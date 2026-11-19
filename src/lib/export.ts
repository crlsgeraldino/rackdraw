import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RackElevation, rackSize } from '@/components/RackElevation';
import { getStencil } from '@/store/useDiagramStore';
import { allDevices, migrateProject } from './project';
import { rackLabel } from './rack';
import type { AppNode, CableData, Page, Project, Rack, StencilDef, StencilLibraryFile } from './types';

/* ---------- helpers ---------- */

function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  download(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(s: string) {
  return s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'diagram';
}

function nodeName(n: AppNode | undefined) {
  if (!n) return '?';
  if (n.type === 'device') return n.data.name;
  if (n.type === 'zone') return n.data.title;
  return 'Note';
}

function portName(n: AppNode | undefined, portId?: string | null) {
  if (!n || n.type !== 'device' || !portId) return portId ?? '';
  const def = getStencil(n.data.stencilId)?.ports.find((p) => p.id === portId);
  return n.data.ports?.[portId]?.label || def?.label || portId;
}

export interface ConnectionRow {
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  cable: string;
  vlan: string;
  label: string;
  page: string;
}

export function connectionRows(p: Project): ConnectionRow[] {
  return p.pages.flatMap((pg) => {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    return pg.edges.map((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      const d = (e.data ?? { cable: 'Cat6' }) as CableData;
      return {
        page: pg.name,
        fromDevice: nodeName(a), fromPort: portName(a, e.sourceHandle),
        toDevice: nodeName(b), toPort: portName(b, e.targetHandle),
        cable: d.cable, vlan: d.vlan ?? '', label: d.label ?? '',
      };
    });
  });
}

/** "Rack A U12–U13" for each mounted device. */
function rackPositions(p: Project) {
  const pos = new Map<string, string>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) pos.set(it.nodeId, `${r.name} ${rackLabel(it)}`);
  return pos;
}

export function deviceRows(p: Project) {
  const pos = rackPositions(p);
  return p.pages.flatMap((pg) => pg.nodes.flatMap((n) => (n.type === 'device' ? [{ n, page: pg.name }] : []))).map(({ n, page }) => ({
    page,
    name: n.data.name,
    type: getStencil(n.data.stencilId)?.name ?? n.data.stencilId,
    model: n.data.model ?? '',
    ip: n.data.ip ?? '',
    serial: n.data.serial ?? '',
    assetTag: n.data.assetTag ?? '',
    rack: pos.get(n.id) ?? '',
    location: n.data.location ?? '',
    powerW: n.data.powerW ?? '',
    notes: n.data.notes ?? '',
  }));
}

export function rackRows(p: Project) {
  const devices = new Map(allDevices(p).map((n) => [n.id, n] as const));
  return (p.racks ?? []).flatMap((r) =>
    [...r.items].sort((a, b) => b.u - a.u).map((it) => {
      const d = it.nodeId ? devices.get(it.nodeId)?.data : undefined;
      return {
        rack: r.name,
        position: rackLabel(it),
        height: `${it.height}U`,
        depth: it.depth === 'full' ? 'Full' : it.depth === 'front' ? 'Front' : 'Rear',
        item: it.kind === 'device' ? d?.name ?? 'Missing device' : it.label ?? it.kind,
        model: d?.model ?? '',
        serial: d?.serial ?? '',
        assetTag: d?.assetTag ?? '',
        powerW: d?.powerW ?? '',
      };
    }),
  );
}

/* ---------- rack elevations ---------- */

/** Renders a rack's front and rear elevations side by side into a PNG, using the same component as the screen. */
async function renderRack(p: Project, rack: Rack) {
  const devices = new Map(allDevices(p).map((n) => [n.id, n]));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        createElement(
          'div',
          null,
          createElement(RackElevation, { rack, face: 'front', devices, stencil: getStencil }),
          createElement(RackElevation, { rack, face: 'rear', devices, stencil: getStencil }),
        ),
      ),
    );
    const size = rackSize(rack);
    const gap = 40;
    const k = 2; // print resolution
    const canvas = document.createElement('canvas');
    canvas.width = (size.width * 2 + gap) * k;
    canvas.height = size.height * k;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const faces = [...(host.firstElementChild?.children ?? [])] as SVGSVGElement[];
    for (const [i, svg] of faces.entries()) {
      const markup = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await img.decode();
      ctx.drawImage(img, i * (size.width + gap) * k, 0, size.width * k, size.height * k);
    }
    return { url: canvas.toDataURL('image/png'), width: canvas.width / k, height: canvas.height / k };
  } finally {
    root.unmount();
    host.remove();
  }
}

/* ---------- image export ---------- */

async function renderViewport(kind: 'png' | 'svg', bounds: Rect) {
  const pad = 60;
  const width = Math.max(800, Math.ceil(bounds.width + pad * 2));
  const height = Math.max(500, Math.ceil(bounds.height + pad * 2));
  const vp = getViewportForBounds(bounds, width, height, 0.2, 2, `${pad}px`);
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('Canvas not found');
  const opts = {
    backgroundColor: '#ffffff',
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    filter: (node: Element) => !(node instanceof HTMLElement && node.classList?.contains('react-flow__resize-control')),
  };
  return { url: kind === 'png' ? await toPng(el, opts) : await toSvg(el, opts), width, height };
}

export async function exportImage(kind: 'png' | 'svg', p: Project, bounds: Rect, pageName?: string) {
  const { url } = await renderViewport(kind, bounds);
  const suffix = p.pages.length > 1 && pageName ? `-${safeName(pageName)}` : '';
  download(`${safeName(p.name)}${suffix}.${kind}`, url);
}

/* ---------- PDF ---------- */

/** Captures the canvas for one page (the editor switches to it first), or null if the page is empty. */
export type PageRenderer = (page: Page) => Promise<{ url: string; width: number; height: number } | null>;

/** Captures the live canvas showing `bounds`. */
export const renderCanvasPng = (bounds: Rect) => renderViewport('png', bounds);

export async function exportPdf(p: Project, renderPage: PageRenderer) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 36;
  let pages = 0;
  const newPage = () => {
    if (pages++) doc.addPage();
  };

  const header = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(p.name, m, m);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    const sub = [p.site, p.address, title, new Date().toLocaleDateString()].filter(Boolean).join('  ·  ');
    doc.text(sub, m, m + 14);
    doc.setTextColor(0);
  };

  const picture = (title: string, img: { url: string; width: number; height: number }) => {
    newPage();
    header(title);
    const top = m + 28;
    const ratio = Math.min((W - m * 2) / img.width, (H - top - m) / img.height);
    doc.addImage(img.url, 'PNG', m, top, img.width * ratio, img.height * ratio, undefined, 'FAST');
  };

  for (const pg of p.pages) {
    const img = await renderPage(pg);
    if (img) picture(p.pages.length > 1 ? `${pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: ${pg.name}` : 'Network diagram', img);
  }
  for (const rack of p.racks ?? []) {
    picture(['Rack elevation', rack.name, rack.location].filter(Boolean).join(': '), await renderRack(p, rack));
  }

  const table = (title: string, cols: string[], widths: number[], rows: string[][]) => {
    if (!rows.length) return;
    newPage();
    header(title);
    let y = m + 40;
    const row = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      let x = m;
      cells.forEach((c, i) => {
        doc.text(doc.splitTextToSize(c, widths[i] - 6)[0] ?? '', x + 3, y);
        x += widths[i];
      });
      doc.setDrawColor(220);
      doc.line(m, y + 5, W - m, y + 5);
      y += 16;
    };
    row(cols, true);
    for (const r of rows) {
      if (y > H - m) {
        doc.addPage();
        header(`${title} (cont.)`);
        y = m + 40;
        row(cols, true);
      }
      row(r, false);
    }
  };

  const avail = W - m * 2;
  table('Devices', ['Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack'], [0.18, 0.16, 0.14, 0.12, 0.13, 0.1, 0.17].map((f) => f * avail),
    deviceRows(p).map((d) => [d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack || d.location]));
  table('Rack contents', ['Rack', 'Position', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power'], [0.13, 0.1, 0.07, 0.2, 0.15, 0.14, 0.11, 0.1].map((f) => f * avail),
    rackRows(p).map((r) => [r.rack, r.position, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW === '' ? '' : `${r.powerW} W`]));
  table('Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'VLAN', 'Label'], [0.11, 0.18, 0.09, 0.18, 0.09, 0.09, 0.09, 0.17].map((f) => f * avail),
    connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.label]));

  doc.save(`${safeName(p.name)}.pdf`);
}

/* ---------- CSV (opens in Excel) ---------- */

function csv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export function exportCsv(p: Project) {
  const conns = connectionRows(p);
  const lines = [
    ['Client', p.name], ['Site', p.site ?? ''], [],
    ['DEVICES'], ['Page', 'Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack position', 'Location', 'Power (W)', 'Notes'],
    ...deviceRows(p).map((d) => [d.page, d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack, d.location, d.powerW, d.notes]),
    [],
    ['CONNECTIONS'], ['Page', 'From device', 'From port', 'To device', 'To port', 'Cable', 'VLAN', 'Label'],
    ...conns.map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.label]),
    [],
    ['RACKS'], ['Rack', 'Position', 'Height', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power (W)'],
    ...rackRows(p).map((r) => [r.rack, r.position, r.height, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW]),
  ];
  // BOM so Excel reads UTF-8 correctly.
  downloadBlob(`${safeName(p.name)}.csv`, new Blob(['\ufeff' + csv(lines)], { type: 'text/csv;charset=utf-8' }));
}

/* ---------- project files ---------- */

/** Saves a project; custom stencils it uses are embedded so the file opens on any computer. */
export function saveProjectFile(p: Project) {
  const clean: Project = {
    ...p,
    pages: p.pages.map((pg) => ({
      ...pg,
      nodes: pg.nodes.map((n) => ({ ...n, selected: false })),
      edges: pg.edges.map((e) => ({ ...e, selected: false })),
    })),
  };
  const used = new Set(allDevices(p).map((n) => n.data.stencilId));
  const stencils = [...used].map(getStencil).filter((s): s is StencilDef => !!s?.custom);
  const body = JSON.stringify({ format: 'netcraft', version: 3, project: clean, stencils }, null, 2);
  downloadBlob(`${safeName(p.name)}.netcraft.json`, new Blob([body], { type: 'application/json' }));
}

export async function readProjectFile(file: File): Promise<{ project: Project; stencils: StencilDef[] }> {
  const json = JSON.parse(await file.text());
  if (json?.format === 'netcraft-stencils') throw new Error('This is a stencil library. Use "Import library" under My stencils.');
  const p = json?.project ?? json;
  const valid = p && (Array.isArray(p.pages) || (Array.isArray(p.nodes) && Array.isArray(p.edges)));
  if (!valid) throw new Error('Not a NetCraft diagram file.');
  return {
    // Files saved by v0.2 and earlier have one diagram; migrateProject turns it into a page.
    project: migrateProject({ name: file.name.replace(/\.netcraft\.json$|\.json$/i, ''), createdAt: Date.now(), ...p }),
    stencils: Array.isArray(json.stencils) ? json.stencils : [],
  };
}

/* ---------- stencil libraries ---------- */

export function saveStencilLibrary(stencils: StencilDef[], name = 'my-stencils') {
  const file: StencilLibraryFile = { format: 'netcraft-stencils', version: 1, stencils };
  downloadBlob(`${safeName(name)}.netcraft-stencils.json`, new Blob([JSON.stringify(file)], { type: 'application/json' }));
}

export async function readStencilLibrary(file: File): Promise<StencilDef[]> {
  const json = JSON.parse(await file.text());
  // A project file also carries the custom stencils it uses, so accept either.
  const list = json?.stencils;
  if (!Array.isArray(list)) throw new Error('No stencils found in this file.');
  return list;
}
