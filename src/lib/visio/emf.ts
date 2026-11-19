/**
 * Minimal EMF (Windows Enhanced Metafile) → SVG converter for Visio stencil artwork.
 *
 * Vendor stencils (Dell, HPE, Cisco…) store pictures as EMF, which browsers cannot display. Most are "dual" files
 * with EMF+ records plus a plain GDI fallback; this converter plays the GDI records — paths, polygons, Béziers,
 * pens, brushes, world transforms, clipping, text and bitmaps — and ignores EMF+ comments.
 *
 * Output coordinates are device units of the EMF header bounds, so the SVG viewBox is simply those bounds.
 */

type Matrix = [number, number, number, number, number, number]; // eM11 eM12 eM21 eM22 eDx eDy (row-vector, GDI order)
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Pen { color: string; width: number; cosmetic: boolean; none: boolean; dash?: string }
interface Brush { color: string; none: boolean }
interface Font { height: number; weight: number; italic: boolean; face: string }
type GdiObject = { kind: 'pen'; pen: Pen } | { kind: 'brush'; brush: Brush } | { kind: 'font'; font: Font };

interface DC {
  world: Matrix;
  winOrg: [number, number];
  winExt: [number, number];
  vpOrg: [number, number];
  vpExt: [number, number];
  mapMode: number;
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  textAlign: number;
  fillRule: 'evenodd' | 'nonzero';
  clip: string | null;
  cur: [number, number];
}

export interface EmfResult {
  /** Inner SVG markup in device coordinates. */
  body: string;
  /** Header bounds (device units): the viewBox to use. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Physical size from the header frame, in inches (0 if unknown). */
  frameIn: { width: number; height: number };
  /** True when no drawable GDI records were found (e.g. an EMF+-only file). */
  empty: boolean;
}

/** Turns a DIB (BITMAPINFO + bits) into a PNG data URL. Supplied by the caller so this module stays DOM-free in tests. */
export type DibEncoder = (width: number, height: number, rgba: Uint8ClampedArray) => string;

const STOCK_BRUSH: Record<number, Brush> = {
  0: { color: '#ffffff', none: false },
  1: { color: '#c0c0c0', none: false },
  2: { color: '#808080', none: false },
  3: { color: '#404040', none: false },
  4: { color: '#000000', none: false },
  5: { color: 'none', none: true },
};
const STOCK_PEN: Record<number, Pen> = {
  6: { color: '#ffffff', width: 1, cosmetic: true, none: false },
  7: { color: '#000000', width: 1, cosmetic: true, none: false },
  8: { color: 'none', width: 0, cosmetic: true, none: true },
};

function colorref(v: DataView, off: number) {
  const r = v.getUint8(off), g = v.getUint8(off + 1), b = v.getUint8(off + 2);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Decodes an uncompressed DIB to RGBA (top-down). Returns null for formats we don't handle (JPEG/PNG/RLE in DIB). */
function decodeDib(v: DataView, offBmi: number, offBits: number): { w: number; h: number; rgba: Uint8ClampedArray } | null {
  const hdr = v.getUint32(offBmi, true);
  const w = v.getInt32(offBmi + 4, true);
  const hRaw = v.getInt32(offBmi + 8, true);
  const bpp = v.getUint16(offBmi + 14, true);
  const comp = v.getUint32(offBmi + 16, true);
  let used = v.getUint32(offBmi + 32, true);
  if (w <= 0 || hRaw === 0 || w * Math.abs(hRaw) > 16e6) return null;
  if (comp !== 0 && comp !== 3) return null;
  const h = Math.abs(hRaw);
  const bottomUp = hRaw > 0;
  if (bpp <= 8 && !used) used = 1 << bpp;
  const masks = comp === 3 ? 12 : 0;
  const palOff = offBmi + hdr + (hdr === 40 ? masks : 0);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < (bpp <= 8 ? used : 0); i++) palette.push([v.getUint8(palOff + i * 4 + 2), v.getUint8(palOff + i * 4 + 1), v.getUint8(palOff + i * 4)]);
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = offBits + (bottomUp ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 32) {
        b = v.getUint8(row + x * 4); g = v.getUint8(row + x * 4 + 1); r = v.getUint8(row + x * 4 + 2); a = v.getUint8(row + x * 4 + 3);
        if (a) anyAlpha = true;
      } else if (bpp === 24) {
        b = v.getUint8(row + x * 3); g = v.getUint8(row + x * 3 + 1); r = v.getUint8(row + x * 3 + 2);
      } else if (bpp === 16) {
        const px = v.getUint16(row + x * 2, true);
        r = ((px >> 10) & 31) << 3; g = ((px >> 5) & 31) << 3; b = (px & 31) << 3;
      } else if (bpp <= 8) {
        const bit = x * bpp;
        const byte = v.getUint8(row + (bit >> 3));
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, b] = palette[idx] ?? [0, 0, 0];
      } else return null;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  // 32bpp bitmaps whose alpha bytes are all zero are opaque in GDI.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { w, h, rgba };
}

export function emfToSvg(buf: ArrayBuffer | Uint8Array, encodeDib?: DibEncoder): EmfResult {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 88 || v.getUint32(0, true) !== 1) throw new Error('Not an EMF file');

  const bl = v.getInt32(8, true), bt = v.getInt32(12, true), br = v.getInt32(16, true), bb = v.getInt32(20, true);
  const fl = v.getInt32(24, true), ft = v.getInt32(28, true), fr = v.getInt32(32, true), fb = v.getInt32(36, true);
  const bounds = { x: bl, y: bt, width: Math.max(1, br - bl + 1), height: Math.max(1, bb - bt + 1) };
  const frameIn = { width: (fr - fl) / 2540, height: (fb - ft) / 2540 };

  const objects = new Map<number, GdiObject>();
  const stack: DC[] = [];
  let dc: DC = {
    world: [...IDENTITY], winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], mapMode: 1,
    pen: STOCK_PEN[7], brush: STOCK_BRUSH[0], font: { height: 12, weight: 400, italic: false, face: 'Arial' },
    textColor: '#000000', textAlign: 0, fillRule: 'evenodd', clip: null, cur: [0, 0],
  };
  const out: string[] = [];
  const defs: string[] = [];
  let clipSeq = 0;
  let drawn = 0;

  // Logical → device.
  const scaleXY = () => {
    if (dc.mapMode === 1) return [1, 1];
    return [dc.vpExt[0] / (dc.winExt[0] || 1), dc.vpExt[1] / (dc.winExt[1] || 1)];
  };
  const pt = (x: number, y: number): [number, number] => {
    const m = dc.world;
    const px = x * m[0] + y * m[2] + m[4];
    const py = x * m[1] + y * m[3] + m[5];
    const [sx, sy] = scaleXY();
    return [(px - dc.winOrg[0]) * sx + dc.vpOrg[0], (py - dc.winOrg[1]) * sy + dc.vpOrg[1]];
  };
  /** Rough logical→device length scale, for pen widths and font sizes. */
  const lenScale = () => {
    const m = dc.world;
    const [sx, sy] = scaleXY();
    return Math.sqrt(Math.abs((m[0] * m[3] - m[1] * m[2]) * sx * sy)) || 1;
  };

  // Path under construction (between BEGINPATH and ENDPATH), or the immediate figure.
  let inPath = false;
  let path = '';
  const P = (x: number, y: number) => { const [a, b] = pt(x, y); return `${r2(a)} ${r2(b)}`; };

  const strokeAttrs = () => {
    const p = dc.pen;
    if (p.none) return 'stroke="none"';
    const w = p.cosmetic ? 1 : Math.max(0.5, p.width * lenScale());
    return `stroke="${p.color}" stroke-width="${r2(w)}" stroke-linejoin="round"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}`;
  };
  const fillAttrs = () => (dc.brush.none ? 'fill="none"' : `fill="${dc.brush.color}" fill-rule="${dc.fillRule}"`);
  const clipAttr = () => (dc.clip ? ` clip-path="url(#${dc.clip})"` : '');
  const emit = (d: string, fill: boolean, stroke: boolean) => {
    if (!d) return;
    if ((!fill || dc.brush.none) && (!stroke || dc.pen.none)) return;
    out.push(`<path d="${d}" ${fill ? fillAttrs() : 'fill="none"'} ${stroke ? strokeAttrs() : 'stroke="none"'}${clipAttr()}/>`);
    drawn++;
  };
  const setClip = (d: string, intersect: boolean) => {
    const id = `c${clipSeq++}`;
    // Intersect with the existing clip by nesting the clip paths.
    defs.push(`<clipPath id="${id}"${intersect && dc.clip ? ` clip-path="url(#${dc.clip})"` : ''}><path d="${d}"/></clipPath>`);
    dc.clip = id;
  };

  const points = (off: number, count: number, wide: boolean) => {
    const res: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      res.push(wide ? [v.getInt32(off + i * 8, true), v.getInt32(off + i * 8 + 4, true)] : [v.getInt16(off + i * 4, true), v.getInt16(off + i * 4 + 2, true)]);
    }
    return res;
  };

  const drawBitmap = (rec: number, dx: number, dy: number, dw: number, dh: number, offBmi: number, cbBmi: number, offBits: number, sx: number, sy: number, sw: number, sh: number) => {
    if (!encodeDib || !cbBmi) return;
    const dib = decodeDib(v, rec + offBmi, rec + offBits);
    if (!dib) return;
    let { w, h, rgba } = dib;
    // Crop to the source rectangle when only part of the bitmap is used.
    if (sw > 0 && sh > 0 && (sx || sy || sw !== w || sh !== h)) {
      const cw = Math.min(sw, w - sx), ch = Math.min(sh, h - sy);
      if (cw <= 0 || ch <= 0) return;
      const crop = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((sy + y) * w + sx) * 4, ((sy + y) * w + sx + cw) * 4), y * cw * 4);
      rgba = crop; w = cw; h = ch;
    }
    const [x0, y0] = pt(dx, dy);
    const [x1, y1] = pt(dx + dw, dy + dh);
    const href = encodeDib(w, h, rgba);
    const xMin = Math.min(x0, x1), yMin = Math.min(y0, y1);
    const flipX = x1 < x0, flipY = y1 < y0;
    const tf = flipX || flipY ? ` transform="translate(${r2(flipX ? x0 + xMin : 0)} ${r2(flipY ? y0 + yMin : 0)}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})"` : '';
    out.push(`<image href="${href}" x="${r2(xMin)}" y="${r2(yMin)}" width="${r2(Math.abs(x1 - x0))}" height="${r2(Math.abs(y1 - y0))}" preserveAspectRatio="none"${tf}${clipAttr()}/>`);
    drawn++;
  };

  let off = 0;
  while (off + 8 <= v.byteLength) {
    const type = v.getUint32(off, true);
    const size = v.getUint32(off + 4, true);
    if (size < 8 || off + size > v.byteLength) break;
    const at = (o: number) => off + o;
    switch (type) {
      case 9: dc.winExt = [v.getInt32(at(8), true), v.getInt32(at(12), true)]; break;
      case 10: dc.winOrg = [v.getInt32(at(8), true), v.getInt32(at(12), true)]; break;
      case 11: dc.vpExt = [v.getInt32(at(8), true), v.getInt32(at(12), true)]; break;
      case 12: dc.vpOrg = [v.getInt32(at(8), true), v.getInt32(at(12), true)]; break;
      case 17: dc.mapMode = v.getUint32(at(8), true); break;
      case 19: dc.fillRule = v.getUint32(at(8), true) === 2 ? 'nonzero' : 'evenodd'; break;
      case 22: dc.textAlign = v.getUint32(at(8), true); break;
      case 24: dc.textColor = colorref(v, at(8)); break;
      case 33: stack.push({ ...dc, world: [...dc.world] as Matrix }); break;
      case 34: {
        const n = v.getInt32(at(8), true);
        const idx = n < 0 ? stack.length + n : n;
        if (idx >= 0 && idx < stack.length) { dc = stack[idx]; stack.length = idx; }
        break;
      }
      case 35: case 36: {
        const x: Matrix = [0, 1, 2, 3, 4, 5].map((i) => v.getFloat32(at(8 + i * 4), true)) as Matrix;
        const mode = type === 35 ? 4 : v.getUint32(at(32), true);
        if (mode === 1) dc.world = [...IDENTITY];
        else if (mode === 2) dc.world = mul(x, dc.world);
        else if (mode === 3) dc.world = mul(dc.world, x);
        else dc.world = x;
        break;
      }
      case 38: { // CREATEPEN
        const style = v.getUint32(at(12), true);
        objects.set(v.getUint32(at(8), true), { kind: 'pen', pen: { color: colorref(v, at(24)), width: v.getInt32(at(16), true), cosmetic: v.getInt32(at(16), true) <= 1, none: (style & 15) === 5 } });
        break;
      }
      case 95: { // EXTCREATEPEN
        const style = v.getUint32(at(28), true);
        const kind = style & 15;
        objects.set(v.getUint32(at(8), true), {
          kind: 'pen',
          pen: {
            color: colorref(v, at(40)), width: v.getUint32(at(32), true), cosmetic: !(style & 0x10000), none: kind === 5 || v.getUint32(at(36), true) === 1,
            dash: kind === 1 ? '6 3' : kind === 2 ? '2 2' : kind === 3 ? '6 2 2 2' : undefined,
          },
        });
        break;
      }
      case 39: { // CREATEBRUSHINDIRECT
        const style = v.getUint32(at(12), true);
        objects.set(v.getUint32(at(8), true), { kind: 'brush', brush: { color: colorref(v, at(16)), none: style === 1 } });
        break;
      }
      case 93: case 94: // CREATEMONOBRUSH / CREATEDIBPATTERNBRUSHPT: approximate with mid gray
        objects.set(v.getUint32(at(8), true), { kind: 'brush', brush: { color: '#808080', none: false } });
        break;
      case 82: { // EXTCREATEFONTINDIRECTW
        let face = '';
        for (let i = 0; i < 32; i++) { const c = v.getUint16(at(40 + i * 2), true); if (!c) break; face += String.fromCharCode(c); }
        objects.set(v.getUint32(at(8), true), { kind: 'font', font: { height: Math.abs(v.getInt32(at(12), true)) || 12, weight: v.getInt32(at(28), true), italic: !!v.getUint8(at(32)), face: face || 'Arial' } });
        break;
      }
      case 37: { // SELECTOBJECT
        const ih = v.getUint32(at(8), true);
        if (ih & 0x80000000) {
          const i = ih & 0x7fffffff;
          if (STOCK_BRUSH[i]) dc.brush = STOCK_BRUSH[i];
          else if (STOCK_PEN[i]) dc.pen = STOCK_PEN[i];
        } else {
          const o = objects.get(ih);
          if (o?.kind === 'pen') dc.pen = o.pen;
          else if (o?.kind === 'brush') dc.brush = o.brush;
          else if (o?.kind === 'font') dc.font = o.font;
        }
        break;
      }
      case 40: objects.delete(v.getUint32(at(8), true)); break;

      case 59: inPath = true; path = ''; break; // BEGINPATH
      case 60: inPath = false; break; // ENDPATH
      case 68: inPath = false; path = ''; break; // ABORTPATH
      case 61: if (inPath) path += 'Z'; break; // CLOSEFIGURE
      case 62: emit(path, true, false); path = ''; break; // FILLPATH
      case 63: emit(path, true, true); path = ''; break; // STROKEANDFILLPATH
      case 64: emit(path, false, true); path = ''; break; // STROKEPATH
      case 67: { // SELECTCLIPPATH
        const mode = v.getUint32(at(8), true);
        if (path) setClip(path, mode === 1);
        path = '';
        break;
      }
      case 30: { // INTERSECTCLIPRECT
        const [l, t, r, b] = [8, 12, 16, 20].map((o) => v.getInt32(at(o), true));
        setClip(`M${P(l, t)}L${P(r, t)}L${P(r, b)}L${P(l, b)}Z`, true);
        break;
      }
      case 75: // EXTSELECTCLIPRGN: an empty region with RGN_COPY resets clipping
        if (v.getUint32(at(8), true) === 0) dc.clip = null;
        break;

      case 27: { // MOVETOEX
        const x = v.getInt32(at(8), true), y = v.getInt32(at(12), true);
        dc.cur = [x, y];
        if (inPath) path += `M${P(x, y)}`;
        break;
      }
      case 54: { // LINETO
        const x = v.getInt32(at(8), true), y = v.getInt32(at(12), true);
        if (inPath) path += `L${P(x, y)}`;
        else emit(`M${P(...dc.cur)}L${P(x, y)}`, false, true);
        dc.cur = [x, y];
        break;
      }
      case 2: case 85: case 3: case 86: case 4: case 87: case 5: case 88: case 6: case 89: {
        const wide = type < 10;
        const n = v.getUint32(at(24), true);
        const pts = points(at(28), n, wide);
        if (!pts.length) break;
        const kind = wide ? type : type - 83; // 2 bezier, 3 polygon, 4 polyline, 5 bezierto, 6 polylineto
        let d = '';
        if (kind === 5 || kind === 6) {
          if (!inPath) d = `M${P(...dc.cur)}`;
          if (kind === 6) d += pts.map((p) => `L${P(...p)}`).join('');
          else for (let i = 0; i + 2 < pts.length; i += 3) d += `C${P(...pts[i])} ${P(...pts[i + 1])} ${P(...pts[i + 2])}`;
          dc.cur = pts[pts.length - 1];
        } else {
          d = `M${P(...pts[0])}`;
          if (kind === 2) for (let i = 1; i + 2 < pts.length; i += 3) d += `C${P(...pts[i])} ${P(...pts[i + 1])} ${P(...pts[i + 2])}`;
          else d += pts.slice(1).map((p) => `L${P(...p)}`).join('');
          if (kind === 3) d += 'Z';
        }
        if (inPath) path += d;
        else emit(d, kind === 3, true);
        break;
      }
      case 7: case 90: case 8: case 91: { // POLYPOLYLINE / POLYPOLYGON
        const wide = type < 10;
        const polys = v.getUint32(at(24), true);
        const counts = Array.from({ length: polys }, (_, i) => v.getUint32(at(32 + i * 4), true));
        const all = points(at(32 + polys * 4), counts.reduce((a, b) => a + b, 0), wide);
        const closed = type === 8 || type === 91;
        let d = '', k = 0;
        for (const c of counts) {
          const seg = all.slice(k, k + c);
          k += c;
          if (!seg.length) continue;
          d += `M${P(...seg[0])}` + seg.slice(1).map((p) => `L${P(...p)}`).join('') + (closed ? 'Z' : '');
        }
        if (inPath) path += d;
        else emit(d, closed, true);
        break;
      }
      case 43: case 42: case 44: { // RECTANGLE / ELLIPSE / ROUNDRECT
        const [l, t, r, b] = [8, 12, 16, 20].map((o) => v.getInt32(at(o), true));
        let d: string;
        if (type === 42) {
          const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2, kk = 0.5523;
          d = `M${P(cx + rx, cy)}C${P(cx + rx, cy + ry * kk)} ${P(cx + rx * kk, cy + ry)} ${P(cx, cy + ry)}C${P(cx - rx * kk, cy + ry)} ${P(cx - rx, cy + ry * kk)} ${P(cx - rx, cy)}C${P(cx - rx, cy - ry * kk)} ${P(cx - rx * kk, cy - ry)} ${P(cx, cy - ry)}C${P(cx + rx * kk, cy - ry)} ${P(cx + rx, cy - ry * kk)} ${P(cx + rx, cy)}Z`;
        } else d = `M${P(l, t)}L${P(r, t)}L${P(r, b)}L${P(l, b)}Z`;
        if (inPath) path += d;
        else emit(d, true, true);
        break;
      }
      case 84: { // EXTTEXTOUTW
        const n = v.getUint32(at(44), true);
        const offStr = v.getUint32(at(48), true);
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint16(at(offStr + i * 2), true));
        if (!s.trim()) break;
        const [x, y] = pt(v.getInt32(at(36), true), v.getInt32(at(40), true));
        const fs = Math.max(1, dc.font.height * lenScale());
        const anchor = (dc.textAlign & 6) === 6 ? 'middle' : dc.textAlign & 2 ? 'end' : 'start';
        const baseline = dc.textAlign & 24 ? (dc.textAlign & 8 ? 'auto' : 'auto') : 'hanging';
        out.push(`<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(fs)}" font-family="${esc(dc.font.face)}, Arial, sans-serif"${dc.font.weight >= 600 ? ' font-weight="bold"' : ''}${dc.font.italic ? ' font-style="italic"' : ''} fill="${dc.textColor}" text-anchor="${anchor}" dominant-baseline="${baseline}"${clipAttr()}>${esc(s)}</text>`);
        drawn++;
        break;
      }
      case 81: { // STRETCHDIBITS
        const rop = v.getUint32(at(68), true);
        if (rop !== 0x00cc0020 && rop !== 0x00ee0086 && rop !== 0x008800c6) break; // copy / paint / and
        drawBitmap(off, v.getInt32(at(24), true), v.getInt32(at(28), true), v.getInt32(at(72), true), v.getInt32(at(76), true),
          v.getUint32(at(48), true), v.getUint32(at(52), true), v.getUint32(at(56), true),
          v.getInt32(at(32), true), v.getInt32(at(36), true), v.getInt32(at(40), true), v.getInt32(at(44), true));
        break;
      }
      case 80: { // SETDIBITSTODEVICE
        const w = v.getInt32(at(40), true), h = v.getInt32(at(44), true);
        drawBitmap(off, v.getInt32(at(24), true), v.getInt32(at(28), true), w, h, v.getUint32(at(48), true), v.getUint32(at(52), true), v.getUint32(at(56), true), 0, 0, 0, 0);
        break;
      }
      case 76: case 77: { // BITBLT / STRETCHBLT
        const x = v.getInt32(at(24), true), y = v.getInt32(at(28), true), w = v.getInt32(at(32), true), h = v.getInt32(at(36), true);
        const cbBmi = v.getUint32(at(88), true);
        const rop = v.getUint32(at(40), true);
        if (!cbBmi) {
          // Blits without a bitmap only paint for these raster ops; others (e.g. 0xAA0029 "leave destination") are no-ops.
          const rect = `M${P(x, y)}L${P(x + w, y)}L${P(x + w, y + h)}L${P(x, y + h)}Z`;
          const saved = dc.brush;
          if (rop === 0x00f00021 && !dc.brush.none) emit(rect, true, false); // PATCOPY
          else if (rop === 0x00ff0062 || rop === 0x00000042) { // WHITENESS / BLACKNESS
            dc.brush = { color: rop === 0x42 ? '#000000' : '#ffffff', none: false };
            emit(rect, true, false);
          }
          dc.brush = saved;
          break;
        }
        const sw = type === 77 ? v.getInt32(at(100), true) : w, sh = type === 77 ? v.getInt32(at(104), true) : h;
        drawBitmap(off, x, y, w, h, v.getUint32(at(84), true), cbBmi, v.getUint32(at(92), true), v.getInt32(at(44), true), v.getInt32(at(48), true), sw, sh);
        break;
      }
      default:
        break; // EMF+ comments, ICM, BK mode, ROP2, etc. don't affect the picture enough to matter.
    }
    if (type === 14) break; // EOF
    off += size;
  }

  const body = (defs.length ? `<defs>${defs.join('')}</defs>` : '') + out.join('');
  return { body, bounds, frameIn, empty: drawn === 0 };
}
