/** Number Shapes (Visio add-on): give devices or shapes numbered names in a reading order. */

export type NumberOrder = 'rows' | 'columns' | 'selection';
export type NumberPlace = 'replace' | 'before' | 'after';

export interface NumberOptions {
  start: number;
  step: number;
  /** Pad with leading zeros to this many digits (1 = none). */
  digits: number;
  prefix: string;
  place: NumberPlace;
  /** Take off a number the name already has (renumbering), at the end for "after" or the start for "before". */
  renumber: boolean;
}

export interface NumberItem { id: string; x: number; y: number; w: number; h: number; text: string }

/**
 * Reading order: "rows" = top to bottom, left to right within a row (items whose centres are within half a typical
 * height count as one row); "columns" the same turned; "selection" keeps the given order.
 */
export function orderItems<T extends NumberItem>(items: T[], order: NumberOrder): T[] {
  if (order === 'selection' || items.length < 2) return [...items];
  const along = order === 'rows' ? (i: T) => i.y + i.h / 2 : (i: T) => i.x + i.w / 2;
  const across = order === 'rows' ? (i: T) => i.x + i.w / 2 : (i: T) => i.y + i.h / 2;
  const size = (i: T) => (order === 'rows' ? i.h : i.w);
  const sorted = [...items].sort((a, b) => along(a) - along(b));
  const tol = (sorted.reduce((s, i) => s + size(i), 0) / sorted.length) / 2;
  const bands: T[][] = [];
  for (const it of sorted) {
    const band = bands.at(-1);
    if (band && Math.abs(along(it) - along(band[0])) <= tol) band.push(it);
    else bands.push([it]);
  }
  return bands.flatMap((b) => b.sort((a, c) => across(a) - across(c)));
}

/** The new text for the item at position `i` (0-based) in the order. */
export function numberText(old: string, i: number, o: NumberOptions): string {
  const n = `${o.prefix}${String(o.start + i * o.step).padStart(Math.max(1, o.digits), '0')}`;
  const t = old.trim();
  if (o.place === 'replace' || !t) return n;
  if (o.place === 'after') return `${o.renumber ? t.replace(/[\s#_-]*\d+$/, '') : t} ${n}`.trim();
  return `${n} ${o.renumber ? t.replace(/^\d+[\s.#_-]*/, '') : t}`.trim();
}
