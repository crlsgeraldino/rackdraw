import type { LengthUnit, PageScale } from './types';

/** Starts "Set scale" (click two points on the canvas). */
export const SET_SCALE_EVENT = 'netcraft:set-scale';

/**
 * Real-world lengths on scaled drawings (floor plans): parsing what people type ("30 ft", "12' 6\"", "9.5 m",
 * "250 cm") and formatting lengths back (feet and inches, or metres).
 */

/** Parses a typed distance into a value and unit; plain numbers use `fallback`. Returns null if unreadable. */
export function parseLength(text: string, fallback: LengthUnit = 'ft'): { value: number; unit: LengthUnit } | null {
  const t = text.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;
  // Feet and inches: 12' 6", 12ft 6in, 12' , 6"
  const fi = t.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches))?$/);
  if (fi && (fi[1] || fi[2])) return { value: Number(fi[1] ?? 0) + Number(fi[2] ?? 0) / 12, unit: 'ft' };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|cm|mm)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'cm') return { value: n / 100, unit: 'm' };
  if (m[2] === 'mm') return { value: n / 1000, unit: 'm' };
  if (m[2]) return { value: n, unit: 'm' };
  return { value: n, unit: fallback };
}

/** "42' 6"" for feet, "12.95 m" for metres. */
export function formatLength(value: number, unit: LengthUnit): string {
  if (unit === 'm') return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} m`;
  let ft = Math.floor(value);
  let inch = Math.round((value - ft) * 12);
  if (inch === 12) { ft++; inch = 0; }
  return inch ? `${ft}' ${inch}"` : `${ft}'`;
}

/** Real length of `px` diagram units on a page with this scale. */
export const realLength = (px: number, scale: PageScale) => formatLength(px * scale.perPx, scale.unit);

/** Scale from two points `px` apart that are really `distance` apart. */
export function scaleFrom(px: number, distance: { value: number; unit: LengthUnit }): PageScale | null {
  if (!(px > 0) || !(distance.value > 0)) return null;
  return { perPx: distance.value / px, unit: distance.unit };
}
