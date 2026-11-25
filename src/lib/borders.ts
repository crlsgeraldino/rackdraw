/*
 * Design → Borders & Titles: page border designs with the page title, the client, the date and the page number.
 * Each design is described once, as plain shapes and text sized to the page, and drawn the same way everywhere:
 * on the canvas, in print and in the PDF report (and as the gallery's thumbnails).
 */
import { FRAME_COLOR, type PageFrame, type Project } from './types';

export type BorderPart =
  | { t: 'rect'; x: number; y: number; w: number; h: number; stroke?: string; fill?: string; width?: number; r?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | { t: 'text'; x: number; y: number; text: string; size: number; color: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; up?: boolean };

export interface BorderText {
  /** The page (or sheet) title. */
  title: string;
  /** Client, and site when there is one. */
  client: string;
  /** Empty = not shown. */
  date: string;
  /** e.g. "Page 2 of 3"; empty = not shown. */
  page: string;
}

export interface BorderLayout {
  parts: BorderPart[];
  /** Room the design takes at each edge (content is kept clear of it in print and PDF). */
  inset: { top: number; right: number; bottom: number; left: number };
}

export const BORDER_DESIGNS: { id: PageFrame; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'simple', name: 'Simple frame' },
  { id: 'banner', name: 'Title banner' },
  { id: 'classic', name: 'Classic' },
  { id: 'engineer', name: 'Title strip' },
  { id: 'corners', name: 'Corners' },
  { id: 'sideband', name: 'Side band' },
  { id: 'underline', name: 'Underlined' },
  { id: 'footer', name: 'Footer band' },
  { id: 'headfoot', name: 'Header & footer' },
  { id: 'tab', name: 'Tab' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'modern', name: 'Modern' },
];

/** Does this design write the title itself (so the report doesn't add its own heading)? */
export const borderHasTitle = (id: PageFrame | undefined) => !!id && id !== 'none' && id !== 'simple';

/** A colour mixed with white: 0 = the colour, 1 = white. */
export function tint(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#e5e7eb';
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
}

const GREY = '#4b5563';
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Rough text width, for sizing tabs and pills. */
const textW = (s: string, size: number) => s.length * size * 0.56;

/**
 * The shapes of a border design on a W × H page. Sizes scale with the page: `u` is one point on a Letter page's short
 * side (so the same design looks the same on screen, in print and in the PDF).
 */
export function borderLayout(id: PageFrame | undefined, W: number, H: number, color = FRAME_COLOR, text: BorderText, short_ = Math.min(W, H)): BorderLayout {
  const u = short_ / 612;
  const c = color;
  const title = short(text.title, 70);
  const client = short(text.client, 90);
  const meta = [text.date, text.page].filter(Boolean).join('   ·   ');
  const parts: BorderPart[] = [];
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const T = (x: number, y: number, s: string, size: number, color: string, o: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; up?: boolean } = {}) => {
    if (s) parts.push({ t: 'text', x, y, text: s, size, color, ...o });
  };
  switch (id) {
    case 'simple':
      parts.push({ t: 'rect', x: 10 * u, y: 10 * u, w: W - 20 * u, h: H - 20 * u, stroke: c, width: 1.5 * u });
      parts.push({ t: 'rect', x: 6.5 * u, y: 6.5 * u, w: W - 13 * u, h: H - 13 * u, stroke: c, width: 0.6 * u });
      break;
    case 'banner':
      parts.push({ t: 'rect', x: 0, y: 0, w: W, h: 52 * u, fill: c });
      T(20 * u, 38 * u, title, 20 * u, '#ffffff', { bold: true });
      T(W - 20 * u, 24 * u, client, 10 * u, '#ffffff', { anchor: 'end' });
      T(W - 20 * u, 40 * u, meta, 9 * u, tint(c, 0.75), { anchor: 'end' });
      inset.top = 56 * u;
      break;
    case 'classic':
      parts.push({ t: 'rect', x: 12 * u, y: 12 * u, w: W - 24 * u, h: H - 24 * u, stroke: c, width: 2 * u });
      parts.push({ t: 'rect', x: 17 * u, y: 17 * u, w: W - 34 * u, h: H - 34 * u, stroke: c, width: 0.6 * u });
      T(30 * u, 44 * u, title, 18 * u, c, { bold: true });
      T(30 * u, 59 * u, client, 10 * u, GREY);
      T(W - 30 * u, H - 28 * u, meta, 9 * u, GREY, { anchor: 'end' });
      inset.top = 68 * u; inset.bottom = 38 * u; inset.left = 20 * u; inset.right = 20 * u;
      break;
    case 'engineer': {
      const y = H - 52 * u;
      parts.push({ t: 'rect', x: 10 * u, y: 10 * u, w: W - 20 * u, h: H - 20 * u, stroke: c, width: 2.5 * u });
      parts.push({ t: 'rect', x: 10 * u, y, w: W - 20 * u, h: 42 * u, stroke: c, width: 1.5 * u, fill: tint(c, 0.94) });
      const cells: [string, string, number][] = [['Drawing', title, 0], ['Client', client, 0.46], ['Date', text.date, 0.74], ['Page', text.page.replace(/^Page /, ''), 0.88]];
      const x0 = 10 * u, cw = W - 20 * u;
      cells.forEach(([label, value, f], i) => {
        const x = x0 + cw * f;
        if (i) parts.push({ t: 'line', x1: x, y1: y, x2: x, y2: y + 42 * u, stroke: c, width: 0.8 * u });
        T(x + 8 * u, y + 13 * u, label.toUpperCase(), 6.5 * u, GREY);
        T(x + 8 * u, y + 32 * u, short(value, i ? 40 : 60), 11 * u, '#111827', { bold: i === 0 });
      });
      inset.bottom = 58 * u; inset.top = 14 * u; inset.left = 14 * u; inset.right = 14 * u;
      break;
    }
    case 'corners': {
      const o = 12 * u, L = 44 * u, w = 3 * u;
      for (const [x, y, dx, dy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]]) {
        parts.push({ t: 'line', x1: x, y1: y, x2: x + dx * L, y2: y, stroke: c, width: w });
        parts.push({ t: 'line', x1: x, y1: y, x2: x, y2: y + dy * L, stroke: c, width: w });
      }
      T(30 * u, 44 * u, title, 18 * u, '#111827', { bold: true });
      T(30 * u, 59 * u, client, 10 * u, GREY);
      T(W - 30 * u, H - 24 * u, meta, 9 * u, GREY, { anchor: 'end' });
      inset.top = 66 * u; inset.bottom = 32 * u;
      break;
    }
    case 'sideband':
      parts.push({ t: 'rect', x: 0, y: 0, w: 50 * u, h: H, fill: c });
      T(24 * u, H - 24 * u, title, 15 * u, '#ffffff', { bold: true, up: true });
      T(40 * u, H - 24 * u, client, 9 * u, tint(c, 0.8), { up: true });
      T(W - 20 * u, H - 18 * u, meta, 9 * u, GREY, { anchor: 'end' });
      inset.left = 56 * u; inset.bottom = 26 * u;
      break;
    case 'underline':
      T(24 * u, 38 * u, title, 20 * u, c, { bold: true });
      T(W - 24 * u, 38 * u, client, 10 * u, GREY, { anchor: 'end' });
      parts.push({ t: 'line', x1: 24 * u, y1: 48 * u, x2: W - 24 * u, y2: 48 * u, stroke: c, width: 2 * u });
      parts.push({ t: 'line', x1: 24 * u, y1: H - 34 * u, x2: W - 24 * u, y2: H - 34 * u, stroke: '#9ca3af', width: 0.75 * u });
      T(24 * u, H - 20 * u, text.date, 9 * u, GREY);
      T(W - 24 * u, H - 20 * u, text.page, 9 * u, GREY, { anchor: 'end' });
      inset.top = 56 * u; inset.bottom = 40 * u;
      break;
    case 'footer':
      parts.push({ t: 'rect', x: 0, y: H - 40 * u, w: W, h: 40 * u, fill: c });
      T(20 * u, H - 15 * u, title, 15 * u, '#ffffff', { bold: true });
      T(W / 2, H - 15 * u, client, 10 * u, '#ffffff', { anchor: 'middle' });
      T(W - 20 * u, H - 15 * u, meta, 9 * u, tint(c, 0.8), { anchor: 'end' });
      inset.bottom = 44 * u;
      break;
    case 'headfoot':
      parts.push({ t: 'rect', x: 0, y: 0, w: W, h: 30 * u, fill: c });
      parts.push({ t: 'rect', x: 0, y: H - 22 * u, w: W, h: 22 * u, fill: tint(c, 0.85) });
      T(18 * u, 21 * u, title, 14 * u, '#ffffff', { bold: true });
      T(W - 18 * u, 20 * u, client, 10 * u, '#ffffff', { anchor: 'end' });
      T(18 * u, H - 8 * u, text.date, 9 * u, c);
      T(W - 18 * u, H - 8 * u, text.page, 9 * u, c, { anchor: 'end' });
      inset.top = 34 * u; inset.bottom = 26 * u;
      break;
    case 'tab': {
      const tw = Math.min(W / 2, textW(title, 12 * u) + 26 * u);
      parts.push({ t: 'rect', x: 14 * u, y: 32 * u, w: W - 28 * u, h: H - 46 * u, stroke: c, width: 1.5 * u });
      parts.push({ t: 'rect', x: 14 * u, y: 10 * u, w: tw, h: 22 * u, fill: c });
      T(27 * u, 26 * u, title, 12 * u, '#ffffff', { bold: true });
      T(14 * u + tw + 12 * u, 26 * u, client, 10 * u, GREY);
      T(W - 26 * u, H - 24 * u, meta, 9 * u, GREY, { anchor: 'end' });
      inset.top = 38 * u; inset.bottom = 34 * u; inset.left = 18 * u; inset.right = 18 * u;
      break;
    }
    case 'rounded': {
      const pw = Math.min(W * 0.7, textW(title, 12 * u) + 32 * u);
      parts.push({ t: 'rect', x: 12 * u, y: 14 * u, w: W - 24 * u, h: H - 26 * u, stroke: c, width: 2 * u, r: 18 * u });
      parts.push({ t: 'rect', x: (W - pw) / 2, y: 2 * u, w: pw, h: 24 * u, fill: c, r: 12 * u });
      T(W / 2, 18.5 * u, title, 12 * u, '#ffffff', { bold: true, anchor: 'middle' });
      T(W / 2, 42 * u, client, 10 * u, GREY, { anchor: 'middle' });
      T(W / 2, H - 22 * u, meta, 9 * u, GREY, { anchor: 'middle' });
      inset.top = 50 * u; inset.bottom = 32 * u; inset.left = 16 * u; inset.right = 16 * u;
      break;
    }
    case 'modern':
      parts.push({ t: 'rect', x: 0, y: 0, w: W, h: 64 * u, fill: tint(c, 0.9) });
      parts.push({ t: 'rect', x: 20 * u, y: 16 * u, w: 6 * u, h: 36 * u, fill: c });
      parts.push({ t: 'rect', x: 0, y: H - 6 * u, w: W, h: 6 * u, fill: c });
      T(36 * u, 36 * u, title, 20 * u, '#111827', { bold: true });
      T(36 * u, 51 * u, client, 10 * u, GREY);
      T(W - 20 * u, 36 * u, meta, 9 * u, GREY, { anchor: 'end' });
      inset.top = 68 * u; inset.bottom = 10 * u;
      break;
    default:
      break;
  }
  return { parts, inset };
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The design as SVG markup (print sheets and the gallery). */
export function borderSvg(layout: BorderLayout, W: number, H: number, font = "'Segoe UI', Arial, sans-serif") {
  const body = layout.parts.map((p) => {
    if (p.t === 'rect') {
      return `<rect x="${p.x}" y="${p.y}" width="${Math.max(0, p.w)}" height="${Math.max(0, p.h)}"${p.r ? ` rx="${p.r}"` : ''} fill="${p.fill ? escXml(p.fill) : 'none'}"${p.stroke ? ` stroke="${escXml(p.stroke)}" stroke-width="${p.width ?? 1}"` : ''}/>`;
    }
    if (p.t === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${escXml(p.stroke)}" stroke-width="${p.width}" stroke-linecap="square"/>`;
    return `<text x="${p.x}" y="${p.y}" font-size="${p.size}" fill="${escXml(p.color)}"${p.bold ? ' font-weight="600"' : ''} text-anchor="${p.anchor ?? 'start'}"${p.up ? ` transform="rotate(-90 ${p.x} ${p.y})"` : ''}>${escXml(p.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" font-family="${escXml(font)}">${body}</svg>`;
}

/**
 * The border text of one of a client's pages (the canvas): page n of m counts the pages that aren't background
 * pages. The date is the title block's date when set, else today; the date and page number follow Borders & Titles'
 * switches.
 */
export function pageBorderText(p: Project, pageId: string, title?: string): BorderText {
  const pages = p.pages.filter((pg) => !pg.background);
  const i = pages.findIndex((pg) => pg.id === pageId);
  const page = p.pages.find((pg) => pg.id === pageId);
  return borderText({
    title: title ?? page?.name ?? '',
    client: p.name,
    site: p.site,
    date: p.display?.frameDate === false ? false : p.titleBlock?.date,
    page: p.display?.framePage === false || i < 0 ? undefined : i + 1,
    pages: pages.length,
  });
}

/** Text for a page's border: its title, the client and site, the date and "Page n of m". */
export function borderText(o: { title: string; client: string; site?: string; date?: string | false; page?: number; pages?: number }): BorderText {
  return {
    title: o.title,
    client: [o.client, o.site].filter(Boolean).join(' · '),
    date: o.date === false ? '' : o.date || new Date().toLocaleDateString(),
    page: o.page && o.pages ? `Page ${o.page} of ${o.pages}` : '',
  };
}
