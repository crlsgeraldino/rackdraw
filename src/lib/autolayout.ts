import type { AppNode, CableEdge, StencilDef } from './types';

/**
 * Auto-arrange (like Visio's Re-Layout Page, top to bottom): devices are put in rows by how far they are, in
 * cables, from the top of the network (ISP → firewall → switches → endpoints), keeping rows centred and each
 * device under the devices it hangs off.
 */

/** Rank of a stencil category at the top of a network: lower = higher up. */
const RANK: Record<string, number> = { WAN: 0, Firewalls: 1, Switching: 2, Wireless: 3, Servers: 3, Endpoints: 4, Custom: 3, Layout: 5 };

export interface LayoutItem {
  id: string;
  /** Width/height to reserve, including anything drawn beside the device (info box). */
  w: number;
  h: number;
  category: string;
  name: string;
}

export const H_GAP = 60;
export const V_GAP = 110;

export type LayoutKind = 'top-down' | 'left-right' | 'compact' | 'radial' | 'circular';
type LEdge = Pick<CableEdge, 'source' | 'target'> & { sourceHandle?: string | null; targetHandle?: string | null };
type PortX = (nodeId: string, handle?: string | null) => number | undefined;

/**
 * Layers by cable distance from the top of each connected group (ISP → firewall → switches → endpoints), each layer
 * ordered under its parents. Children of the same parent are ordered by the port they plug into on it (left to
 * right), so cables from a switch to a row of devices don't cross. Unconnected devices form the last layer.
 */
function layering(items: LayoutItem[], edges: LEdge[], portX?: PortX) {
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const adj = new Map(items.map((i) => [i.id, new Set<string>()]));
  const via = new Map<string, number>(); // "parent|child" → x of the port on the parent
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
    const xs = portX?.(e.source, e.sourceHandle), xt = portX?.(e.target, e.targetHandle);
    if (xs !== undefined && !via.has(`${e.source}|${e.target}`)) via.set(`${e.source}|${e.target}`, xs);
    if (xt !== undefined && !via.has(`${e.target}|${e.source}`)) via.set(`${e.target}|${e.source}`, xt);
  }
  const rank = (id: string) => RANK[byId.get(id)!.category] ?? 3;

  const layer = new Map<string, number>();
  const parent = new Map<string, string>();
  const isolated: string[] = [];
  const unvisited = new Set(ids);
  while (unvisited.size) {
    const group: string[] = [];
    const seed = [...unvisited][0];
    const stack = [seed];
    unvisited.delete(seed);
    while (stack.length) {
      const v = stack.pop()!;
      group.push(v);
      for (const w of adj.get(v)!) if (unvisited.has(w)) { unvisited.delete(w); stack.push(w); }
    }
    if (group.length === 1) {
      isolated.push(group[0]);
      continue;
    }
    const root = group.reduce((a, b) => (rank(b) < rank(a) || (rank(b) === rank(a) && adj.get(b)!.size > adj.get(a)!.size) ? b : a));
    layer.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const v = queue.shift()!;
      // Visit higher-ranked neighbours first so a firewall stays above the switches beside it.
      for (const w of [...adj.get(v)!].sort((a, b) => rank(a) - rank(b))) {
        if (layer.has(w)) continue;
        layer.set(w, layer.get(v)! + 1);
        parent.set(w, v);
        queue.push(w);
      }
    }
  }
  const depth = Math.max(-1, ...layer.values());
  isolated.forEach((id) => layer.set(id, depth + 1));

  const rows: string[][] = [];
  for (const [id, l] of layer) (rows[l] ??= []).push(id);
  const place = new Map<string, number>();
  rows.forEach((row, l) => {
    const key = (id: string) => {
      const p = parent.get(id);
      return { p: l && p !== undefined ? place.get(p) ?? 0 : 0, port: p !== undefined ? via.get(`${p}|${id}`) ?? Infinity : Infinity };
    };
    row.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka.p - kb.p || (ka.port === kb.port ? 0 : ka.port < kb.port ? -1 : 1) || rank(a) - rank(b) || byId.get(a)!.name.localeCompare(byId.get(b)!.name, undefined, { numeric: true });
    });
    row.forEach((id, i) => place.set(id, i));
  });
  return { rows, parent, byId };
}

/** Positions (top-left) for the items, starting at `origin`, in one of Visio's Re-Layout Page styles. */
export function layoutPage(kind: LayoutKind, items: LayoutItem[], edges: LEdge[], origin: { x: number; y: number }, opts: { spacing?: number; portX?: PortX } = {}) {
  const k = opts.spacing ?? 1;
  const hGap = H_GAP * k, vGap = V_GAP * k;
  const { rows, parent, byId } = layering(items, edges, opts.portX);
  const out = new Map<string, { x: number; y: number }>();
  const size = (id: string) => byId.get(id)!;

  if (kind === 'top-down') {
    const widths = rows.map((row) => row.reduce((s, id) => s + size(id).w, 0) + hGap * (row.length - 1));
    const widest = Math.max(...widths, 0);
    let y = origin.y;
    rows.forEach((row, l) => {
      let x = origin.x + (widest - widths[l]) / 2;
      for (const id of row) {
        out.set(id, { x: Math.round(x), y: Math.round(y) });
        x += size(id).w + hGap;
      }
      y += Math.max(...row.map((id) => size(id).h)) + vGap;
    });
  } else if (kind === 'left-right') {
    const heights = rows.map((row) => row.reduce((s, id) => s + size(id).h, 0) + (hGap / 2) * (row.length - 1));
    const tallest = Math.max(...heights, 0);
    let x = origin.x;
    rows.forEach((row, l) => {
      let y = origin.y + (tallest - heights[l]) / 2;
      for (const id of row) {
        out.set(id, { x: Math.round(x), y: Math.round(y) });
        y += size(id).h + hGap / 2;
      }
      x += Math.max(...row.map((id) => size(id).w)) + vGap * 1.2;
    });
  } else if (kind === 'compact') {
    // Compact tree: each device's children in a column below it, indented; top-level devices side by side.
    const kids = new Map<string, string[]>();
    for (const row of rows) for (const id of row) {
      const p = parent.get(id);
      if (p) kids.set(p, [...(kids.get(p) ?? []), id]);
    }
    const indent = 40 * k, gap = 24 * k;
    const place = (id: string, x: number, y: number): { w: number; h: number } => {
      out.set(id, { x: Math.round(x), y: Math.round(y) });
      let w = size(id).w;
      let cy = y + size(id).h + gap;
      for (const c of kids.get(id) ?? []) {
        const sub = place(c, x + indent, cy);
        cy += sub.h + gap;
        w = Math.max(w, indent + sub.w);
      }
      return { w, h: cy - y - gap };
    };
    let x = origin.x;
    for (const id of rows.flat()) {
      if (out.has(id) || parent.has(id)) continue;
      x += place(id, x, origin.y).w + hGap * 1.5;
    }
  } else {
    // Radial: the top device in the middle, each layer on a ring further out. Circular: everything on one ring.
    const all = rows.flat();
    const maxDim = Math.max(...all.map((id) => Math.max(size(id).w, size(id).h)), 60);
    const rings = kind === 'circular' ? [all] : rows;
    rings.forEach((ring, r) => {
      const n = ring.length;
      if (kind === 'radial' && r === 0 && n === 1) {
        out.set(ring[0], { x: Math.round(-size(ring[0]).w / 2), y: Math.round(-size(ring[0]).h / 2) });
        return;
      }
      // Big enough for the items to fit around it with a gap, and rings well apart.
      const need = (n * (maxDim + hGap)) / (2 * Math.PI);
      const radius = Math.max(need, (kind === 'radial' ? r : 1) * (maxDim + vGap));
      ring.forEach((id, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        out.set(id, { x: Math.round(radius * Math.cos(a) - size(id).w / 2), y: Math.round(radius * Math.sin(a) - size(id).h / 2) });
      });
    });
    const minX = Math.min(...[...out.values()].map((p) => p.x)), minY = Math.min(...[...out.values()].map((p) => p.y));
    for (const [id, p] of out) out.set(id, { x: p.x - minX + origin.x, y: p.y - minY + origin.y });
  }
  return out;
}

/** Positions (top-left) for the items, starting at `origin` (top to bottom). */
export function layoutTopDown(items: LayoutItem[], edges: LEdge[], origin: { x: number; y: number }, portX?: PortX) {
  return layoutPage('top-down', items, edges, origin, { portX });
}

/** Size of a device on the diagram from its stencil (or its set size). */
export function deviceSize(n: AppNode, stencilOf: (id: string) => StencilDef | undefined) {
  if (n.width && n.height) return { w: n.width, h: n.height };
  if (n.type === 'device') {
    const s = stencilOf(n.data.stencilId);
    if (s) {
      const k = s.style === 'icon' ? 1 : s.scale;
      return { w: s.width * k, h: s.height * k };
    }
  }
  return { w: n.measured?.width ?? 160, h: n.measured?.height ?? 80 };
}
