/**
 * Cable lengths as people type them: "85 ft", "1,200 ft", "10 ft.", "10'", `10' 6"`, "6 in", "3 m", "3m", "150 cm",
 * "2.5 metres". One parser for the Bill of Materials and cable path totals, so both read the same lengths.
 */

const FT_PER_M = 3.28084;

/** Length in feet, and whether it was written in metric units; undefined when the text isn't a length. */
export function parseLength(s?: string): { ft: number; metric: boolean } | undefined {
  let t = (s ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  if (!t) return undefined;
  // Thousands separators: "1,200 ft" (a comma followed by exactly three digits).
  t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  // Feet and inches: 10' 6", 10 ft 6 in, 10'6"
  const fi = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (fi) return { ft: Number(fi[1]) + Number(fi[2]) / 12, metric: false };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|in|inch|inches|"|m|meters?|metres?|cm|mm)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ft': case 'feet': case 'foot': case "'": return { ft: n, metric: false };
    case 'in': case 'inch': case 'inches': case '"': return { ft: n / 12, metric: false };
    case 'cm': return { ft: (n / 100) * FT_PER_M, metric: true };
    case 'mm': return { ft: (n / 1000) * FT_PER_M, metric: true };
    default: return { ft: n * FT_PER_M, metric: true };
  }
}

/** Feet, or undefined when the text isn't a length. */
export const lengthFt = (s?: string) => parseLength(s)?.ft;

/** Total of several lengths: in metres when every one was metric, else in feet; '' when any is missing. */
export function totalLength(list: (string | undefined)[]): string {
  if (!list.length) return '';
  let ft = 0;
  let metric = true;
  for (const s of list) {
    const l = parseLength(s);
    if (!l) return '';
    ft += l.ft;
    metric &&= l.metric;
  }
  return metric ? `${Math.round((ft / FT_PER_M) * 10) / 10} m` : `${Math.round(ft * 10) / 10} ft`;
}
