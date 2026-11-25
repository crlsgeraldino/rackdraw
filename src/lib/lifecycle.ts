/**
 * Device lifecycle (purchase, warranty end, end of life) and ISP / carrier circuit records: what's expiring, what's
 * out of support, and what the client pays every month for its circuits. Pure functions over the project.
 */
import { allDevices } from './project';
import type { DeviceData, Project } from './types';

/** An ISP / carrier circuit, recorded on the device that stands for it (Internet cloud, modem / ONT, router…). */
export interface CircuitInfo {
  carrier?: string;
  circuitId?: string;
  /** DIA, Broadband, MPLS, Metro Ethernet, LTE / 5G, Satellite, Dark fiber… */
  kind?: string;
  bandwidth?: string;
  /** Static IP block, e.g. "203.0.113.8/29". */
  staticIps?: string;
  supportPhone?: string;
  accountNumber?: string;
  /** Contract end date (YYYY-MM-DD). */
  contractEnd?: string;
  monthlyCost?: number;
  notes?: string;
}

export const CIRCUIT_KINDS = ['DIA (dedicated Internet)', 'Broadband', 'MPLS', 'Metro Ethernet', 'SD-WAN overlay', 'LTE / 5G', 'Satellite', 'Dark fiber', 'Point-to-point', 'POTS / PRI'];

/** Days before a date that it counts as "expiring soon". */
export const SOON_DAYS = 90;

export type LifeState = 'expired' | 'soon' | 'ok' | 'unknown';
export const LIFE_STATES: { value: LifeState; label: string; color: string }[] = [
  { value: 'expired', label: 'Expired', color: '#dc2626' },
  { value: 'soon', label: `Expires within ${SOON_DAYS} days`, color: '#d97706' },
  { value: 'ok', label: 'Covered', color: '#16a34a' },
  { value: 'unknown', label: 'No date', color: '#9ca3af' },
];

const DAY = 86400000;

/** Whole days from `today` to a date (negative = past); undefined when it isn't a date. */
export function daysUntil(date?: string, today = new Date()): number | undefined {
  const t = date?.trim();
  if (!t) return undefined;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const at = iso ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3]) : Date.parse(t);
  if (!Number.isFinite(at)) return undefined;
  // "2026-02-30" is not a date (Date.UTC would quietly make it March 2).
  if (iso && new Date(at).getUTCDate() !== +iso[3]) return undefined;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((at - now) / DAY);
}

export function stateOf(days: number | undefined): LifeState {
  if (days === undefined) return 'unknown';
  if (days < 0) return 'expired';
  return days <= SOON_DAYS ? 'soon' : 'ok';
}

/** A device's warranty state (Design → Devices by Warranty). */
export const warrantyState = (d: DeviceData, today = new Date()) => stateOf(daysUntil(d.warrantyEnd, today));

/** "in 45 days", "3 days ago", "today". */
export function whenText(days: number | undefined) {
  if (days === undefined) return '';
  if (days === 0) return 'today';
  return days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ago`;
}

export interface LifeRow {
  deviceId: string;
  device: string;
  model: string;
  serial: string;
  purchase: string;
  warrantyEnd: string;
  warrantyDays?: number;
  endOfLife: string;
  eolDays?: number;
  /** The more urgent of warranty and end of life. */
  state: LifeState;
}

export function lifecycleRows(p: Project, today = new Date()): LifeRow[] {
  const rank: Record<LifeState, number> = { expired: 0, soon: 1, ok: 2, unknown: 3 };
  return allDevices(p).map((n) => {
    const d = n.data;
    const warrantyDays = daysUntil(d.warrantyEnd, today), eolDays = daysUntil(d.endOfLife, today);
    const states = [stateOf(warrantyDays), stateOf(eolDays)].sort((a, b) => rank[a] - rank[b]);
    return {
      deviceId: n.id, device: d.name, model: d.model ?? '', serial: d.serial ?? '', purchase: d.purchaseDate ?? '',
      warrantyEnd: d.warrantyEnd ?? '', warrantyDays, endOfLife: d.endOfLife ?? '', eolDays, state: states[0],
    };
  });
}

export interface CircuitRow extends CircuitInfo {
  deviceId: string;
  device: string;
  contractDays?: number;
}

export function circuitRows(p: Project, today = new Date()): CircuitRow[] {
  return allDevices(p)
    .filter((n) => n.data.circuit && Object.values(n.data.circuit).some((v) => v !== undefined && v !== ''))
    .map((n) => ({ ...n.data.circuit!, deviceId: n.id, device: n.data.name, contractDays: daysUntil(n.data.circuit!.contractEnd, today) }));
}

export interface LifeProblem {
  deviceId: string;
  severity: 'warning' | 'info';
  rule: string;
  message: string;
}

/** Check Diagram: out of warranty, past end of life, expiring soon, circuit contracts ending. */
export function lifecycleProblems(p: Project, today = new Date()): LifeProblem[] {
  const out: LifeProblem[] = [];
  for (const r of lifecycleRows(p, today)) {
    if (r.eolDays !== undefined && r.eolDays < 0) out.push({ deviceId: r.deviceId, severity: 'warning', rule: 'End of life', message: `${r.device} reached end of life ${whenText(r.eolDays)} (${r.endOfLife}): plan its replacement` });
    else if (r.eolDays !== undefined && r.eolDays <= SOON_DAYS) out.push({ deviceId: r.deviceId, severity: 'info', rule: 'End of life soon', message: `${r.device} reaches end of life ${whenText(r.eolDays)} (${r.endOfLife})` });
    if (r.warrantyDays !== undefined && r.warrantyDays < 0) out.push({ deviceId: r.deviceId, severity: 'warning', rule: 'Out of warranty', message: `${r.device}: warranty ended ${whenText(r.warrantyDays)} (${r.warrantyEnd})` });
    else if (r.warrantyDays !== undefined && r.warrantyDays <= SOON_DAYS) out.push({ deviceId: r.deviceId, severity: 'info', rule: 'Warranty ending', message: `${r.device}: warranty ends ${whenText(r.warrantyDays)} (${r.warrantyEnd})` });
  }
  for (const c of circuitRows(p, today)) {
    if (c.contractDays !== undefined && c.contractDays <= SOON_DAYS) {
      out.push({ deviceId: c.deviceId, severity: c.contractDays < 0 ? 'warning' : 'info', rule: 'Circuit contract', message: `${c.device}: ${[c.carrier, c.circuitId].filter(Boolean).join(' ') || 'circuit'} contract ${c.contractDays < 0 ? 'ended' : 'ends'} ${whenText(c.contractDays)} (${c.contractEnd})` });
    }
  }
  return out;
}

/** Name of a circuit for lists and the quote: "Fiber Co 1 Gbps DIA (CID 12345)". */
export function circuitName(c: CircuitInfo, fallback: string) {
  const what = [c.carrier, c.bandwidth, c.kind?.replace(/\s*\(.*\)$/, '')].filter(Boolean).join(' ');
  return `${what || fallback}${c.circuitId ? ` (${c.circuitId})` : ''}`;
}
