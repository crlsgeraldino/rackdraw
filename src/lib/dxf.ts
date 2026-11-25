/**
 * Insert → CAD Drawing: reads an ASCII DXF (AutoCAD's exchange format) into an SVG picture for the page background,
 * with its real-world scale when the file says what units it is drawn in.
 *
 * Supported: LINE, LWPOLYLINE / POLYLINE (with bulge arcs), CIRCLE, ARC, ELLIPSE, SPLINE (through its points),
 * TEXT / MTEXT, and INSERT (blocks: doors, furniture), nested a few levels. Hatches, dimensions and images are skipped.
 */

type Pt = { x: number; y: number };
type Pair = [number, string];

/** What the drawing is made of, in drawing units. */
interface Geo {
  lines: Pt[][];
  texts: { at: Pt; h: number; rot: number; text: string }[];
}

/** A block transform (INSERT): base point, scale, rotation (radians), insertion point. */
interface Xf { bx: number; by: number; sx: number; sy: number; rot: number; tx: number; ty: number }

export interface DxfResult {
  /** The drawing as an SVG data URL. */
  dataUrl: string;
  width: number;
  height: number;
  /** Real length of one pixel of the picture at `width` × `height` (feet or metres), when the file has units. */
  scale: { perPx: number; unit: 'ft' | 'm' } | null;
  /** Human-readable units of the file, e.g. "millimetres". */
  units: string | null;
  entities: number;
}

/** $INSUNITS codes → [name, size of one unit in feet or metres]. */
const UNITS: Record<number, [string, number, 'ft' | 'm']> = {
  1: ['inches', 1 / 12, 'ft'], 2: ['feet', 1, 'ft'], 4: ['millimetres', 0.001, 'm'], 5: ['centimetres', 0.01, 'm'], 6: ['metres', 1, 'm'],
};

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; } // resync on stray lines
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

/** Splits a section's pairs into entities (each starting with code 0). */
function entities(ps: Pair[]): Pair[][] {
  const out: Pair[][] = [];
  for (const p of ps) {
    if (p[0] === 0) out.push([p]);
    else out[out.length - 1]?.push(p);
  }
  return out;
}

const num = (e: Pair[], code: number, def = 0) => { const p = e.find((x) => x[0] === code); const v = p ? parseFloat(p[1]) : def; return Number.isFinite(v) ? v : 0; };

/** A damaged or enormous drawing stops with a clear message instead of freezing the app. */
const MAX_ENTITIES = 1_000_000;
const MAX_POINTS = 3_000_000;
const TOO_BIG = 'This drawing is too large or too complex to insert (over a million items, or blocks nested many times). Save a simpler version from your CAD program (only the floor plan layers).';

/** The sweep from a0 to a1 counter-clockwise, in (0, 2π]: never loops, whatever the file says. */
function sweep(a0: number, a1: number) {
  const full = Math.PI * 2;
  if (!Number.isFinite(a0) || !Number.isFinite(a1)) return full;
  const s = (a1 - a0) % full;
  return s > 0 ? s : s + full;
}
const str = (e: Pair[], code: number) => e.find((x) => x[0] === code)?.[1] ?? '';

/** Points along an arc (angles in radians, counter-clockwise from a0 to a1). */
function arcPts(c: Pt, r: number, a0: number, a1: number): Pt[] {
  const span = sweep(a0, a1);
  const n = Math.max(4, Math.ceil(span / (Math.PI / 18)));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (span * i) / n; return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }; });
}

/** The arc a bulge describes between two polyline vertices (bulge = tan(angle / 4); positive = counter-clockwise). */
function bulgePts(p: Pt, q: Pt, b: number): Pt[] {
  if (!b) return [q];
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (!d) return [q];
  const theta = 4 * Math.atan(b);
  const r = d / (2 * Math.sin(theta / 2));
  // Centre: from the chord's midpoint, along its normal.
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const h = r * Math.cos(theta / 2);
  const nx = -(q.y - p.y) / d, ny = (q.x - p.x) / d;
  const c = { x: mx + nx * h, y: my + ny * h };
  const a0 = Math.atan2(p.y - c.y, p.x - c.x), a1 = Math.atan2(q.y - c.y, q.x - c.x);
  const pts = b > 0 ? arcPts(c, Math.abs(r), a0, a1) : arcPts(c, Math.abs(r), a1, a0).reverse();
  return pts.slice(1);
}

/** Vertices (with bulges) of an LWPOLYLINE. */
function lwVertices(e: Pair[]): { pts: Pt[]; bulge: number[] } {
  const pts: Pt[] = [], bulge: number[] = [];
  for (const [c, v] of e) {
    if (c === 10) { pts.push({ x: parseFloat(v), y: 0 }); bulge.push(0); }
    else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
    else if (c === 42 && pts.length) bulge[bulge.length - 1] = parseFloat(v);
  }
  return { pts, bulge };
}

function withBulges(pts: Pt[], bulge: number[], closed: boolean): Pt[] {
  if (!pts.length) return [];
  const out = [pts[0]];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) out.push(...bulgePts(pts[i], pts[(i + 1) % pts.length], bulge[i] ?? 0));
  return out;
}

/** MTEXT / TEXT content without formatting codes. */
function cleanText(s: string) {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\[~]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
    .trim();
}

function apply(x: Xf, p: Pt): Pt {
  const lx = (p.x - x.bx) * x.sx, ly = (p.y - x.by) * x.sy;
  const c = Math.cos(x.rot), s = Math.sin(x.rot);
  return { x: x.tx + lx * c - ly * s, y: x.ty + lx * s + ly * c };
}

export function parseDxf(text: string): DxfResult {
  const ps = pairs(text);
  // Sections by name.
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 0 && ps[i][1] === 'SECTION' && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1][1];
      const start = i + 2;
      let j = start;
      while (j < ps.length && !(ps[j][0] === 0 && ps[j][1] === 'ENDSEC')) j++;
      sections.set(name, ps.slice(start, j));
      i = j;
    }
  }
  if (!sections.has('ENTITIES')) throw new Error('This is not a DXF drawing (or it is a binary DXF). Save it from your CAD program as an ASCII DXF.');

  // Units from the header.
  const header = sections.get('HEADER') ?? [];
  const ui = header.findIndex((p) => p[0] === 9 && p[1] === '$INSUNITS');
  const unitCode = ui >= 0 ? parseInt(header[ui + 1]?.[1] ?? '0', 10) : 0;

  // Blocks (for INSERT).
  const blocks = new Map<string, { base: Pt; ents: Pair[][] }>();
  let cur: { name: string; base: Pt; ents: Pair[][] } | null = null;
  for (const e of entities(sections.get('BLOCKS') ?? [])) {
    const type = e[0][1];
    if (type === 'BLOCK') cur = { name: str(e, 2), base: { x: num(e, 10), y: num(e, 20) }, ents: [] };
    else if (type === 'ENDBLK') { if (cur) blocks.set(cur.name, { base: cur.base, ents: cur.ents }); cur = null; }
    else cur?.ents.push(e);
  }

  const geo: Geo = { lines: [], texts: [] };
  let count = 0;
  let points = 0;
  const addLine = (l: Pt[]) => {
    points += l.length;
    if (points > MAX_POINTS) throw new Error(TOO_BIG);
    geo.lines.push(l);
  };
  const walk = (ents: Pair[][], xf: Xf[], depth: number) => {
    const tp = (p: Pt) => xf.reduceRight((q, x) => apply(x, q), p);
    const scaleOf = () => xf.reduce((k, x) => k * Math.sqrt(Math.abs(x.sx * x.sy)), 1);
    const rotOf = () => xf.reduce((r, x) => r + x.rot, 0);
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const type = e[0][1];
      if (++count > MAX_ENTITIES) throw new Error(TOO_BIG);
      if (type === 'LINE') addLine([tp({ x: num(e, 10), y: num(e, 20) }), tp({ x: num(e, 11), y: num(e, 21) })]);
      else if (type === 'LWPOLYLINE') {
        const { pts, bulge } = lwVertices(e);
        addLine(withBulges(pts, bulge, (num(e, 70) & 1) === 1).map(tp));
      } else if (type === 'POLYLINE') {
        // Old-style polyline: VERTEX entities follow until SEQEND.
        const pts: Pt[] = [], bulge: number[] = [];
        while (ents[k + 1] && ents[k + 1][0][1] === 'VERTEX') { k++; pts.push({ x: num(ents[k], 10), y: num(ents[k], 20) }); bulge.push(num(ents[k], 42)); }
        if (ents[k + 1]?.[0][1] === 'SEQEND') k++;
        addLine(withBulges(pts, bulge, (num(e, 70) & 1) === 1).map(tp));
      } else if (type === 'CIRCLE') addLine(arcPts({ x: num(e, 10), y: num(e, 20) }, num(e, 40), 0, Math.PI * 2).map(tp));
      else if (type === 'ARC') addLine(arcPts({ x: num(e, 10), y: num(e, 20) }, num(e, 40), (num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180).map(tp));
      else if (type === 'ELLIPSE') {
        const c = { x: num(e, 10), y: num(e, 20) }, mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
        const a0 = num(e, 41, 0), a1 = num(e, 42, Math.PI * 2);
        const rot = Math.atan2(my, mx), ra = Math.hypot(mx, my), rb = ra * ratio;
        const span = sweep(a0, a1);
        const n = Math.max(8, Math.ceil(span / (Math.PI / 18)));
        addLine(Array.from({ length: n + 1 }, (_, i) => {
          const t = a0 + (span * i) / n, x = ra * Math.cos(t), y = rb * Math.sin(t);
          return tp({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) });
        }));
      } else if (type === 'SPLINE') {
        // Through its fit points when it has them, else its control points: close enough for a background.
        const fit = e.filter((p) => p[0] === 11).length;
        const xs = e.filter((p) => p[0] === (fit ? 11 : 10)).map((p) => parseFloat(p[1])), ys = e.filter((p) => p[0] === (fit ? 21 : 20)).map((p) => parseFloat(p[1]));
        addLine(xs.map((x, i) => tp({ x, y: ys[i] ?? 0 })));
      } else if (type === 'TEXT' || type === 'MTEXT') {
        const raw = type === 'MTEXT' ? e.filter((p) => p[0] === 3).map((p) => p[1]).join('') + str(e, 1) : str(e, 1);
        const t = cleanText(raw);
        if (!t) continue;
        const angle = type === 'MTEXT' && e.some((p) => p[0] === 11) ? Math.atan2(num(e, 21), num(e, 11)) : (num(e, 50) * Math.PI) / 180;
        if (++points > MAX_POINTS) throw new Error(TOO_BIG);
        geo.texts.push({ at: tp({ x: num(e, 10), y: num(e, 20) }), h: num(e, 40, 2.5) * scaleOf(), rot: angle + rotOf(), text: t });
      } else if (type === 'INSERT' && depth < 5) {
        const b = blocks.get(str(e, 2));
        if (!b) continue;
        walk(b.ents, [...xf, { bx: b.base.x, by: b.base.y, sx: num(e, 41, 1), sy: num(e, 42, 1), rot: (num(e, 50) * Math.PI) / 180, tx: num(e, 10), ty: num(e, 20) }], depth + 1);
      }
    }
  };
  walk(entities(sections.get('ENTITIES')!), [], 0);

  // Bounds, then the picture: long side 1600px, y flipped (DXF y goes up).
  // Points that aren't numbers (a damaged file) are left out; bounds with a loop (a spread overflows on big drawings).
  const ok = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
  geo.lines = geo.lines.map((l) => l.filter(ok));
  geo.texts = geo.texts.filter((t) => ok(t.at) && Number.isFinite(t.h) && Number.isFinite(t.rot));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (p: Pt) => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; };
  for (const l of geo.lines) for (const p of l) grow(p);
  for (const t of geo.texts) grow(t.at);
  if (x0 === Infinity) throw new Error('No drawing found in this DXF (only lines, polylines, arcs, circles, text and blocks are read).');
  const w = Math.max(1e-9, x1 - x0), h = Math.max(1e-9, y1 - y0);
  const k = 1600 / Math.max(w, h);
  const pad = 8;
  const W = Math.round(w * k) + pad * 2, H = Math.round(h * k) + pad * 2;
  const X = (x: number) => +((x - x0) * k + pad).toFixed(1), Y = (y: number) => +((y1 - y) * k + pad).toFixed(1);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paths = geo.lines.filter((l) => l.length > 1).map((l) => `M${l.map((p) => `${X(p.x)} ${Y(p.y)}`).join('L')}`).join('');
  const texts = geo.texts.map((t) => {
    const size = Math.max(1, t.h * k);
    const lines = t.text.split('\n');
    return `<text x="${X(t.at.x)}" y="${Y(t.at.y)}" font-size="${size.toFixed(1)}" transform="rotate(${(-t.rot * 180 / Math.PI).toFixed(1)} ${X(t.at.x)} ${Y(t.at.y)})">${lines.map((ln, i) => `<tspan x="${X(t.at.x)}" dy="${i ? (size * 1.2).toFixed(1) : 0}">${esc(ln)}</tspan>`).join('')}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/><path d="${paths}" fill="none" stroke="#1f2937" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/><g font-family="Arial, sans-serif" fill="#1f2937">${texts}</g></svg>`;
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  const u = UNITS[unitCode];
  // One picture pixel = (drawing units per pixel) × (size of a unit).
  const scale = u ? { perPx: (1 / k) * u[1], unit: u[2] } : null;
  return { dataUrl, width: W, height: H, scale, units: u ? u[0] : null, entities: count };
}
