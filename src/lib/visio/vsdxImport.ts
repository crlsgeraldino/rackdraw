'use client';

import { libraryNameFromFile } from '../libraries';
import { newPage } from '../project';
import { CABLE_STYLES, DEVICE_STATUSES, type AppNode, type CableEdge, type CableType, type DeviceData, type Page, type PortDef, type Project, type StencilDef } from '../types';
import { canvasDibEncoder, VisioPackage, type PageItem } from './vssx';

/**
 * "Open a Visio drawing": turns each page of a .vsdx into a NetCraft page. Pictures become devices (their Shape
 * Data fills the device fields, their shapes go into a library named after the file), plain boxes/ellipses/text
 * become drawing shapes (transparent dashed boxes become zones), and connectors become cables between the shapes
 * they are glued to (or, for drawings NetCraft saved, between the devices named in their From/To data).
 */

const uid = () => Math.random().toString(36).slice(2, 10);

/** Shape Data labels Visio and vendors commonly use, mapped to device fields. */
const FIELD_ALIASES: [keyof DeviceData, RegExp][] = [
  ['name', /^(name|host ?name|device ?name)$/i],
  ['ip', /^(ip|ip ?address|management ?ip|mgmt ?ip)$/i],
  ['mac', /^(mac|mac ?address)$/i],
  ['serial', /^(serial|serial ?number|s\/n|sn)$/i],
  ['model', /^(model|product ?number|product)$/i],
  ['assetTag', /^(asset ?tag|asset ?number|asset)$/i],
  ['location', /^(location|building|room)$/i],
  ['notes', /^(notes?|description|comments?)$/i],
];
const IGNORED = /^(type|status)$/i;

/** Ports on the four sides, for pictures that have no connection points, so cables can attach. */
function sidePorts(w: number, h: number): PortDef[] {
  const s = Math.max(6, Math.min(12, Math.min(w, h) * 0.2));
  return [
    { id: 'T', label: 'Top', kind: 'link', x: w / 2 - s / 2, y: 0, w: s, h: s, side: 'top' },
    { id: 'R', label: 'Right', kind: 'link', x: w - s, y: h / 2 - s / 2, w: s, h: s, side: 'right' },
    { id: 'B', label: 'Bottom', kind: 'link', x: w / 2 - s / 2, y: h - s, w: s, h: s, side: 'bottom' },
    { id: 'L', label: 'Left', kind: 'link', x: 0, y: h / 2 - s / 2, w: s, h: s, side: 'left' },
  ];
}

export interface VsdxImport {
  project: Project;
  stencils: StencilDef[];
  summary: { pages: number; devices: number; cables: number; shapes: number; skippedLines: number; warnings: string[] };
}

export async function importVsdx(file: File): Promise<VsdxImport> {
  const pkg = await VisioPackage.open(file, { drawing: true });
  const library = libraryNameFromFile(file.name);
  const stencils: StencilDef[] = [];
  const byMaster = new Map<string, StencilDef>();
  const pages: Page[] = [];
  const summary = { pages: 0, devices: 0, cables: 0, shapes: 0, skippedLines: 0, warnings: [] as string[] };

  for (const vp of pkg.pages) {
    const { items, connects, warnings } = pkg.readPage(vp, canvasDibEncoder);
    summary.warnings.push(...warnings);
    const nodes: AppNode[] = [];
    const edges: CableEdge[] = [];
    // Visio shape id → NetCraft node, and where each device's ports are on the page.
    const nodeFor = new Map<string, { node: AppNode; stencil?: StencilDef; k: number }>();
    const byName = new Map<string, { node: AppNode; stencil?: StencilDef; k: number }>();

    // Text NetCraft wrote for a device's label / info box: recreate those on the device instead.
    const pictureNames = new Set(items.filter((i) => i.kind === 'picture').map((i) => i.data.Name || i.name));
    const ownText = (i: PageItem) => i.kind !== 'line' && i.kind !== 'picture' && /\s(label|info)$/.test(i.name) && pictureNames.has(i.name.replace(/\s(label|info)$/, ''));
    const infoFor = new Set(items.filter((i) => ownText(i) && i.name.endsWith(' info')).map((i) => i.name.replace(/\sinfo$/, '')));

    for (const it of items) {
      if (it.kind === 'line' || ownText(it)) continue;
      if (it.kind === 'picture' && it.svg) {
        const key = it.masterId ? `m:${it.masterId}` : '';
        let st = key ? byMaster.get(key) : undefined;
        if (!st) {
          st = {
            id: `custom-${uid()}`,
            name: (it.masterId && it.text.split('\n')[0]) || it.name || 'Visio shape',
            library, category: 'Custom', style: 'image', custom: true,
            image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(it.svg)}`,
            width: Math.max(1, it.w), height: Math.max(1, it.h), scale: 1,
            ports: it.ports?.length ? it.ports : sidePorts(it.w, it.h),
          };
          stencils.push(st);
          if (key) byMaster.set(key, st);
        }
        const data: DeviceData = { stencilId: st.id, name: '' };
        const extra: { label: string; value: string }[] = [];
        for (const [label, value] of Object.entries(it.data)) {
          const field = FIELD_ALIASES.find(([, re]) => re.test(label.trim()))?.[0];
          if (field) (data as Record<string, unknown>)[field] = value;
          else if (/^status$/i.test(label) && DEVICE_STATUSES.some((s) => s.value === value)) data.status = value as DeviceData['status'];
          else if (!IGNORED.test(label)) extra.push({ label, value });
        }
        if (!data.name) data.name = it.text.split('\n')[0] || it.name || st.name;
        if (extra.length) data.extraFields = extra;
        if (infoFor.has(data.name)) data.infoBox = { show: true };
        const node: AppNode = { id: `n-${uid()}`, type: 'device', position: { x: it.x, y: it.y }, data };
        // Same shape drawn at another size: scale this device (proportions from the shape).
        const k = it.w / st.width;
        if (Math.abs(k - 1) > 0.01) Object.assign(node, { width: it.w, height: st.height * k });
        nodes.push(node);
        const ref = { node, stencil: st, k };
        nodeFor.set(it.id, ref);
        byName.set(data.name, ref);
        summary.devices++;
      } else {
        const zone = it.kind === 'box' && it.dashed && (it.fillTransparency ?? 0) > 0.5;
        let node: AppNode;
        if (zone) {
          node = { id: `z-${uid()}`, type: 'zone', position: { x: it.x, y: it.y }, zIndex: -1, style: { width: it.w, height: it.h }, data: { title: it.text.split('\n')[0] || 'Zone', color: it.stroke ?? '#3b82f6' } };
        } else {
          const kind = it.kind === 'ellipse' ? 'ellipse' : it.kind === 'text' ? 'text' : (it.rounding ?? 0) > 2 ? 'rounded' : 'rect';
          node = {
            id: `s-${uid()}`, type: 'shape', position: { x: it.x, y: it.y }, width: Math.max(20, it.w), height: Math.max(14, it.h),
            data: {
              kind, text: it.text, fill: it.fill ?? 'transparent', stroke: it.stroke ?? 'transparent', textColor: it.textColor,
              fontSize: Math.max(8, Math.min(48, Math.round(it.fontPx))), dashed: it.dashed || undefined, rotation: 0,
            },
          };
        }
        nodes.push(node);
        nodeFor.set(it.id, { node, k: 1 });
        summary.shapes++;
      }
    }

    // Cables: glued ends first, else the From / To names NetCraft writes.
    const glue = new Map<string, { begin?: string; end?: string }>();
    for (const c of connects) glue.set(c.connector, { ...glue.get(c.connector), [c.end]: c.shape });
    const portNear = (ref: { node: AppNode; stencil?: StencilDef; k: number }, [x, y]: [number, number]) => {
      if (!ref.stencil) return null; // drawing shapes use their side handles
      let best: { id: string; d: number } | null = null;
      for (const p of ref.stencil.ports) {
        const cx = ref.node.position.x + (p.x + p.w / 2) * ref.k, cy = ref.node.position.y + (p.y + p.h / 2) * ref.k;
        const d = Math.hypot(cx - x, cy - y);
        if (!best || d < best.d) best = { id: p.id, d };
      }
      return best?.id ?? null;
    };
    const sideNear = (node: AppNode, [x, y]: [number, number]) => {
      const w = node.width ?? 160, h = node.height ?? 80;
      const dx = x - (node.position.x + w / 2), dy = y - (node.position.y + h / 2);
      return Math.abs(dx) / w > Math.abs(dy) / h ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
    };
    for (const it of items) {
      if (it.kind !== 'line' || !it.points || it.points.length < 2) continue;
      const g = glue.get(it.id);
      const a = (g?.begin && nodeFor.get(g.begin)) || byName.get(it.data.From ?? '');
      const b = (g?.end && nodeFor.get(g.end)) || byName.get(it.data.To ?? '');
      if (!a || !b || a.node === b.node) {
        summary.skippedLines++;
        continue;
      }
      const first = it.points[0], last = it.points[it.points.length - 1];
      const sourceHandle = a.stencil ? portNear(a, first) : sideNear(a.node, first);
      const targetHandle = b.stencil ? portNear(b, last) : sideNear(b.node, last);
      const type = (Object.keys(CABLE_STYLES) as CableType[]).find((t) => t.toLowerCase() === (it.data.Cable ?? '').toLowerCase());
      const cable: CableType = type ?? (a.stencil && b.stencil ? 'Cat6' : 'Line');
      const color = it.lineColor && it.lineColor.toLowerCase() !== CABLE_STYLES[cable].color.toLowerCase() && it.lineColor !== '#000000' ? it.lineColor : undefined;
      edges.push({
        id: `e-${uid()}`, type: 'cable', source: a.node.id, target: b.node.id, sourceHandle, targetHandle,
        data: {
          cable, color, route: 'step',
          vlan: it.data.VLAN || undefined, length: it.data.Length || undefined, label: it.data.Label || undefined,
          arrows: it.arrows?.start && it.arrows?.end ? 'both' : it.arrows?.end ? 'end' : it.arrows?.start ? 'start' : undefined,
        },
      } as CableEdge);
      summary.cables++;
    }

    const pg = newPage(vp.name, 'network', nodes, edges);
    pg.setup = { paper: 'letter', landscape: vp.widthIn >= vp.heightIn };
    pages.push(pg);
    summary.pages++;
  }
  if (!pages.length) throw new Error('This Visio file has no pages to open.');
  const now = Date.now();
  const project: Project = { id: uid(), name: file.name.replace(/\.vsdx$/i, ''), pages, activePageId: pages[0].id, createdAt: now, updatedAt: now };
  return { project, stencils, summary };
}
