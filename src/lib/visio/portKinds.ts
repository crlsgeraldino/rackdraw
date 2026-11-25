/**
 * Visio connection points are only points: a vendor's switch stencil has 26 of them and nothing says which are RJ45
 * and which are SFP. This works it out, cautiously, from what the stencil does say:
 * - a point's own name ("SFP1", "Console", "Power", "USB") wins;
 * - a switch named for its port count ("USW-Pro-24-PoE", "Switch 48 port") with a few more points than that has its
 *   extra points as SFP when they stand apart at one end of the faceplate (as uplink cages do);
 * - a shape whose name mentions SFP gets the same, from the gap alone.
 * Anything unclear stays RJ45, as before: a port typed wrong in the other direction is worse than one left as RJ45.
 */
import type { PortDef, PortKind } from '../types';

/** The kind a connection point's own name says, if it says one. */
export function kindFromName(name: string | undefined): PortKind | undefined {
  const n = (name ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!n || /^\d+$/.test(n)) return undefined;
  if (/q?sfp|fib(er|re)|\bgbic\b|\bxfp\b/.test(n)) return 'sfp';
  if (/console|\bcon\b|serial|\bmgmt ?serial\b/.test(n)) return 'console';
  if (/\busb\b/.test(n)) return 'usb';
  if (/power|\bpwr\b|\bpsu\b|\brps\b|\bac\b|\bdc\b|inlet/.test(n)) return 'power';
  if (/\brj-?45\b|ethernet|\beth\d|\blan\b|\bwan\b|\bport\b|\bge\d|\bpoe\b/.test(n)) return 'rj45';
  return undefined;
}

/** Port counts that show up in switch names ("24", "48P", "-16-"); 1–3 digit numbers that aren't a model's year. */
function countsInName(name: string): number[] {
  return [...name.matchAll(/(?:^|[^\d.])(\d{1,2})(?=[^\d.]|$)/g)].map((m) => Number(m[1])).filter((n) => n >= 4 && n <= 96);
}

/** Groups ports into columns (same x, within half a port) and returns the columns left to right. */
function columns(ports: PortDef[]): PortDef[][] {
  const sorted = [...ports].sort((a, b) => a.x - b.x);
  const cols: PortDef[][] = [];
  for (const p of sorted) {
    const last = cols.at(-1);
    if (last && Math.abs(p.x - last[0].x) <= Math.max(p.w, last[0].w) / 2) last.push(p);
    else cols.push([p]);
  }
  return cols;
}

/**
 * The ports at one end of the faceplate that stand apart from the rest: a gap at least twice the usual spacing
 * between columns. Tries the right end, then the left. `want` = how many ports that group must have, if known.
 */
function standApart(ports: PortDef[], want?: number): PortDef[] | undefined {
  const cols = columns(ports);
  if (cols.length < 4) return undefined;
  const gaps = cols.slice(1).map((c, i) => c[0].x - cols[i][0].x);
  const usual = [...gaps].sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)];
  if (!(usual > 0)) return undefined;
  const max = Math.min(8, Math.floor(ports.length / 3));
  for (const fromRight of [true, false]) {
    let n = 0;
    for (let k = 1; k < cols.length; k++) {
      const i = fromRight ? cols.length - k : k - 1;
      n += cols[i].length;
      const gap = fromRight ? gaps[i - 1] : gaps[i];
      if (n > max) break;
      if (gap >= usual * 2 && (want === undefined || n === want)) {
        return (fromRight ? cols.slice(i) : cols.slice(0, i + 1)).flat();
      }
    }
  }
  return undefined;
}

/**
 * Sets each port's kind. `names` are the connection points' own names (Visio row names), in the order of `ports`;
 * `shapeName` is the master's or shape's name.
 */
export function guessPortKinds(ports: PortDef[], shapeName = '', names: (string | undefined)[] = []): PortDef[] {
  const named = ports.map((p, i) => ({ ...p, kind: kindFromName(names[i]) ?? p.kind }));
  // Points named for what they are (any but plain RJ45): trust the names alone.
  if (names.some((n) => { const k = kindFromName(n); return k && k !== 'rj45'; })) return named;
  const total = ports.length;
  let sfp: PortDef[] | undefined;
  for (const n of countsInName(shapeName)) {
    if (total > n && total - n <= 8) sfp = standApart(named, total - n);
    if (sfp) break;
  }
  if (!sfp && /sfp/i.test(shapeName)) sfp = standApart(named);
  if (!sfp) return named;
  const ids = new Set(sfp.map((p) => p.id));
  return named.map((p) => (ids.has(p.id) ? { ...p, kind: 'sfp' } : p));
}

/** A port's label from its connection point's name: "Port_07" → "7", "AC_Power" → "AC Power"; unnamed → its number. */
export function portLabel(name: string | undefined, i: number): string {
  const n = (name ?? '').replace(/_+/g, ' ').trim();
  const num = /^(?:port|row|p|ge|eth|ethernet)?\s*0*(\d+)$/i.exec(n);
  return !n ? `${i + 1}` : num ? num[1] : n.slice(0, 24);
}
