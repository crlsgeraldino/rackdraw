/**
 * Shape operations (Visio's Union / Combine / Intersect / Subtract) on simple polygons, with the Greiner–Hormann
 * clipping algorithm. Rings are lists of points; results are lists of rings (drawn with the even-odd rule, so a ring
 * inside another is a hole).
 */
export type P = { x: number; y: number };
export type Ring = P[];

interface V { x: number; y: number; next: V; prev: V; inter: boolean; entry: boolean; neighbor?: V; alpha: number; visited: boolean }

function list(ring: Ring): V {
  let first: V | null = null, last: V | null = null;
  for (const p of ring) {
    const v = { x: p.x, y: p.y, inter: false, entry: false, alpha: 0, visited: false } as V;
    if (!first) { first = v; v.next = v; v.prev = v; } else { v.prev = last!; v.next = first; last!.next = v; first.prev = v; }
    last = v;
  }
  return first!;
}

/** Point in polygon (even-odd). */
export function inside(p: P, ring: Ring): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function segX(a: P, b: P, c: P, d: P): { t: number; u: number; x: number; y: number } | null {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Puts an intersection vertex between `a` and the next original vertex, ordered by alpha. */
function insert(v: V, a: V) {
  let cur = a.next;
  while (cur.inter && cur.alpha < v.alpha) cur = cur.next;
  v.next = cur; v.prev = cur.prev; cur.prev.next = v; cur.prev = v;
}

const originals = (start: V) => { const out: V[] = []; let v = start; do { if (!v.inter) out.push(v); v = v.next; } while (v !== start); return out; };

/** Removes repeated points and nearly-straight corners. */
function tidy(r: Ring): Ring {
  const out: Ring = [];
  for (const p of r) { const q = out[out.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p); }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  // Points on a straight edge (left where two outlines met) are dropped.
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
    return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) > 1e-3 * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  });
}

/** Signed area (positive = counter-clockwise in y-up, clockwise on screen). */
export const area = (r: Ring) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

/** One Greiner–Hormann operation between two simple polygons. */
export function clip(subject: Ring, clipper: Ring, op: 'union' | 'intersect' | 'difference'): Ring[] {
  // Nudge the clipper a hair so no vertex lies exactly on the other outline (the algorithm's blind spot).
  const c = clipper.map((p, i) => ({ x: p.x + 1e-7 * (1 + (i % 7)), y: p.y + 1.3e-7 * (1 + (i % 5)) }));
  const S = list(subject), C = list(c);
  let found = false;
  for (const sa of originals(S)) {
    let sb = sa.next; while (sb.inter) sb = sb.next;
    for (const ca of originals(C)) {
      let cb = ca.next; while (cb.inter) cb = cb.next;
      const hit = segX(sa, sb, ca, cb);
      if (!hit) continue;
      found = true;
      const i1 = { x: hit.x, y: hit.y, inter: true, entry: false, alpha: hit.t, visited: false } as V;
      const i2 = { x: hit.x, y: hit.y, inter: true, entry: false, alpha: hit.u, visited: false } as V;
      i1.neighbor = i2; i2.neighbor = i1;
      insert(i1, sa); insert(i2, ca);
    }
  }
  if (!found) {
    const sInC = inside(subject[0], c), cInS = inside(c[0], subject);
    if (op === 'union') return sInC ? [clipper] : cInS ? [subject] : [subject, clipper];
    if (op === 'intersect') return sInC ? [subject] : cInS ? [clipper] : [];
    // difference
    return sInC ? [] : cInS ? [subject, clipper] : [subject];
  }
  // Entry / exit flags.
  const mark = (start: V, startsInside: boolean) => {
    let entry = !startsInside;
    let v = start;
    do { if (v.inter) { v.entry = entry; entry = !entry; } v = v.next; } while (v !== start);
  };
  const sIn = inside(S, c), cIn = inside(C, subject);
  if (op === 'intersect') { mark(S, sIn); mark(C, cIn); }
  else if (op === 'union') { mark(S, !sIn); mark(C, !cIn); }
  else { mark(S, !sIn); mark(C, cIn); }
  const out: Ring[] = [];
  for (;;) {
    let start: V | null = null;
    let v = S;
    do { if (v.inter && !v.visited) { start = v; break; } v = v.next; } while (v !== S);
    if (!start) break;
    const ring: Ring = [{ x: start.x, y: start.y }];
    let cur: V = start;
    do {
      cur.visited = true; cur.neighbor!.visited = true;
      // Walk along this outline to the next crossing, forwards when entering the other shape, backwards when leaving.
      const forward = cur.entry;
      do { cur = forward ? cur.next : cur.prev; ring.push({ x: cur.x, y: cur.y }); } while (!cur.inter);
      cur = cur.neighbor!;
    } while (!cur.visited);
    const t = tidy(ring);
    if (t.length >= 3 && Math.abs(area(t)) > 1e-3) out.push(t);
  }
  return out;
}

/** Union of many polygons: merges each into whatever it touches. */
export function unionAll(rings: Ring[]): Ring[] {
  let acc: Ring[] = [];
  for (const r of rings) {
    let cur = r;
    const rest: Ring[] = [];
    for (const a of acc) {
      const u = clip(a, cur, 'union');
      if (u.length === 1) cur = u[0]; // merged
      else rest.push(a);
    }
    acc = [...rest, cur];
  }
  return acc;
}

/** Intersection of all the polygons. */
export function intersectAll(rings: Ring[]): Ring[] {
  let acc: Ring[] = [rings[0]];
  for (const r of rings.slice(1)) acc = acc.flatMap((a) => clip(a, r, 'intersect'));
  return acc;
}

/** The first polygon with all the others cut out (a cut-out fully inside becomes a hole ring). */
export function subtractAll(rings: Ring[]): Ring[] {
  let acc: Ring[] = [rings[0]];
  for (const r of rings.slice(1)) acc = acc.flatMap((a) => clip(a, r, 'difference'));
  return acc;
}

/** Ring helper: point at a % of the way into a bounding box (for tests). */
export const rect = (x: number, y: number, w: number, h: number): Ring => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
