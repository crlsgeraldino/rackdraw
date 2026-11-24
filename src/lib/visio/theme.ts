/**
 * Visio themes: shapes from modern templates store their colours as "Themed" and pick them through Quick Style
 * cells instead (QuickStyleFillColor / ...Matrix and friends). This resolves those to real colours from the
 * drawing's theme (visio/theme/theme1.xml), the way Visio does:
 *
 * - the colour index picks a theme colour: 0 dark 1, 1 light 1, 2–7 accent 1–6, 100–106 the page's variation colours;
 * - the matrix index picks a fill / line / font style from the theme's format scheme (1–6), or, from 100 on, the style
 *   the page's variation names; that style either has its own colour or tints/shades the picked colour ("phClr").
 *
 * 1-D shapes (connectors) use the theme's connector scheme.
 */

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const VT = 'http://schemas.microsoft.com/office/visio/2012/theme';

type Mod = [string, number];
/** A colour as the theme writes it: a fixed colour, a scheme colour, or the placeholder for the picked colour. */
type Paint = { rgb?: string; scheme?: string; mods: Mod[] } | null;
export type ThemeKind = 'fill' | 'line' | 'font';

export interface VisioTheme {
  /** The theme / colour scheme numbers this theme answers to (a page's or shape's ThemeIndex / ColorSchemeIndex). */
  ids: string[];
  scheme: Record<string, string>;
  variations: string[][];
  styles: Record<ThemeKind, Paint[]>;
  connector: Record<ThemeKind, Paint[]>;
  /** Variation style schemes: per scheme, per matrix 100–103, the style index for fill / line / font. */
  varStyles: Record<ThemeKind, number>[][];
}

const kids = (el: Element | undefined | null, ns: string, local: string) =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === local) : [];
const kid = (el: Element | undefined | null, ns: string, local: string) => kids(el, ns, local)[0];

/** The colour an element itself stands for (a colour, a solid fill, a gradient's first stop); undefined if none. */
function paintEl(c: Element): Paint | undefined {
  const mods = Array.from(c.children).map((m): Mod => [m.localName, Number(m.getAttribute('val') ?? '0') / 100000]);
  switch (c.localName) {
    case 'srgbClr': return { rgb: `#${(c.getAttribute('val') ?? '000000').toLowerCase()}`, mods };
    case 'sysClr': return { rgb: `#${(c.getAttribute('lastClr') ?? '000000').toLowerCase()}`, mods };
    case 'schemeClr': return { scheme: c.getAttribute('val') ?? 'phClr', mods };
    case 'solidFill': return paintOf(c);
    case 'gradFill': return paintOf(kid(kid(c, A, 'gsLst'), A, 'gs'));
    case 'noFill': return null;
    default: return undefined;
  }
}

/** The colour inside an element (its first child that is a colour or a fill). */
function paintOf(el: Element | undefined | null): Paint {
  for (const c of el ? Array.from(el.children) : []) {
    const p = paintEl(c);
    if (p !== undefined) return p;
  }
  return null;
}

export function parseTheme(xml: string): VisioTheme | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const els = doc.getElementsByTagNameNS(A, 'themeElements')[0];
  if (!els) return null;
  const scheme: Record<string, string> = {};
  const clr = kid(els, A, 'clrScheme');
  for (const c of clr ? Array.from(clr.children) : []) {
    const p = paintOf(c);
    if (p?.rgb) scheme[c.localName] = p.rgb;
  }
  const variations = Array.from(doc.getElementsByTagNameNS(VT, 'variationClrScheme')).map((v) =>
    [1, 2, 3, 4, 5, 6, 7].map((i) => paintOf(kid(v, VT, `varColor${i}`))?.rgb ?? ''));
  const fmt = kid(els, A, 'fmtScheme');
  const conn = doc.getElementsByTagNameNS(VT, 'fmtConnectorScheme')[0];
  const fills = (f: Element | undefined) => Array.from(kid(f, A, 'fillStyleLst')?.children ?? []).map((c) => paintEl(c) ?? null);
  const lines = (f: Element | undefined) => kids(kid(f, A, 'lnStyleLst'), A, 'ln').map((ln) => paintOf(ln));
  const fonts = (group: string) => kids(doc.getElementsByTagNameNS(VT, group)[0], VT, 'fontProps').map((fp) => paintOf(kid(fp, VT, 'color')));
  const varStyles = Array.from(doc.getElementsByTagNameNS(VT, 'variationStyleScheme')).map((s) =>
    kids(s, VT, 'varStyle').map((v) => ({ fill: Number(v.getAttribute('fillIdx') ?? 0), line: Number(v.getAttribute('lineIdx') ?? 0), font: Number(v.getAttribute('fontIdx') ?? 0) })));
  const ids = [...new Set(Array.from(doc.getElementsByTagNameNS(VT, 'schemeID')).map((e) => e.getAttribute('schemeEnum') ?? '').filter(Boolean))];
  return {
    ids, scheme, variations, varStyles,
    styles: { fill: fills(fmt), line: lines(fmt), font: fonts('fontStyles') },
    connector: { fill: fills(conn), line: lines(conn), font: fonts('connectorFontStyles') },
  };
}

const SCHEME_BY_INDEX = ['dk1', 'lt1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

/** The colour a Quick Style colour index stands for (0–7 theme colours, 100–106 variation colours). */
export function themeColor(theme: VisioTheme, index: number, variation = 0): string | null {
  if (index >= 0 && index < SCHEME_BY_INDEX.length) return theme.scheme[SCHEME_BY_INDEX[index]] ?? null;
  if (index >= 100 && index <= 106) {
    const v = theme.variations[variation] ?? theme.variations[0];
    return v?.[index - 100] || null;
  }
  return null;
}

/**
 * A themed colour: the picked colour (`colorIndex`) run through the style the matrix index names. `null` when the
 * theme says nothing (the caller keeps its own default).
 */
export function themedColor(theme: VisioTheme, kind: ThemeKind, colorIndex: number | null, matrix: number | null,
  opts: { connector?: boolean; variationColor?: number; variationStyle?: number } = {}): string | null {
  const base = colorIndex == null ? null : themeColor(theme, colorIndex, opts.variationColor ?? 0);
  let idx = matrix ?? 0;
  if (idx >= 100) {
    const vs = theme.varStyles[opts.variationStyle ?? 0] ?? theme.varStyles[0];
    idx = vs?.[idx - 100]?.[kind] ?? 0;
  }
  const list = (opts.connector ? theme.connector : theme.styles)[kind];
  const paint = idx >= 1 ? list[idx - 1] ?? list[list.length - 1] : undefined;
  if (paint === undefined) return base;
  if (paint === null) return null;
  const start = paint.rgb ?? (paint.scheme === 'phClr' ? base : theme.scheme[paint.scheme ?? ''] ?? null);
  return start ? applyMods(start, paint.mods) : null;
}

/* ---------------- DrawingML colour transforms (tint, shade, lumMod/lumOff, satMod) ---------------- */

function applyMods(hex: string, mods: Mod[]): string {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  for (const [m, v] of mods) {
    if (m === 'tint') [r, g, b] = [r, g, b].map((c) => c + (1 - c) * (1 - v));
    else if (m === 'shade') [r, g, b] = [r, g, b].map((c) => c * v);
    else if (m === 'lumMod' || m === 'lumOff' || m === 'satMod') {
      const [h, s, l] = toHsl(r, g, b);
      const nl = m === 'lumMod' ? l * v : m === 'lumOff' ? l + v : l;
      const ns = m === 'satMod' ? s * v : s;
      [r, g, b] = fromHsl(h, Math.min(1, Math.max(0, ns)), Math.min(1, Math.max(0, nl)));
    }
  }
  return `#${[r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
