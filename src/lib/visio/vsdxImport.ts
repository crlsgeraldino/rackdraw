'use client';

import { libraryNameFromFile } from '../libraries';
import { newPage } from '../project';
import { CABLE_STYLES, DEVICE_STATUSES, type AppNode, type CableEdge, type CableType, type DeviceData, type Layer, type Page, type PortDef, type Project, type StencilDef } from '../types';
import { canvasDibEncoder, looksLikeEquipment, VisioPackage, type PageItem } from './vssx';
import { RD_SHAPE } from './vsdxWriter';

/**
 * An SVG as a data URL, escaping only what a data URL needs (%, #, line breaks): pictures embedded in it as base64
 * stay their own size instead of growing ~2× under full URL encoding.
 */
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${svg.replace(/[%#\r\n]/g, (c) => encodeURIComponent(c))}`;

type Pt = [number, number];

/**
 * A RackDraw door from a Visio door's swing (page px): the rotation / flip whose hinge, closed leaf and open leaf
 * point the same ways, in a square box as wide as the leaf. RackDraw's door, unturned: hinge bottom-left, closed
 * leaf along the bottom (the wall), open leaf up the left side.
 */
function doorFrom(d: { hinge: Pt; wallTip: Pt; openTip: Pt }, wallPx: number | undefined, layer: string | undefined): AppNode | null {
  const r = Math.hypot(d.wallTip[0] - d.hinge[0], d.wallTip[1] - d.hinge[1]);
  if (!(r > 1)) return null;
  const unit = (a: Pt, b: Pt): Pt => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const u = unit(d.hinge, d.wallTip), v = unit(d.hinge, d.openTip);
  // The same turn RackDraw applies when drawing (and saving) a door, on the unit square.
  const turn = (rot: number, flip: boolean, [x0, y0]: Pt): Pt => {
    const [x, y] = flip ? [1 - x0, y0] : [x0, y0];
    return rot === 90 ? [1 - y, x] : rot === 180 ? [1 - x, 1 - y] : rot === 270 ? [y, 1 - x] : [x, y];
  };
  let best: { rot: number; flip: boolean; score: number; h: Pt } | null = null;
  for (const rot of [0, 90, 180, 270]) for (const flip of [false, true]) {
    const h = turn(rot, flip, [0, 1]), w = turn(rot, flip, [1, 1]), o = turn(rot, flip, [0, 0]);
    const su = unit(h, w), sv = unit(h, o);
    const score = su[0] * u[0] + su[1] * u[1] + sv[0] * v[0] + sv[1] * v[1];
    if (!best || score > best.score) best = { rot, flip, score, h };
  }
  const b = best!;
  return {
    id: `s-${uid()}`, type: 'shape', position: { x: d.hinge[0] - b.h[0] * r, y: d.hinge[1] - b.h[1] * r }, width: r, height: r,
    data: {
      kind: 'door', text: '', rotation: b.rot, flip: b.flip || undefined, wallGap: wallPx && wallPx > 1 ? Math.round(wallPx * 10) / 10 : undefined,
      fill: 'transparent', stroke: '#374151', textColor: '#111827', fontSize: 14, layer,
    },
  } as AppNode;
}

/**
 * "Open a Visio drawing": turns each page of a .vsdx into a RackDraw page. Pictures become devices (their Shape
 * Data fills the device fields, their shapes go into a library named after the file), plain boxes/ellipses/text
 * become drawing shapes (transparent dashed boxes become zones), and connectors become cables between the shapes
 * they are glued to (or, for drawings RackDraw saved, between the devices named in their From/To data).
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

const isEquipment = (it: PageItem) => looksLikeEquipment(it.data, it.fields ?? [], it.masterName);

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
  // Visio layers become client layers, matched by name across pages.
  const layers: Layer[] = [];
  const layerId = (vp: { layers?: { name: string; visible: boolean; print: boolean; lock: boolean }[] }, idx?: number[]) => {
    const l = idx?.length ? vp.layers?.[idx[0]] : undefined;
    if (!l) return undefined;
    let hit = layers.find((x) => x.name.toLowerCase() === l.name.toLowerCase());
    if (!hit) {
      hit = { id: `l-${uid()}`, name: l.name, visible: l.visible, print: l.print ? undefined : false, locked: l.lock || undefined };
      layers.push(hit);
    }
    return hit.id;
  };
  const pageIdOf = new Map<string, string>(); // Visio page ID → RackDraw page id

  for (const vp of pkg.pages) {
    const { items, connects, warnings } = pkg.readPage(vp, canvasDibEncoder);
    summary.warnings.push(...warnings);
    const nodes: AppNode[] = [];
    const edges: CableEdge[] = [];
    // Visio shape id → RackDraw node, and where each device's ports are on the page.
    const nodeFor = new Map<string, { node: AppNode; stencil?: StencilDef; k: number }>();
    const byName = new Map<string, { node: AppNode; stencil?: StencilDef; k: number }>();

    // Text RackDraw wrote for a device's label / info box: recreate those on the device instead.
    const pictureNames = new Set(items.filter((i) => i.kind === 'picture').map((i) => i.data.Name || i.name));
    const ownText = (i: PageItem) => i.kind !== 'line' && i.kind !== 'wall' && i.kind !== 'door' && i.kind !== 'window' && i.kind !== 'picture' && /\s(label|info)$/.test(i.name) && pictureNames.has(i.name.replace(/\s(label|info)$/, ''));
    const infoFor = new Set(items.filter((i) => ownText(i) && i.name.endsWith(' info')).map((i) => i.name.replace(/\sinfo$/, '')));

    for (const it of items) {
      // Doors and windows RackDraw saved come back as doors and windows (their extra lines are drawn by them).
      const own = it.data[RD_SHAPE];
      if (own === 'doorway' || own === 'window-glass') continue;
      if (own === 'door' || own === 'window') {
        const pts = it.points ?? [];
        const box = own === 'door' && pts.length
          ? { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), w: 0, h: 0 }
          : { x: it.x, y: it.y, w: it.w, h: it.h };
        if (own === 'door' && pts.length) { box.w = Math.max(...pts.map((p) => p[0])) - box.x; box.h = Math.max(...pts.map((p) => p[1])) - box.y; }
        const rotation = Number(it.data.Rotation) || 0;
        const wallGap = Number(it.data['Wall gap']) || undefined;
        nodes.push({
          id: `s-${uid()}`, type: 'shape', position: { x: box.x, y: box.y }, width: Math.max(4, box.w), height: Math.max(4, box.h),
          data: {
            kind: own, text: '', rotation: own === 'door' ? rotation : 0, flip: own === 'door' && it.data.Flip === '1' ? true : undefined, wallGap,
            fill: own === 'window' ? it.fill ?? 'transparent' : 'transparent', stroke: (own === 'door' ? it.lineColor : it.stroke) ?? '#374151',
            textColor: '#111827', fontSize: 14, layer: layerId(vp, it.layers),
          },
        } as AppNode);
        summary.shapes++;
        continue;
      }
      if (it.kind === 'window') {
        // A Visio window: a RackDraw window in the same place along its wall.
        nodes.push({
          id: `s-${uid()}`, type: 'shape', position: { x: it.x, y: it.y }, width: Math.max(4, it.w), height: Math.max(4, it.h),
          data: { kind: 'window', text: '', rotation: 0, fill: '#e0f2fe', stroke: '#374151', textColor: '#111827', fontSize: 14, layer: layerId(vp, it.layers) },
        } as AppNode);
        summary.shapes++;
        continue;
      }
      if (it.kind === 'door' && it.door) {
        const node = doorFrom(it.door, it.thicknessPx, layerId(vp, it.layers));
        if (node) { nodes.push(node); summary.shapes++; }
        continue;
      }
      if (it.kind === 'line' || ownText(it)) continue;
      if (it.kind === 'wall' && it.points && it.points.length >= 2) {
        // A Visio wall becomes a RackDraw wall (doors and windows snap into it, its length shows with the scale).
        const [[x1, y1], [x2, y2]] = it.points;
        nodes.push({ id: `m-${uid()}`, type: 'measure', position: { x: x1, y: y1 }, data: { dx: x2 - x1, dy: y2 - y1, variant: 'wall', thickness: Math.max(2, Math.round((it.thicknessPx ?? 8) * 10) / 10), layer: layerId(vp, it.layers) } });
        summary.shapes++;
        continue;
      }
      if (it.kind === 'picture' && it.svg && !isEquipment(it)) {
        // Part of a drawing (an ER table, a flowchart symbol, a logo…): a picture of exactly this copy, with its own
        // size and text, that cables can still connect to.
        const node: AppNode = {
          id: `s-${uid()}`, type: 'shape', position: { x: it.x, y: it.y }, width: Math.max(4, it.w), height: Math.max(4, it.h),
          data: { kind: 'image', text: '', src: svgUrl(it.svg), fill: 'transparent', stroke: 'transparent', textColor: '#111827', fontSize: 14, rotation: 0, layer: layerId(vp, it.layers) },
        };
        nodes.push(node);
        nodeFor.set(it.id, { node, k: 1 });
        summary.shapes++;
      } else if (it.kind === 'picture' && it.svg) {
        const key = it.masterId ? `m:${it.masterId}` : '';
        let st = key ? byMaster.get(key) : undefined;
        if (!st) {
          st = {
            id: `custom-${uid()}`,
            name: (it.masterId && it.text.split('\n')[0]) || it.name || 'Visio shape',
            library, category: 'Custom', style: 'image', custom: true,
            image: svgUrl(it.svg),
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
        data.layer = layerId(vp, it.layers);
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
        const zone = it.container || (it.kind === 'box' && it.dashed && (it.fillTransparency ?? 0) > 0.5);
        let node: AppNode;
        if (zone) {
          node = { id: `z-${uid()}`, type: 'zone', position: { x: it.x, y: it.y }, zIndex: -1, style: { width: it.w, height: it.h }, data: { title: it.text.split('\n')[0] || 'Zone', color: it.stroke ?? '#3b82f6' } };
        } else {
          const kind = it.kind === 'ellipse' ? 'ellipse' : it.kind === 'diamond' ? 'diamond' : it.kind === 'text' ? 'text' : (it.rounding ?? 0) > 2 ? 'rounded' : 'rect';
          // Visio's fill transparency (0–1): fully transparent boxes (swimlane lists, frames) have no fill at all.
          const trans = it.fillTransparency ?? 0;
          node = {
            id: `s-${uid()}`, type: 'shape', position: { x: it.x, y: it.y }, width: Math.max(20, it.w), height: Math.max(14, it.h),
            data: {
              kind, text: it.text, fill: it.fill && trans < 0.99 ? it.fill : 'transparent', stroke: it.stroke ?? 'transparent', textColor: it.textColor,
              fillTransparency: trans >= 0.01 && trans < 0.99 ? Math.round(trans * 100) : undefined,
              fontSize: Math.max(8, Math.min(48, Math.round(it.fontPx))), dashed: it.dashed || undefined, rotation: 0,
              align: it.align, valign: it.valign, bold: it.bold || undefined,
              layer: layerId(vp, it.layers),
            },
          };
        }
        nodes.push(node);
        nodeFor.set(it.id, { node, k: 1 });
        summary.shapes++;
      }
    }

    // Cables: glued ends first, else the From / To names RackDraw writes.
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
      if (it.kind !== 'line' || !it.points || it.points.length < 2 || it.data[RD_SHAPE]) continue;
      const g = glue.get(it.id);
      const a = (g?.begin && nodeFor.get(g.begin)) || byName.get(it.data.From ?? '');
      const b = (g?.end && nodeFor.get(g.end)) || byName.get(it.data.To ?? '');
      if (!a || !b || a.node === b.node) {
        // Not a connector between two shapes: keep it as a drawn line (two points) or a freeform drawing.
        const ptsL = it.points;
        const color = it.lineColor ?? '#374151';
        const width = Math.max(1, Math.round(it.lineWidthPx ?? 2));
        if (ptsL.length === 2) {
          const [[x1, y1], [x2, y2]] = ptsL;
          nodes.push({ id: `m-${uid()}`, type: 'measure', position: { x: x1, y: y1 }, data: { dx: x2 - x1, dy: y2 - y1, variant: 'line', color, thickness: width, dashed: it.dashed || undefined, arrowStart: it.arrows?.start || undefined, arrowEnd: it.arrows?.end || undefined, label: it.text || undefined, layer: layerId(vp, it.layers) } });
        } else {
          const xs = ptsL.map((p) => p[0]), ys = ptsL.map((p) => p[1]);
          const x0 = Math.min(...xs), y0 = Math.min(...ys);
          const w = Math.max(10, Math.max(...xs) - x0), h = Math.max(10, Math.max(...ys) - y0);
          nodes.push({
            id: `s-${uid()}`, type: 'shape', position: { x: x0, y: y0 }, width: w, height: h,
            data: { kind: 'freeform', text: '', fill: 'transparent', stroke: color, textColor: '#111827', fontSize: 14, rotation: 0, dashed: it.dashed || undefined, points: ptsL.map(([px, py]) => [(px - x0) / w, (py - y0) / h] as [number, number]), layer: layerId(vp, it.layers) },
          });
        }
        summary.shapes++;
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
          layer: layerId(vp, it.layers),
        },
      } as CableEdge);
      summary.cables++;
    }

    // A scaled Visio page (floor plan) opens as a floor-plan page with the same drawing scale, so lengths, wall
    // lengths and room areas read in real units.
    const scaled = vp.scale != null && Math.abs(vp.scale - 1) > 1e-6;
    const hasWalls = nodes.some((n) => n.type === 'measure' && n.data.variant === 'wall');
    const pg = newPage(vp.name, scaled || hasWalls ? 'floorplan' : 'network', nodes, edges);
    if (scaled) {
      const realInPerPx = 1 / (96 * vp.scale!);
      pg.scale = vp.realUnit === 'm' ? { perPx: realInPerPx * 0.0254, unit: 'm' } : { perPx: realInPerPx / 12, unit: 'ft' };
    }
    pg.setup = { paper: 'letter', landscape: vp.widthIn >= vp.heightIn };
    if (vp.background) pg.background = true;
    if (vp.id) pageIdOf.set(vp.id, pg.id);
    if (vp.backPage) pg.backgroundId = vp.backPage; // Visio ID for now; mapped below
    pages.push(pg);
    summary.pages++;
  }
  for (const pg of pages) if (pg.backgroundId) pg.backgroundId = pageIdOf.get(pg.backgroundId);
  // Visio lists background pages last; keep a foreground page first so the drawing opens on it.
  pages.sort((a, b) => Number(!!a.background) - Number(!!b.background));
  if (!pages.length) throw new Error('This Visio file has no pages to open.');
  const now = Date.now();
  const project: Project = { id: uid(), name: file.name.replace(/\.vs[dt]x$/i, ''), pages, activePageId: pages[0].id, createdAt: now, updatedAt: now, ...(layers.length ? { layers } : {}) };
  return { project, stencils, summary };
}
