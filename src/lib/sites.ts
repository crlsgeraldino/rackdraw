import { vlanOfIp } from './ipam';
import { warrantyState } from './lifecycle';
import { portMap } from './portMap';
import { rackPower } from './rackPower';
import { isPassThrough } from './trace';
import type { DeviceNode, Project, Rack, StencilDef } from './types';

/*
 * Sites: a client's network seen place by place (HQ, Branch 2, the warehouse, Building C…). A device's site is its
 * Location, else the location of the rack it is mounted in, else the site of what it is cabled to — "No location"
 * when none is known. Per site: equipment by kind, racks, switch ports, PoE, rack power, circuits and their monthly cost,
 * warranties; and the links between sites (backbone fiber, WAN).
 */

type Stencils = (id: string) => StencilDef | undefined;

export const NO_SITE = 'No location';

export type EquipmentGroup = 'network' | 'servers' | 'endpoints' | 'security' | 'other';
export const GROUP_LABEL: Record<EquipmentGroup, string> = { network: 'Network', servers: 'Servers & storage', endpoints: 'End devices', security: 'Security & building', other: 'Other' };

function groupOf(st?: StencilDef): EquipmentGroup {
  switch (st?.category) {
    case 'Firewalls': case 'Switching': case 'Wireless': case 'WAN': case 'Carrier': case 'Cabling': return 'network';
    case 'Servers': return 'servers';
    case 'Endpoints': case 'Personal': return 'endpoints';
    case 'Security': case 'Infrastructure': return 'security';
    default: return 'other';
  }
}

export interface SiteSummary {
  site: string;
  devices: number;
  groups: Record<EquipmentGroup, number>;
  racks: string[];
  /** Switch ports (patch panels not counted). */
  ports: { total: number; used: number; free: number; poe: number };
  powerW: number;
  circuits: { name: string; bandwidth: string; monthly?: number }[];
  monthlyCost: number;
  warranty: { expired: number; soon: number };
  /** Different subnets / VLANs its devices' IPs are in. */
  vlans: string[];
}

export interface SiteLink {
  a: string;
  b: string;
  cables: number;
  /** "Fiber SM ×2, Cat6" */
  types: string;
}

const siteName = (s?: string) => s?.trim() || '';

/** Each device's site (by id). */
export function deviceSites(p: Project): Map<string, string> {
  const rackOf = new Map<string, Rack>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) rackOf.set(it.nodeId, r);
  const out = new Map<string, string>();
  for (const pg of p.pages) for (const n of pg.nodes) {
    if (n.type !== 'device') continue;
    out.set(n.id, siteName(n.data.location) || siteName(rackOf.get(n.id)?.location) || NO_SITE);
  }
  // No location of its own: the site it is cabled to (a PC is served from its IDF; an ISP line ends at the MDF).
  // Nearest known site by number of cables, spreading out from every located device at once.
  const next = new Map<string, string[]>();
  for (const pg of p.pages) for (const e of pg.edges) {
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
    next.set(e.target, [...(next.get(e.target) ?? []), e.source]);
  }
  let frontier = [...out].filter(([, s]) => s !== NO_SITE).map(([id]) => id);
  while (frontier.length) {
    const grown: string[] = [];
    for (const id of frontier) {
      for (const n of next.get(id) ?? []) {
        if (out.get(n) === NO_SITE) { out.set(n, out.get(id)!); grown.push(n); }
      }
    }
    frontier = grown;
  }
  return out;
}

/** One summary per site (sites with more equipment first; "No location" last), and the links between sites. */
export function siteSummaries(p: Project, stencil: Stencils, today = new Date()): { sites: SiteSummary[]; links: SiteLink[] } {
  const sites = deviceSites(p);
  const devices = p.pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device');
  const by = new Map<string, SiteSummary>();
  const get = (site: string) => {
    let s = by.get(site);
    if (!s) {
      s = { site, devices: 0, groups: { network: 0, servers: 0, endpoints: 0, security: 0, other: 0 }, racks: [], ports: { total: 0, used: 0, free: 0, poe: 0 }, powerW: 0, circuits: [], monthlyCost: 0, warranty: { expired: 0, soon: 0 }, vlans: [] };
      by.set(site, s);
    }
    return s;
  };

  const vlanSets = new Map<string, Set<string>>();
  for (const d of devices) {
    const site = sites.get(d.id)!;
    const s = get(site);
    const st = stencil(d.data.stencilId);
    s.devices++;
    s.groups[groupOf(st)]++;
    // Switch ports: active network gear only (a patch panel's ports are the same links again).
    if (st?.category === 'Switching' && !isPassThrough(d, st) && st.ports.filter((q) => q.kind === 'rj45' || q.kind === 'sfp').length >= 4) {
      const m = portMap(p, d.id, stencil);
      if (m) { s.ports.total += m.total; s.ports.used += m.used; s.ports.free += m.free; s.ports.poe += m.poe; }
    }
    const c = d.data.circuit;
    if (c && (c.carrier || c.circuitId || c.bandwidth || c.monthlyCost)) {
      s.circuits.push({ name: [c.carrier, c.kind].filter(Boolean).join(' ') || d.data.name, bandwidth: c.bandwidth ?? '', monthly: c.monthlyCost });
      s.monthlyCost += c.monthlyCost ?? 0;
    }
    const w = warrantyState(d.data, today);
    if (w === 'expired') s.warranty.expired++;
    else if (w === 'soon') s.warranty.soon++;
    const vlan = vlanOfIp(d.data.ip, p.vlans ?? []);
    if (vlan) {
      const set = vlanSets.get(site) ?? new Set<string>();
      set.add(vlan.vlan ? `VLAN ${vlan.vlan}` : vlan.name);
      vlanSets.set(site, set);
    }
  }
  for (const [site, set] of vlanSets) get(site).vlans = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Racks: at the site of their location, else the site most of their equipment is at.
  for (const r of p.racks ?? []) {
    let site = siteName(r.location);
    if (!site) {
      const count = new Map<string, number>();
      for (const it of r.items) if (it.nodeId && sites.has(it.nodeId)) count.set(sites.get(it.nodeId)!, (count.get(sites.get(it.nodeId)!) ?? 0) + 1);
      site = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NO_SITE;
    }
    const s = get(site);
    s.racks.push(r.name);
    s.powerW += rackPower(p, r, stencil).totalW;
  }

  // Links: cables whose two ends are at different (known) sites.
  const links = new Map<string, { a: string; b: string; types: Map<string, number> }>();
  for (const pg of p.pages) for (const e of pg.edges) {
    const a = sites.get(e.source), b = sites.get(e.target);
    if (!a || !b || a === b || a === NO_SITE || b === NO_SITE) continue;
    const [x, y] = [a, b].sort((m, n) => m.localeCompare(n));
    const k = `${x}\n${y}`;
    const l = links.get(k) ?? { a: x, b: y, types: new Map<string, number>() };
    const t = e.data?.cable ?? 'Cat6';
    l.types.set(t, (l.types.get(t) ?? 0) + 1);
    links.set(k, l);
  }

  const list = [...by.values()].sort((a, b) => Number(a.site === NO_SITE) - Number(b.site === NO_SITE) || b.devices - a.devices || a.site.localeCompare(b.site));
  return {
    sites: list,
    links: [...links.values()].map((l) => ({
      a: l.a, b: l.b,
      cables: [...l.types.values()].reduce((n, x) => n + x, 0),
      types: [...l.types].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', '),
    })).sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
  };
}

export const SITE_TABLE = ['Site', 'Devices', 'Network', 'Servers', 'End devices', 'Racks', 'Ports used / free', 'PoE', 'Rack power', 'Circuits', 'Monthly', 'Warranty'];

/** The sites as table rows (dialog, CSV and reports). */
export function siteTableRows(sites: SiteSummary[]): string[][] {
  const money = (n: number) => (n ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '');
  return sites.map((s) => [
    s.site, String(s.devices), String(s.groups.network), String(s.groups.servers), String(s.groups.endpoints),
    s.racks.join(', '), s.ports.total ? `${s.ports.used} / ${s.ports.free}` : '', s.ports.poe ? String(s.ports.poe) : '',
    s.powerW ? `${Math.round(s.powerW).toLocaleString('en-US')} W` : '',
    s.circuits.map((c) => [c.name, c.bandwidth].filter(Boolean).join(' ')).join('; '), money(s.monthlyCost),
    [s.warranty.expired && `${s.warranty.expired} expired`, s.warranty.soon && `${s.warranty.soon} ending`].filter(Boolean).join(', '),
  ]);
}
