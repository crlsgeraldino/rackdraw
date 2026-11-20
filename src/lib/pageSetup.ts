/**
 * Visio-style drawing page: a paper-sized sheet behind the diagram that grows by whole sheets to hold the
 * content (Visio "Auto Size"), and the ticks for the rulers along the canvas.
 */

export type PaperSize = 'letter' | 'legal' | 'tabloid' | 'a4' | 'a3';

/** Paper sizes in inches (portrait). */
export const PAPER: Record<PaperSize, { label: string; w: number; h: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  legal: { label: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
  tabloid: { label: 'Tabloid (11 × 17 in)', w: 11, h: 17 },
  a4: { label: 'A4', w: 8.27, h: 11.69 },
  a3: { label: 'A3', w: 11.69, h: 16.54 },
};

export interface PageSetup {
  paper: PaperSize;
  landscape: boolean;
}
export const DEFAULT_SETUP: PageSetup = { paper: 'letter', landscape: true };

/** Diagram units per inch (CSS pixels at 100% zoom). */
export const PX_PER_IN = 96;

/** One sheet in diagram units. */
export function sheetSize(setup: PageSetup = DEFAULT_SETUP) {
  const p = PAPER[setup.paper] ?? PAPER.letter;
  const [w, h] = setup.landscape ? [p.h, p.w] : [p.w, p.h];
  return { w: w * PX_PER_IN, h: h * PX_PER_IN };
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The drawing page: whole sheets starting at the origin, extended (in any direction) until the content fits,
 * with a margin so nothing sits on the edge.
 */
export function pageBounds(content: Box | null, sheet: { w: number; h: number }, margin = 24) {
  let x0 = 0, y0 = 0, x1 = sheet.w, y1 = sheet.h;
  if (content && content.w > 0 && content.h > 0) {
    x0 = Math.min(0, Math.floor((content.x - margin) / sheet.w) * sheet.w);
    y0 = Math.min(0, Math.floor((content.y - margin) / sheet.h) * sheet.h);
    x1 = Math.max(sheet.w, Math.ceil((content.x + content.w + margin) / sheet.w) * sheet.w);
    y1 = Math.max(sheet.h, Math.ceil((content.y + content.h + margin) / sheet.h) * sheet.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cols: Math.round((x1 - x0) / sheet.w), rows: Math.round((y1 - y0) / sheet.h) };
}

export interface Tick { pos: number; major: boolean; label?: string }

/**
 * Ruler ticks along one axis. `offset` and `zoom` come from the viewport (screen = flow * zoom + offset);
 * `unitPx` is how many diagram units one ruler unit is (96 for inches, or from the page's drawing scale).
 * Spacing adapts so labels stay about 60–150px apart on screen.
 */
export function rulerTicks(lengthPx: number, offset: number, zoom: number, unitPx: number): Tick[] {
  const screenPerUnit = unitPx * zoom;
  const steps = [0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const major = steps.find((s) => s * screenPerUnit >= 60) ?? steps[steps.length - 1];
  const minorCount = major * screenPerUnit >= 120 ? 10 : 4;
  const minor = major / minorCount;
  const first = Math.floor(-offset / screenPerUnit / minor) * minor;
  const last = (lengthPx - offset) / screenPerUnit;
  const out: Tick[] = [];
  for (let u = first, i = 0; u <= last && i < 2000; u += minor, i++) {
    const v = Math.round(u / minor) * minor;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    out.push({ pos: v * screenPerUnit + offset, major: isMajor, label: isMajor ? String(+v.toFixed(3)) : undefined });
  }
  return out;
}
