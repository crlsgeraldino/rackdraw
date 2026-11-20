/**
 * Dynamic grid (Visio): while dragging, the moved items snap so their left / centre / right (and top / middle /
 * bottom) line up with another item's, and blue guide lines show the alignment. Pure snapping maths plus a tiny
 * store for the guides currently shown.
 */
import { create } from 'zustand';

export interface Box { x: number; y: number; w: number; h: number }

export const useGuides = create<{ x: number[]; y: number[] }>(() => ({ x: [], y: [] }));

/** Current canvas zoom, so the snap distance is the same on screen at any zoom. */
export const guideZoom = { value: 1 };

/** Snap distance in screen pixels. */
export const SNAP_PX = 6;

const lines = (a: number, size: number) => [a, a + size / 2, a + size];

/** Best shift (≤ tol) that lines `moving` up with any of `others`, per axis, and the guide positions it creates. */
export function snapToGuides(moving: Box, others: Box[], tol: number) {
  const axis = (mine: number[], theirs: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const t of theirs) for (const m of mine) {
      const d = t - m;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
    if (!best) return { d: 0, guides: [] as number[] };
    // Every line that matches after the shift gets a guide (e.g. both left and right edges).
    const shifted = mine.map((m) => m + best!.d);
    const guides = [...new Set(theirs.filter((t) => shifted.some((m) => Math.abs(m - t) < 0.5)))];
    return { d: best.d, guides };
  };
  const xs = others.flatMap((o) => lines(o.x, o.w)), ys = others.flatMap((o) => lines(o.y, o.h));
  const x = axis(lines(moving.x, moving.w), xs), y = axis(lines(moving.y, moving.h), ys);
  return { dx: x.d, dy: y.d, gx: x.guides, gy: y.guides };
}
