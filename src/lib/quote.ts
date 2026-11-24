/**
 * Cost estimate / quote from the Bill of Materials: unit prices from the price book, labor hours estimated from the
 * work the diagram shows (cable drops, fiber runs, rack equipment, endpoints, racks, patch cords), markup and tax on
 * materials, and circuits / services as monthly recurring charges.
 */
import type { BomSection, WorkCounts } from './bom';

export type LaborTask = 'copperRuns' | 'fiberRuns' | 'rackDevices' | 'endpoints' | 'racks' | 'cords';

export interface QuoteSettings {
  /** ISO currency code, e.g. USD, EUR, GBP. */
  currency?: string;
  /** Markup on materials, %. */
  markupPct?: number;
  /** Sales tax on materials (after markup), %. */
  taxPct?: number;
  /** Labor rate per hour. */
  laborRate?: number;
  /** Hours per unit of each task (missing = default). */
  hours?: Partial<Record<LaborTask, number>>;
  /** Days the quote is valid. */
  validDays?: number;
  /** Notes / terms printed on the quote. */
  notes?: string;
  /** The prices this client's quote used (so the file / backup quotes the same on another computer). */
  prices?: Record<string, number>;
}

export const LABOR_TASKS: { key: LaborTask; label: string; unit: string; hours: number }[] = [
  { key: 'copperRuns', label: 'Pull, terminate and test copper drops', unit: 'drop', hours: 1 },
  { key: 'fiberRuns', label: 'Pull, terminate and test fiber runs', unit: 'run', hours: 2.5 },
  { key: 'rackDevices', label: 'Mount and configure rack equipment', unit: 'device', hours: 1.5 },
  { key: 'endpoints', label: 'Install and set up endpoints (APs, cameras, phones, PCs…)', unit: 'device', hours: 0.5 },
  { key: 'racks', label: 'Assemble and dress racks', unit: 'rack', hours: 3 },
  { key: 'cords', label: 'Patch and label cords', unit: 'cord', hours: 0.1 },
];

export const QUOTE_DEFAULTS: Required<Omit<QuoteSettings, 'hours' | 'notes' | 'prices'>> = { currency: 'USD', markupPct: 20, taxPct: 0, laborRate: 95, validDays: 30 };

export interface QuoteLine {
  section: string;
  key: string;
  item: string;
  detail: string;
  qty: number;
  unit: string;
  price?: number;
  amount: number;
  monthly?: boolean;
}

export interface Quote {
  lines: QuoteLine[];
  labor: { key: LaborTask; label: string; qty: number; unit: string; hoursEach: number; hours: number; amount: number }[];
  materials: number;
  markup: number;
  tax: number;
  laborHours: number;
  labor$: number;
  oneTime: number;
  monthly: number;
  unpriced: number;
}

/** Bulk cable is priced per foot; everything else per unit. */
export function priceQuote(sections: BomSection[], work: WorkCounts, prices: Record<string, number>, s: QuoteSettings = {}): Quote {
  const set = { ...QUOTE_DEFAULTS, ...s };
  const lines: QuoteLine[] = sections.flatMap((sec) =>
    sec.rows.map((r) => {
      const price = r.price ?? prices[r.key];
      return { section: sec.title, key: r.key, item: r.item, detail: r.detail, qty: r.qty, unit: r.unit, price, amount: price !== undefined ? price * r.qty : 0, monthly: sec.title === 'Circuits & services' };
    }),
  );
  const materials = lines.filter((l) => !l.monthly).reduce((t, l) => t + l.amount, 0);
  const markup = (materials * set.markupPct) / 100;
  const tax = ((materials + markup) * set.taxPct) / 100;
  const labor = LABOR_TASKS.map((t) => {
    const hoursEach = s.hours?.[t.key] ?? t.hours;
    const qty = work[t.key];
    const hours = Math.round(qty * hoursEach * 10) / 10;
    return { key: t.key, label: t.label, qty, unit: t.unit, hoursEach, hours, amount: hours * set.laborRate };
  }).filter((l) => l.qty);
  const laborHours = labor.reduce((t, l) => t + l.hours, 0);
  const labor$ = laborHours * set.laborRate;
  return {
    lines, labor, materials, markup, tax, laborHours, labor$,
    oneTime: materials + markup + tax + labor$,
    monthly: lines.filter((l) => l.monthly).reduce((t, l) => t + l.amount, 0),
    unpriced: lines.filter((l) => l.price === undefined).length,
  };
}

/**
 * A typed price: "$8,500", "1.200,50" (decimal comma), "45,5", "12.99". Text without digits, or a negative number,
 * is not a price (undefined).
 */
export function parsePrice(text: string): number | undefined {
  let t = text.trim().replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t) || t.startsWith('-')) return undefined;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  // The last separator is the decimal one when it is followed by 1-2 digits and it's a comma after any dot.
  if (lastComma > lastDot && /,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

export function money(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** The quote as sheet rows: lines, labor, then the totals. */
export function quoteRows(q: Quote, s: QuoteSettings = {}): (string | number)[][] {
  const set = { ...QUOTE_DEFAULTS, ...s };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [
    ...q.lines.map((l) => [l.section, l.qty, l.unit, l.item, l.detail, l.price ?? '', l.price !== undefined ? r2(l.amount) : '', l.monthly ? 'monthly' : '']),
    ...q.labor.map((l) => ['Labor', l.hours, 'h', l.label, `${l.qty} ${l.unit}${l.qty === 1 ? '' : 's'} × ${l.hoursEach} h`, set.laborRate, r2(l.amount), '']),
    [],
    ['', '', '', 'Materials', '', '', r2(q.materials), ''],
    ['', '', '', `Markup ${set.markupPct}%`, '', '', r2(q.markup), ''],
    ...(set.taxPct ? [['', '', '', `Tax ${set.taxPct}%`, '', '', r2(q.tax), '']] : []),
    ['', '', '', `Labor (${r2(q.laborHours)} h)`, '', '', r2(q.labor$), ''],
    ['', '', '', 'Total (one-time)', '', '', r2(q.oneTime), ''],
    ...(q.monthly ? [['', '', '', 'Monthly recurring', '', '', r2(q.monthly), 'monthly']] : []),
  ];
}
export const QUOTE_HEADER = ['Section', 'Qty', 'Unit', 'Item', 'Detail', 'Unit price', 'Amount', 'Billing'];
