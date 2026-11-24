import { isWall } from './floorplan';
import type { AppNode, DeviceNode, Page, StencilDef } from './types';

/*
 * Wi-Fi planning on a scaled floor plan: an estimate of signal strength from the access points drawn on the page,
 * with the walls in between, and how many access points the floor needs.
 *
 * The model is the usual planning rule of thumb, not a site survey:
 *   received (dBm) = AP power (EIRP) − path loss − walls crossed
 *   path loss = loss at 1 m (from the frequency) + 10 · n · log10(distance in m), n = 3 (offices: furniture, people)
 *   each wall crossed takes off its material's loss for that band; doors and windows in a wall take off less.
 * Targets: −67 dBm or better for voice and video calls, −72 dBm for normal use, −80 dBm the edge of coverage.
 */

export type Band = '2.4' | '5' | '6';
export const BANDS: { value: Band; label: string; loss1m: number; eirp: number }[] = [
  { value: '2.4', label: '2.4 GHz', loss1m: 40.0, eirp: 17 },
  { value: '5', label: '5 GHz', loss1m: 47.3, eirp: 20 },
  { value: '6', label: '6 GHz', loss1m: 48.0, eirp: 20 },
];
const EXPONENT = 3.0;

export type WallMaterial = 'drywall' | 'glass' | 'wood' | 'brick' | 'concrete' | 'metal';
export const WALL_MATERIALS: { value: WallMaterial; label: string; loss: Record<Band, number> }[] = [
  { value: 'drywall', label: 'Drywall / partition', loss: { '2.4': 3, '5': 4, '6': 5 } },
  { value: 'glass', label: 'Glass', loss: { '2.4': 2, '5': 3, '6': 4 } },
  { value: 'wood', label: 'Wood', loss: { '2.4': 4, '5': 6, '6': 7 } },
  { value: 'brick', label: 'Brick / block', loss: { '2.4': 8, '5': 10, '6': 12 } },
  { value: 'concrete', label: 'Concrete', loss: { '2.4': 12, '5': 15, '6': 18 } },
  { value: 'metal', label: 'Metal / elevator', loss: { '2.4': 20, '5': 25, '6': 30 } },
];
/** A door or window in a wall lets more through than the wall around it. */
const OPENING_LOSS: Record<'door' | 'window', Record<Band, number>> = { door: { '2.4': 2, '5': 3, '6': 3 }, window: { '2.4': 2, '5': 3, '6': 4 } };

export const TARGETS = { voice: -67, data: -72, edge: -80 };

/** Kinds of device that are Wi-Fi access points. */
const AP_IDS = new Set(['access-point', 'ap-outdoor', 'mesh-node', 'wifi-router', 'range-extender']);
export const isAccessPoint = (d: DeviceNode, st?: StencilDef) =>
  AP_IDS.has(d.data.stencilId) || !!d.data.wifi || (!!st?.custom && /access ?point|\bwap\b|\bap\b|wi-?fi/i.test(`${st.name} ${d.data.model ?? ''}`));

export interface WifiAp { id: string; name: string; x: number; y: number; band: Band; eirp: number }
export interface WifiWall { x1: number; y1: number; x2: number; y2: number; material: WallMaterial }
export interface WifiOpening { x: number; y: number; w: number; h: number; kind: 'door' | 'window' }
export interface Box { x: number; y: number; w: number; h: number }

export interface WifiModel {
  aps: WifiAp[];
  walls: WifiWall[];
  openings: WifiOpening[];
  /** Rooms (zones): the floor area coverage is measured over; empty = the walls' outline. */
  rooms: Box[];
  metresPerPx: number;
}

const nodeBox = (n: AppNode): Box => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 });

/** The page's access points, walls, doors / windows and rooms, ready for the estimate (null without a drawing scale). */
export function wifiModel(page: Page, stencil: (id: string) => StencilDef | undefined): WifiModel | null {
  if (!page.scale) return null;
  const metresPerPx = page.scale.unit === 'm' ? page.scale.perPx : page.scale.perPx * 0.3048;
  const aps: WifiAp[] = [], walls: WifiWall[] = [], openings: WifiOpening[] = [], rooms: Box[] = [];
  for (const n of page.nodes) {
    if (n.type === 'device' && isAccessPoint(n, stencil(n.data.stencilId))) {
      // Its own size when resized, else its shape's natural size (not the size on screen, which may not be known).
      const st = stencil(n.data.stencilId);
      const b = { x: n.position.x, y: n.position.y, w: n.width ?? (st ? st.width * st.scale : nodeBox(n).w), h: n.height ?? (st ? st.height * st.scale : nodeBox(n).h) };
      const band = (n.data.wifi?.band ?? '5') as Band;
      aps.push({ id: n.id, name: n.data.name, x: b.x + b.w / 2, y: b.y + b.h / 2, band, eirp: n.data.wifi?.eirp ?? BANDS.find((x) => x.value === band)!.eirp });
    } else if (isWall(n)) {
      walls.push({ x1: n.position.x, y1: n.position.y, x2: n.position.x + n.data.dx, y2: n.position.y + n.data.dy, material: (n.data.material as WallMaterial) ?? 'drywall' });
    } else if (n.type === 'shape' && (n.data.kind === 'door' || n.data.kind === 'window')) {
      const b = nodeBox(n);
      const turned = Math.round(((n.data.rotation ?? 0) % 180 + 180) % 180) === 90;
      // A turned door's box is the same size the other way round, about the same centre.
      openings.push(turned ? { x: b.x + b.w / 2 - b.h / 2, y: b.y + b.h / 2 - b.w / 2, w: b.h, h: b.w, kind: n.data.kind } : { ...b, kind: n.data.kind });
    } else if (n.type === 'zone') {
      rooms.push(nodeBox(n));
    }
  }
  return { aps, walls, openings, rooms, metresPerPx };
}

/** Where segment p→q crosses segment a→b (0..1 along p→q), or null. */
function cross(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number): number | null {
  const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - px) * sy - (ay - py) * sx) / den;
  const u = ((ax - px) * ry - (ay - py) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

const lossOf = (m: WallMaterial, band: Band) => (WALL_MATERIALS.find((x) => x.value === m) ?? WALL_MATERIALS[0]).loss[band];

/** Signal (dBm) from one access point at a point on the page. */
export function rssiAt(m: WifiModel, ap: WifiAp, x: number, y: number): number {
  const band = BANDS.find((b) => b.value === ap.band) ?? BANDS[1];
  const d = Math.max(1, Math.hypot(x - ap.x, y - ap.y) * m.metresPerPx);
  let loss = band.loss1m + 10 * EXPONENT * Math.log10(d);
  for (const w of m.walls) {
    const t = cross(ap.x, ap.y, x, y, w.x1, w.y1, w.x2, w.y2);
    if (t === null) continue;
    const cx = ap.x + (x - ap.x) * t, cy = ap.y + (y - ap.y) * t;
    const o = m.openings.find((b) => cx >= b.x - 2 && cx <= b.x + b.w + 2 && cy >= b.y - 2 && cy <= b.y + b.h + 2);
    loss += o ? OPENING_LOSS[o.kind][ap.band] : lossOf(w.material, ap.band);
  }
  return ap.eirp - loss;
}

/** The floor's outline: the rooms if drawn, else the walls' extent. */
export function floorBounds(m: WifiModel): Box | null {
  const xs: number[] = [], ys: number[] = [];
  for (const r of m.rooms) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  if (!xs.length) for (const w of m.walls) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); }
  if (!xs.length) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether a point is on the floor (inside a room; or inside the walls' extent when no rooms are drawn). */
function onFloor(m: WifiModel, outline: Box, x: number, y: number) {
  if (m.rooms.length) return m.rooms.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return x >= outline.x && x <= outline.x + outline.w && y >= outline.y && y <= outline.y + outline.h;
}

export interface CoverageGrid {
  x: number; y: number; cols: number; rows: number;
  /** Cell size in page px. */
  cell: number;
  /** Best signal per cell (dBm), row by row; −Infinity with no access point. */
  best: Float32Array;
  /** 1 where the cell is on the floor. */
  floor: Uint8Array;
}

/** Best signal over a grid covering the floor (and the access points), at most `maxCells` cells on the long side. */
export function coverageGrid(m: WifiModel, maxCells = 140): CoverageGrid | null {
  const outline = floorBounds(m);
  const pts = m.aps.map((a) => ({ x: a.x, y: a.y }));
  const xs = [...pts.map((p) => p.x), ...(outline ? [outline.x, outline.x + outline.w] : [])];
  const ys = [...pts.map((p) => p.y), ...(outline ? [outline.y, outline.y + outline.h] : [])];
  if (!xs.length) return null;
  const pad = 2 / m.metresPerPx; // 2 m round the edge
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x0, h = Math.max(...ys) + pad - y0;
  const cell = Math.max(w, h) / maxCells;
  const cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
  const best = new Float32Array(cols * rows).fill(-Infinity);
  const floor = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell, y = y0 + (r + 0.5) * cell;
      const i = r * cols + c;
      if (outline && onFloor(m, outline, x, y)) floor[i] = 1;
      let b = -Infinity;
      for (const ap of m.aps) { const v = rssiAt(m, ap, x, y); if (v > b) b = v; }
      best[i] = b;
    }
  }
  return { x: x0, y: y0, cols, rows, cell, best, floor };
}

export interface CoverageStats { floorCells: number; voice: number; data: number; edge: number }

/** Share of the floor (0..1) at or above each target. */
export function coverageStats(g: CoverageGrid): CoverageStats {
  let n = 0, v = 0, d = 0, e = 0;
  for (let i = 0; i < g.best.length; i++) {
    if (!g.floor[i]) continue;
    n++;
    const s = g.best[i];
    if (s >= TARGETS.voice) v++;
    if (s >= TARGETS.data) d++;
    if (s >= TARGETS.edge) e++;
  }
  return { floorCells: n, voice: n ? v / n : 0, data: n ? d / n : 0, edge: n ? e / n : 0 };
}

/**
 * Where to add access points so that `goal` of the floor gets `target` dBm or better: candidate spots on a grid over
 * the floor, then the one covering the most still-uncovered floor each time (greedy), until the goal or `max` APs.
 */
export function suggestAps(m: WifiModel, opts: { band?: Band; target?: number; goal?: number; max?: number } = {}): { x: number; y: number }[] {
  const band = opts.band ?? (m.aps[0]?.band ?? '5');
  const eirp = BANDS.find((b) => b.value === band)!.eirp;
  const target = opts.target ?? TARGETS.voice, goal = opts.goal ?? 0.95, max = opts.max ?? 20;
  const outline = floorBounds(m);
  if (!outline) return [];
  // A coarse grid keeps this quick: test points and candidate spots.
  const tests: { x: number; y: number }[] = [], spots: { x: number; y: number }[] = [];
  const tStep = Math.max(outline.w, outline.h) / 28, sStep = Math.max(outline.w, outline.h) / 14;
  for (let y = outline.y + tStep / 2; y < outline.y + outline.h; y += tStep) for (let x = outline.x + tStep / 2; x < outline.x + outline.w; x += tStep) if (onFloor(m, outline, x, y)) tests.push({ x, y });
  // Candidate spots keep clear of walls (an access point goes on the ceiling in the room, not on a wall).
  const clear = 1.5 / m.metresPerPx;
  const nearWall = (x: number, y: number) => m.walls.some((w) => distToSegment(x, y, w) < clear);
  for (let y = outline.y + sStep / 2; y < outline.y + outline.h; y += sStep) for (let x = outline.x + sStep / 2; x < outline.x + outline.w; x += sStep) if (onFloor(m, outline, x, y) && !nearWall(x, y)) spots.push({ x, y });
  if (!tests.length || !spots.length) return [];
  const covered = tests.map((p) => m.aps.some((ap) => rssiAt(m, ap, p.x, p.y) >= target));
  // What each candidate spot would cover (computed once).
  const reach = spots.map((s) => tests.map((p) => rssiAt(m, { id: '', name: '', x: s.x, y: s.y, band, eirp }, p.x, p.y) >= target));
  const out: { x: number; y: number }[] = [];
  const done = () => covered.filter(Boolean).length / tests.length >= goal;
  while (!done() && out.length < max) {
    let bestI = -1, bestGain = 0;
    reach.forEach((r, i) => {
      let g = 0;
      for (let k = 0; k < r.length; k++) if (r[k] && !covered[k]) g++;
      if (g > bestGain) { bestGain = g; bestI = i; }
    });
    if (bestI < 0) break;
    out.push(spots[bestI]);
    reach[bestI].forEach((ok, k) => { if (ok) covered[k] = true; });
  }
  return out;
}

function distToSegment(x: number, y: number, w: WifiWall) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2)) : 0;
  return Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy));
}

/** Colour of a signal level for the map (RGBA), or transparent below the edge of coverage. */
export function signalColour(dbm: number): [number, number, number, number] {
  if (dbm >= TARGETS.voice) return [22, 163, 74, 120];     // green: voice and video
  if (dbm >= TARGETS.data) return [163, 230, 53, 120];     // light green: normal use
  if (dbm >= -76) return [250, 204, 21, 120];              // yellow: slow
  if (dbm >= TARGETS.edge) return [249, 115, 22, 110];     // orange: edge
  return [239, 68, 68, 60];                                // red: little or none
}
