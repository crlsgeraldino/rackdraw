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

/** Positions (top-left) for the items, starting at `origin`. */
export function layoutTopDown(items: LayoutItem[], edges: Pick<CableEdge, 'source' | 'target'>[], origin: { x: number; y: number }) {
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const adj = new Map(items.map((i) => [i.id, new Set<string>()]));
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  const rank = (id: string) => RANK[byId.get(id)!.category] ?? 3;

  // Layer = cable distance from the top-most device of each connected group; unconnected devices go last.
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

  // Order each row under its parents (barycentre of the parent's place in the row above), else by name.
  const place = new Map<string, number>();
  rows.forEach((row, l) => {
    row.sort((a, b) => {
      const pa = parent.get(a), pb = parent.get(b);
      const ka = l && pa !== undefined ? place.get(pa) ?? 0 : 0, kb = l && pb !== undefined ? place.get(pb) ?? 0 : 0;
      return ka - kb || rank(a) - rank(b) || byId.get(a)!.name.localeCompare(byId.get(b)!.name, undefined, { numeric: true });
    });
    row.forEach((id, i) => place.set(id, i));
  });

  const widths = rows.map((row) => row.reduce((s, id) => s + byId.get(id)!.w, 0) + H_GAP * (row.length - 1));
  const widest = Math.max(...widths, 0);
  const out = new Map<string, { x: number; y: number }>();
  let y = origin.y;
  rows.forEach((row, l) => {
    let x = origin.x + (widest - widths[l]) / 2;
    for (const id of row) {
      out.set(id, { x: Math.round(x), y: Math.round(y) });
      x += byId.get(id)!.w + H_GAP;
    }
    y += Math.max(...row.map((id) => byId.get(id)!.h)) + V_GAP;
  });
  return out;
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
