import { equipmentKey } from './bom';
import { allDevices } from './project';
import { isPassThrough } from './trace';
import type { DeviceNode, Project, StencilDef } from './types';

/*
 * Replacement budget forecast (the technology roadmap MSPs bring to a quarterly review): when each piece of
 * equipment is due for replacement, and what that costs per year, from the price book. Due date: the device's End of
 * life, else its purchase date plus a typical service life for its kind, else its warranty end. Passive cabling
 * (patch panels, jacks) and services (Internet clouds) aren't replaced on a schedule and are left out.
 */

type Stencils = (id: string) => StencilDef | undefined;

/** Typical years in service before replacement, by kind of equipment. */
export const LIFESPAN_YEARS: Record<string, number> = {
  firewall: 5, router: 7, 'wifi-router': 4, 'lte-router': 5, sdwan: 5, 'vpn-concentrator': 5, 'load-balancer': 6, 'wan-optimizer': 6,
  'access-point': 5, 'ap-outdoor': 5, 'mesh-node': 4, wlc: 6, 'wireless-bridge': 7, 'range-extender': 4,
  server: 5, nas: 5, san: 6, 'tape-library': 7, ups: 8, 'pdu-network': 10, kvm: 8, 'console-server': 8,
  workstation: 4, laptop: 4, tablet: 3, smartphone: 3, printer: 5, phone: 6, 'ip-pbx': 7, camera: 6, nvr: 6,
  'access-control': 8, 'badge-reader': 8, 'alarm-panel': 10, display: 6, conference: 6, 'pos-terminal': 6, 'iot-device': 5,
};
/** By category, when the kind isn't listed. */
const BY_CATEGORY: Record<string, number> = { Firewalls: 5, Switching: 7, Wireless: 5, Servers: 5, Endpoints: 4, Personal: 3, WAN: 7, Carrier: 8, Security: 7, Infrastructure: 8 };
const DEFAULT_YEARS = 5;

export type DueBasis = 'End of life' | 'Typical life' | 'Warranty ends';

export interface ForecastItem {
  deviceId: string;
  device: string;
  model: string;
  /** Price-book key (the same as in the Bill of Materials). */
  key: string;
  /** What the equipment is ("Switch 24-port PoE + 4 SFP"). */
  kind: string;
  due: string;
  basis: DueBasis;
  /** Years of service assumed (Typical life only). */
  years?: number;
  price?: number;
}

export interface ForecastYear {
  /** Calendar year, or 0 for "overdue" (due before today). */
  year: number;
  items: ForecastItem[];
  equipment: number;
  /** Items in that year with no price yet. */
  unpriced: number;
  /** Circuits: monthly cost × 12. */
  recurring: number;
  total: number;
}

export interface Forecast {
  years: ForecastYear[];
  /** Equipment with no date at all (no End of life, purchase date or warranty end). */
  undated: { deviceId: string; device: string; model: string; key: string; kind: string; price?: number }[];
  /** Everything due within the forecast, in date order. */
  items: ForecastItem[];
  recurringPerYear: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const validDate = (s?: string) => {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  // The day must exist ("2026-02-30" does not).
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : undefined;
};

/** The service life assumed for a device. */
export function lifespanOf(d: DeviceNode, st?: StencilDef) {
  return LIFESPAN_YEARS[d.data.stencilId] ?? (st?.category ? BY_CATEGORY[st.category] : undefined) ?? DEFAULT_YEARS;
}

/** Whether the device is equipment that gets replaced on a schedule. */
function replaceable(d: DeviceNode, st?: StencilDef) {
  if (!equipmentKey(d, st)) return false;
  if (st?.category === 'Cabling' || st?.category === 'Layout' || isPassThrough(d, st)) return false;
  return !['sfp-module', 'optical-splitter', 'splice-closure', 'wall-jack', 'antenna', 'keyboard-mouse', 'headset', 'usb-hub', 'bt-adapter', 'smartwatch'].includes(d.data.stencilId);
}

/** When the device is due for replacement, and on what basis. */
export function dueDate(d: DeviceNode, st?: StencilDef): { due: string; basis: DueBasis; years?: number } | undefined {
  const eol = validDate(d.data.endOfLife);
  if (eol) return { due: eol, basis: 'End of life' };
  const bought = validDate(d.data.purchaseDate);
  if (bought) {
    const years = lifespanOf(d, st);
    const t = new Date(`${bought}T00:00:00`);
    t.setFullYear(t.getFullYear() + years);
    return { due: iso(t), basis: 'Typical life', years };
  }
  const warranty = validDate(d.data.warrantyEnd);
  if (warranty) return { due: warranty, basis: 'Warranty ends' };
  return undefined;
}

/** The forecast for this year and the next `span - 1`, plus what is already overdue. */
export function replacementForecast(p: Project, stencil: Stencils, prices: Record<string, number>, today = new Date(), span = 5): Forecast {
  const todayIso = iso(today);
  const first = today.getFullYear(), last = first + span - 1;
  const items: ForecastItem[] = [];
  const undated: Forecast['undated'] = [];
  for (const d of allDevices(p)) {
    const st = stencil(d.data.stencilId);
    if (!replaceable(d, st)) continue;
    const key = equipmentKey(d, st)!;
    const base = { deviceId: d.id, device: d.data.name, model: d.data.model?.trim() || st?.defaults?.model || '', key, kind: st?.name ?? d.data.stencilId, price: prices[key] };
    const due = dueDate(d, st);
    if (!due) { undated.push(base); continue; }
    if (Number(due.due.slice(0, 4)) > last) continue;
    items.push({ ...base, ...due });
  }
  items.sort((a, b) => a.due.localeCompare(b.due) || a.device.localeCompare(b.device));

  const recurringPerYear = allDevices(p).reduce((t, d) => t + (d.data.circuit?.monthlyCost ?? 0) * 12, 0);
  const bucket = (year: number, list: ForecastItem[], recurring: number): ForecastYear => {
    const equipment = list.reduce((t, i) => t + (i.price ?? 0), 0);
    return { year, items: list, equipment, unpriced: list.filter((i) => i.price === undefined).length, recurring, total: equipment + recurring };
  };
  const years: ForecastYear[] = [bucket(0, items.filter((i) => i.due < todayIso), 0)];
  for (let y = first; y <= last; y++) years.push(bucket(y, items.filter((i) => i.due >= todayIso && Number(i.due.slice(0, 4)) === y), recurringPerYear));
  return { years, undated, items, recurringPerYear };
}

export const FORECAST_HEADER = ['Due', 'When', 'Device', 'Equipment', 'Model', 'Basis', 'Price'];

/** Table rows (Excel / CSV / copy): every item, with its year bucket. */
export function forecastRows(f: Forecast): (string | number)[][] {
  return f.years.flatMap((y) => y.items.map((i) => [
    i.due, y.year === 0 ? 'Overdue' : String(y.year), i.device, i.kind, i.model,
    i.basis === 'Typical life' ? `Typical life (${i.years} years from purchase)` : i.basis, i.price ?? '',
  ]));
}
