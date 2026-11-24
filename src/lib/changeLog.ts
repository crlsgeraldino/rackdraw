import { rackLabel } from './rack';
import type { CableEdge, DeviceNode, PortData, Project, StencilDef } from './types';

/*
 * Change log: what changed in the client's network documentation, and when — devices, their details and ports,
 * cables, racks and the IP plan. Worked out by comparing the client before and after a burst of edits (moves,
 * colours and other drawing-only changes are left out), plus notes the user adds (a ticket number, a site visit).
 * Kept in the client, so it travels with the file and the backups.
 */

export type ChangeKind = 'device' | 'port' | 'cable' | 'rack' | 'vlan' | 'page' | 'note';

export interface ChangeEntry {
  /** When it was recorded (ms). */
  at: number;
  kind: ChangeKind;
  action: 'added' | 'removed' | 'changed' | 'note';
  /** What it is about ("Core switch", "Rack A", "VLAN 20"). */
  target: string;
  /** What happened, in words ("IP 10.0.0.5 → 10.0.0.7"). */
  detail: string;
}

/** The newest entries kept per client. */
export const CHANGE_LOG_LIMIT = 5000;

const DEVICE_FIELDS: [keyof DeviceNode['data'], string][] = [
  ['name', 'Name'], ['model', 'Model'], ['ip', 'IP'], ['mac', 'MAC'], ['serial', 'Serial'], ['assetTag', 'Asset tag'],
  ['location', 'Location'], ['status', 'Status'], ['purchaseDate', 'Purchased'], ['warrantyEnd', 'Warranty ends'],
  ['endOfLife', 'End of life'], ['powerW', 'Power (W)'], ['weightLb', 'Weight (lb)'],
];
const CIRCUIT_FIELDS: [string, string][] = [
  ['carrier', 'Carrier'], ['circuitId', 'Circuit ID'], ['bandwidth', 'Bandwidth'], ['accountNumber', 'Account'],
  ['contractEnd', 'Contract ends'], ['monthlyCost', 'Monthly cost'], ['staticIps', 'Static IPs'],
];
const PORT_FIELDS: [keyof PortData, string][] = [
  ['description', 'connected to'], ['ip', 'IP'], ['vlan', 'VLAN'], ['speed', 'speed'], ['poe', 'PoE'], ['status', 'status'], ['uplink', 'uplink'],
];
const CABLE_FIELDS: [string, string][] = [['cable', 'type'], ['label', 'label'], ['vlan', 'VLAN'], ['length', 'length']];

const show = (v: unknown) => (v === undefined || v === null || v === '' || v === false ? '—' : v === true ? 'yes' : String(v));
const differs = (a: unknown, b: unknown) => show(a) !== show(b);

function devicesOf(p: Project) {
  const m = new Map<string, DeviceNode>();
  for (const pg of p.pages) for (const n of pg.nodes) if (n.type === 'device') m.set(n.id, n as DeviceNode);
  return m;
}
function cablesOf(p: Project) {
  const m = new Map<string, CableEdge>();
  for (const pg of p.pages) for (const e of pg.edges) m.set(e.id, e);
  return m;
}
const mountsOf = (p: Project) => {
  const m = new Map<string, { rack: string; at: string }>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) m.set(it.nodeId, { rack: r.name, at: rackLabel(it) });
  return m;
};

/** What changed between two versions of a client, as log entries (all stamped `at`). */
export function diffProjects(a: Project, b: Project, at = Date.now(), stencil?: (id: string) => StencilDef | undefined): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const push = (kind: ChangeKind, action: ChangeEntry['action'], target: string, detail: string) => out.push({ at, kind, action, target, detail });

  // Pages
  const ap = new Map(a.pages.map((p) => [p.id, p])), bp = new Map(b.pages.map((p) => [p.id, p]));
  for (const p of b.pages) if (!ap.has(p.id)) push('page', 'added', p.name, 'Page added');
  for (const p of a.pages) if (!bp.has(p.id)) push('page', 'removed', p.name, 'Page deleted');
  for (const p of b.pages) { const o = ap.get(p.id); if (o && o.name !== p.name) push('page', 'changed', p.name, `Page renamed from "${o.name}"`); }

  // Devices and their ports
  const ad = devicesOf(a), bd = devicesOf(b);
  const nameIn = (id: string) => bd.get(id)?.data.name ?? ad.get(id)?.data.name ?? 'Item';
  /** A port's printed name ("3", "SFP 1"), from the device, else its stencil. */
  const portOf = (d: DeviceNode | undefined, h?: string | null) => (h ? d?.data.ports?.[h]?.label || (d && stencil?.(d.data.stencilId)?.ports.find((q) => q.id === h)?.label) || h.replace(/^PP?/, '') : '');
  for (const [id, n] of bd) {
    const o = ad.get(id);
    if (!o) { push('device', 'added', n.data.name, ['Added', n.data.model, n.data.ip].filter(Boolean).join(' · ')); continue; }
    if (o.data === n.data) continue;
    for (const [k, label] of DEVICE_FIELDS) {
      if (differs(o.data[k], n.data[k])) push('device', 'changed', k === 'name' ? show(o.data.name) : n.data.name, `${label}: ${show(o.data[k])} → ${show(n.data[k])}`);
    }
    if (differs(o.data.notes?.trim(), n.data.notes?.trim())) push('device', 'changed', n.data.name, 'Notes edited');
    for (const [k, label] of CIRCUIT_FIELDS) {
      const x = (o.data.circuit as Record<string, unknown> | undefined)?.[k], y = (n.data.circuit as Record<string, unknown> | undefined)?.[k];
      if (differs(x, y)) push('device', 'changed', n.data.name, `${label}: ${show(x)} → ${show(y)}`);
    }
    const ox = new Map((o.data.extraFields ?? []).map((f) => [f.label, f.value])), nx = new Map((n.data.extraFields ?? []).map((f) => [f.label, f.value]));
    for (const k of new Set([...ox.keys(), ...nx.keys()])) if (k && differs(ox.get(k), nx.get(k))) push('device', 'changed', n.data.name, `${k}: ${show(ox.get(k))} → ${show(nx.get(k))}`);
    if (o.data.ports !== n.data.ports) {
      for (const port of new Set([...Object.keys(o.data.ports ?? {}), ...Object.keys(n.data.ports ?? {})])) {
        const x = o.data.ports?.[port] ?? {}, y = n.data.ports?.[port] ?? {};
        const name = portOf(n, port);
        for (const [k, label] of PORT_FIELDS) if (differs(x[k], y[k])) push('port', 'changed', `${n.data.name} ${name}`, `Port ${label}: ${show(x[k])} → ${show(y[k])}`);
      }
    }
  }
  for (const [id, n] of ad) if (!bd.has(id)) push('device', 'removed', n.data.name, ['Deleted', n.data.model, n.data.ip].filter(Boolean).join(' · '));

  // Cables
  const ac = cablesOf(a), bc = cablesOf(b);
  const ends = (e: CableEdge, devs: Map<string, DeviceNode>) => {
    const side = (id: string, h?: string | null) => [devs.get(id)?.data.name ?? nameIn(id), portOf(devs.get(id), h)].filter(Boolean).join(' ');
    return `${side(e.source, e.sourceHandle)} ↔ ${side(e.target, e.targetHandle)}`;
  };
  const isCable = (e: CableEdge, devs: Map<string, DeviceNode>) => devs.has(e.source) || devs.has(e.target);
  for (const [id, e] of bc) {
    const o = ac.get(id);
    if (!o) { if (isCable(e, bd)) push('cable', 'added', ends(e, bd), `Connected (${e.data?.cable ?? 'Cat6'})`); continue; }
    if (o === e || !isCable(e, bd)) continue;
    if (o.source !== e.source || o.target !== e.target || o.sourceHandle !== e.sourceHandle || o.targetHandle !== e.targetHandle) push('cable', 'changed', ends(e, bd), `Reconnected (was ${ends(o, ad)})`);
    for (const [k, label] of CABLE_FIELDS) {
      const x = (o.data as Record<string, unknown> | undefined)?.[k] ?? (k === 'cable' ? 'Cat6' : undefined);
      const y = (e.data as Record<string, unknown> | undefined)?.[k] ?? (k === 'cable' ? 'Cat6' : undefined);
      if (differs(x, y)) push('cable', 'changed', ends(e, bd), `Cable ${label}: ${show(x)} → ${show(y)}`);
    }
  }
  for (const [id, e] of ac) if (!bc.has(id) && isCable(e, ad)) push('cable', 'removed', ends(e, ad), 'Disconnected');

  // Racks: racks themselves, and where devices are mounted
  const ar = new Map((a.racks ?? []).map((r) => [r.id, r])), br = new Map((b.racks ?? []).map((r) => [r.id, r]));
  for (const r of b.racks ?? []) {
    const o = ar.get(r.id);
    if (!o) push('rack', 'added', r.name, `Rack added (${r.units}U)`);
    else {
      if (o.name !== r.name) push('rack', 'changed', r.name, `Renamed from "${o.name}"`);
      if (o.units !== r.units) push('rack', 'changed', r.name, `Size: ${o.units}U → ${r.units}U`);
    }
  }
  for (const r of a.racks ?? []) if (!br.has(r.id)) push('rack', 'removed', r.name, 'Rack deleted');
  const am = mountsOf(a), bm = mountsOf(b);
  for (const [id, m] of bm) {
    const o = am.get(id);
    if (!o) push('rack', 'changed', nameIn(id), `Mounted in ${m.rack} ${m.at}`);
    else if (o.rack !== m.rack || o.at !== m.at) push('rack', 'changed', nameIn(id), `Moved: ${o.rack} ${o.at} → ${m.rack} ${m.at}`);
  }
  for (const [id, o] of am) if (!bm.has(id) && bd.has(id)) push('rack', 'changed', nameIn(id), `Taken out of ${o.rack} ${o.at}`);

  // IP plan
  const av = new Map((a.vlans ?? []).map((v) => [v.id, v])), bv = new Map((b.vlans ?? []).map((v) => [v.id, v]));
  const vname = (v: { vlan: string; name: string }) => [v.vlan && `VLAN ${v.vlan}`, v.name].filter(Boolean).join(' ') || 'Subnet';
  for (const v of b.vlans ?? []) {
    const o = av.get(v.id);
    if (!o) { push('vlan', 'added', vname(v), ['Added', v.subnet].filter(Boolean).join(' · ')); continue; }
    for (const [k, label] of [['vlan', 'VLAN'], ['name', 'Name'], ['subnet', 'Subnet'], ['gateway', 'Gateway'], ['dhcpStart', 'DHCP start'], ['dhcpEnd', 'DHCP end']] as const) {
      if (differs(o[k], v[k])) push('vlan', 'changed', vname(v), `${label}: ${show(o[k])} → ${show(v[k])}`);
    }
  }
  for (const v of a.vlans ?? []) if (!bv.has(v.id)) push('vlan', 'removed', vname(v), 'Deleted');

  return out;
}

const FIELD_CHANGE = /^([^]*?): ([^]*) → ([^]*)$/;
/** Edits of the same field this close together are one change (typing an IP with pauses). */
const MERGE_WINDOW = 3 * 60_000;

/**
 * Adds entries to a log, keeping the newest CHANGE_LOG_LIMIT. A field changed again within a few minutes updates the
 * earlier entry ("IP: 10.0.0.5 → 10.0.0.7" then "→ 10.0.0.70" gives "IP: 10.0.0.5 → 10.0.0.70"); changed back, the
 * entry goes away.
 */
export function appendEntries(log: ChangeEntry[] | undefined, entries: ChangeEntry[]): ChangeEntry[] {
  const all = [...(log ?? [])];
  for (const e of entries) {
    const m = e.action === 'changed' ? FIELD_CHANGE.exec(e.detail) : null;
    let entry: ChangeEntry | null = e;
    if (m) {
      for (let i = all.length - 1; i >= 0 && e.at - all[i].at <= MERGE_WINDOW; i--) {
        const o = all[i];
        if (o.action !== 'changed' || o.kind !== e.kind) continue;
        const om = FIELD_CHANGE.exec(o.detail);
        // Same field, continuing from where the last change left it (a rename changes the target too).
        if (!om || om[1] !== m[1] || om[3] !== m[2] || (o.target !== e.target && m[1] !== 'Name')) continue;
        all.splice(i, 1);
        entry = om[2] === m[3] ? null : { ...e, detail: `${m[1]}: ${om[2]} → ${m[3]}`, target: m[1] === 'Name' ? o.target : e.target };
        break;
      }
    }
    if (entry) all.push(entry);
  }
  return all.length > CHANGE_LOG_LIMIT ? all.slice(all.length - CHANGE_LOG_LIMIT) : all;
}

const KIND_LABEL: Record<ChangeKind, string> = { device: 'Device', port: 'Port', cable: 'Cable', rack: 'Rack', vlan: 'IP plan', page: 'Page', note: 'Note' };
export const changeKindLabel = (k: ChangeKind) => KIND_LABEL[k];
export const CHANGE_KINDS = Object.keys(KIND_LABEL) as ChangeKind[];

/** "2026-11-24 13:05" in local time. */
export function changeTime(at: number) {
  const d = new Date(at);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** CSV of the given entries, oldest first. */
export function changeLogCsv(entries: ChangeEntry[]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [['When', 'Kind', 'What', 'Change'], ...[...entries].sort((x, y) => x.at - y.at).map((e) => [changeTime(e.at), changeKindLabel(e.kind), e.target, e.detail])]
    .map((r) => r.map(q).join(',')).join('\r\n');
}

/** Only well-formed entries (for files opened from disk). */
export function cleanChangeLog(v: unknown): ChangeEntry[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ok = v.filter((e): e is ChangeEntry => !!e && typeof e === 'object'
    && typeof (e as ChangeEntry).at === 'number' && Number.isFinite((e as ChangeEntry).at)
    && CHANGE_KINDS.includes((e as ChangeEntry).kind)
    && ['added', 'removed', 'changed', 'note'].includes((e as ChangeEntry).action)
    && typeof (e as ChangeEntry).target === 'string' && typeof (e as ChangeEntry).detail === 'string');
  return ok.length ? ok.slice(-CHANGE_LOG_LIMIT) : undefined;
}
