/**
 * Orthogonal cable routing around devices (like Visio's dynamic connector).
 *
 * The cable leaves its port straight out of the device, then follows the shortest right-angle path with the fewest
 * bends that doesn't pass through any device. Works on a sparse grid made of the obstacles' edges (an orthogonal
 * visibility graph), searched with Dijkstra over (point, direction) so bends can be penalized.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Pt { x: number; y: number }
export interface Box { left: number; top: number; right: number; bottom: number }
export interface Obstacle extends Box {
  id: string;
  /** Gap to keep from this item; defaults to CLEARANCE. Labels and info boxes use less, so cables can pass beside them. */
  clearance?: number;
}

/**
 * Items drawn for a device (its label, its info box) have ids `${deviceId}#…`. They are obstacles like any other,
 * but a cable leaving that device first steps past them.
 */
const ownedBy = (o: Obstacle, device?: string) => !!device && o.id.startsWith(`${device}#`);

/** Gap kept between a cable and the devices it goes around. */
export const CLEARANCE = 14;
/** A bend costs as much as this many pixels of extra length. */
const BEND = 40;
/** Searches bigger than this fall back to a simple path, so huge pages stay responsive. */
const MAX_POINTS = 60_000;

const DIRS: Pt[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]; // up, right, down, left
const SIDE_DIR: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 };

const pad = (b: Box, d: number): Box => ({ left: b.left - d, top: b.top - d, right: b.right + d, bottom: b.bottom + d });
const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const inside = (b: Box, x: number, y: number) => x > b.left && x < b.right && y > b.top && y < b.bottom;

/** Where a cable leaving `p` on `side` clears its own device (or just steps out if it has none). */
function exitPoint(p: Pt, side: Side, b: Box): Pt {
  if (side === 'top') return { x: p.x, y: Math.min(p.y - CLEARANCE, b.top) };
  if (side === 'bottom') return { x: p.x, y: Math.max(p.y + CLEARANCE, b.bottom) };
  if (side === 'left') return { x: Math.min(p.x - CLEARANCE, b.left), y: p.y };
  return { x: Math.max(p.x + CLEARANCE, b.right), y: p.y };
}

/** Exit point past the device, then past any of its own label/info box that sits in the way. */
function stub(p: Pt, side: Side, own: Box | undefined, extras: Box[]): Pt {
  let s = exitPoint(p, side, own ? pad(own, CLEARANCE) : pad({ left: p.x, top: p.y, right: p.x, bottom: p.y }, CLEARANCE));
  for (let k = 0; k < 4; k++) {
    const hit = extras.find((b) => inside(b, s.x, s.y));
    if (!hit) break;
    s = exitPoint(s, side, hit);
  }
  return s;
}

/** Removes repeated and collinear points. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((Math.abs(a.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5) || (Math.abs(a.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** Binary min-heap of [cost, state]. */
class Heap {
  private c: number[] = [];
  private s: number[] = [];
  get size() { return this.c.length; }
  push(cost: number, state: number) {
    const { c, s } = this;
    let i = c.length;
    c.push(cost); s.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]]; [s[p], s[i]] = [s[i], s[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { c, s } = this;
    const top: [number, number] = [c[0], s[0]];
    const lc = c.pop()!, ls = s.pop()!;
    if (c.length) {
      c[0] = lc; s[0] = ls;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]]; [s[m], s[i]] = [s[i], s[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Routes a cable from port `a` to port `b`. `obstacles` are the devices on the page (including the two being
 * connected, named by `ownA`/`ownB`). Returns the corner points, or null if no clear path exists.
 */
export function routeOrthogonal(
  a: Pt & { side: Side },
  b: Pt & { side: Side },
  obstacles: Obstacle[],
  ownA?: string,
  ownB?: string,
): Pt[] | null {
  const boxA = obstacles.find((o) => o.id === ownA);
  const boxB = obstacles.find((o) => o.id === ownB);
  const padOf = (o: Obstacle) => pad(o, o.clearance ?? CLEARANCE);
  const sa = stub(a, a.side, boxA, obstacles.filter((o) => ownedBy(o, ownA)).map(padOf));
  const sb = stub(b, b.side, boxB, obstacles.filter((o) => ownedBy(o, ownB)).map(padOf));

  // Work in a window around the two ends, grown to take in any device it touches, so far-away devices cost nothing.
  let win: Box = pad({ left: Math.min(sa.x, sb.x), top: Math.min(sa.y, sb.y), right: Math.max(sa.x, sb.x), bottom: Math.max(sa.y, sb.y) }, 60);
  // Each obstacle with its keep-clear margin; a stub end that lands in that margin (not in the item itself) keeps
  // the bare item as an obstacle, so the cable still goes around it instead of through it.
  const padded = obstacles.map((o) => {
    const p = padOf(o);
    return (inside(p, sa.x, sa.y) || inside(p, sb.x, sb.y)) && !inside(o, sa.x, sa.y) && !inside(o, sb.x, sb.y) ? { left: o.left, top: o.top, right: o.right, bottom: o.bottom } : p;
  });
  let used: Box[] = [];
  for (let k = 0; k < 6; k++) {
    used = padded.filter((o) => overlaps(o, win));
    const grown = used.reduce((w, o) => ({ left: Math.min(w.left, o.left - 30), top: Math.min(w.top, o.top - 30), right: Math.max(w.right, o.right + 30), bottom: Math.max(w.bottom, o.bottom + 30) }), win);
    if (grown.left === win.left && grown.top === win.top && grown.right === win.right && grown.bottom === win.bottom) break;
    win = grown;
  }
  // A stub can sit inside something touching the device (a device right next to it, its own label or info box):
  // route over that item rather than not at all.
  used = used.filter((o) => !inside(o, sa.x, sa.y) && !inside(o, sb.x, sb.y));

  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 2) / 2))].sort((p, q) => p - q);
  const xs = uniq([sa.x, sb.x, (sa.x + sb.x) / 2, win.left, win.right, ...used.flatMap((o) => [o.left, o.right])].filter((x) => x >= win.left && x <= win.right));
  const ys = uniq([sa.y, sb.y, (sa.y + sb.y) / 2, win.top, win.bottom, ...used.flatMap((o) => [o.top, o.bottom])].filter((y) => y >= win.top && y <= win.bottom));
  const W = xs.length, H = ys.length;
  if (W * H * 4 > MAX_POINTS) return null;

  const idx = (i: number, j: number) => j * W + i;
  const blocked = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (used.some((o) => inside(o, xs[i], ys[j]))) blocked[idx(i, j)] = 1;
  // Can we step from a grid point to its neighbour in direction d without crossing a device?
  const canStep = (i: number, j: number, d: number) => {
    const ni = i + DIRS[d].x, nj = j + DIRS[d].y;
    if (ni < 0 || nj < 0 || ni >= W || nj >= H || blocked[idx(ni, nj)]) return false;
    const mx = (xs[i] + xs[ni]) / 2, my = (ys[j] + ys[nj]) / 2;
    return !used.some((o) => inside(o, mx, my));
  };

  const si = xs.indexOf(Math.round(sa.x * 2) / 2), sj = ys.indexOf(Math.round(sa.y * 2) / 2);
  const ti = xs.indexOf(Math.round(sb.x * 2) / 2), tj = ys.indexOf(Math.round(sb.y * 2) / 2);
  if (si < 0 || sj < 0 || ti < 0 || tj < 0) return null;

  const startDir = SIDE_DIR[a.side];
  const endDir = (SIDE_DIR[b.side] + 2) % 4; // the last leg runs into the target port
  const N = W * H * 4;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  const start = idx(si, sj) * 4 + startDir;
  dist[start] = 0;
  heap.push(0, start);
  let best = -1, bestCost = Infinity;
  while (heap.size) {
    const [cost, st] = heap.pop();
    if (cost > dist[st] || cost >= bestCost) continue;
    const d = st % 4, p = (st - d) / 4, i = p % W, j = (p - i) / W;
    if (i === ti && j === tj) {
      const total = cost + (d === endDir ? 0 : d === (endDir + 2) % 4 ? BEND * 2 : BEND);
      if (total < bestCost) { bestCost = total; best = st; }
      continue;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4 || !canStep(i, j, nd)) continue; // no U-turns on the spot
      const ni = i + DIRS[nd].x, nj = j + DIRS[nd].y;
      const ns = idx(ni, nj) * 4 + nd;
      const c = cost + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : BEND);
      if (c < dist[ns]) {
        dist[ns] = c;
        prev[ns] = st;
        heap.push(c, ns);
      }
    }
  }
  if (best < 0) return null;

  const pts: Pt[] = [];
  for (let st = best; st >= 0; st = prev[st]) {
    const p = (st - (st % 4)) / 4;
    pts.push({ x: xs[p % W], y: ys[(p - (p % W)) / W] });
  }
  pts.reverse();
  // Grid coordinates are rounded to half pixels; line the first and last legs up exactly with the ports.
  const first = pts[0], last = pts[pts.length - 1];
  if (a.side === 'top' || a.side === 'bottom') first.x = a.x; else first.y = a.y;
  if (b.side === 'top' || b.side === 'bottom') last.x = b.x; else last.y = b.y;
  if (pts.length > 1) {
    const second = pts[1], before = pts[pts.length - 2];
    if (Math.abs(second.x - Math.round(a.x * 2) / 2) < 0.01) second.x = first.x;
    if (Math.abs(second.y - Math.round(a.y * 2) / 2) < 0.01) second.y = first.y;
    if (Math.abs(before.x - Math.round(b.x * 2) / 2) < 0.01) before.x = last.x;
    if (Math.abs(before.y - Math.round(b.y * 2) / 2) < 0.01) before.y = last.y;
  }
  return simplify([{ x: a.x, y: a.y }, ...pts, { x: b.x, y: b.y }]);
}

/** Direction of a step, ignoring sub-pixel differences (ports sit at fractional positions). */
const sgn = (v: number) => (Math.abs(v) < 0.5 ? 0 : Math.sign(v));

/** SVG path through the points with rounded corners, and the point halfway along it (for the label). */
export function roundedPath(points: Pt[], radius = 8, jumps?: Map<number, number[]>, jumpR = 5, jumpStyle: 'arc' | 'gap' | 'square' = 'arc'): { d: string; mid: Pt } {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let k = 1; k < points.length; k++) {
    const p = points[k];
    const next = points[k + 1];
    // Line jumps on this (horizontal) segment: a small arc over each crossing, always bulging upward.
    const hops = jumps?.get(k);
    if (hops?.length) {
      const dir = sgn(p.x - points[k - 1].x) || 1;
      for (const x of hops) {
        const a = x - dir * jumpR, b = x + dir * jumpR;
        // Arc: a half-circle hop. Gap: the line breaks. Square: a little box-shaped hop.
        if (jumpStyle === 'gap') d += ` L ${a} ${p.y} M ${b} ${p.y}`;
        else if (jumpStyle === 'square') d += ` L ${a} ${p.y} L ${a} ${p.y - jumpR} L ${b} ${p.y - jumpR} L ${b} ${p.y}`;
        else d += ` L ${a} ${p.y} A ${jumpR} ${jumpR} 0 0 ${dir > 0 ? 1 : 0} ${b} ${p.y}`;
      }
    }
    if (!next) {
      d += ` L ${p.x} ${p.y}`;
      break;
    }
    const prev = points[k - 1];
    const r = Math.min(radius, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const inX = p.x - sgn(p.x - prev.x) * r, inY = p.y - sgn(p.y - prev.y) * r;
    const outX = p.x + sgn(next.x - p.x) * r, outY = p.y + sgn(next.y - p.y) * r;
    d += ` L ${inX} ${inY} Q ${p.x} ${p.y} ${outX} ${outY}`;
  }
  const lens = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
  let half = lens.reduce((s, l) => s + l, 0) / 2;
  let mid = points[0];
  for (let k = 0; k < lens.length; k++) {
    if (half <= lens[k] || k === lens.length - 1) {
      const t = lens[k] ? Math.min(1, half / lens[k]) : 0;
      mid = { x: points[k].x + (points[k + 1].x - points[k].x) * t, y: points[k].y + (points[k + 1].y - points[k].y) * t };
      break;
    }
    half -= lens[k];
  }
  return { d, mid };
}
