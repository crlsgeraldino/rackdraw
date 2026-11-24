/**
 * Reads Visio stencils (.vssx, also the masters inside .vsdx / .vstx) in the browser and turns masters into
 * RackDraw stencils: Visio geometry and styles become SVG, embedded PNG/JPG/GIF/BMP pictures are kept, EMF
 * pictures go through the EMF converter, and connection points become cable ports.
 *
 * Visio coordinates are inches with y pointing up; everything is drawn in that space and flipped once at the end.
 */
import { unzipSync, type Unzipped } from 'fflate';
import type { PortDef } from '../types';
import { bmpToRgba, emfToSvg, type DibEncoder } from './emf';
import { parseTheme, themedColor, type ThemeKind, type VisioTheme } from './theme';

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

/**
 * Breaks text into lines that fit `width` (same units as `charW`, an average character width): explicit line
 * breaks are kept, words wrap; a single word longer than the line stays whole. Character widths are estimated,
 * so lines may run up to 8% over before wrapping.
 */
function wrapText(text: string, width: number, charW: number): string[] {
  const max = Math.max(1, Math.floor((width * 1.08) / charW));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** A Visio length as text ("4 in.", "1 ft. 6 in.", "10 cm", "0.2 m", "6\"") in inches; null if unreadable. */
function realInches(text: string): number | null {
  const PER: Record<string, number> = { in: 1, inch: 1, inches: 1, '"': 1, ft: 12, feet: 12, foot: 12, "'": 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 39.3701 };
  let total = 0, any = false;
  for (const m of text.toLowerCase().matchAll(/(-?\d+(?:[.,]\d+)?)\s*(inches|inch|in|feet|foot|ft|mm|cm|m|"|')?\.?/g)) {
    const v = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    total += v * (PER[m[2] ?? 'in'] ?? 1);
    any = true;
  }
  return any && total > 0 ? total : null;
}

/** The average of #rrggbb colours. */
function averageColor(cs: string[]): string {
  const ch = (i: number) => Math.round(cs.reduce((a, c) => a + parseInt(c.slice(i, i + 2), 16), 0) / cs.length);
  return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative lightness (0 black – 1 white) of a #rrggbb colour. */
const lightness = (hex: string) => [1, 3, 5].reduce((a, i, k) => a + (parseInt(hex.slice(i, i + 2), 16) / 255) * [0.299, 0.587, 0.114][k], 0);

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
  /** Every master by ID, hidden ones included (page shapes refer to them). */
  private allMasters = new Map<string, VisioMasterInfo>();
  private masterRenders = new Map<string, RenderedMaster | null>();

  private constructor(private data: Uint8Array, readonly masters: VisioMasterInfo[], private styles: Map<string, Element>) {}

  /** The drawing's themes (colours of shapes whose cells say "Themed"), by theme number; `theme` is the first. */
  private theme: VisioTheme | null = null;
  private themes = new Map<string, VisioTheme>();

  /** Pages of a drawing (.vsdx); empty for a stencil. */
  pages: VisioPageInfo[] = [];

  static async open(file: File, opts: { drawing?: boolean } = {}): Promise<VisioPackage> {
    if (/\.(vss|vsd|vst)$/i.test(file.name)) {
      throw new Error('This is an older binary Visio file (.vss/.vsd). Open it in Visio and save it as a .vssx stencil, then import that.');
    }
    const data = new Uint8Array(await file.arrayBuffer());
    if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('This is not a Visio .vssx/.vsdx file.');
    const pkg = new VisioPackage(data, [], new Map());
    const mastersXml = pkg.text('visio/masters/masters.xml');
    if (!mastersXml && !opts.drawing) throw new Error('This Visio file has no stencil masters.');
    if (mastersXml) {
      const rels = pkg.rels('visio/masters/masters.xml');
      const doc = new DOMParser().parseFromString(mastersXml, 'application/xml');
      for (const m of Array.from(doc.getElementsByTagNameNS(NS, 'Master'))) {
        const relId = m.getElementsByTagNameNS(NS, 'Rel')[0]?.getAttributeNS(REL_NS, 'id');
        const target = relId && rels.get(relId);
        if (!target) continue;
        const info = { id: m.getAttribute('ID') ?? target, name: m.getAttribute('Name') || m.getAttribute('NameU') || `Master ${m.getAttribute('ID')}`, file: `visio/masters/${target}` };
        pkg.allMasters.set(info.id, info);
        // Hidden masters (e.g. Dynamic connector) are used by drawings but not offered as stencil shapes.
        if (m.getAttribute('Hidden') !== '1') pkg.masters.push(info);
      }
    }
    if (opts.drawing) {
      const pagesXml = pkg.text('visio/pages/pages.xml');
      if (!pagesXml) throw new Error('This Visio file has no drawing pages.');
      const prels = pkg.rels('visio/pages/pages.xml');
      for (const pg of Array.from(new DOMParser().parseFromString(pagesXml, 'application/xml').getElementsByTagNameNS(NS, 'Page'))) {
        const relId = pg.getElementsByTagNameNS(NS, 'Rel')[0]?.getAttributeNS(REL_NS, 'id');
        const target = relId && prels.get(relId);
        if (!target) continue;
        const sheet = pg.getElementsByTagNameNS(NS, 'PageSheet')[0];
        const layerSec = sheet ? section(sheet, 'Layer') : undefined;
        const layers = layerSec ? children(layerSec, 'Row').map((r) => ({
          name: cell(r, 'Name') || cell(r, 'NameUniv') || 'Layer',
          visible: cell(r, 'Visible') !== '0', print: cell(r, 'Print') !== '0', lock: cell(r, 'Lock') === '1',
        })) : undefined;
        pkg.pages.push({
          id: pg.getAttribute('ID') ?? undefined,
          background: pg.getAttribute('Background') === '1',
          backPage: pg.getAttribute('BackPage') ?? undefined,
          layers,
          name: pg.getAttribute('Name') || pg.getAttribute('NameU') || `Page ${pkg.pages.length + 1}`,
          file: `visio/pages/${target}`,
          themeIndex: (sheet && (cell(sheet, 'ColorSchemeIndex') ?? cell(sheet, 'ThemeIndex'))) || undefined,
          variationColor: num(sheet ? cell(sheet, 'VariationColorIndex') : null, 0),
          variationStyle: num(sheet ? cell(sheet, 'VariationStyleIndex') : null, 0),
          widthIn: num(sheet ? cell(sheet, 'PageWidth') : null, 11),
          heightIn: num(sheet ? cell(sheet, 'PageHeight') : null, 8.5),
          // Scaled drawings (floor plans) store shapes in real-world units: paper = real × PageScale / DrawingScale.
          scale: sheet ? num(cell(sheet, 'PageScale'), 1) / (num(cell(sheet, 'DrawingScale'), 1) || 1) || 1 : 1,
          realUnit: /^(M|CM|MM|KM|DL_M)$/i.test(sheet ? cellUnit(sheet, 'DrawingScale') ?? '' : '') ? 'm' : 'ft',
        });
      }
    }
    // Style sheets supply default line/fill/text formatting.
    const docXml = pkg.text('visio/document.xml');
    if (docXml) {
      const d = new DOMParser().parseFromString(docXml, 'application/xml');
      for (const st of Array.from(d.getElementsByTagNameNS(NS, 'StyleSheet'))) pkg.styles.set(st.getAttribute('ID') ?? '', st);
    }
    for (let i = 1; i <= 20; i++) {
      const xml = pkg.text(`visio/theme/theme${i}.xml`);
      if (!xml) break;
      let th: VisioTheme | null = null;
      try { th = parseTheme(xml); } catch { th = null; }
      if (!th) continue;
      pkg.theme ??= th;
      for (const id of th.ids) if (!pkg.themes.has(id)) pkg.themes.set(id, th);
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

    // Line widths, text sizes and margins are paper sizes; on a scaled page the shape itself is in real-world units.
    const sc = ctx.scale ?? 1;
    // Geometry
    const lineW = Math.max(0.003, num(get('LineWeight', 'line'), 0.01)) / sc;
    const linePattern = num(get('LinePattern', 'line'), 1);
    const lineColor = this.colorOf(s, 'line', ctx) ?? '#000000';
    const fillPattern = num(get('FillPattern', 'fill'), 1);
    const fillColor = this.colorOf(s, 'fill', ctx) ?? '#ffffff';
    const fillTrans = num(get('FillForegndTrans', 'fill'), 0);
    for (const geo of sections(s, 'Geometry')) {
      if (cell(geo, 'NoShow') === '1') continue;
      const { d, closed } = geometry(geo, t.w, t.h);
      if (!d) continue;
      const fill = closed && cell(geo, 'NoFill') !== '1' && fillPattern !== 0;
      const stroke = cell(geo, 'NoLine') !== '1' && linePattern !== 0;
      if (!fill && !stroke) continue;
      // Even-odd, as Visio fills: an outline drawn around a smaller one leaves the inside empty (rings, frames).
      parts.push(`<path d="${d}" fill="${fill ? fillColor : 'none'}" fill-rule="evenodd"${fill && fillTrans ? ` fill-opacity="${r3(1 - fillTrans)}"` : ''} stroke="${stroke ? lineColor : 'none'}" stroke-width="${r3(lineW)}" stroke-linejoin="round"${linePattern > 1 ? ` stroke-dasharray="${r3(lineW * 4)} ${r3(lineW * 3)}"` : ''}/>`);
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

    // Text: wrapped to its text block, aligned like Visio (paragraph alignment, vertical alignment, margins).
    const textEl = children(s, 'Text')[0];
    const text = textEl?.textContent?.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').trim();
    // Hidden text (HideText) isn't drawn: Visio shows it only when the shape's settings turn it on.
    if (text && cell(s, 'HideText') !== '1') {
      const size = num(sectionCell(s, 'Character', 'Size', this.styles), 0.1111) / sc;
      const bold = (num(sectionCell(s, 'Character', 'Style', this.styles)) & 1) === 1;
      const tc = this.colorOf(s, 'font', ctx) ?? '#000000';
      // The text block: TxtPinX/Y is where its anchor point (TxtLocPinX/Y) sits; by default the block is the shape.
      const tw = num(cell(s, 'TxtWidth'), t.w), th = num(cell(s, 'TxtHeight'), t.h);
      const bx = num(cell(s, 'TxtPinX'), t.w / 2) - num(cell(s, 'TxtLocPinX'), tw / 2);
      const by = num(cell(s, 'TxtPinY'), t.h / 2) - num(cell(s, 'TxtLocPinY'), th / 2);
      const ty = by + th / 2;
      // Left / right aligned text starts at the block's edge (inside its margin), as Visio draws it.
      const align = num(paraCell(s, 'HorzAlign', this.styles), 1);
      const left = num(get('LeftMargin', 'text'), 0.0556) / sc, right = num(get('RightMargin', 'text'), 0.0556) / sc;
      const top = num(get('TopMargin', 'text'), 0.0556) / sc, bottom = num(get('BottomMargin', 'text'), 0.0556) / sc;
      const x = align === 0 ? bx + left : align === 2 ? bx + tw - right : bx + tw / 2;
      const anchor = align === 0 ? 'start' : align === 2 ? 'end' : 'middle';
      // Auto-sized text blocks (TxtWidth = the text's own width) never wrap inside their shape's width.
      const lines = wrapText(text, Math.max(size, Math.max(tw, t.w) - left - right), size * (bold ? 0.56 : 0.52));
      const lh = size * 1.2;
      const va = num(get('VerticalAlign', 'text'), 1);
      const y0 = va === 0 ? -th / 2 + top + lh / 2 : va === 2 ? th / 2 - bottom - lh / 2 - (lines.length - 1) * lh : -((lines.length - 1) * lh) / 2;
      const spans = lines.map((l, i) => `<tspan x="0" y="${r3(y0 + i * lh)}">${esc(l)}</tspan>`).join('');
      parts.push(`<g transform="matrix(1 0 0 -1 ${r3(x)} ${r3(ty)})"><text font-size="${r3(size)}" font-family="Segoe UI, Arial, sans-serif"${bold ? ' font-weight="bold"' : ''} fill="${tc}" text-anchor="${anchor}" dominant-baseline="central">${spans}</text></g>`);
    }

    if (!parts.length) return '';
    const [a, b, c, d, e, f] = t.m;
    return `<g transform="matrix(${r3(a)} ${r3(b)} ${r3(c)} ${r3(d)} ${r3(e)} ${r3(f)})">${parts.join('')}</g>`;
  }

  /**
   * Reads one drawing page: each top-level shape becomes a picture (devices and anything complex, with its Shape
   * Data and connection points), a box, an ellipse, a text block or a line, plus which connector ends are glued
   * to which shapes. Positions are in pixels (96 per inch) from the page's top-left.
   */
  readPage(page: VisioPageInfo, encodeDib: DibEncoder): { items: PageItem[]; connects: PageConnect[]; warnings: string[] } {
    const xml = this.text(page.file);
    if (!xml) throw new Error(`Page "${page.name}" is missing from the file.`);
    const rels = this.rels(page.file);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const warnings: string[] = [];
    const ctx: Ctx = { pkg: this, rels, folder: page.file.slice(0, page.file.lastIndexOf('/')), encodeDib, warnings, scale: page.scale, themeIndex: page.themeIndex, variationColor: page.variationColor, variationStyle: page.variationStyle };
    const shapesEl = doc.getElementsByTagNameNS(NS, 'Shapes')[0];
    const tops = shapesEl ? children(shapesEl, 'Shape') : [];
    // A shape drawn from a master only stores what differs from it: fill in the rest (size, geometry, text, styles,
    // sub-shapes) from the master, as Visio does, so every copy is drawn at its own size with its own text.
    for (const s of tops) {
      const mid = s.getAttribute('Master');
      const ms = mid ? this.masterShape(mid) : null;
      if (ms) inheritFrom(s, ms);
    }
    // Connectors glued to a part of a group (a row of a table) count as glued to the group.
    const topOf = new Map<string, string>();
    for (const s of tops) {
      const id = s.getAttribute('ID') ?? '';
      for (const d of Array.from(s.getElementsByTagNameNS(NS, 'Shape'))) topOf.set(d.getAttribute('ID') ?? '', id);
    }
    const H = page.heightIn;
    const sc = page.scale ?? 1;
    const toPx = ([x, y]: [number, number]): [number, number] => [x * PX * sc, (H - y) * PX * sc];
    const items: PageItem[] = [];

    for (const s of tops) {
      const id = s.getAttribute('ID') ?? '';
      const t = xf(s);
      const name = s.getAttribute('Name') || s.getAttribute('NameU') || '';
      const textEl = children(s, 'Text')[0];
      const text = (textEl?.textContent ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
      const data: Record<string, string> = {};
      const prop = section(s, 'Property');
      if (prop) for (const row of children(prop, 'Row')) {
        const v = cell(row, 'Value');
        if (v != null && v !== '') data[cell(row, 'Label') || row.getAttribute('N') || 'Field'] = v;
      }
      const corners = ([[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]] as [number, number][]).map(([x, y]) => toPx(apply(t.m, x, y)));
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const get = (n: string, kind: 'line' | 'fill' | 'text') => styleCell(s, n, kind, this.styles);
      const linePattern = num(get('LinePattern', 'line'), 1);
      const lineColor = linePattern === 0 ? null : this.colorOf(s, 'line', ctx) ?? '#000000';
      const lineWidthPx = Math.max(0.5, num(get('LineWeight', 'line'), 0.01) * PX);
      const fillColor = num(get('FillPattern', 'fill'), 1) === 0 ? null : this.colorOf(s, 'fill', ctx) ?? '#ffffff';
      const charSec = section(s, 'Character');
      const charRow = charSec ? children(charSec, 'Row')[0] : undefined;
      const textColor = this.colorOf(s, 'font', ctx) ?? '#000000';
      const fontPx = num(charRow ? cell(charRow, 'Size') : get('Size', 'text'), 0.1111) * PX;
      // Layer membership ("0;2") and Visio containers (User.msvStructureType = Container).
      const memRow = section(s, 'LayerMem') ? children(section(s, 'LayerMem')!, 'Row')[0] : undefined;
      const layerMember = memRow ? cell(memRow, 'LayerMember') : null;
      const layers = layerMember ? layerMember.split(';').map(Number).filter((x) => Number.isFinite(x)) : undefined;
      const userSec = section(s, 'User');
      const container = !!userSec && children(userSec, 'Row').some((r) => r.getAttribute('N') === 'msvStructureType' && /container/i.test(cell(r, 'Value') ?? ''));
      // Every Shape Data field name (even empty ones) and the master's name: what kind of thing the shape is.
      const fields = prop ? children(prop, 'Row').map((row) => cell(row, 'Label') || row.getAttribute('N') || '').filter(Boolean) : [];
      const masterName = s.getAttribute('Master') ? this.allMasters.get(s.getAttribute('Master')!)?.name : undefined;
      // Text alignment and weight, as the shape (or its text style) sets them.
      const ha = num(paraCell(s, 'HorzAlign', this.styles), 1), va = num(styleCell(s, 'VerticalAlign', 'text', this.styles), 1);
      const align = ha === 0 ? 'left' as const : ha === 2 ? 'right' as const : undefined;
      const valign = va === 0 ? 'top' as const : va === 2 ? 'bottom' as const : undefined;
      const bold = (num(charRow ? cell(charRow, 'Style') : null) & 1) === 1;
      const base = { id, name, text, data, ...bbox, textColor, fontPx, layers, container, fields, masterName, align, valign, bold };

      const geos = sections(s, 'Geometry').filter((g) => cell(g, 'NoShow') !== '1');
      const sub = s.getElementsByTagNameNS(NS, 'Shapes')[0];
      const hasKids = !!sub && sub.parentElement === s && children(sub, 'Shape').length > 0;
      const masterId = s.getAttribute('Master');
      const oneD = cell(s, 'BeginX') != null && cell(s, 'EndX') != null;
      const foreign = s.getAttribute('Type') === 'Foreign';

      // Lines and connectors: their geometry (or begin/end points) in page coordinates.
      const lineGeo = geos.length === 1 && !hasKids && !foreign ? lineRows(geos[0]) : null;
      // Floor-plan walls (Visio's Walls, Shell and Structure stencil): a wall along the shape's centre line, as thick
      // as its "Wall thickness" (real-world, so scaled like the drawing).
      const thickText = Object.entries(data).find(([k]) => /^wall\s*thickness$/i.test(k.trim()))?.[1];
      if ((oneD || lineGeo) && (thickText != null || (/\bwall\b/i.test(masterName ?? '') && !/window/i.test(masterName ?? '')))) {
        const thickIn = (thickText != null ? realInches(thickText) : null) ?? (t.h > 0 ? t.h : 4);
        // Visio's walls run along their width (centre line half-way up their thickness); a plain line wall (as
        // RackDraw saves them) may have no width at all, so use its own end points then.
        const ends: [number, number][] = t.w >= t.h && t.w > 1e-9
          ? [apply(t.m, 0, t.h / 2), apply(t.m, t.w, t.h / 2)]
          : lineGeo && lineGeo.length >= 2 ? [apply(t.m, ...lineGeo[0]), apply(t.m, ...lineGeo[lineGeo.length - 1])]
          : [[num(cell(s, 'BeginX')), num(cell(s, 'BeginY'))], [num(cell(s, 'EndX')), num(cell(s, 'EndY'))]];
        items.push({
          ...base, kind: 'wall', points: ends.map(toPx),
          thicknessPx: Math.max(2, thickIn * PX * sc), lineColor: lineColor ?? '#000000',
        });
        continue;
      }
      // Visio doors (single and double): each swing arc becomes a RackDraw door, measured from how it is drawn
      // (hinge = the arc's centre, in the wall; one end on the wall, the other the open leaf), so flips and
      // rotations come out right without evaluating Visio's formulas.
      if (hasKids && /\b(door|double)\b/i.test(masterName ?? '') && !/garage|overhead|revolving/i.test(masterName ?? '')) {
        const leaves = doorSwings(s, t.m);
        if (leaves.length) {
          // The wall line: the door's own length axis, half-way through its thickness.
          const a = apply(t.m, 0, t.h / 2), b = apply(t.m, t.w, t.h / 2);
          const fromWall = (p: [number, number]) => {
            const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
            return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
          };
          for (const lf of leaves) {
            const hinge = fromWall(lf.centers[0]) <= fromWall(lf.centers[1]) ? lf.centers[0] : lf.centers[1];
            const [wallTip, openTip] = fromWall(lf.ends[0]) <= fromWall(lf.ends[1]) ? lf.ends : [lf.ends[1], lf.ends[0]];
            items.push({ ...base, kind: 'door', door: { hinge: toPx(hinge), wallTip: toPx(wallTip), openTip: toPx(openTip) }, thicknessPx: t.h * PX * sc });
          }
          continue;
        }
      }
      // 1-D shapes that draw a filled area (walls, block arrows, pipes) are pictures of themselves, not lines.
      const filledArea = fillColor != null && geos.some((g) => cell(g, 'NoFill') !== '1' && geometry(g, t.w, t.h).closed);
      if ((oneD && !filledArea) || (lineGeo && (cell(geos[0], 'NoFill') === '1' || !fillColor))) {
        let pts: [number, number][];
        if (lineGeo && lineGeo.length >= 2) pts = lineGeo.map(([x, y]) => toPx(apply(t.m, x, y)));
        else pts = [toPx([num(cell(s, 'BeginX')), num(cell(s, 'BeginY'))]), toPx([num(cell(s, 'EndX')), num(cell(s, 'EndY'))])];
        items.push({
          ...base, kind: 'line', points: pts, lineColor: lineColor ?? '#000000', lineWidthPx, dashed: linePattern > 1,
          // Arrowheads only: Visio's higher arrow styles (25 and up) are crow's-foot / ER marks, not arrows.
          arrows: { start: isArrowhead(num(get('BeginArrow', 'line'))), end: isArrowhead(num(get('EndArrow', 'line'))) },
        });
        continue;
      }

      // Plain boxes, ellipses, diamonds and text, including copies of simple masters (flowchart and basic shapes):
      // kept as editable drawing shapes. Equipment and anything carrying data stays a picture / device.
      // (RackDraw's own tag on doors / windows it saved doesn't count as Shape Data here.)
      const simple = !hasKids && !foreign && !Object.keys(data).some((k) => k !== 'RackDraw shape') && (!masterId || !looksLikeEquipment(data, fields, masterName));
      if (simple && geos.length === 0 && text) {
        items.push({ ...base, kind: 'text' });
        continue;
      }
      if (simple && geos.length === 1 && Math.abs(num(cell(s, 'Angle'))) < 1e-6) {
        const kind = isRect(geos[0], t.w, t.h) ? 'box' : isEllipse(geos[0]) ? 'ellipse' : isDiamond(geos[0], t.w, t.h) ? 'diamond' : null;
        if (kind) {
          items.push({ ...base, kind, fill: cell(geos[0], 'NoFill') === '1' ? null : fillColor, stroke: cell(geos[0], 'NoLine') === '1' ? null : lineColor, dashed: linePattern > 1, rounding: num(get('Rounding', 'line')) * PX, fillTransparency: num(get('FillForegndTrans', 'fill')) });
          continue;
        }
      }

      // Everything else is a picture: the shape as drawn, or its master's drawing when the shape only refers to it.
      const master = masterId ? this.masterRender(masterId, encodeDib) : null;
      let svg: string;
      let ports: PortDef[] = [];
      if (master && !geos.length && !hasKids && !foreign) {
        // Scale the master's drawing (and its ports) into this shape's box.
        const mw = master.widthIn * PX, mh = master.heightIn * PX;
        const inner = master.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(mw)} ${r3(mh)}" width="${r3(bbox.w)}" height="${r3(bbox.h)}" preserveAspectRatio="none">${inner}</svg>`;
        ports = master.ports.map((p) => ({ ...p, x: (p.x / mw) * bbox.w, y: (p.y / mh) * bbox.h, w: (p.w / mw) * bbox.w, h: (p.h / mh) * bbox.h }));
        if (!text && !data.Name) base.text = this.allMasters.get(masterId!)?.name ?? '';
      } else {
        const own = this.shape(s, ctx);
        if (!own) continue;
        const W = bbox.w, Hh = bbox.h;
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(W)} ${r3(Hh)}" width="${r3(W)}" height="${r3(Hh)}"><g transform="matrix(${r3(PX * sc)} 0 0 ${r3(-PX * sc)} ${r3(-bbox.x)} ${r3(H * PX * sc - bbox.y)})">${own}</g></svg>`;
        const sec = section(s, 'Connection');
        if (sec) {
          const size = Math.max(6, Math.min(16, Math.min(W, Hh) * 0.15));
          ports = children(sec, 'Row').map((row, i) => {
            const [px, py] = toPx(apply(t.m, num(cell(row, 'X')), num(cell(row, 'Y'))));
            const lx = px - bbox.x, ly = py - bbox.y;
            // Named connection points (RackDraw writes the port's name) keep their name.
            const label = row.getAttribute('N')?.replace(/^_(?=\d)/, '').replace(/_/g, ' ') || `${i + 1}`;
            return { id: `C${i + 1}`, label, kind: 'rj45', x: Math.max(0, Math.min(W - size, lx - size / 2)), y: Math.max(0, Math.min(Hh - size, ly - size / 2)), w: size, h: size, side: ly < Hh / 2 ? 'top' : 'bottom' } as PortDef;
          });
        }
      }
      items.push({ ...base, kind: 'picture', svg, ports, masterId: masterId ?? undefined });
    }

    // Glue: which end of which connector is attached to which shape.
    const connects: PageConnect[] = [];
    for (const c of Array.from(doc.getElementsByTagNameNS(NS, 'Connect'))) {
      const fromCell = c.getAttribute('FromCell');
      if (fromCell !== 'BeginX' && fromCell !== 'EndX') continue;
      const to = c.getAttribute('ToSheet') ?? '';
      connects.push({ connector: c.getAttribute('FromSheet') ?? '', end: fromCell === 'BeginX' ? 'begin' : 'end', shape: topOf.get(to) ?? to });
    }
    return { items, connects, warnings };
  }

  /** A master's drawing, rendered once per file. */
  /**
   * A shape's fill, line or text colour: its own (or its styles') colour, or, where that says "Themed" or isn't set,
   * the colour its Quick Style cells pick from the drawing's theme.
   */
  private colorOf(s: Element, kind: ThemeKind, ctx: Ctx): string | null {
    // A gradient fill shows its stop colours, not the plain fill colour: use their average.
    if (kind === 'fill' && styleCell(s, 'FillGradientEnabled', 'fill', this.styles) === '1') {
      const sec = section(s, 'FillGradient');
      const stops = sec ? children(sec, 'Row').map((r) => color(cell(r, 'GradientStopColor'))).filter((c): c is string => !!c) : [];
      if (stops.length) return averageColor(stops);
    }
    const raw =kind === 'fill' ? styleCell(s, 'FillForegnd', 'fill', this.styles)
      : kind === 'line' ? styleCell(s, 'LineColor', 'line', this.styles)
      : sectionCell(s, 'Character', 'Color', this.styles);
    const own = color(raw);
    if (own) return own;
    // The shape's own theme (a page can mix themes), else its page's, else the drawing's first.
    const theme = this.themes.get(cell(s, 'ColorSchemeIndex') ?? cell(s, 'ThemeIndex') ?? '') ?? this.themes.get(ctx.themeIndex ?? '') ?? this.theme;
    if (!theme || (raw != null && raw !== 'Themed')) return null;
    const styleKind = kind === 'font' ? 'text' : kind;
    const K = kind === 'fill' ? 'Fill' : kind === 'line' ? 'Line' : 'Font';
    const idx = (name: string) => {
      const v = styleCell(s, name, styleKind, this.styles);
      return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    const opts = { connector: cell(s, 'BeginX') != null, variationColor: ctx.variationColor, variationStyle: ctx.variationStyle };
    const c = themedColor(theme, kind, idx(`QuickStyle${K}Color`), idx(`QuickStyle${K}Matrix`), opts);
    // QuickStyleVariation asks Visio to keep the line (4) or fill (2) visible on the (white) page: a near-white
    // result then takes the picked theme colour itself.
    const flag = kind === 'line' ? 4 : kind === 'fill' ? 2 : 0;
    if (c && flag && ((idx('QuickStyleVariation') ?? 0) & flag) && lightness(c) > 0.92) {
      return themedColor(theme, kind, idx(`QuickStyle${K}Color`), null, opts) ?? c;
    }
    return c;
  }

  private masterShapes = new Map<string, Element | null>();

  /** The top shape of a master (what drawn copies inherit from). */
  private masterShape(id: string): Element | null {
    if (!this.masterShapes.has(id)) {
      const m = this.allMasters.get(id);
      const xml = m ? this.text(m.file) : null;
      let top: Element | null = null;
      if (xml) {
        const d = new DOMParser().parseFromString(xml, 'application/xml');
        const sh = d.getElementsByTagNameNS(NS, 'Shapes')[0];
        top = sh ? children(sh, 'Shape')[0] ?? null : null;
      }
      this.masterShapes.set(id, top);
    }
    return this.masterShapes.get(id)!;
  }

  private masterRender(id: string, encodeDib: DibEncoder): RenderedMaster | null {
    if (!this.masterRenders.has(id)) {
      const m = this.allMasters.get(id);
      let r: RenderedMaster | null = null;
      try {
        r = m ? this.render(m, encodeDib) : null;
      } catch {
        r = null;
      }
      this.masterRenders.set(id, r);
    }
    return this.masterRenders.get(id)!;
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
          if (r.empty) ctx.warnings.push('A picture uses a format RackDraw cannot draw (EMF+ only).');
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
      } else if (ext === 'bmp' && bmpToRgba(data)) {
        // Uncompressed bitmaps (often screenshots) are many times bigger than the same picture as PNG.
        const d = bmpToRgba(data)!;
        url = ctx.encodeDib(d.w, d.h, d.rgba);
      } else {
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
        url = `data:${mime};base64,${toBase64(data)}`;
      }
    }
    this.pictures.set(path, url);
    return url;
  }
}

/** Points of a single open path made only of MoveTo/LineTo rows (a polyline), else null. */
function lineRows(geo: Element): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const row of children(geo, 'Row')) {
    if (row.getAttribute('Del') === '1') continue;
    const T = row.getAttribute('T');
    if (T !== 'MoveTo' && T !== 'LineTo') return null;
    if (T === 'MoveTo' && pts.length) return null;
    pts.push([num(cell(row, 'X')), num(cell(row, 'Y'))]);
  }
  if (pts.length < 2) return null;
  const [a, z] = [pts[0], pts[pts.length - 1]];
  // A closed outline is a shape, not a line.
  if (pts.length > 2 && Math.abs(a[0] - z[0]) < 1e-6 && Math.abs(a[1] - z[1]) < 1e-6) return null;
  return pts;
}

/** Is this geometry the shape's own rectangle (0,0)–(w,h)? */
function isRect(geo: Element, w: number, h: number) {
  const rows = children(geo, 'Row').filter((r) => r.getAttribute('Del') !== '1');
  if (rows.length < 4 || rows.length > 5) return false;
  const kinds = ['MoveTo', 'LineTo', 'RelMoveTo', 'RelLineTo'];
  if (!rows.every((r) => kinds.includes(r.getAttribute('T') ?? ''))) return false;
  const pts = rows.map((r) => {
    const rel = (r.getAttribute('T') ?? '').startsWith('Rel');
    return [num(cell(r, 'X')) * (rel ? w : 1), num(cell(r, 'Y')) * (rel ? h : 1)];
  });
  const near = (a: number, b: number) => Math.abs(a - b) < Math.max(w, h) * 0.01 + 1e-6;
  return pts.every(([x, y]) => (near(x, 0) || near(x, w)) && (near(y, 0) || near(y, h)));
}

/** A four-sided outline through the middles of the box's sides (a flowchart Decision). */
function isDiamond(geo: Element, w: number, h: number) {
  const rows = children(geo, 'Row').filter((r) => r.getAttribute('Del') !== '1');
  if (rows.length < 4 || rows.length > 5) return false;
  if (!rows.every((r) => ['MoveTo', 'LineTo', 'RelMoveTo', 'RelLineTo'].includes(r.getAttribute('T') ?? ''))) return false;
  const pts = rows.map((r) => { const rel = (r.getAttribute('T') ?? '').startsWith('Rel'); return [num(cell(r, 'X')) * (rel ? w : 1), num(cell(r, 'Y')) * (rel ? h : 1)]; });
  const near = (a: number, b: number) => Math.abs(a - b) < Math.max(w, h) * 0.02 + 1e-6;
  const on = ([x, y]: number[]) => (near(x, w / 2) && (near(y, 0) || near(y, h))) || (near(y, h / 2) && (near(x, 0) || near(x, w)));
  return pts.every(on) && new Set(pts.map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`)).size === 4;
}

/** Network equipment, by its master's name (Visio's network, rack and computer stencils). */
const EQUIPMENT = /router|switch|server|firewall|access ?point|\bap\b|wireless|modem|gateway|hub|bridge|nas\b|san\b|storage|ups\b|pdu|patch|rack|pc\b|computer|workstation|laptop|desktop|tablet|phone|printer|copier|scanner|camera|nvr|dvr|projector|controller|load ?balancer|vpn|cloud|internet|isp|ont\b|cable ?modem|fax|terminal|mainframe|kvm|monitor|display|appliance/i;
/** Shape Data fields that mark a shape as a piece of equipment. */
const DEVICE_FIELDS = /^(ip|ip ?address|mac|mac ?address|serial|serial ?number|asset ?(tag|number)|product ?number|manufacturer|model|network ?name|host ?name|cable|vlan|from|to)$/i;

/**
 * Is a Visio shape a piece of equipment (a device in RackDraw, with ports and details) rather than part of a
 * drawing? By its Shape Data (RackDraw's own Name/Status/Type, or device-type fields) or its master's name.
 */
export function looksLikeEquipment(data: Record<string, string>, fields: string[], masterName?: string) {
  return ('Name' in data && 'Type' in data && 'Status' in data)
    || Object.keys(data).some((k) => DEVICE_FIELDS.test(k.trim())) || fields.some((k) => DEVICE_FIELDS.test(k.trim()))
    || EQUIPMENT.test(masterName ?? '');
}

function isEllipse(geo: Element) {
  const rows = children(geo, 'Row').filter((r) => r.getAttribute('Del') !== '1');
  return rows.length === 1 && rows[0].getAttribute('T') === 'Ellipse';
}

export interface VisioPageInfo {
  name: string;
  file: string;
  widthIn: number;
  heightIn: number;
  /** Visio page ID. */
  id?: string;
  background?: boolean;
  /** ID of the background page behind this one. */
  backPage?: string;
  /** The page's layers, in index order. */
  layers?: { name: string; visible: boolean; print: boolean; lock: boolean }[];
  /** The page's theme number (ColorSchemeIndex / ThemeIndex). */
  themeIndex?: string;
  /** Paper inches per drawing inch (1 for unscaled pages; 1/48 at 1/4" = 1'), and the real-world unit shown. */
  scale?: number;
  realUnit?: 'ft' | 'm';
  /** Which of the theme's variation colours / styles the page uses. */
  variationColor?: number;
  variationStyle?: number;
}

/** A shape read from a drawing page. Positions in pixels from the page's top-left. */
export interface PageItem {
  id: string;
  kind: 'picture' | 'box' | 'ellipse' | 'diamond' | 'text' | 'line' | 'wall' | 'door';
  /** Wall: its thickness on the page; door: the wall it sits in. */
  thicknessPx?: number;
  /** Door: hinge, the leaf's tip when closed (on the wall) and when open, in page px. */
  door?: { hinge: [number, number]; wallTip: [number, number]; openTip: [number, number] };
  align?: 'left' | 'right';
  valign?: 'top' | 'bottom';
  bold?: boolean;
  name: string;
  text: string;
  /** Shape Data (label → value). */
  data: Record<string, string>;
  /** Names of all its Shape Data fields, filled in or not. */
  fields?: string[];
  /** The name of the master it was drawn from. */
  masterName?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  textColor: string;
  fontPx: number;
  svg?: string;
  ports?: PortDef[];
  masterId?: string;
  fill?: string | null;
  stroke?: string | null;
  dashed?: boolean;
  rounding?: number;
  fillTransparency?: number;
  points?: [number, number][];
  lineColor?: string;
  lineWidthPx?: number;
  arrows?: { start: boolean; end: boolean };
  /** Indexes into the page's layers. */
  layers?: number[];
  /** A Visio container. */
  container?: boolean;
}

export interface PageConnect {
  connector: string;
  end: 'begin' | 'end';
  shape: string;
}

interface Ctx {
  pkg: VisioPackage;
  rels: Map<string, string>;
  folder: string;
  encodeDib: DibEncoder;
  warnings: string[];
  /** Page scale (paper per drawing unit): line widths and text sizes are paper sizes, shapes are drawing units. */
  scale?: number;
  themeIndex?: string;
  variationColor?: number;
  variationStyle?: number;
}

/* ------------------------------------------------------------------ */
/*  XML helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Copies into a drawn shape whatever it leaves to its master: cells, sections (row by row, cell by cell), text and
 * sub-shapes (matched through MasterShape). What the shape sets itself always wins.
 */
function inheritFrom(inst: Element, ms: Element) {
  const doc = inst.ownerDocument;
  const take = (el: Element) => doc.importNode(el, true);
  // The style sheets it uses (line / fill / text formatting and theme Quick Styles), unless it picks its own.
  for (const a of ['LineStyle', 'FillStyle', 'TextStyle']) {
    const v = ms.getAttribute(a);
    if (v != null && !inst.hasAttribute(a)) inst.setAttribute(a, v);
  }
  const own = new Set(children(inst, 'Cell').map((c) => c.getAttribute('N')));
  for (const c of children(ms, 'Cell')) if (!own.has(c.getAttribute('N'))) inst.appendChild(take(c));
  for (const sec of children(ms, 'Section')) {
    const n = sec.getAttribute('N'), ix = sec.getAttribute('IX') ?? '';
    const mine = children(inst, 'Section').find((x) => x.getAttribute('N') === n && (x.getAttribute('IX') ?? '') === ix);
    if (!mine) { inst.appendChild(take(sec)); continue; }
    const secCells = new Set(children(mine, 'Cell').map((c) => c.getAttribute('N')));
    for (const c of children(sec, 'Cell')) if (!secCells.has(c.getAttribute('N'))) mine.appendChild(take(c));
    for (const row of children(sec, 'Row')) {
      const key = row.getAttribute('IX') ?? row.getAttribute('N');
      const r = children(mine, 'Row').find((x) => (x.getAttribute('IX') ?? x.getAttribute('N')) === key);
      if (!r) { mine.appendChild(take(row)); continue; }
      const rowCells = new Set(children(r, 'Cell').map((c) => c.getAttribute('N')));
      for (const c of children(row, 'Cell')) if (!rowCells.has(c.getAttribute('N'))) r.appendChild(take(c));
    }
    // Rows the shape left to its master were added at the end: put numbered rows (geometry) back in order.
    const rows = children(mine, 'Row');
    if (rows.length > 1 && rows.every((r) => r.hasAttribute('IX'))) {
      rows.sort((a, b) => Number(a.getAttribute('IX')) - Number(b.getAttribute('IX'))).forEach((r) => mine.appendChild(r));
    }
  }
  if (!children(inst, 'Text').length) { const t = children(ms, 'Text')[0]; if (t) inst.appendChild(take(t)); }
  const msSub = children(ms, 'Shapes')[0];
  if (!msSub) return;
  const instSub = children(inst, 'Shapes')[0];
  if (!instSub) { inst.appendChild(take(msSub)); return; }
  const byId = new Map(Array.from(msSub.getElementsByTagNameNS(NS, 'Shape')).map((e) => [e.getAttribute('ID') ?? '', e]));
  for (const k of Array.from(instSub.getElementsByTagNameNS(NS, 'Shape'))) {
    const ref = k.getAttribute('MasterShape');
    const mk = ref ? byId.get(ref) : undefined;
    if (mk) inheritFrom(k, mk);
  }
}

function children(el: Element, local: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === local);
}
/** The display unit (U attribute) of a cell, e.g. FT, M, IN_F. */
function cellUnit(el: Element, name: string): string | null {
  for (const c of Array.from(el.children)) if (c.localName === 'Cell' && c.getAttribute('N') === name) return c.getAttribute('U');
  return null;
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
const isArrowhead = (n: number) => n >= 1 && n <= 24;

/** A paragraph setting (first paragraph), from the shape or else its text style chain. */
const paraCell = (s: Element, name: string, styles: Map<string, Element>) => sectionCell(s, 'Paragraph', name, styles);

/** A first-row setting of a text section (Paragraph, Character), from the shape or else its text style chain. */
function sectionCell(s: Element, sectionName: string, name: string, styles: Map<string, Element>): string | null {
  const first = (el: Element) => { const sec = section(el, sectionName); const row = sec ? children(sec, 'Row')[0] : undefined; return row ? cell(row, name) : null; };
  const own = first(s);
  if (own != null) return own;
  let id = s.getAttribute('TextStyle');
  for (let guard = 0; id != null && guard < 20; guard++) {
    const st = styles.get(id);
    if (!st) break;
    const v = first(st);
    if (v != null) return v;
    id = st.getAttribute('TextStyle');
  }
  return null;
}

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
/**
 * The visible door-swing arcs inside a door shape (geometry of just MoveTo + ArcTo): both ends and both possible
 * centres of each, in the coordinates `m` maps to (the door's parent).
 */
function doorSwings(s: Element, m: M): { ends: [[number, number], [number, number]]; centers: [[number, number], [number, number]] }[] {
  const out: ReturnType<typeof doorSwings> = [];
  const visit = (el: Element, mm: M) => {
    for (const geo of sections(el, 'Geometry')) {
      if (cell(geo, 'NoShow') === '1') continue;
      const rows = children(geo, 'Row').filter((r) => r.getAttribute('Del') !== '1');
      if (rows.length !== 2 || !/MoveTo$/.test(rows[0].getAttribute('T') ?? '') || rows[1].getAttribute('T') !== 'ArcTo') continue;
      const p0: [number, number] = [num(cell(rows[0], 'X')), num(cell(rows[0], 'Y'))];
      const p1: [number, number] = [num(cell(rows[1], 'X')), num(cell(rows[1], 'Y'))];
      const bulge = Math.abs(num(cell(rows[1], 'A')));
      const c = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (bulge < 1e-9 || c < 1e-9) continue;
      // Radius from chord and bulge; the centre sits on the chord's perpendicular, on either side.
      const R = (bulge * bulge + (c / 2) ** 2) / (2 * bulge), d = R - bulge;
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, nx = -(p1[1] - p0[1]) / c, ny = (p1[0] - p0[0]) / c;
      out.push({
        ends: [apply(mm, ...p0), apply(mm, ...p1)],
        centers: [apply(mm, mx + nx * d, my + ny * d), apply(mm, mx - nx * d, my - ny * d)],
      });
    }
    const sub = children(el, 'Shapes')[0];
    if (sub) for (const k of children(sub, 'Shape')) visit(k, compose(mm, xf(k).m));
  };
  visit(s, m);
  return out;
}

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
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const P = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    return `${r3(x)} ${r3(y)}`;
  };
  const finish = () => {
    const gap = Math.hypot(cx - sx, cy - sy);
    // Visio still fills an outline that stops just short of where it began (ring shapes drawn as one path).
    const nearlyClosed = segments >= 4 && gap < 0.15 * Math.hypot(x1 - x0, y1 - y0);
    if (started && segments && gap > 1e-6 && !nearlyClosed) closedAll = false;
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
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
