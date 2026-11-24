/**
 * Label printing: cable labels (both ends), asset labels with a QR code, and patch panel port strips, laid out on
 * common Avery sheets (or plain paper for strips) as print-ready HTML.
 */
import { allDevices } from './project';
import { qrSvg } from './qr';
import { isPassThrough, tracePath } from './trace';
import type { CableData, CableEdge, DeviceNode, Project, StencilDef } from './types';

type Stencils = (id: string) => StencilDef | undefined;

export interface LabelSheet {
  id: string;
  name: string;
  paper: 'letter' | 'a4';
  cols: number;
  rows: number;
  /** Label size and layout, in inches. */
  w: number;
  h: number;
  top: number;
  left: number;
  gapX: number;
  gapY: number;
}

const MM = 1 / 25.4;
export const LABEL_SHEETS: LabelSheet[] = [
  { id: '5160', name: 'Avery 5160 / 8160 · 30 per sheet · 2⅝ × 1 in', paper: 'letter', cols: 3, rows: 10, w: 2.625, h: 1, top: 0.5, left: 0.1875, gapX: 0.125, gapY: 0 },
  { id: '5167', name: 'Avery 5167 · 80 per sheet · 1¾ × ½ in', paper: 'letter', cols: 4, rows: 20, w: 1.75, h: 0.5, top: 0.5, left: 0.28125, gapX: 0.3125, gapY: 0 },
  { id: '5163', name: 'Avery 5163 · 10 per sheet · 4 × 2 in', paper: 'letter', cols: 2, rows: 5, w: 4, h: 2, top: 0.5, left: 0.15625, gapX: 0.1875, gapY: 0 },
  { id: 'L7160', name: 'Avery L7160 (A4) · 21 per sheet · 63.5 × 38.1 mm', paper: 'a4', cols: 3, rows: 7, w: 63.5 * MM, h: 38.1 * MM, top: 15.15 * MM, left: 7.25 * MM, gapX: 2.5 * MM, gapY: 0 },
  { id: 'L7651', name: 'Avery L7651 (A4) · 65 per sheet · 38.1 × 21.2 mm', paper: 'a4', cols: 5, rows: 13, w: 38.1 * MM, h: 21.2 * MM, top: 10.7 * MM, left: 4.75 * MM, gapX: 2.5 * MM, gapY: 0 },
];

export interface Label {
  title: string;
  lines: string[];
  /** Text encoded in a QR code on the label. */
  qr?: string;
  /** Small colour bar (the cable's VLAN / type colour). */
  color?: string;
}

/** Physical cables only: Wi-Fi, Bluetooth, VPN, MPLS… links have nothing to label. */
const NOT_A_CABLE = new Set(['Wireless', 'Bluetooth', 'Cellular', 'Microwave', 'Satellite', 'VPN', 'MPLS', 'Line']);

const portLabel = (d: DeviceNode | undefined, port: string | null | undefined, stencil: Stencils) =>
  port ? d?.data.ports?.[port]?.label || (d && stencil(d.data.stencilId)?.ports.find((x) => x.id === port)?.label) || port : '';

export interface CableLabelOptions {
  /** One label for each end (this end first), or one label per cable with both ends. */
  perEnd: boolean;
  pageId?: string;
}

/** Cables in print order, with the number each gets when it has no label ("C-001"). */
export function labelledCables(p: Project, pageId?: string): { e: CableEdge; id: string }[] {
  let n = 0;
  return p.pages
    .filter((pg) => !pageId || pg.id === pageId)
    .flatMap((pg) => pg.edges)
    .filter((e) => !NOT_A_CABLE.has(e.data?.cable ?? 'Cat6'))
    .map((e) => ({ e, id: e.data?.label?.trim() || `C-${String(++n).padStart(3, '0')}` }));
}

export function cableLabels(p: Project, stencil: Stencils, o: CableLabelOptions, colorOf?: (d?: CableData) => string): Label[] {
  const devices = new Map(allDevices(p).map((d) => [d.id, d] as const));
  const out: Label[] = [];
  for (const { e, id } of labelledCables(p, o.pageId)) {
    const a = devices.get(e.source), b = devices.get(e.target);
    const end = (d: DeviceNode | undefined, port?: string | null) => [d?.data.name ?? '?', portLabel(d, port, stencil)].filter(Boolean).join(' · ');
    const info = [e.data?.cable, e.data?.vlan && `VLAN ${e.data.vlan}`, e.data?.length].filter(Boolean).join(' · ');
    const color = colorOf?.(e.data);
    if (o.perEnd) {
      out.push({ title: id, lines: [`▶ ${end(a, e.sourceHandle)}`, `to ${end(b, e.targetHandle)}`, info].filter(Boolean), color });
      out.push({ title: id, lines: [`▶ ${end(b, e.targetHandle)}`, `to ${end(a, e.sourceHandle)}`, info].filter(Boolean), color });
    } else {
      out.push({ title: id, lines: [`A ${end(a, e.sourceHandle)}`, `B ${end(b, e.targetHandle)}`, info].filter(Boolean), color });
    }
  }
  return out;
}

/** Things drawn that aren't physical equipment to tag. */
const NOT_ASSETS = /^(internet|mpls-cloud|carrier-cloud|cloud-service|building|remote-user)$/;

export interface AssetLabelOptions {
  /** What the QR code holds: the device's web link (falls back to details), its details, or no QR. */
  qr: 'details' | 'link' | 'none';
  pageId?: string;
}

export function assetLabels(p: Project, stencil: Stencils, o: AssetLabelOptions): Label[] {
  return p.pages
    .filter((pg) => !o.pageId || pg.id === o.pageId)
    .flatMap((pg) => pg.nodes.filter((n): n is DeviceNode => n.type === 'device'))
    .filter((d) => !NOT_ASSETS.test(d.data.stencilId) && !(stencil(d.data.stencilId)?.category === 'Cabling'))
    .map((d) => {
      const x = d.data;
      const lines = [x.model, x.serial && `S/N ${x.serial}`, x.assetTag && `Asset ${x.assetTag}`, x.ip && `IP ${x.ip}`].filter(Boolean) as string[];
      const details = [p.name, x.name, x.model, x.serial && `S/N ${x.serial}`, x.assetTag && `Asset ${x.assetTag}`, x.ip && `IP ${x.ip}`, x.location].filter(Boolean).join('\n');
      const link = /^https?:\/\//i.test(x.link ?? '') ? x.link : undefined;
      const qr = o.qr === 'none' ? undefined : (o.qr === 'link' && link) || truncateUtf8(details, 200);
      return { title: x.name, lines, qr };
    });
}

function truncateUtf8(s: string, max: number) {
  const enc = new TextEncoder();
  while (enc.encode(s).length > max) s = s.slice(0, -1);
  return s;
}

export interface PanelStrip {
  panel: string;
  /** One row of the panel (24 ports), as cells: port number and what it serves. */
  rows: { port: string; text: string }[][];
}

/** Patch panel port strips: each port's jack / outlet, or else what its back run reaches. */
export function panelStrips(p: Project, stencil: Stencils, pageId?: string): PanelStrip[] {
  return p.pages
    .filter((pg) => !pageId || pg.id === pageId)
    .flatMap((pg) => pg.nodes.filter((n): n is DeviceNode => n.type === 'device'))
    .filter((d) => { const s = stencil(d.data.stencilId); return !!s && !s.custom && s.id.startsWith('patch-panel') ? true : isPassThrough(d, s) && /patch/i.test(s?.name ?? ''); })
    .map((d) => {
      const s = stencil(d.data.stencilId)!;
      const cells = s.ports.filter((x) => x.kind === 'rj45' || x.kind === 'sfp').map((port) => {
        const note = d.data.ports?.[port.id]?.description?.trim();
        let text = note ? note.replace(/^wall\s*jack\s*/i, '').replace(/^outlet\s*/i, '') : '';
        if (!text) {
          // What the back of this port reaches: the end of its path that isn't a switch.
          const t = tracePath(p, d.id, port.id, stencil);
          const ends = t.hops.filter((h) => !h.passThrough && h.nodeId !== d.id);
          const far = ends.find((h) => { const n = allDevices(p).find((x) => x.id === h.nodeId); return n && stencil(n.data.stencilId)?.category !== 'Switching'; });
          text = far?.name ?? '';
        }
        return { port: port.label || port.id, text };
      });
      const rows: { port: string; text: string }[][] = [];
      for (let i = 0; i < cells.length; i += 24) rows.push(cells.slice(i, i + 24));
      return { panel: d.data.name, rows };
    });
}

/* ---------- print-ready HTML ---------- */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Sheets of labels as HTML (absolutely positioned, in inches); `skip` leaves the first N labels of the first sheet unused. */
export function labelSheetsHtml(labels: Label[], sheet: LabelSheet, opts: { skip?: number; outlines?: boolean } = {}): string {
  const per = sheet.cols * sheet.rows;
  const slots: (Label | null)[] = [...new Array(Math.min(opts.skip ?? 0, per - 1)).fill(null), ...labels];
  const pageW = sheet.paper === 'letter' ? 8.5 : 210 * MM, pageH = sheet.paper === 'letter' ? 11 : 297 * MM;
  const small = sheet.h < 0.75;
  const qrSize = Math.min(sheet.h - 0.12, sheet.w * 0.42);
  const pages: string[] = [];
  for (let s = 0; s < slots.length; s += per) {
    const cells = slots.slice(s, s + per).map((l, i) => {
      if (!l) return '';
      const c = i % sheet.cols, r = Math.floor(i / sheet.cols);
      const x = sheet.left + c * (sheet.w + sheet.gapX), y = sheet.top + r * (sheet.h + sheet.gapY);
      const qr = l.qr ? `<div class="qr" style="width:${qrSize}in;height:${qrSize}in">${qrSvg(l.qr, 96)}</div>` : '';
      return `<div class="lb${opts.outlines ? ' ol' : ''}${small ? ' sm' : ''}" style="left:${x}in;top:${y}in;width:${sheet.w}in;height:${sheet.h}in">`
        + (l.color ? `<i style="background:${esc(l.color)}"></i>` : '')
        + `<div class="tx"><b>${esc(l.title)}</b>${l.lines.map((t) => `<span>${esc(t)}</span>`).join('')}</div>${qr}</div>`;
    }).join('');
    pages.push(`<section class="lsheet" style="width:${pageW}in;height:${pageH}in">${cells}</section>`);
  }
  return pages.join('');
}

/** Patch panel strips on plain paper: blocks of six ports (the width of a typical label window), cut out and slid in. */
export function stripsHtml(strips: PanelStrip[], blockWidthIn = 2.5): string {
  const cellW = blockWidthIn / 6;
  return `<section class="strips">${strips.map((s) => `<div class="panel"><h3>${esc(s.panel)}</h3>${s.rows.map((row) => {
    const blocks: string[] = [];
    for (let i = 0; i < row.length; i += 6) {
      blocks.push(`<div class="blk" style="width:${blockWidthIn}in">${row.slice(i, i + 6).map((c) => `<div class="cell" style="width:${cellW}in"><small>${esc(c.port)}</small><span>${esc(c.text)}</span></div>`).join('')}</div>`);
    }
    return `<div class="row">${blocks.join('')}</div>`;
  }).join('')}</div>`).join('')}</section>`;
}

/** Styles for both kinds of output (screen preview and print). */
export const LABEL_CSS = `
.lsheet { position: relative; background: #fff; overflow: hidden; break-after: page; }
.lsheet:last-child { break-after: auto; }
.lb { position: absolute; box-sizing: border-box; padding: 0.06in 0.08in; display: flex; gap: 0.06in; align-items: center; overflow: hidden; font-family: 'Segoe UI', Arial, sans-serif; color: #000; }
.lb.ol { outline: 0.5pt dashed #999; outline-offset: -0.5pt; }
.lb > i { position: absolute; left: 0; top: 0.08in; bottom: 0.08in; width: 0.06in; border-radius: 0 2px 2px 0; }
.lb .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
.lb .tx b { font-size: 9pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb .tx span { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb.sm { padding: 0.02in 0.05in; }
.lb.sm .tx b { font-size: 6.5pt; }
.lb.sm .tx span { font-size: 5pt; }
.lb .qr { flex-shrink: 0; }
.lb .qr svg { width: 100%; height: 100%; display: block; }
.strips { font-family: 'Segoe UI', Arial, sans-serif; padding: 0.4in; }
.strips .panel { margin-bottom: 0.25in; break-inside: avoid; }
.strips h3 { font-size: 9pt; margin: 0 0 3pt; }
.strips .row { display: flex; gap: 0.2in; margin-bottom: 0.12in; flex-wrap: wrap; }
.strips .blk { display: flex; border: 0.75pt solid #000; height: 0.32in; box-sizing: border-box; }
.strips .cell { box-sizing: border-box; border-left: 0.5pt solid #000; padding: 1pt 2pt; display: flex; flex-direction: column; overflow: hidden; }
.strips .cell:first-child { border-left: 0; }
.strips .cell small { font-size: 5pt; color: #444; line-height: 1; }
.strips .cell span { font-size: 6.5pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
`;
