/**
 * Spreadsheet data linking (like Visio's "Link Data to Shapes"): read a CSV or Excel sheet, map its columns to
 * device fields, match rows to devices, and preview/apply the changes. The mapping is remembered per client so the
 * same sheet can be re-applied ("Refresh") after it is edited.
 */
import { DEVICE_STATUSES } from './types';
import { unzipLimited, XLSX_LIMITS } from './zipSafe';
import type { DeviceData, DeviceNode, Project } from './types';
import { allDevices } from './project';

export interface Table {
  headers: string[];
  rows: string[][];
}

/* ------------------------------------------------------------------ */
/*  Reading files                                                      */
/* ------------------------------------------------------------------ */

/** RFC 4180-style CSV parser; detects comma, semicolon or tab delimiters. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Reads the first worksheet of an .xlsx file into rows of text. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipLimited(bytes, XLSX_LIMITS, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n.startsWith('xl/worksheets/sheet'));
  const dec = (n: string) => (files[n] ? new TextDecoder().decode(files[n]) : '');
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

  // First sheet in workbook order → its part via the workbook relationships.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = dec('xl/workbook.xml');
  const rels = dec('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = xml(wb).getElementsByTagName('sheet')[0]?.getAttribute('r:id');
    const rel = Array.from(xml(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const shared = Array.from(xml(dec('xl/sharedStrings.xml') || '<sst/>').getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''),
  );
  const sheet = dec(sheetPath);
  if (!sheet) throw new Error('The workbook has no readable worksheet.');

  const col = (ref: string) => {
    let n = 0;
    for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
    return n - 1;
  };
  const out: string[][] = [];
  for (const r of Array.from(xml(sheet).getElementsByTagName('row'))) {
    const cells: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? c.getElementsByTagName('t')[0]?.textContent ?? '' : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
      cells[col(c.getAttribute('r') ?? 'A')] = val;
    }
    out.push(Array.from(cells, (x) => x ?? ''));
  }
  return out;
}

export async function readTable(file: File): Promise<Table> {
  let rows: string[][];
  if (/\.xlsx$/i.test(file.name)) rows = readXlsx(new Uint8Array(await file.arrayBuffer()));
  else if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or .csv in Excel.');
  else rows = parseCsv(await file.text());
  rows = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (rows.length < 2) throw new Error('The sheet needs a header row and at least one data row.');
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return { headers: pad(rows[0]).map((h, i) => h || `Column ${i + 1}`), rows: rows.slice(1).map(pad) };
}

/* ------------------------------------------------------------------ */
/*  Mapping and matching                                               */
/* ------------------------------------------------------------------ */

export type FieldKey = 'id' | 'name' | 'type' | 'model' | 'ip' | 'mac' | 'serial' | 'assetTag' | 'location' | 'powerW' | 'notes'
  | 'status' | 'purchaseDate' | 'warrantyEnd' | 'endOfLife' | 'weightLb';

export const FIELDS: { key: FieldKey; label: string; aliases: string[] }[] = [
  { key: 'id', label: 'RackDraw ID', aliases: ['rackdraw id', 'netcraft id', 'id', 'device id'] },
  { key: 'name', label: 'Name / hostname', aliases: ['name', 'hostname', 'host name', 'device', 'device name', 'computer name'] },
  { key: 'type', label: 'Type (for new devices)', aliases: ['type', 'device type', 'stencil', 'category'] },
  { key: 'model', label: 'Model', aliases: ['model', 'product', 'model number'] },
  { key: 'ip', label: 'Management IP', aliases: ['ip', 'ip address', 'management ip', 'mgmt ip', 'ipv4', 'address'] },
  { key: 'mac', label: 'MAC address', aliases: ['mac', 'mac address', 'mac addr'] },
  { key: 'serial', label: 'Serial number', aliases: ['serial', 'serial number', 'serial no', 's/n', 'sn', 'service tag'] },
  { key: 'assetTag', label: 'Asset tag', aliases: ['asset tag', 'asset', 'tag', 'asset number', 'asset #'] },
  { key: 'location', label: 'Location', aliases: ['location', 'room', 'site', 'closet'] },
  { key: 'powerW', label: 'Power (W)', aliases: ['power', 'power (w)', 'watts', 'power w', 'wattage'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'description'] },
  { key: 'status', label: 'Status', aliases: ['status', 'state'] },
  { key: 'purchaseDate', label: 'Purchased', aliases: ['purchased', 'purchase date', 'bought', 'install date', 'installed'] },
  { key: 'warrantyEnd', label: 'Warranty ends', aliases: ['warranty ends', 'warranty end', 'warranty', 'warranty expiry', 'warranty expiration', 'support ends'] },
  { key: 'endOfLife', label: 'End of life', aliases: ['end of life', 'eol', 'end of support', 'eos'] },
  { key: 'weightLb', label: 'Weight (lb)', aliases: ['weight', 'weight (lb)', 'weight lb', 'lbs'] },
];

/** A cell as the device field wants it: numbers, a known status, dates as YYYY-MM-DD; '' when it can't be read. */
export function normalizeCell(f: FieldKey, v: string): string {
  const t = v.trim();
  if (!t) return '';
  if (f === 'powerW' || f === 'weightLb') { const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? String(n) : ''; }
  if (f === 'status') return DEVICE_STATUSES.find((s) => s.value === t.toLowerCase() || s.label.toLowerCase() === t.toLowerCase())?.value ?? '';
  if (f === 'purchaseDate' || f === 'warrantyEnd' || f === 'endOfLife') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const at = Date.parse(t);
    if (!Number.isFinite(at)) return '';
    const d = new Date(at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return t;
}

/** Fields that can identify a device. */
export const MATCH_KEYS: FieldKey[] = ['id', 'name', 'assetTag', 'serial', 'ip', 'mac'];

/** Column index per field (-1 = not imported), guessed from header names. */
export type Mapping = Record<FieldKey, number>;

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

export function autoMap(headers: string[]): Mapping {
  const h = headers.map(norm);
  const m = {} as Mapping;
  for (const f of FIELDS) m[f.key] = h.findIndex((x) => f.aliases.includes(x));
  return m;
}

/** Converts a header-index mapping to header names (stable if columns move) and back. */
export const mappingToNames = (m: Mapping, headers: string[]) =>
  Object.fromEntries(Object.entries(m).map(([k, i]) => [k, i >= 0 ? headers[i] : ''])) as Record<FieldKey, string>;
export const mappingFromNames = (names: Record<string, string>, headers: string[]): Mapping => {
  const h = headers.map(norm);
  const m = {} as Mapping;
  for (const f of FIELDS) m[f.key] = names[f.key] ? h.indexOf(norm(names[f.key])) : -1;
  return m;
};

function deviceValue(d: DeviceNode, key: FieldKey): string {
  if (key === 'id') return d.id;
  const v = d.data[key as keyof DeviceData];
  return v == null ? '' : String(v);
}

const matchNorm = (key: FieldKey, v: string) => (key === 'mac' ? v.toLowerCase().replace(/[^0-9a-f]/g, '') : norm(v));

export interface PlannedUpdate {
  nodeId: string;
  name: string;
  changes: { field: FieldKey; from: string; to: string }[];
}
export interface PlannedCreate {
  data: Partial<DeviceData> & { name: string };
  type: string;
}
export interface ImportPlan {
  updates: PlannedUpdate[];
  unchanged: number;
  creates: PlannedCreate[];
  skipped: { row: number; reason: string }[];
}

const EDITABLE: FieldKey[] = ['name', 'model', 'ip', 'mac', 'serial', 'assetTag', 'location', 'powerW', 'notes', 'status', 'purchaseDate', 'warrantyEnd', 'endOfLife', 'weightLb'];
const NUMERIC = new Set<FieldKey>(['powerW', 'weightLb']);

/**
 * Works out what an import would do. Empty cells never erase existing values, so a sheet with only a few
 * columns filled in is safe to apply.
 */
export function planImport(p: Project, t: Table, m: Mapping, matchKey: FieldKey, createMissing: boolean): ImportPlan {
  const devices = allDevices(p);
  const index = new Map<string, DeviceNode[]>();
  for (const d of devices) {
    const k = matchNorm(matchKey, deviceValue(d, matchKey));
    if (k) index.set(k, [...(index.get(k) ?? []), d]);
  }
  const plan: ImportPlan = { updates: [], unchanged: 0, creates: [], skipped: [] };
  const seen = new Set<string>();
  const cell = (row: string[], k: FieldKey) => (m[k] >= 0 ? row[m[k]] ?? '' : '');

  t.rows.forEach((row, i) => {
    const rowNo = i + 2; // spreadsheet row number (after the header)
    const key = matchNorm(matchKey, cell(row, matchKey));
    // A row with no match value can still be a new device (e.g. a row added to an exported list, with no ID yet).
    if (!key && !(createMissing && cell(row, 'name'))) { plan.skipped.push({ row: rowNo, reason: 'no value in the match column' }); return; }
    const hits = key ? index.get(key) ?? [] : [];
    if (hits.length > 1) { plan.skipped.push({ row: rowNo, reason: `matches ${hits.length} devices` }); return; }
    if (!hits.length) {
      const name = cell(row, 'name') || cell(row, matchKey);
      if (!createMissing) { plan.skipped.push({ row: rowNo, reason: `no device "${cell(row, matchKey)}"` }); return; }
      const data: PlannedCreate['data'] = { name };
      for (const f of EDITABLE) {
        const v = normalizeCell(f, cell(row, f));
        if (v && f !== 'name') (data as Record<string, unknown>)[f] = NUMERIC.has(f) ? Number(v) : v;
      }
      plan.creates.push({ data, type: cell(row, 'type') });
      return;
    }
    const d = hits[0];
    if (seen.has(d.id)) { plan.skipped.push({ row: rowNo, reason: `"${d.data.name}" appears twice in the sheet` }); return; }
    seen.add(d.id);
    const changes: PlannedUpdate['changes'] = [];
    for (const f of EDITABLE) {
      const to = normalizeCell(f, cell(row, f));
      if (!to) continue;
      const from = deviceValue(d, f);
      if (NUMERIC.has(f) ? Number(to) !== Number(from) : to !== from) changes.push({ field: f, from, to });
    }
    if (changes.length) plan.updates.push({ nodeId: d.id, name: d.data.name, changes });
    else plan.unchanged++;
  });
  return plan;
}

/** One flat sheet of every device, with the RackDraw ID so edits can be matched back exactly. */
export function deviceListRows(p: Project, stencilName: (id: string) => string): string[][] {
  const head = ['RackDraw ID', 'Page', 'Name', 'Type', 'Model', 'IP', 'MAC', 'Serial', 'Asset tag', 'Location', 'Power (W)', 'Notes', 'Status', 'Purchased', 'Warranty ends', 'End of life', 'Weight (lb)'];
  const rows = p.pages.flatMap((pg) =>
    pg.nodes.filter((n): n is DeviceNode => n.type === 'device').map((n) => [
      n.id, pg.name, n.data.name, stencilName(n.data.stencilId), n.data.model ?? '', n.data.ip ?? '', n.data.mac ?? '',
      n.data.serial ?? '', n.data.assetTag ?? '', n.data.location ?? '', n.data.powerW == null ? '' : String(n.data.powerW), n.data.notes ?? '',
      n.data.status ?? 'active', n.data.purchaseDate ?? '', n.data.warrantyEnd ?? '', n.data.endOfLife ?? '', n.data.weightLb == null ? '' : String(n.data.weightLb),
    ]),
  );
  return [head, ...rows];
}
