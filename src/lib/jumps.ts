'use client';

import { useSyncExternalStore } from 'react';
import type { Pt } from './router';

/**
 * Line jumps (Visio "line jumps"): where two cables cross, the horizontal one hops over the vertical one.
 * Each right-angle cable publishes its corner points here so the others can find where they cross it.
 */
const routes = new Map<string, Pt[]>();
let version = 0;
const listeners = new Set<() => void>();

const same = (a?: Pt[], b?: Pt[]) => !!a && !!b && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

export function publishRoute(id: string, pts: Pt[] | null) {
  if (pts ? same(routes.get(id), pts) : !routes.has(id)) return;
  if (pts) routes.set(id, pts);
  else routes.delete(id);
  version++;
  listeners.forEach((l) => l());
}

export function useRoutesVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
}

export const otherRoutes = (id: string) => [...routes.entries()].filter(([k]) => k !== id).map(([, v]) => v);

/**
 * Where each cable is actually drawn, after parallel runs were spread into lanes. Line jumps use these, so a cable
 * only hops where it really crosses another (the raw routes above are what the lanes are worked out from).
 */
const drawn = new Map<string, Pt[]>();
export function publishDrawn(id: string, pts: Pt[] | null) {
  if (pts ? same(drawn.get(id), pts) : !drawn.has(id)) return;
  if (pts) drawn.set(id, pts);
  else drawn.delete(id);
  version++;
  listeners.forEach((l) => l());
}
export const otherDrawnRoutes = (id: string) => [...drawn.entries()].filter(([k]) => k !== id).map(([, v]) => v);

/** Hop radius, and how close to a corner or end a hop may sit. */
export const JUMP_R = 5;
const MARGIN = JUMP_R + 8;

/**
 * Where this cable's horizontal segments cross other cables' vertical segments: segment index → x positions
 * (sorted along the direction of travel). Crossings too close to a corner are skipped so hops stay clean.
 */
export function findJumps(pts: Pt[], others: Pt[][]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const verticals: { x: number; y0: number; y1: number }[] = [];
  for (const o of others) {
    for (let k = 1; k < o.length; k++) {
      const a = o[k - 1], b = o[k];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5) verticals.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    }
  }
  if (!verticals.length) return out;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (Math.abs(a.y - b.y) > 0.5) continue;
    const x0 = Math.min(a.x, b.x) + MARGIN, x1 = Math.max(a.x, b.x) - MARGIN;
    if (x1 <= x0) continue;
    const xs = verticals.filter((v) => v.x > x0 && v.x < x1 && a.y > v.y0 + 1 && a.y < v.y1 - 1).map((v) => v.x);
    if (!xs.length) continue;
    // One hop per crossing point, and none overlapping each other.
    const sorted = [...new Set(xs)].sort((p, q) => (b.x > a.x ? p - q : q - p));
    const kept: number[] = [];
    for (const x of sorted) if (!kept.length || Math.abs(x - kept[kept.length - 1]) >= JUMP_R * 2 + 2) kept.push(x);
    out.set(k, kept);
  }
  return out;
}

export const otherRouteEntries = (id: string) => [...routes.entries()].filter(([k]) => k !== id);

/** Gap between parallel cables that would otherwise run on the same line (Visio spaces them apart too). */
export const LANE = 7;

/**
 * Spreads this cable's middle segments that lie on top of other cables' (same line, overlapping) into separate
 * lanes. Every cable computes the same order for a shared run, so each takes its own lane. The order keeps the bundle
 * from crossing itself: for a run fed from above heading right, the cable that comes in further right takes the
 * higher lane (and mirrored for the other directions). First and last segments (at the ports) never move.
 */
export function separateParallel(id: string, pts: Pt[], others: [string, Pt[]][]): Pt[] {
  if (pts.length < 4) return pts;
  const out = pts.map((p) => ({ ...p }));
  type Seg = { a: Pt; b: Pt; prev: Pt };
  const middle = (o: Pt[]) => {
    const segs: Seg[] = [];
    for (let k = 1; k <= o.length - 3; k++) segs.push({ a: o[k], b: o[k + 1], prev: o[k - 1] });
    return segs;
  };
  const horiz = (s: Seg) => Math.abs(s.a.y - s.b.y) < 0.5 && Math.abs(s.a.x - s.b.x) > 0.5;
  const vert = (s: Seg) => Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.y - s.b.y) > 0.5;
  // Order key: lower key → lower lane offset (up for horizontal runs, left for vertical ones).
  const key = (s: Seg, h: boolean) => {
    if (h) {
      const right = s.b.x > s.a.x ? -1 : 1;
      const fromAbove = s.a.y > s.prev.y ? 1 : -1;
      return s.a.x * right * fromAbove;
    }
    const down = s.b.y > s.a.y ? -1 : 1;
    const fromLeft = s.a.x > s.prev.x ? 1 : -1;
    return s.a.y * down * fromLeft;
  };
  const span = (t: Seg, h: boolean) => [Math.min(h ? t.a.x : t.a.y, h ? t.b.x : t.b.y), Math.max(h ? t.a.x : t.a.y, h ? t.b.x : t.b.y)] as const;
  const mine = middle(pts);
  mine.forEach((s, i) => {
    const h = horiz(s);
    if (!h && !vert(s)) return;
    const c = h ? s.a.y : s.a.x;
    // Everything on the same line, then the chain of runs that overlap (directly or through one another): every
    // cable in the chain computes the same group and order.
    const cands: { id: string; seg: Seg }[] = [];
    for (const [oid, o] of others) {
      for (const t of middle(o)) if ((h ? horiz(t) : vert(t)) && Math.abs((h ? t.a.y : t.a.x) - c) <= 1) cands.push({ id: oid, seg: t });
    }
    const group: { id: string; seg: Seg }[] = [{ id, seg: s }];
    for (let grew = true; grew; ) {
      grew = false;
      for (const cnd of cands) {
        if (group.some((g) => g.id === cnd.id)) continue;
        const [lo, hi] = span(cnd.seg, h);
        if (group.some((g) => { const [glo, ghi] = span(g.seg, h); return Math.min(hi, ghi) - Math.max(lo, glo) > -1; })) {
          group.push(cnd);
          grew = true;
        }
      }
    }
    if (group.length < 2) return;
    const order = group.map((g) => ({ id: g.id, k: key(g.seg, h) })).sort((x, y) => x.k - y.k || (x.id < y.id ? -1 : 1));
    const off = (order.findIndex((g) => g.id === id) - (order.length - 1) / 2) * LANE;
    const k = i + 1; // the segment runs from pts[k] to pts[k + 1]
    if (h) { out[k].y += off; out[k + 1].y += off; } else { out[k].x += off; out[k + 1].x += off; }
  });
  return out;
}
