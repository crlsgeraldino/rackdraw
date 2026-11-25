/*
 * Guards for values from files (a client file, a backup, a stencil library or a Visio drawing may have been made by
 * anyone). Colours and numbers end up inside markup and styles — the port map, printing, exports — so they must be
 * plain values that can't close a quote or a tag.
 */

/** Characters a colour (or other plain style value: "vlan", "4 2", "rgba(0,0,0,.5)") may contain. */
const PLAIN_STYLE = /^[#a-zA-Z0-9(),.%\s-]{0,64}$/;

/** True for a plain style value: no quotes, <, >, ;, :, /, \, braces or other characters that could break out. */
export function isPlainStyle(v: unknown): v is string {
  return typeof v === 'string' && PLAIN_STYLE.test(v);
}

/** `v` when it is a plain colour value, else `fallback`. */
export function safeColor(v: unknown, fallback: string): string {
  return isPlainStyle(v) && v.trim() ? v : fallback;
}

/** `v` when it is a finite number, else `fallback`. */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Keys whose string values are colours or other style values (colour, fill, stroke, lineColor, dash pattern…). */
const STYLE_KEY = /(colou?r|fill|stroke|dasharray)$/i;

/** Deeper than this is not a drawing: it is a damaged or hostile file (and would break saving). */
export const MAX_DEPTH = 64;

/**
 * A copy of `value` that is safe to keep: style values that aren't plain are removed, and anything nested deeper than
 * MAX_DEPTH is dropped. Plain data (text, numbers, pictures) is kept as it is.
 */
export function cleanDeep<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return undefined as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, depth + 1)).filter((v) => v !== undefined) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof v === 'string' && STYLE_KEY.test(k) && !isPlainStyle(v)) continue;
    const c = cleanDeep(v, depth + 1);
    if (c !== undefined || v === undefined) out[k] = c;
  }
  return out as T;
}
