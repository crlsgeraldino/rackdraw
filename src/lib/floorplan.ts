/** Floor-plan helpers (Visio's Office Layout): doors and windows snapping into walls, rooms turned into walls. */
import type { AppNode, MeasureNode } from './types';

type Box = { x: number; y: number; w: number; h: number };

/** How close (px) a door or window's edge must be dropped to a wall to snap into it. */
export const WALL_SNAP = 30;

/**
 * Where a door or window dropped at `box` goes when it lands near a straight (horizontal or vertical) wall: its
 * new box and rotation, or null when no wall is near. Windows lie along the wall, as thick as it is; doors sit with
 * their opening on the wall line, swinging into the side they were dropped on.
 */
export function snapIntoWall(kind: 'door' | 'window', box: Box, walls: MeasureNode[]): { box: Box; rotation: number } | null {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let best: { wall: MeasureNode; d: number; dc: number; horiz: boolean } | null = null;
  for (const w of walls) {
    const { dx, dy } = w.data;
    const horiz = Math.abs(dy) < 1e-6 && Math.abs(dx) > 1, vert = Math.abs(dx) < 1e-6 && Math.abs(dy) > 1;
    if (!horiz && !vert) continue; // only straight walls
    const x0 = Math.min(w.position.x, w.position.x + dx), x1 = Math.max(w.position.x, w.position.x + dx);
    const y0 = Math.min(w.position.y, w.position.y + dy), y1 = Math.max(w.position.y, w.position.y + dy);
    // Gap between the item and the wall line (0 when the item lies across it), counted only along the wall's length.
    const gap = (lo: number, hi: number, at: number) => (at >= lo && at <= hi ? 0 : Math.min(Math.abs(lo - at), Math.abs(hi - at)));
    const d = horiz ? (cx >= x0 && cx <= x1 ? gap(box.y, box.y + box.h, y0) : Infinity) : (cy >= y0 && cy <= y1 ? gap(box.x, box.x + box.w, x0) : Infinity);
    const dc = horiz ? Math.abs(cy - y0) : Math.abs(cx - x0);
    if (d <= WALL_SNAP && (!best || d < best.d || (d === best.d && dc < best.dc))) best = { wall: w, d, dc, horiz };
  }
  if (!best) return null;
  const w = best.wall;
  const t = w.data.thickness ?? 8;
  const len = Math.max(box.w, box.h);
  const x0 = Math.min(w.position.x, w.position.x + w.data.dx), x1 = Math.max(w.position.x, w.position.x + w.data.dx);
  const y0 = Math.min(w.position.y, w.position.y + w.data.dy), y1 = Math.max(w.position.y, w.position.y + w.data.dy);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (kind === 'window') {
    if (best.horiz) {
      const x = clamp(cx - len / 2, x0, Math.max(x0, x1 - len));
      return { box: { x: Math.round(x), y: Math.round(y0 - t / 2), w: len, h: t }, rotation: 0 };
    }
    const y = clamp(cy - len / 2, y0, Math.max(y0, y1 - len));
    return { box: { x: Math.round(x0 - t / 2), y: Math.round(y), w: t, h: len }, rotation: 0 };
  }
  // Door: a square box with the opening along its bottom edge at rotation 0 (left edge at 90, top at 180, right at 270).
  const size = Math.max(box.w, box.h);
  if (best.horiz) {
    const x = Math.round(clamp(cx - size / 2, x0, Math.max(x0, x1 - size)));
    return cy <= y0 ? { box: { x, y: Math.round(y0 - size), w: size, h: size }, rotation: 0 } : { box: { x, y: Math.round(y0), w: size, h: size }, rotation: 180 };
  }
  const y = Math.round(clamp(cy - size / 2, y0, Math.max(y0, y1 - size)));
  return cx >= x0 ? { box: { x: Math.round(x0), y, w: size, h: size }, rotation: 90 } : { box: { x: Math.round(x0 - size), y, w: size, h: size }, rotation: 270 };
}

/** The four walls round a box (centre lines on its outline). */
export function wallsAround(b: Box): { x: number; y: number; dx: number; dy: number }[] {
  return [
    { x: b.x, y: b.y, dx: b.w, dy: 0 },
    { x: b.x + b.w, y: b.y, dx: 0, dy: b.h },
    { x: b.x + b.w, y: b.y + b.h, dx: -b.w, dy: 0 },
    { x: b.x, y: b.y + b.h, dx: 0, dy: -b.h },
  ];
}

export const isWall = (n: AppNode): n is MeasureNode => n.type === 'measure' && n.data.variant === 'wall';
