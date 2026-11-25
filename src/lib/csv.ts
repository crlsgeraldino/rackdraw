/*
 * CSV cells for Excel. Text that starts with = + - @ (or a tab / carriage return) would be read by Excel as a formula:
 * "-48 VDC" shows #NAME?, and a value typed by someone else could run a formula. Such text gets a leading apostrophe,
 * which is how Excel itself marks "this is text". Plain numbers ("-5", "+1.5") stay numbers.
 */

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

/** The text of one cell, safe to open in Excel (not yet quoted). */
export function csvText(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return FORMULA.test(s) && !NUMBER.test(s.trim()) ? `'${s}` : s;
}

/** One cell, always quoted. */
export const csvQuoted = (v: unknown) => `"${csvText(v).replace(/"/g, '""')}"`;

/** One cell, quoted only when it has to be. */
export const csvMinimal = (v: unknown) => {
  const s = csvText(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows as CSV text (Windows line ends), every cell quoted. */
export const csvOf = (rows: unknown[][]) => rows.map((r) => r.map(csvQuoted).join(',')).join('\r\n');
