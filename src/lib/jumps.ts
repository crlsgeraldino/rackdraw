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
