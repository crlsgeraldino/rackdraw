/**
 * Visio's Report wizard: pick which devices (page, layer, a condition on a field), which fields become columns, and
 * how to sort; the same definition gives the preview table, Excel, Word and CSV. Definitions are saved with the client.
 */
import { DEVICE_STATUSES, type DeviceNode, type Project } from './types';

export type ReportOp = 'exists' | 'missing' | 'equals' | 'contains';

export interface ReportDef {
  id: string;
  name: string;
  /** Column field keys, in order (see reportFields). */
  fields: string[];
  /** Page id, or empty for every page. */
  pageId?: string;
  /** Layer id, '-' for "no layer", or empty for any. */
  layer?: string;
  filter?: { field: string; op: ReportOp; value?: string };
  sortBy?: string;
  /** Adds a final row with the device count and total power. */
  totals?: boolean;
}

export interface ReportField {
  key: string;
  label: string;
}

type Row = { n: DeviceNode; page: string; rack: string; connections: number };

const BUILT_IN: (ReportField & { get: (r: Row, p: Project, stencilName: (id: string) => string) => string | number })[] = [
  { key: 'name', label: 'Name', get: (r) => r.n.data.name },
  { key: 'type', label: 'Type', get: (r, _p, st) => st(r.n.data.stencilId) },
  { key: 'model', label: 'Model', get: (r) => r.n.data.model ?? '' },
  { key: 'ip', label: 'IP', get: (r) => r.n.data.ip ?? '' },
  { key: 'mac', label: 'MAC', get: (r) => r.n.data.mac ?? '' },
  { key: 'serial', label: 'Serial', get: (r) => r.n.data.serial ?? '' },
  { key: 'assetTag', label: 'Asset tag', get: (r) => r.n.data.assetTag ?? '' },
  { key: 'location', label: 'Location', get: (r) => r.n.data.location ?? '' },
  { key: 'rack', label: 'Rack', get: (r) => r.rack },
  { key: 'status', label: 'Status', get: (r) => DEVICE_STATUSES.find((s) => s.value === (r.n.data.status ?? 'active'))?.label ?? '' },
  { key: 'layer', label: 'Layer', get: (r, p) => p.layers?.find((l) => l.id === r.n.data.layer)?.name ?? '' },
  { key: 'page', label: 'Page', get: (r) => r.page },
  { key: 'powerW', label: 'Power (W)', get: (r) => r.n.data.powerW ?? '' },
  { key: 'connections', label: 'Connections', get: (r) => r.connections },
  { key: 'documentedPorts', label: 'Documented ports', get: (r) => Object.values(r.n.data.ports ?? {}).filter((pd) => pd && (pd.description || pd.ip || pd.vlan || pd.notes || pd.uplink)).length },
  { key: 'link', label: 'Link', get: (r) => r.n.data.link ?? '' },
  { key: 'notes', label: 'Notes', get: (r) => r.n.data.notes ?? '' },
];

/** Every field a report can use: the built-in ones, then each "My fields" name used on any device. */
export function reportFields(p: Project): ReportField[] {
  const extra = new Set<string>((p.fieldDefs ?? []).map((d) => d.label.trim()).filter(Boolean));
  for (const pg of p.pages) for (const n of pg.nodes) if (n.type === 'device') for (const f of n.data.extraFields ?? []) if (f.label.trim()) extra.add(f.label.trim());
  return [...BUILT_IN.map(({ key, label }) => ({ key, label })), ...[...extra].sort((a, b) => a.localeCompare(b)).map((l) => ({ key: `x:${l}`, label: l }))];
}

export const DEFAULT_REPORT: Omit<ReportDef, 'id'> = {
  name: 'Inventory',
  fields: ['name', 'type', 'model', 'ip', 'serial', 'location', 'rack'],
  sortBy: 'name',
};

function rackPositions(p: Project) {
  const pos = new Map<string, string>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) pos.set(it.nodeId, `${r.name} U${it.u}${it.height > 1 ? `–${it.u + it.height - 1}` : ''}`);
  return pos;
}

function value(key: string, r: Row, p: Project, st: (id: string) => string): string | number {
  if (key.startsWith('x:')) {
    const label = key.slice(2).toLowerCase();
    return r.n.data.extraFields?.find((f) => f.label.trim().toLowerCase() === label)?.value ?? '';
  }
  return BUILT_IN.find((f) => f.key === key)?.get(r, p, st) ?? '';
}

export function runReport(p: Project, def: ReportDef, stencilName: (id: string) => string) {
  const racks = rackPositions(p);
  let rows: Row[] = p.pages
    .filter((pg) => !def.pageId || pg.id === def.pageId)
    .flatMap((pg) => pg.nodes.flatMap((n) => (n.type === 'device'
      ? [{ n, page: pg.name, rack: racks.get(n.id) ?? '', connections: pg.edges.filter((e) => e.source === n.id || e.target === n.id).length }]
      : [])));
  if (def.layer) rows = rows.filter((r) => (def.layer === '-' ? !r.n.data.layer : r.n.data.layer === def.layer));
  const f = def.filter;
  if (f?.field) {
    const want = (f.value ?? '').trim().toLowerCase();
    rows = rows.filter((r) => {
      const v = String(value(f.field, r, p, stencilName)).trim().toLowerCase();
      return f.op === 'exists' ? !!v : f.op === 'missing' ? !v : f.op === 'equals' ? v === want : v.includes(want);
    });
  }
  const fields = reportFields(p);
  const header = def.fields.map((k) => fields.find((x) => x.key === k)?.label ?? (k.startsWith('x:') ? k.slice(2) : k));
  let data = rows.map((r) => ({ r, cells: def.fields.map((k) => value(k, r, p, stencilName)) }));
  if (def.sortBy) {
    const key = def.sortBy;
    data = data
      .map((d) => ({ ...d, s: value(key, d.r, p, stencilName) }))
      .sort((a, b) => (typeof a.s === 'number' && typeof b.s === 'number' ? a.s - b.s : String(a.s).localeCompare(String(b.s), undefined, { numeric: true })));
  }
  const body = data.map((d) => d.cells);
  if (def.totals && body.length) {
    const total = def.fields.map((k, i) => {
      if (i === 0) return `Total: ${body.length} device${body.length === 1 ? '' : 's'}`;
      if (k === 'powerW' || k === 'connections') return body.reduce((s, r) => s + (Number(r[i]) || 0), 0);
      return '';
    });
    body.push(total);
  }
  return { header, rows: body, count: rows.length };
}
