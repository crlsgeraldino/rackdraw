/**
 * Reads Visio stencils (.vssx, also the masters inside .vsdx / .vstx) in the browser and turns masters into
 * NetCraft stencils: Visio geometry and styles become SVG, embedded PNG/JPG/GIF/BMP pictures are kept, EMF
 * pictures go through the EMF converter, and connection points become cable ports.
 *
 * Visio coordinates are inches with y pointing up; everything is drawn in that space and flipped once at the end.
 */
import { unzipSync, type Unzipped } from 'fflate';
import type { PortDef } from '../types';
import { emfToSvg, type DibEncoder } from './emf';

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface VisioMasterInfo {
  id: string;
  name: string;
  /** Path of the master's XML inside the package. */
  file: string;
}

export interface RenderedMaster {
  /** SVG markup, viewBox in pixels at 96 per inch. */
  svg: string;
  widthIn: number;
  heightIn: number;
  /** Ports from the master's connection points, in viewBox pixels. */
  ports: PortDef[];
  /** Set when some artwork could not be shown (e.g. EMF+-only pictures). */
  warnings: string[];
}

const PX = 96;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Visio's legacy 24-color palette, for colors stored as an index. */
const PALETTE = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#c0c0c0', '#e6e6e6', '#cdcdcd', '#b3b3b3', '#9a9a9a', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a'];

function color(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0 && n < PALETTE.length) return PALETTE[n];
  return null;
}

/* ------------------------------------------------------------------ */
/*  Package access                                                     */
/* ------------------------------------------------------------------ */

export class VisioPackage {
  private cache = new Map<string, Uint8Array>();

  private constructor(private data: Uint8Array, readonly masters: VisioMasterInfo[], private styles: Map<string, Element>) {}

  static async open(file: File): Promise<VisioPackage> {
    if (/\.(vss|vsd|vst)$/i.test(file.name)) {
      throw new Error('This is an older binary Visio file (.vss/.vsd). Open it in Visio and save it as a .vssx stencil, then import that.');
    }
    const data = new Uint8Array(await file.arrayBuffer());
    if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('This is not a Visio .vssx/.vsdx file.');
    const pkg = new VisioPackage(data, [], new Map());
    const mastersXml = pkg.text('visio/masters/masters.xml');
    if (!mastersXml) throw new Error('This Visio file has no stencil masters.');
    const rels = pkg.rels('visio/masters/masters.xml');
    const doc = new DOMParser().parseFromString(mastersXml, 'application/xml');
    for (const m of Array.from(doc.getElementsByTagNameNS(NS, 'Master'))) {
      if (m.getAttribute('Hidden') === '1') continue;
      const relId = m.getElementsByTagNameNS(NS, 'Rel')[0]?.getAttributeNS(REL_NS, 'id');
      const target = relId && rels.get(relId);
      if (!target) continue;
      pkg.masters.push({ id: m.getAttribute('ID') ?? target, name: m.getAttribute('Name') || m.getAttribute('NameU') || `Master ${m.getAttribute('ID')}`, file: `visio/masters/${target}` });
    }
    // Style sheets supply default line/fill/text formatting.
    const docXml = pkg.text('visio/document.xml');
    if (docXml) {
      const d = new DOMParser().parseFromString(docXml, 'application/xml');
      for (const st of Array.from(d.getElementsByTagNameNS(NS, 'StyleSheet'))) pkg.styles.set(st.getAttribute('ID') ?? '', st);
    }
    return pkg;
  }

  /** Decompresses just the files asked for; big stencils are mostly pictures we may never need. */
  private bytes(path: string): Uint8Array | undefined {
    if (!this.cache.has(path)) {
      const files: Unzipped = unzipSync(this.data, { filter: (f) => f.name === path });
      if (files[path]) this.cache.set(path, files[path]);
    }
    return this.cache.get(path);
  }

  private text(path: string) {
    const b = this.bytes(path);
    return b ? new TextDecoder().decode(b) : undefined;
  }

  private rels(path: string): Map<string, string> {
    const i = path.lastIndexOf('/');
    const xml = this.text(`${path.slice(0, i)}/_rels/${path.slice(i + 1)}.rels`);
    const map = new Map<string, string>();
    if (!xml) return map;
    for (const r of Array.from(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('Relationship'))) {
      map.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
    }
    return map;
  }

  /** Renders one master to SVG. */
  render(master: VisioMasterInfo, encodeDib: DibEncoder): RenderedMaster {
    const xml = this.text(master.file);
    if (!xml) throw new Error(`Master "${master.name}" is missing from the file.`);
    const rels = this.rels(master.file);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const shapesEl = doc.getElementsByTagNameNS(NS, 'Shapes')[0];
    const tops = shapesEl ? children(shapesEl, 'Shape') : [];
    const warnings: string[] = [];
    const ctx: Ctx = { pkg: this, rels, folder: master.file.slice(0, master.file.lastIndexOf('/')), encodeDib, warnings };

    // Page-space bounds of the top-level shapes.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const body: string[] = [];
    const conns: [number, number][] = [];
    // Measure what is actually drawn: some vendors make the group a 1-D "line" (0.001" tall) with
    // its children hanging off it, so the group's own Width/Height can't be trusted.
    const grow = (s: Element, parent: M) => {
      const t = xf(s);
      const m = compose(parent, t.m);
      const sub = s.getElementsByTagNameNS(NS, 'Shapes')[0];
      const kids = sub && sub.parentElement === s ? children(sub, 'Shape') : [];
      kids.forEach((k) => grow(k, m));
      const draws = s.getAttribute('Type') === 'Foreign' || sections(s, 'Geometry').some((g) => cell(g, 'NoShow') !== '1');
      if ((draws || !kids.length) && t.w > 0 && t.h > 0) {
        for (const [x, y] of [[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]]) {
          const [px, py] = apply(m, x, y);
          minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
      }
    };
    for (const s of tops) {
      const t = xf(s);
      grow(s, [1, 0, 0, 1, 0, 0]);
      body.push(this.shape(s, ctx));
      const sec = section(s, 'Connection');
      if (sec) for (const row of children(sec, 'Row')) conns.push(apply(t.m, num(cell(row, 'X')), num(cell(row, 'Y'))));
    }
    if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) throw new Error(`Master "${master.name}" has nothing to draw.`);

    const wIn = maxX - minX, hIn = maxY - minY;
    const W = wIn * PX, H = hIn * PX;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(W)} ${r3(H)}" width="${r3(W)}" height="${r3(H)}"><g transform="matrix(${PX} 0 0 ${-PX} ${r3(-minX * PX)} ${r3(maxY * PX)})">${body.join('')}</g></svg>`;

    // Connection points → small square ports, sized from the spacing between neighbours.
    const pts = conns.map(([x, y]) => [(x - minX) * PX, (maxY - y) * PX] as [number, number]);
    let spacing = Math.min(W, H) * 0.3;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) spacing = Math.min(spacing, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) || spacing);
    const size = Math.max(6, Math.min(0.3 * PX, spacing * 0.8));
    const ports: PortDef[] = pts.map(([x, y], i) => ({
      id: `C${i + 1}`, label: `${i + 1}`, kind: 'rj45',
      x: Math.max(0, Math.min(W - size, x - size / 2)), y: Math.max(0, Math.min(H - size, y - size / 2)), w: size, h: size,
      side: y < H / 2 ? 'top' : 'bottom',
    }));
    return { svg, widthIn: wIn, heightIn: hIn, ports, warnings };
  }

  private shape(s: Element, ctx: Ctx): string {
    const t = xf(s);
    const parts: string[] = [];
    const get = (name: string, kind: 'line' | 'fill' | 'text') => styleCell(s, name, kind, this.styles);

    // Geometry
    const lineW = Math.max(0.003, num(get('LineWeight', 'line'), 0.01));
    const linePattern = num(get('LinePattern', 'line'), 1);
    const lineColor = color(get('LineColor', 'line')) ?? '#000000';
    const fillPattern = num(get('FillPattern', 'fill'), 1);
    const fillColor = color(get('FillForegnd', 'fill')) ?? '#ffffff';
    const fillTrans = num(get('FillForegndTrans', 'fill'), 0);
    for (const geo of sections(s, 'Geometry')) {
      if (cell(geo, 'NoShow') === '1') continue;
      const { d, closed } = geometry(geo, t.w, t.h);
      if (!d) continue;
      const fill = closed && cell(geo, 'NoFill') !== '1' && fillPattern !== 0;
      const stroke = cell(geo, 'NoLine') !== '1' && linePattern !== 0;
      if (!fill && !stroke) continue;
      parts.push(`<path d="${d}" fill="${fill ? fillColor : 'none'}"${fill && fillTrans ? ` fill-opacity="${r3(1 - fillTrans)}"` : ''} stroke="${stroke ? lineColor : 'none'}" stroke-width="${r3(lineW)}" stroke-linejoin="round"${linePattern > 1 ? ` stroke-dasharray="${r3(lineW * 4)} ${r3(lineW * 3)}"` : ''}/>`);
    }

    // Embedded picture
    if (s.getAttribute('Type') === 'Foreign') {
      const fd = s.getElementsByTagNameNS(NS, 'ForeignData')[0];
      const relId = fd?.getElementsByTagNameNS(NS, 'Rel')[0]?.getAttributeNS(REL_NS, 'id');
      const target = relId && ctx.rels.get(relId);
      if (target) {
        const ox = num(cell(s, 'ImgOffsetX')), oy = num(cell(s, 'ImgOffsetY'));
        const iw = num(cell(s, 'ImgWidth'), t.w), ih = num(cell(s, 'ImgHeight'), t.h);
        const href = this.picture(resolve(ctx.folder, target), ctx);
        if (href) parts.push(`<g transform="matrix(1 0 0 -1 ${r3(ox)} ${r3(oy + ih)})"><image href="${href}" width="${r3(iw)}" height="${r3(ih)}" preserveAspectRatio="none"/></g>`);
      }
    }

    // Child shapes of a group
    const sub = s.getElementsByTagNameNS(NS, 'Shapes')[0];
    if (sub && sub.parentElement === s) for (const c of children(sub, 'Shape')) parts.push(this.shape(c, ctx));

    // Text (simple: one centred line block)
    const textEl = children(s, 'Text')[0];
    const text = textEl?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) {
      const charSec = section(s, 'Character');
      const row = charSec ? children(charSec, 'Row')[0] : undefined;
      const size = num(row ? cell(row, 'Size') : get('Size', 'text'), 0.1111);
      const tc = color(row ? cell(row, 'Color') : null) ?? '#000000';
      const tx = num(cell(s, 'TxtPinX'), t.w / 2), ty = num(cell(s, 'TxtPinY'), t.h / 2);
      parts.push(`<g transform="matrix(1 0 0 -1 ${r3(tx)} ${r3(ty)})"><text font-size="${r3(size)}" font-family="Segoe UI, Arial, sans-serif" fill="${tc}" text-anchor="middle" dominant-baseline="central">${esc(text)}</text></g>`);
    }

    if (!parts.length) return '';
    const [a, b, c, d, e, f] = t.m;
    return `<g transform="matrix(${r3(a)} ${r3(b)} ${r3(c)} ${r3(d)} ${r3(e)} ${r3(f)})">${parts.join('')}</g>`;
  }

  private pictures = new Map<string, string | null>();

  private picture(path: string, ctx: Ctx): string | null {
    if (this.pictures.has(path)) return this.pictures.get(path)!;
    const data = this.bytes(path);
    let url: string | null = null;
    const ext = path.split('.').pop()?.toLowerCase();
    if (data) {
      if (ext === 'emf') {
        try {
          const r = emfToSvg(data, ctx.encodeDib);
          if (r.empty) ctx.warnings.push('A picture uses a format NetCraft cannot draw (EMF+ only).');
          else {
            const b = r.bounds;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" preserveAspectRatio="none">${r.body}</svg>`;
            url = `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
          }
        } catch {
          ctx.warnings.push('A picture could not be converted.');
        }
      } else if (ext === 'wmf') {
        ctx.warnings.push('A WMF picture was skipped (not supported).');
      } else {
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
        url = `data:${mime};base64,${toBase64(data)}`;
      }
    }
    this.pictures.set(path, url);
    return url;
  }
}

interface Ctx {
  pkg: VisioPackage;
  rels: Map<string, string>;
  folder: string;
  encodeDib: DibEncoder;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/*  XML helpers                                                        */
/* ------------------------------------------------------------------ */

function children(el: Element, local: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === local);
}
function cell(el: Element, name: string): string | null {
  for (const c of Array.from(el.children)) if (c.localName === 'Cell' && c.getAttribute('N') === name) return c.getAttribute('V');
  return null;
}
function section(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === 'Section' && c.getAttribute('N') === name);
}
function sections(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === 'Section' && c.getAttribute('N') === name);
}
function num(v: string | null | undefined, fallback = 0) {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function resolve(folder: string, target: string) {
  const parts = `${folder}/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}
function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A cell from the shape itself, else from its line/fill/text style chain. */
function styleCell(s: Element, name: string, kind: 'line' | 'fill' | 'text', styles: Map<string, Element>): string | null {
  const own = cell(s, name);
  if (own != null) return own;
  const attr = kind === 'line' ? 'LineStyle' : kind === 'fill' ? 'FillStyle' : 'TextStyle';
  let id = s.getAttribute(attr);
  for (let guard = 0; id != null && guard < 20; guard++) {
    const st = styles.get(id);
    if (!st) break;
    const v = cell(st, name);
    if (v != null) return v;
    id = st.getAttribute(attr);
  }
  return null;
}

type M = [number, number, number, number, number, number]; // SVG matrix(a b c d e f)

/** parent ∘ child: apply the child transform first, then the parent's. */
function compose(p: M, c: M): M {
  return [
    p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

function apply(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Local → parent transform: translate(Pin) · rotate(Angle) · flip · translate(-LocPin). */
function xf(s: Element): { m: M; w: number; h: number } {
  const w = num(cell(s, 'Width')), h = num(cell(s, 'Height'));
  const px = num(cell(s, 'PinX')), py = num(cell(s, 'PinY'));
  const lx = num(cell(s, 'LocPinX'), w / 2), ly = num(cell(s, 'LocPinY'), h / 2);
  const a = num(cell(s, 'Angle'));
  const fx = cell(s, 'FlipX') === '1' ? -1 : 1, fy = cell(s, 'FlipY') === '1' ? -1 : 1;
  const cos = Math.cos(a), sin = Math.sin(a);
  const A = cos * fx, B = sin * fx, C = -sin * fy, D = cos * fy;
  return { m: [A, B, C, D, px - (A * lx + C * ly), py - (B * lx + D * ly)], w, h };
}

/* ------------------------------------------------------------------ */
/*  Geometry                                                           */
/* ------------------------------------------------------------------ */

/** Builds an SVG path from a Visio Geometry section, in the shape's local coordinates. */
function geometry(geo: Element, w: number, h: number): { d: string; closed: boolean } {
  let d = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let segments = 0, closedAll = true, started = false;
  const P = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
  const finish = () => {
    if (started && segments && (Math.abs(cx - sx) > 1e-6 || Math.abs(cy - sy) > 1e-6)) closedAll = false;
  };

  for (const row of children(geo, 'Row')) {
    if (row.getAttribute('Del') === '1') continue;
    const T = row.getAttribute('T');
    const X = num(cell(row, 'X')), Y = num(cell(row, 'Y'));
    const A = num(cell(row, 'A')), B = num(cell(row, 'B')), C = num(cell(row, 'C')), D = num(cell(row, 'D'));
    switch (T) {
      case 'MoveTo': case 'RelMoveTo': {
        finish();
        const x = T === 'RelMoveTo' ? X * w : X, y = T === 'RelMoveTo' ? Y * h : Y;
        d += `M${P(x, y)}`; cx = sx = x; cy = sy = y; started = true; segments = 0;
        break;
      }
      case 'LineTo': case 'RelLineTo': case 'PolylineTo': case 'NURBSTo': case 'SplineStart': case 'SplineKnot': {
        const x = T === 'RelLineTo' ? X * w : X, y = T === 'RelLineTo' ? Y * h : Y;
        if (!started) { d += `M${P(cx, cy)}`; sx = cx; sy = cy; started = true; }
        d += `L${P(x, y)}`; cx = x; cy = y; segments++;
        break;
      }
      case 'RelCubBezTo': {
        if (!started) { d += `M${P(cx, cy)}`; sx = cx; sy = cy; started = true; }
        d += `C${P(A * w, B * h)} ${P(C * w, D * h)} ${P(X * w, Y * h)}`; cx = X * w; cy = Y * h; segments++;
        break;
      }
      case 'RelQuadBezTo': {
        if (!started) { d += `M${P(cx, cy)}`; sx = cx; sy = cy; started = true; }
        d += `Q${P(A * w, B * h)} ${P(X * w, Y * h)}`; cx = X * w; cy = Y * h; segments++;
        break;
      }
      case 'ArcTo': {
        if (!started) { d += `M${P(cx, cy)}`; sx = cx; sy = cy; started = true; }
        const chord = Math.hypot(X - cx, Y - cy);
        if (Math.abs(A) < 1e-9 || chord < 1e-9) d += `L${P(X, Y)}`;
        else {
          const r = (A * A + (chord / 2) ** 2) / (2 * Math.abs(A));
          d += `A${r3(r)} ${r3(r)} 0 ${Math.abs(A) > chord / 2 ? 1 : 0} ${A > 0 ? 1 : 0} ${P(X, Y)}`;
        }
        cx = X; cy = Y; segments++;
        break;
      }
      case 'EllipticalArcTo': case 'RelEllipticalArcTo': {
        if (!started) { d += `M${P(cx, cy)}`; sx = cx; sy = cy; started = true; }
        const rel = T === 'RelEllipticalArcTo';
        const ex = rel ? X * w : X, ey = rel ? Y * h : Y, mx = rel ? A * w : A, my = rel ? B * h : B;
        d += ellipticalArc(cx, cy, mx, my, ex, ey, C, D || 1);
        cx = ex; cy = ey; segments++;
        break;
      }
      case 'Ellipse': {
        finish();
        const rx = Math.hypot(A - X, B - Y), ry = Math.hypot(C - X, D - Y);
        const ang = (Math.atan2(B - Y, A - X) * 180) / Math.PI;
        const c = Math.cos((ang * Math.PI) / 180), s = Math.sin((ang * Math.PI) / 180);
        const p1 = [X + rx * c, Y + rx * s], p2 = [X - rx * c, Y - rx * s];
        d += `M${P(p1[0], p1[1])}A${r3(rx)} ${r3(ry)} ${r3(ang)} 1 1 ${P(p2[0], p2[1])}A${r3(rx)} ${r3(ry)} ${r3(ang)} 1 1 ${P(p1[0], p1[1])}Z`;
        cx = sx = p1[0]; cy = sy = p1[1]; started = false; segments = 0;
        break;
      }
      default:
        break; // InfiniteLine and unknown rows are skipped
    }
  }
  finish();
  return { d, closed: closedAll && d.length > 0 };
}

/** Arc from (x0,y0) through (mx,my) to (x1,y1) on an ellipse rotated by `angle` with major/minor ratio `ratio`. */
function ellipticalArc(x0: number, y0: number, mx: number, my: number, x1: number, y1: number, angle: number, ratio: number): string {
  const c = Math.cos(-angle), s = Math.sin(-angle);
  // Rotate into the ellipse frame and stretch y so the ellipse becomes a circle.
  const tf = (x: number, y: number): [number, number] => [x * c - y * s, (x * s + y * c) * ratio];
  const [ax, ay] = tf(x0, y0), [bx, by] = tf(mx, my), [ex, ey] = tf(x1, y1);
  const dd = 2 * (ax * (by - ey) + bx * (ey - ay) + ex * (ay - by));
  if (Math.abs(dd) < 1e-12) return `L${r3(x1)} ${r3(y1)}`;
  const ux = ((ax * ax + ay * ay) * (by - ey) + (bx * bx + by * by) * (ey - ay) + (ex * ex + ey * ey) * (ay - by)) / dd;
  const uy = ((ax * ax + ay * ay) * (ex - bx) + (bx * bx + by * by) * (ax - ex) + (ex * ex + ey * ey) * (bx - ax)) / dd;
  const R = Math.hypot(ax - ux, ay - uy);
  const ccw = (bx - ax) * (ey - ay) - (by - ay) * (ex - ax) > 0;
  const ang = (x: number, y: number) => Math.atan2(y - uy, x - ux);
  let sweep = ang(ex, ey) - ang(ax, ay);
  if (ccw && sweep < 0) sweep += 2 * Math.PI;
  if (!ccw && sweep > 0) sweep -= 2 * Math.PI;
  const large = Math.abs(sweep) > Math.PI ? 1 : 0;
  return `A${r3(R)} ${r3(R / ratio)} ${r3((angle * 180) / Math.PI)} ${large} ${ccw ? 1 : 0} ${r3(x1)} ${r3(y1)}`;
}

/** Browser DIB encoder for EMF bitmaps. */
export const canvasDibEncoder: DibEncoder = (w, h, rgba) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return canvas.toDataURL('image/png');
};
