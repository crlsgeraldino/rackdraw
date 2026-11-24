/**
 * A shared pool for big strings (embedded pictures, mostly data URLs) so Version History keeps each picture once,
 * however many versions contain it. Packing swaps every long string for a short reference; unpacking puts it back.
 */

/** Strings at least this long go to the pool. */
export const POOL_MIN = 2048;
const REF = 'rd-blob:';

/** Two FNV-1a passes (different seeds) and the length: a key that practically never collides. */
function hashOf(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}-${s.length.toString(36)}`;
}

/** The pool key for `s`, adding it when new (a genuine collision gets a numbered key of its own). */
function keyFor(s: string, pool: Record<string, string>): string {
  const base = hashOf(s);
  for (let n = 0; ; n++) {
    const k = n ? `${base}.${n}` : base;
    if (pool[k] === undefined) { pool[k] = s; return k; }
    if (pool[k] === s) return k;
  }
}

/** A deep copy of `value` with long strings moved into `pool`. */
export function pack<T>(value: T, pool: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length >= POOL_MIN && !v.startsWith(REF) ? REF + keyFor(v, pool) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** A deep copy of `value` with pool references replaced by their strings (unknown references are left as they are). */
export function unpack<T>(value: T, pool: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(REF) ? pool[v.slice(REF.length)] ?? v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** Only the pool entries `value` still refers to (what to save after versions were deleted or trimmed). */
export function usedPool(value: unknown, pool: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.startsWith(REF)) { const k = v.slice(REF.length); if (pool[k] !== undefined) out[k] = pool[k]; } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}
