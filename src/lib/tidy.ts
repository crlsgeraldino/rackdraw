/**
 * Design → Tidy Diagram: one click from "devices dropped wherever" (e.g. everything added from the rack view, which
 * lands in a column down the left) to a presentable network page:
 *  1. `tidyPrepare`: UPS / PDU / other rack-only gear that has network cables is shown on the diagram (patch panels
 *     stay rack-only: their runs are drawn "via" them), an Internet cloud goes above a modem whose uplink is free,
 *     and dragged info boxes go back beside their devices.
 *  2. `tidyLayout` (once the page is redrawn and measured): devices top-down by cabling, rows wrapped to the sheet
 *     width and never straddling a page break, and a box round each rack's devices.
 */
import { layoutPage, type LayoutItem, V_GAP } from './autolayout';
import { isPassThrough } from './trace';
import { drawingCables, isRackOnly } from './rackOnly';
import type { AppNode, CableEdge, DeviceNode, Page, Rack, StencilDef, ZoneNode } from './types';

export interface TidyOptions {
  /** Show rack-only devices that have network cables (UPS / PDU management ports). */
  showRackGear: boolean;
  /** Add an Internet cloud above a modem / router whose uplink is free. */
  internet: boolean;
  /** Put a box (zone) round each rack's devices. */
  rackZones: boolean;
}

export const TIDY_DEFAULTS: TidyOptions = { showRackGear: true, internet: true, rackZones: true };

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Pass 1: what is shown and what is added. Returns the page's new nodes and edges, and what changed. `icons`: the
 * page will draw devices as symbols (their names then go beside them, clear of cables running up and down).
 */
export function tidyPrepare(page: Page, stencil: (id: string) => StencilDef | undefined, o: TidyOptions, icons = false) {
  let nodes = page.nodes;
  let edges = page.edges;
  const shown: string[] = [];
  if (o.showRackGear) {
    const visible = new Set(nodes.filter((n) => n.type === 'device' && !isRackOnly(n)).map((n) => n.id));
    nodes = nodes.map((n) => {
      if (!isRackOnly(n) || n.type !== 'device' || isPassThrough(n, stencil(n.data.stencilId))) return n;
      const linked = edges.some((e) => (e.source === n.id && visible.has(e.target)) || (e.target === n.id && visible.has(e.source)));
      if (!linked) return n;
      shown.push(n.data.name);
      const data = { ...n.data };
      delete data.showOn;
      return { ...n, data } as AppNode;
    });
  }
  let internet: string | null = null;
  if (o.internet && !nodes.some((n) => n.type === 'device' && n.data.stencilId === 'internet')) {
    const used = new Set(edges.flatMap((e) => [`${e.source}|${e.sourceHandle}`, `${e.target}|${e.targetHandle}`]));
    for (const n of nodes) {
      if (n.type !== 'device' || isRackOnly(n)) continue;
      const st = stencil(n.data.stencilId);
      if (!st || st.category !== 'WAN') continue;
      const up = st.ports.find((p) => /^(uplink|wan\d*)$/i.test(p.id) && p.side === 'top' && !used.has(`${n.id}|${p.id}`));
      if (!up) continue;
      internet = `n-${uid()}`;
      nodes = [...nodes, { id: internet, type: 'device', position: { x: n.position.x, y: n.position.y - 160 }, data: { stencilId: 'internet', name: 'Internet' } } as AppNode];
      edges = [...edges, { id: `e-${uid()}`, type: 'cable', source: internet, sourceHandle: 'WAN', target: n.id, targetHandle: up.id, data: { cable: 'WAN' } } as CableEdge];
      break;
    }
  }
  // Info boxes and labels dragged somewhere go back to their places, so the layout leaves room for them. Names of
  // icons go to their left: cables leave icons from the top and bottom, and the info box is on the right.
  nodes = nodes.map((n) => {
    if (n.type !== 'device') return n;
    const st = stencil(n.data.stencilId);
    const icon = st?.style === 'icon' || (icons && !!st);
    const data = { ...n.data, labelOffset: undefined, ...(icon ? { labelSide: 'left' as const } : {}) };
    if (data.infoBox?.offset) data.infoBox = { ...data.infoBox, offset: undefined };
    return { ...n, data } as AppNode;
  });
  return { nodes, edges, shown, internet };
}

export interface TidyItem extends LayoutItem {
  /** How far the drawing sticks out left of the box's x (a label wider than its device). */
  left?: number;
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Pass 2: positions for the items (each with its measured size, label and info box included), laid out top-down
 * by the page's cables on sheets of `sheet` size, and zones for the racks.
 */
export function tidyLayout(page: Page, items: TidyItem[], racks: Rack[], sheet: { w: number; h: number }, stencil: (id: string) => StencilDef | undefined, o: TidyOptions) {
  const margin = 48;
  const hGap = 56;
  const vGap = Math.round(V_GAP * 0.8);
  const drawn = drawingCables(page.nodes, page.edges, stencil);
  const edges = [...page.edges.filter((e) => !drawn.hidden.has(e.id)), ...drawn.via];
  const raw = layoutPage('top-down', items, edges, { x: 0, y: 0 });
  const byId = new Map(items.map((i) => [i.id, i]));

  // Rows as the layered layout made them, each left to right.
  const rowsAt = new Map<number, string[]>();
  for (const [id, p] of raw) rowsAt.set(p.y, [...(rowsAt.get(p.y) ?? []), id]);
  const rows = [...rowsAt.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids.sort((a, b) => raw.get(a)!.x - raw.get(b)!.x));

  // As many sheets across as the widest single item needs (usually one).
  const widest = Math.max(0, ...items.map((i) => i.w));
  const cols = Math.max(1, Math.ceil((widest + 2 * margin) / sheet.w));
  const usable = cols * sheet.w - 2 * margin;
  const wrapped: string[][] = [];
  for (const row of rows) {
    let line: string[] = [], w = 0;
    for (const id of row) {
      const iw = byId.get(id)!.w;
      if (line.length && w + hGap + iw > usable) { wrapped.push(line); line = []; w = 0; }
      w += (line.length ? hGap : 0) + iw;
      line.push(id);
    }
    if (line.length) wrapped.push(line);
  }

  const out = new Map<string, { x: number; y: number }>();
  const zoneHead = o.rackZones ? 40 : 0;
  let y = margin + zoneHead;
  for (const line of wrapped) {
    const h = Math.max(...line.map((id) => byId.get(id)!.h));
    // A row never straddles a page break: it starts on the next sheet instead.
    const sheetEnd = (Math.floor(y / sheet.h) + 1) * sheet.h - margin;
    if (y + h > sheetEnd && h <= sheet.h - 2 * margin) y = sheetEnd + 2 * margin + zoneHead;
    const total = line.reduce((s, id) => s + byId.get(id)!.w, 0) + hGap * (line.length - 1);
    // Centred on the first sheet when it fits on one (so a vertical page break doesn't cut through it), else
    // across the sheets it needs.
    const span = total <= sheet.w - 2 * margin ? sheet.w - 2 * margin : usable;
    let x = margin + Math.max(0, (span - total) / 2);
    for (const id of line) {
      const it = byId.get(id)!;
      out.set(id, { x: Math.round(x + (it.left ?? 0)), y: Math.round(y) });
      x += it.w + hGap;
    }
    y += h + vGap;
  }

  // A box round each rack's devices (shown on this page), unless something else would end up inside it.
  const zones: { title: string; box: Box }[] = [];
  if (o.rackZones) {
    const boxOf = (id: string): Box => { const p = out.get(id)!, it = byId.get(id)!; return { x: p.x - (it.left ?? 0), y: p.y, w: it.w, h: it.h }; };
    for (const r of racks) {
      const inRack = new Set(r.items.map((it) => it.nodeId).filter((x): x is string => !!x));
      const mine = items.filter((i) => inRack.has(i.id) && out.has(i.id));
      if (mine.length < 2) continue;
      const bs = mine.map((i) => boxOf(i.id));
      const x0 = Math.min(...bs.map((b) => b.x)) - 24, y0 = Math.min(...bs.map((b) => b.y)) - 24 - 28;
      const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 24, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 20;
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const intruder = items.some((i) => !inRack.has(i.id) && out.has(i.id) && overlaps(box, boxOf(i.id)));
      if (intruder || zones.some((z) => overlaps(z.box, box))) continue;
      zones.push({ title: r.location ? `${r.name} · ${r.location}` : r.name, box });
    }
  }
  return { positions: out, zones };
}

/** Puts the zones on the page: an existing zone with the same title is moved / resized, else a new one is added. */
export function placeZones(nodes: AppNode[], zones: { title: string; box: Box }[]): AppNode[] {
  let out = nodes;
  for (const z of zones) {
    const size = { width: Math.round(z.box.w), height: Math.round(z.box.h) };
    const position = { x: Math.round(z.box.x), y: Math.round(z.box.y) };
    const hit = out.find((n): n is ZoneNode => n.type === 'zone' && n.data.title === z.title);
    if (hit) {
      out = out.map((n) => (n === hit ? { ...n, position, width: size.width, height: size.height, style: { ...(n.style ?? {}), ...size } } as AppNode : n));
    } else {
      out = [...out, { id: `z-${uid()}`, type: 'zone', position, zIndex: -1, style: size, data: { title: z.title, color: '#475569', style: 'header' } } as AppNode];
    }
  }
  return out;
}

/** The devices Tidy lays out: shown on the diagram and not locked in place. */
export const tidyDevices = (page: Page): DeviceNode[] =>
  page.nodes.filter((n): n is DeviceNode => n.type === 'device' && !isRackOnly(n) && !n.data.locked);
