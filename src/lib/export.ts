import { expandHF, hasHeaderFooter } from './headerFooter';
import { patchRows, rackCables, rackPortStates } from './rackPatching';
import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RackElevation, rackSize } from '@/components/RackElevation';
import { getStencil } from '@/store/useDiagramStore';
import { libraryNameFromFile } from './libraries';
import { deviceListRows } from './dataImport';
import { DEFAULT_DISPLAY, displayColors } from './display';
import { allDevices, migrateProject } from './project';
import { rackLabel } from './rack';
import { FRAME_COLOR, isDocumented, type AppNode, type CableData, type Page, type Project, type Rack, type StencilDef, type StencilLibraryFile } from './types';

/* ---------- helpers ---------- */

function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

export function downloadBlob(name: string, blob: Blob) {
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
  length: string;
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
        cable: d.cable, vlan: d.vlan ?? '', label: d.label ?? '', length: d.length ?? '',
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

/** Every port someone documented (connected device, IP, VLAN, uplink, notes), for the PDF/print/CSV "Port notes" table. */
export function portRows(p: Project) {
  return p.pages.flatMap((pg) => {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    // What a cable on this page plugs each port into, when the port has no "connected to" written.
    const peer = new Map<string, string>();
    for (const e of pg.edges) {
      peer.set(`${e.source}|${e.sourceHandle}`, `${nodeName(byId.get(e.target))} ${portName(byId.get(e.target), e.targetHandle)}`.trim());
      peer.set(`${e.target}|${e.targetHandle}`, `${nodeName(byId.get(e.source))} ${portName(byId.get(e.source), e.sourceHandle)}`.trim());
    }
    return pg.nodes.flatMap((n) => {
      if (n.type !== 'device') return [];
      const ports = getStencil(n.data.stencilId)?.ports ?? [];
      const order = new Map(ports.map((pt, i) => [pt.id, i]));
      return Object.entries(n.data.ports ?? {})
        .filter(([, pd]) => isDocumented(pd))
        .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
        .map(([pid, pd]) => ({
          page: pg.name,
          device: n.data.name,
          port: portName(n, pid),
          uplink: pd.uplink ? 'Uplink' : '',
          connectedTo: pd.description || peer.get(`${n.id}|${pid}`) || '',
          ip: pd.ip ?? '',
          vlan: pd.vlan ?? '',
          notes: pd.notes ?? '',
        }));
    });
  });
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

/** Every rack's patching schedule: each cable from mounted equipment, port to port, with where the far end is. */
export function patchingRows(p: Project) {
  return (p.racks ?? []).flatMap((r) => patchRows(p, r, getStencil).map((x) => ({
    rack: r.name, fromPosition: x.from.position, fromDevice: x.from.device, fromPort: x.from.port,
    toDevice: x.to.device, toPort: x.to.port, toWhere: x.to.where ? x.to.where : x.to.position, cable: x.cable, vlan: x.vlan, length: x.length,
  })));
}

/* ---------- rack elevations ---------- */

/** Renders a rack's front and rear elevations side by side into a PNG, using the same component as the screen. */
export async function renderRack(p: Project, rack: Rack) {
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
          createElement(RackElevation, { rack, face: 'front', devices, stencil: getStencil, portStates: rackPortStates(p), cables: rackCables(p, rack) }),
          createElement(RackElevation, { rack, face: 'rear', devices, stencil: getStencil, portStates: rackPortStates(p) }),
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

/** What a "selection only" picture keeps: these items, and the cables between them. */
export interface Only { nodes: Set<string>; edges: Set<string> }

async function renderViewport(kind: 'png' | 'svg', bounds: Rect, only?: Only) {
  const pad = 60;
  const width = Math.max(800, Math.ceil(bounds.width + pad * 2));
  const height = Math.max(500, Math.ceil(bounds.height + pad * 2));
  const vp = getViewportForBounds(bounds, width, height, 0.2, 2, `${pad}px`);
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('Canvas not found');
  // The page colour (Design → Backgrounds), as drawn on the sheet.
  const sheetBg = document.querySelector<HTMLElement>('.nc-page-sheet')?.style.backgroundColor || '#ffffff';
  const opts = {
    backgroundColor: sheetBg,
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    // Leave out resize handles and connection dots (shown on selected items).
    // Non-printing layers (Layer Properties → Print) are tagged nc-noprint; their cables are SVG elements.
    filter: (node: Element) => !(node instanceof Element && node.classList?.contains('nc-noprint')) && !(node instanceof HTMLElement && (node.classList?.contains('react-flow__resize-control') || node.classList?.contains('react-flow__handle') || node.classList?.contains('react-flow__node-toolbar') || node.classList?.contains('nc-page-sheet')))
  };
  // Selection outlines and editing handles stay out of the picture; for "selection only", everything else is made
  // invisible (not removed, so nothing shifts) while the picture is taken.
  const hidden: Element[] = [];
  if (only) {
    for (const n of el.querySelectorAll<HTMLElement>('.react-flow__node')) if (!only.nodes.has(n.dataset.id ?? '')) hidden.push(n);
    for (const g of el.querySelectorAll('g.react-flow__edge')) if (!only.edges.has(g.getAttribute('data-id') ?? '')) hidden.push(g.closest('svg') ?? g);
    for (const l of document.querySelectorAll('[data-edge-label]')) if (!only.edges.has(l.getAttribute('data-edge-label') ?? '')) hidden.push(l);
    hidden.forEach((h) => h.classList.add('nc-export-hide'));
  }
  document.body.classList.add('nc-exporting');
  try {
    return { url: kind === 'png' ? await toPng(el, opts) : await toSvg(el, opts), width, height, vp };
  } finally {
    document.body.classList.remove('nc-exporting');
    hidden.forEach((h) => h.classList.remove('nc-export-hide'));
  }
}

export async function exportImage(kind: 'png' | 'svg', p: Project, bounds: Rect, pageName?: string, only?: Only) {
  const { url } = await renderViewport(kind, bounds, only);
  const suffix = only ? '-selection' : p.pages.length > 1 && pageName ? `-${safeName(pageName)}` : '';
  download(`${safeName(p.name)}${suffix}.${kind}`, url);
}

/* ---------- title block ---------- */

/** Cells of the drawing title block (Visio-style border/title), left to right. "Page" is filled in per sheet. */
export function titleBlockCells(p: Project, sheetTitle: string): { label: string; value: string; weight: number }[] {
  const tb = p.titleBlock;
  return [
    { label: 'Client', value: p.name, weight: 1.3 },
    { label: 'Site', value: [p.site, p.address].filter(Boolean).join(', '), weight: 1.5 },
    { label: 'Drawing', value: sheetTitle, weight: 1.5 },
    { label: 'Prepared by', value: tb?.preparedBy ?? '', weight: 1.1 },
    { label: 'Drawn by', value: tb?.author ?? '', weight: 0.9 },
    { label: 'Rev', value: tb?.revision ?? '', weight: 0.4 },
    { label: 'Date', value: tb?.date || new Date().toLocaleDateString(), weight: 0.8 },
  ];
}

/* ---------- PDF ---------- */

/** Captures the canvas for one page (the editor switches to it first), or null if the page is empty. */
export type PageRenderer = (page: Page) => Promise<{ url: string; width: number; height: number } | null>;

/** Captures the live canvas showing `bounds`. */
export const renderCanvasPng = (bounds: Rect) => renderViewport('png', bounds);

/** Captures the live canvas as SVG, with the transform used (to place things on the picture). */
export const renderCanvasSvg = (bounds: Rect) => renderViewport('svg', bounds);

export async function exportPdf(p: Project, renderPage: PageRenderer) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 36;
  // Room kept free at the bottom of every sheet for the title block.
  const tbH = p.titleBlock?.show ? 30 : 0;
  const bottom = H - m - (tbH ? tbH + 8 : 0);
  /** Sheet title of each PDF page, for its title block. */
  const sheetTitles: string[] = [];
  let pages = 0;
  const newPage = () => {
    if (pages++) doc.addPage();
  };

  const look = p.display;
  const frame = look?.frame ?? 'none';
  const fc = look?.frameColor ?? FRAME_COLOR;
  const header = (title: string) => {
    sheetTitles[doc.getNumberOfPages() - 1] = title;
    // Design → Backgrounds / Borders & Titles.
    if (look?.pageColor && look.pageColor.toLowerCase() !== '#ffffff') { doc.setFillColor(look.pageColor); doc.rect(0, 0, W, H, 'F'); }
    if (frame === 'simple') { doc.setDrawColor(fc); doc.setLineWidth(1.5); doc.rect(m / 2, m / 2, W - m, H - m); doc.setLineWidth(0.5); doc.rect(m / 2 - 3, m / 2 - 3, W - m + 6, H - m + 6); doc.setDrawColor(0); }
    const banner = frame === 'banner';
    if (banner) { doc.setFillColor(fc); doc.rect(0, 0, W, m + 22, 'F'); }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    if (banner) doc.setTextColor(255);
    doc.text(banner ? title : p.name, m, m);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(banner ? 230 : 100);
    const sub = [banner ? p.name : '', p.site, p.address, banner ? '' : title, new Date().toLocaleDateString()].filter(Boolean).join('  ·  ');
    doc.text(sub, m, m + 14);
    doc.setTextColor(0);
  };

  const picture = (title: string, img: { url: string; width: number; height: number }) => {
    newPage();
    header(title);
    const top = m + 28;
    const ratio = Math.min((W - m * 2) / img.width, (bottom - top) / img.height);
    doc.addImage(img.url, 'PNG', m, top, img.width * ratio, img.height * ratio, undefined, 'FAST');
  };

  // Legend for data colors, drawn in the top-right corner of each diagram page.
  const colors = displayColors(p);
  const settings = p.display ?? DEFAULT_DISPLAY;
  const legendGroups = [
    { title: colors.deviceTitle, items: colors.deviceLegend },
    { title: colors.cableTitle, items: settings.cableColor === 'vlan' ? colors.cableLegend : [] },
  ].filter((g) => g.title && g.items.length);
  const legend = () => {
    if (!settings.showLegend || !legendGroups.length) return;
    let x = W - m;
    for (const g of [...legendGroups].reverse()) {
      const width = Math.max(doc.getTextWidth(g.title.toUpperCase()), ...g.items.map((i) => doc.getTextWidth(i.label) + 12)) + 10;
      x -= width;
      doc.setFontSize(7);
      doc.setTextColor(110);
      doc.text(g.title.toUpperCase(), x, m - 4);
      g.items.forEach((it, i) => {
        const y = m + 4 + i * 9;
        doc.setDrawColor(it.color);
        doc.setFillColor(it.color);
        doc.rect(x, y - 5, 6, 6, it.dashed ? 'S' : 'F');
        doc.setTextColor(40);
        doc.text(it.label, x + 9, y);
      });
    }
    doc.setTextColor(0);
  };

  for (const pg of p.pages) {
    const img = await renderPage(pg);
    if (!img) continue;
    picture(p.pages.length > 1 ? `${pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: ${pg.name}` : 'Network diagram', img);
    legend();
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
      if (y > bottom) {
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
  table('Patching', ['Rack', 'Position', 'Device', 'Port', 'To device', 'Port', 'Where', 'Cable', 'VLAN'], [0.11, 0.08, 0.17, 0.07, 0.17, 0.07, 0.13, 0.1, 0.1].map((f) => f * avail),
    patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan]));
  table('Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'VLAN', 'Length', 'Label'], [0.1, 0.17, 0.08, 0.17, 0.08, 0.08, 0.08, 0.09, 0.15].map((f) => f * avail),
    connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.length, c.label]));
  table('Port notes', ['Device', 'Port', 'Uplink', 'Connected to', 'IP', 'VLAN', 'Notes'], [0.16, 0.08, 0.07, 0.22, 0.12, 0.07, 0.28].map((f) => f * avail),
    portRows(p).map((r) => [r.device, r.port, r.uplink, r.connectedTo, r.ip, r.vlan, r.notes]));

  // Header and footer (Design / Print → Header & Footer), on every sheet.
  const hf = p.headerFooter;
  if (hasHeaderFooter(hf)) {
    const total = doc.getNumberOfPages();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90);
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const ctx = { page: i, pages: total, sheet: sheetTitles[i - 1] ?? '' };
      ([[hf!.header, 20], [hf!.footer, H - 14]] as const).forEach(([parts, y]) => {
        parts.forEach((t, k) => {
          const s = expandHF(t, p, ctx);
          if (s) doc.text(s, k === 0 ? m : k === 1 ? W / 2 : W - m, y, { align: k === 0 ? 'left' : k === 1 ? 'center' : 'right' });
        });
      });
    }
    doc.setTextColor(0);
  }

  if (tbH) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      drawTitleBlock(doc, [...titleBlockCells(p, sheetTitles[i - 1] ?? ''), { label: 'Page', value: `${i} of ${total}`, weight: 0.6 }], m, H - m - tbH, W - m * 2, tbH);
    }
  }

  doc.save(`${safeName(p.name)}.pdf`);
}

type Pdf = InstanceType<typeof import('jspdf').jsPDF>;

/** A one-row bordered title block: small grey labels over values. */
function drawTitleBlock(doc: Pdf, cells: { label: string; value: string; weight: number }[], x: number, y: number, w: number, h: number) {
  const total = cells.reduce((s, c) => s + c.weight, 0);
  doc.setDrawColor(80);
  doc.setLineWidth(0.8);
  doc.rect(x, y, w, h);
  let cx = x;
  cells.forEach((c, i) => {
    const cw = (c.weight / total) * w;
    if (i) doc.line(cx, y, cx, y + h);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120);
    doc.text(c.label.toUpperCase(), cx + 4, y + 8);
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(20);
    doc.text(doc.splitTextToSize(c.value, cw - 8)[0] ?? '', cx + 4, y + h - 8);
    cx += cw;
  });
  doc.setTextColor(0);
  doc.setLineWidth(0.2);
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
    ['CONNECTIONS'], ['Page', 'From device', 'From port', 'To device', 'To port', 'Cable', 'VLAN', 'Length', 'Label'],
    ...conns.map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.length, c.label]),
    [],
    ['RACKS'], ['Rack', 'Position', 'Height', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power (W)'],
    ...rackRows(p).map((r) => [r.rack, r.position, r.height, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW]),
    [],
    ['PATCHING'], ['Rack', 'Position', 'Device', 'Port', 'To device', 'To port', 'Where', 'Cable', 'VLAN', 'Length'],
    ...patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan, r.length]),
    [],
    ['PORT NOTES'], ['Page', 'Device', 'Port', 'Uplink', 'Connected to', 'IP', 'VLAN', 'Notes'],
    ...portRows(p).map((r) => [r.page, r.device, r.port, r.uplink, r.connectedTo, r.ip, r.vlan, r.notes]),
  ];
  // BOM so Excel reads UTF-8 correctly.
  downloadBlob(`${safeName(p.name)}.csv`, new Blob(['\ufeff' + csv(lines)], { type: 'text/csv;charset=utf-8' }));
}

/** One flat device sheet (with RackDraw IDs) meant to be edited in Excel and imported back. */
export function exportDeviceList(p: Project) {
  const rows = deviceListRows(p, (id) => getStencil(id)?.name ?? id);
  downloadBlob(`${safeName(p.name)}-devices.csv`, new Blob(['﻿' + csv(rows)], { type: 'text/csv;charset=utf-8' }));
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
  downloadBlob(`${safeName(p.name)}.rackdraw.json`, new Blob([body], { type: 'application/json' }));
}

export async function readProjectFile(file: File): Promise<{ project: Project; stencils: StencilDef[] }> {
  const json = JSON.parse(await file.text());
  if (json?.format === 'netcraft-stencils') throw new Error('This is a stencil library. Use "Import library" in the shapes palette.');
  const p = json?.project ?? json;
  const valid = p && (Array.isArray(p.pages) || (Array.isArray(p.nodes) && Array.isArray(p.edges)));
  if (!valid) throw new Error('Not a RackDraw diagram file.');
  return {
    // Files saved by v0.2 and earlier have one diagram; migrateProject turns it into a page.
    project: migrateProject({ name: file.name.replace(/\.(rackdraw|netcraft)\.json$|\.json$/i, ''), createdAt: Date.now(), ...p }),
    stencils: Array.isArray(json.stencils) ? json.stencils : [],
  };
}

/* ---------- stencil libraries ---------- */

export function saveStencilLibrary(stencils: StencilDef[], name = 'my-stencils', library?: string) {
  const file: StencilLibraryFile = { format: 'netcraft-stencils', version: 1, ...(library ? { name: library } : {}), stencils };
  downloadBlob(`${safeName(name)}.rackdraw-stencils.json`, new Blob([JSON.stringify(file)], { type: 'application/json' }));
}

/**
 * Reads a library or project file. `library` is where stencils without their own library name go:
 * the file's library name, else a name made from the file name (project files: undefined → "My stencils").
 */
export async function readStencilLibrary(file: File): Promise<{ stencils: StencilDef[]; library?: string }> {
  const json = JSON.parse(await file.text());
  // A project file also carries the custom stencils it uses, so accept either.
  const list = json?.stencils;
  if (!Array.isArray(list)) throw new Error('No stencils found in this file.');
  if (json?.format !== 'netcraft-stencils') return { stencils: list };
  const named = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : undefined;
  return { stencils: list, library: named ?? libraryNameFromFile(file.name) };
}
