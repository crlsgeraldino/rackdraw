import type { AppNode } from './types';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'h' | 'v';

/** Size of a node on the canvas (measured by React Flow, else its set size). */
export function nodeSize(n: AppNode) {
  return { width: n.measured?.width ?? n.width ?? 0, height: n.measured?.height ?? n.height ?? 0 };
}

export const isLocked = (n: AppNode) => n.type !== 'backdrop' && !!n.data.locked;

/** Items the Arrange commands may move: selected, not the page backdrop, not locked. */
export const movable = (nodes: AppNode[]) => nodes.filter((n) => n.selected && n.type !== 'backdrop' && !isLocked(n));

/**
 * Returns new positions (by node id) lining the nodes up on the selection's edge or centre line,
 * like Visio's Align commands. Needs at least two nodes.
 */
export function alignPositions(nodes: AppNode[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 2) return out;
  const boxes = nodes.map((n) => ({ n, ...nodeSize(n), x: n.position.x, y: n.position.y }));
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  for (const b of boxes) {
    let { x, y } = b;
    if (mode === 'left') x = left;
    else if (mode === 'right') x = right - b.width;
    else if (mode === 'center') x = (left + right) / 2 - b.width / 2;
    else if (mode === 'top') y = top;
    else if (mode === 'bottom') y = bottom - b.height;
    else y = (top + bottom) / 2 - b.height / 2;
    out.set(b.n.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/**
 * Spaces nodes so the gaps between them are equal, keeping the first and last in place
 * (Visio's Distribute Horizontally/Vertically). Needs at least three nodes.
 */
export function distributePositions(nodes: AppNode[], axis: DistributeAxis): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 3) return out;
  const key = axis === 'h' ? 'x' : 'y';
  const dim = axis === 'h' ? 'width' : 'height';
  const boxes = nodes.map((n) => ({ n, size: nodeSize(n)[dim], at: n.position[key] })).sort((a, b) => a.at - b.at);
  const start = boxes[0].at;
  const end = Math.max(...boxes.map((b) => b.at + b.size));
  const gap = (end - start - boxes.reduce((s, b) => s + b.size, 0)) / (boxes.length - 1);
  let at = start;
  for (const b of boxes) {
    out.set(b.n.id, { ...b.n.position, [key]: Math.round(at) });
    at += b.size + gap;
  }
  return out;
}

const BACKDROP_Z = -10;

/** zIndex that puts the selection above (front) or below (back) everything else, staying above a page backdrop. */
export function orderZ(nodes: AppNode[], to: 'front' | 'back') {
  const others = nodes.filter((n) => !n.selected && n.type !== 'backdrop').map((n) => n.zIndex ?? 0);
  if (to === 'front') return Math.max(0, ...others) + 1;
  return Math.max(BACKDROP_Z + 1, Math.min(0, ...others) - 1);
}
