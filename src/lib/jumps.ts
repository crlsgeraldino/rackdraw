'use client';

import { useSyncExternalStore } from 'react';
import type { Pt } from './router';

/**
 * Line jumps (Visio "line jumps"): where two cables cross, the horizontal one hops over the vertical one.
 * Each right-angle cable publishes its corner points here so the others can find where they cross it.
 */
const routes = new Map<string, Pt[]>();
/*
 * Two change counters: raw routes (what lanes are worked out from) and drawn routes (what line jumps use). Keeping
 * them apart means a cable settling into its lane only re-checks line jumps, instead of making every cable work out
 * its lanes again (a second pass over all cable pairs after every drop).
 */
let version = 0;
let drawnVersion = 0;
const listeners = new Set<() => void>();

/**
 * Tell the cables that routes changed, once: many cables publish in the same moment (a whole page drawing, a device
 * moving), and redrawing every cable for each one made big pages slow.
 */
let pending = false;
function notify() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; listeners.forEach((l) => l()); });
}
function changed() {
  version++;
  notify();
}
function drawnChanged() {
  drawnVersion++;
  notify();
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

const same = (a?: Pt[], b?: Pt[]) => !!a && !!b && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/**
 * A route with a NaN / infinite point (the canvas had no size yet, e.g. the window was minimised) counts as no route:
 * NaN never equals itself, so such a route would look "changed" on every check and re-publish forever.
 */
const usable = (pts: Pt[] | null) => (pts && pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : null);

export function publishRoute(id: string, raw: Pt[] | null) {
  const pts = usable(raw);
  if (pts ? same(routes.get(id), pts) : !routes.has(id)) return;
  if (pts) routes.set(id, pts);
  else routes.delete(id);
  changed();
}

/** Changes when any cable's raw route changes (re-work out lanes). */
export function useRoutesVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/** Changes when any cable is drawn somewhere else (re-check line jumps). */
export function useDrawnVersion() {
  return useSyncExternalStore(subscribe, () => drawnVersion, () => 0);
}

export const otherRoutes = (id: string) => [...routes.entries()].filter(([k]) => k !== id).map(([, v]) => v);

/**
 * Where each cable is actually drawn, after parallel runs were spread into lanes. Line jumps use these, so a cable
 * only hops where it really crosses another (the raw routes above are what the lanes are worked out from).
 */
const drawn = new Map<string, Pt[]>();
export function publishDrawn(id: string, raw: Pt[] | null) {
  const pts = usable(raw);
  if (pts ? same(drawn.get(id), pts) : !drawn.has(id)) return;
  if (pts) drawn.set(id, pts);
  else drawn.delete(id);
  drawnChanged();
}
export const otherDrawnRoutes = (id: string) => [...drawn.entries()].filter(([k]) => k !== id).map(([, v]) => v);

/** A vertical segment of a cable (what other cables hop over). */
interface Vertical { x: number; y0: number; y1: number; id: string }
/** Vertical segments sorted by x, so a cable finds the ones it crosses by a search, not by scanning every cable. */
function verticalsOf(entries: Iterable<[string, Pt[]]>): Vertical[] {
  const out: Vertical[] = [];
  for (const [id, o] of entries) {
    for (let k = 1; k < o.length; k++) {
      const a = o[k - 1], b = o[k];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5) out.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), id });
    }
  }
  return out.sort((p, q) => p.x - q.x);
}
/** First index with x > v (verticals sorted by x). */
function firstAbove(vs: Vertical[], v: number) {
  let lo = 0, hi = vs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (vs[m].x > v) hi = m; else lo = m + 1; }
  return lo;
}
let drawnIndex: { rev: number; vs: Vertical[] } | null = null;
/** The drawn cables' verticals, built once per change and shared by every cable. */
function drawnVerticals() {
  if (!drawnIndex || drawnIndex.rev !== drawnVersion) drawnIndex = { rev: drawnVersion, vs: verticalsOf(drawn.entries()) };
  return drawnIndex.vs;
}
/** Line jumps of cable `id` over every other drawn cable (same result as findJumps with all the others). */
export function jumpsFor(id: string, pts: Pt[]): Map<number, number[]> {
  return jumpsOver(pts, drawnVerticals(), id);
}

/** Hop radius, and how close to a corner or end a hop may sit. */
export const JUMP_R = 5;
const MARGIN = JUMP_R + 8;

/**
 * Where this cable's horizontal segments cross other cables' vertical segments: segment index → x positions
 * (sorted along the direction of travel). Crossings too close to a corner are skipped so hops stay clean.
 */
export function findJumps(pts: Pt[], others: Pt[][]): Map<number, number[]> {
  return jumpsOver(pts, verticalsOf(others.map((o, i) => [String(i), o] as [string, Pt[]])), null);
}

/** Where `pts` crosses the given verticals (sorted by x), leaving out cable `skip`'s own. */
function jumpsOver(pts: Pt[], verticals: Vertical[], skip: string | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!verticals.length) return out;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (Math.abs(a.y - b.y) > 0.5) continue;
    const x0 = Math.min(a.x, b.x) + MARGIN, x1 = Math.max(a.x, b.x) - MARGIN;
    if (x1 <= x0) continue;
    const xs: number[] = [];
    for (let i = firstAbove(verticals, x0); i < verticals.length && verticals[i].x < x1; i++) {
      const v = verticals[i];
      if (v.id !== skip && a.y > v.y0 + 1 && a.y < v.y1 - 1) xs.push(v.x);
    }
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

type Seg = { a: Pt; b: Pt; prev: Pt };
const middle = (o: Pt[]) => {
  const segs: Seg[] = [];
  for (let k = 1; k <= o.length - 3; k++) segs.push({ a: o[k], b: o[k + 1], prev: o[k - 1] });
  return segs;
};
const horiz = (s: Seg) => Math.abs(s.a.y - s.b.y) < 0.5 && Math.abs(s.a.x - s.b.x) > 0.5;
const vert = (s: Seg) => Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.y - s.b.y) > 0.5;

/** Middle segments of the cables, by the line they run on (rounded), so a cable looks up only its own lines. */
type LaneEntry = { id: string; seg: Seg; order: number };
export interface LaneIndex { h: Map<number, LaneEntry[]>; v: Map<number, LaneEntry[]> }
function laneIndexOf(entries: Iterable<[string, Pt[]]>): LaneIndex {
  const idx: LaneIndex = { h: new Map(), v: new Map() };
  // `order`: the cables' and segments' order, so every cable sees the candidates in the same order as before.
  let order = 0;
  for (const [id, o] of entries) {
    for (const t of middle(o)) {
      order++;
      const h = horiz(t);
      if (!h && !vert(t)) continue;
      const m = h ? idx.h : idx.v;
      const k = Math.round(h ? t.a.y : t.a.x);
      const list = m.get(k);
      if (list) list.push({ id, seg: t, order }); else m.set(k, [{ id, seg: t, order }]);
    }
  }
  return idx;
}
let routesIndex: { rev: number; idx: LaneIndex } | null = null;
/** The routes' lane index, built once per change and shared by every cable. */
export function laneIndex(): LaneIndex {
  if (!routesIndex || routesIndex.rev !== version) routesIndex = { rev: version, idx: laneIndexOf(routes.entries()) };
  return routesIndex.idx;
}

/** Gap between parallel cables that would otherwise run on the same line (Visio spaces them apart too). */
export const LANE = 7;

/**
 * Spreads this cable's middle segments that lie on top of other cables' (same line, overlapping) into separate
 * lanes. Every cable computes the same order for a shared run, so each takes its own lane. The order keeps the bundle
 * from crossing itself: for a run fed from above heading right, the cable that comes in further right takes the
 * higher lane (and mirrored for the other directions). First and last segments (at the ports) never move.
 */
export function separateParallel(id: string, pts: Pt[], others: [string, Pt[]][] | LaneIndex): Pt[] {
  if (pts.length < 4) return pts;
  const out = pts.map((p) => ({ ...p }));
  const idx = Array.isArray(others) ? laneIndexOf(others) : others;
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
    const cands: LaneEntry[] = [];
    const lines = h ? idx.h : idx.v;
    for (let k = Math.round(c) - 2; k <= Math.round(c) + 2; k++) {
      for (const t of lines.get(k) ?? []) if (t.id !== id && Math.abs((h ? t.seg.a.y : t.seg.a.x) - c) <= 1) cands.push(t);
    }
    cands.sort((p, q) => p.order - q.order);
    let group: { id: string; seg: Seg }[] = [{ id, seg: s }];
    const seen = new Set<string>();
    const oneEach = cands.every((cnd) => !seen.has(cnd.id) && !!seen.add(cnd.id));
    if (oneEach) {
      // Each other cable has one run on this line: the group is the chain of overlapping runs that holds this one,
      // found in one sorted sweep (the step below does the same by repeated scans, which is slow for big bundles).
      const items = [{ id, seg: s }, ...cands].map((g) => ({ g, lo: span(g.seg, h)[0], hi: span(g.seg, h)[1] })).sort((p, q) => p.lo - q.lo);
      let start = 0, reach = -Infinity, mine = false;
      for (let i = 0; i <= items.length; i++) {
        if (i === items.length || (i > 0 && items[i].lo - reach >= 1)) {
          if (mine) { group = items.slice(start, i).map((x) => x.g); break; }
          if (i === items.length) break;
          start = i; reach = -Infinity;
        }
        reach = Math.max(reach, items[i].hi);
        if (items[i].g.id === id) mine = true;
      }
    } else {
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
    }
    if (group.length < 2) return;
    const order = group.map((g) => ({ id: g.id, k: key(g.seg, h) })).sort((x, y) => x.k - y.k || (x.id < y.id ? -1 : 1));
    const off = (order.findIndex((g) => g.id === id) - (order.length - 1) / 2) * LANE;
    const k = i + 1; // the segment runs from pts[k] to pts[k + 1]
    if (h) { out[k].y += off; out[k + 1].y += off; } else { out[k].x += off; out[k + 1].x += off; }
  });
  return out;
}
