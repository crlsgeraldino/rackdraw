/**
 * Bill of materials: what to order for a client's network, counted from its diagrams and racks — equipment by model,
 * cable runs and patch cords by type and length, transceivers for fiber / copper SFP ports, wall-end terminations,
 * racks and rack accessories, and the circuits and services the sites need. Plus port capacity per switch.
 */
import { allDevices } from './project';
import { isPassThrough } from './trace';
import type { CableData, CableEdge, DeviceNode, PortDef, Project, StencilDef } from './types';

type Stencils = (id: string) => StencilDef | undefined;

export interface BomRow {
  /** Identifies the item in the price book (same item, same price, in every client). */
  key: string;
  item: string;
  detail: string;
  qty: number;
  unit: string;
}
export interface BomSection {
  title: string;
  rows: BomRow[];
}
export interface CapacityRow {
  device: string;
  model: string;
  ports: number;
  used: number;
  free: number;
  poePorts: number;
  poeW: number;
  poeBudgetW: number;
  warning: string;
}

/** Things drawn on diagrams that aren't bought as equipment: they are circuits, services or places. */
const SERVICES: Record<string, string> = {
  internet: 'Internet circuit',
  'mpls-cloud': 'MPLS / private WAN service',
  'carrier-cloud': 'Metro Ethernet service',
  'cloud-service': 'Cloud subscription (IaaS / SaaS)',
};
const NOT_EQUIPMENT = new Set(['building', 'remote-user', ...Object.keys(SERVICES)]);

/** Links that are not a cable you buy. */
const AIR: Record<string, string> = {
  Wireless: 'Wireless links (no cable)',
  Bluetooth: 'Bluetooth pairings (no cable)',
  Cellular: 'Cellular data plan',
  Microwave: 'Microwave path (licensed / unlicensed)',
  Satellite: 'Satellite service',
  VPN: 'VPN tunnels',
  MPLS: 'MPLS circuits',
};
const COPPER = new Set(['Cat6', 'Cat6a', 'Cat5e']);
const FIBER = new Set(['Fiber', 'Fiber SM', 'Fiber MM']);
const FIBER_NAME: Record<string, string> = { Fiber: 'Fiber cable', 'Fiber SM': 'Single-mode fiber (OS2)', 'Fiber MM': 'Multimode fiber (OM3 / OM4)' };

/** Typical PoE budgets of the built-in PoE switches (W). */
const POE_BUDGET: Record<string, number> = { 'switch-16-poe': 240, 'switch-24-poe': 370, 'switch-48-poe': 740 };
const POE_WATTS: Record<string, number> = { PoE: 15.4, 'PoE+': 30, 'PoE++': 60, 'PoE++ 90W': 90 };

/** "85 ft", "3 m", "1.5m", "10'" → feet (undefined when not a length). */
export function lengthFt(s?: string): number | undefined {
  const m = (s ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|m|meters?|metres?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return /^(ft|feet|foot|')$/i.test(m[2]) ? n : n * 3.28084;
}
const fmtFt = (ft: number) => `${Math.round(ft).toLocaleString()} ft (${Math.round(ft / 3.28084).toLocaleString()} m)`;

/** Runs longer than this are permanent cabling (bulk cable); shorter ones are patch cords. */
const CORD_MAX_FT = 25;

/** What the labor estimate counts (Bill of Materials → Labor & quote). */
export interface WorkCounts {
  copperRuns: number;
  fiberRuns: number;
  rackDevices: number;
  endpoints: number;
  racks: number;
  cords: number;
}

export function billOfMaterials(p: Project, stencil: Stencils): { sections: BomSection[]; capacity: CapacityRow[]; work: WorkCounts } {
  const devices = allDevices(p);
  const byId = new Map(devices.map((d) => [d.id, d] as const));
  const edges: CableEdge[] = p.pages.flatMap((pg) => pg.edges).filter((e) => byId.has(e.source) && byId.has(e.target));
  const st = (d?: DeviceNode) => (d ? stencil(d.data.stencilId) : undefined);
  const portOf = (d: DeviceNode | undefined, id?: string | null): PortDef | undefined => (d && id ? st(d)?.ports.find((x) => x.id === id) : undefined);
  const count = <K,>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

  /* Equipment, by type and model. */
  const equip = new Map<string, { key: string; item: string; detail: string; qty: number }>();
  const work: WorkCounts = { copperRuns: 0, fiberRuns: 0, rackDevices: 0, endpoints: 0, racks: (p.racks ?? []).length, cords: 0 };
  const services = new Map<string, number>();
  for (const d of devices) {
    const s = st(d);
    const sid = d.data.stencilId;
    if (SERVICES[sid]) { count(services, SERVICES[sid]); continue; }
    if (NOT_EQUIPMENT.has(sid)) continue;
    const item = s?.name ?? sid;
    const model = d.data.model?.trim() || s?.defaults?.model || '';
    const units = s?.rackUnits ? `${s.rackUnits}U` : '';
    const k = `${item}|${model}`;
    const row = equip.get(k) ?? { key: `eq|${k}`, item, detail: [model, units].filter(Boolean).join(' · '), qty: 0 };
    row.qty++;
    if (s?.rackUnits) work.rackDevices++;
    else if (s?.category !== 'Cabling' && !isPassThrough(d, s)) work.endpoints++;
    equip.set(k, row);
  }

  /* Cables: permanent runs (bulk length), patch cords by length, and the rest. */
  const bulkFt = new Map<string, number>();
  const runs = new Map<string, number>();
  const cords = new Map<string, number>();
  const unknown = new Map<string, number>();
  const air = new Map<string, number>();
  const transceivers = new Map<string, number>();
  let wallEnds = 0;
  let lcEnds = 0;
  const cordName = (t: string) =>
    t === 'DAC' ? 'DAC cable (direct-attach)' : FIBER.has(t) ? `${t === 'Fiber' ? 'Fiber' : FIBER_NAME[t]} patch cord, LC–LC` : COPPER.has(t) ? `${t} patch cord` : `${t} cable`;

  const speedOf = (d: DeviceNode, port: PortDef) => {
    const set = d.data.ports?.[port.id]?.speed;
    if (set) return set;
    if (/^Q/.test(port.id)) return '100G';
    if (/^X\d/.test(port.id) || /SFP\+|SFP28/i.test(st(d)?.name ?? '')) return '10G';
    return '1G';
  };
  const form = (speed: string) => {
    const g = parseFloat(speed) * (/M$/i.test(speed) ? 0.001 : 1);
    return g >= 40 ? 'QSFP28' : g >= 25 ? 'SFP28' : g >= 10 ? 'SFP+' : 'SFP';
  };

  for (const e of edges) {
    const data = (e.data ?? {}) as CableData;
    const t = data.cable ?? 'Cat6';
    if (AIR[t] || t === 'Line') {
      if (AIR[t]) count(air, AIR[t]);
      continue;
    }
    const ft = lengthFt(data.length);
    if (ft === undefined) count(unknown, FIBER.has(t) ? FIBER_NAME[t] : `${t} cable`);
    else if (ft > CORD_MAX_FT && t !== 'DAC') {
      const name = FIBER.has(t) ? FIBER_NAME[t] : COPPER.has(t) ? `${t} cable (bulk, plenum / riser)` : `${t} cable`;
      count(bulkFt, name, ft);
      count(runs, name);
      if (FIBER.has(t)) work.fiberRuns++;
      else if (COPPER.has(t)) work.copperRuns++;
    } else {
      count(cords, `${cordName(t)}|${Math.round(ft * 10) / 10} ft`);
      work.cords++;
    }

    // Each end on an active SFP port needs a module (DAC cables have theirs built in).
    for (const [nid, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
      const d = byId.get(nid);
      const port = portOf(d, h);
      if (!d || !port || port.kind !== 'sfp' || t === 'DAC' || isPassThrough(d, st(d)) || d.data.stencilId === 'sfp-module') continue;
      const sp = speedOf(d, port);
      const f = form(sp);
      const name = t === 'Fiber SM' ? `${sp} ${f} LR transceiver (single-mode, LC)`
        : FIBER.has(t) ? `${sp} ${f} SR transceiver (multimode, LC)`
        : COPPER.has(t) ? `${sp} ${f} copper module (RJ45)`
        : `${sp} ${f} module for ${t}`;
      count(transceivers, name);
    }
    // Terminations for permanent runs: the wall end of a copper run from a patch panel, fiber ends on fiber panels.
    if (ft !== undefined && ft > CORD_MAX_FT) {
      const a = byId.get(e.source), b = byId.get(e.target);
      const pa = isPassThrough(a, st(a)), pb = isPassThrough(b, st(b));
      if (COPPER.has(t) && pa !== pb) {
        const far = pa ? b : a;
        if (far && far.data.stencilId !== 'wall-jack') wallEnds++;
      }
      if (FIBER.has(t)) lcEnds += [a, b].filter((x) => x && st(x)?.id.startsWith('patch-panel-fiber')).length;
    }
  }

  /* Racks and accessories. */
  const racks = new Map<string, number>();
  const accessories = new Map<string, number>();
  const ACC: Record<string, string> = { 'cable-manager': 'Horizontal cable manager', blank: 'Blanking panel', shelf: 'Rack shelf', pdu: 'Rack PDU', other: 'Other rack item' };
  for (const r of p.racks ?? []) {
    count(racks, `${r.units}U rack / cabinet`);
    for (const it of r.items) if (it.kind !== 'device') count(accessories, `${ACC[it.kind] ?? it.kind} ${it.height}U`);
    count(accessories, 'Cage nuts and screws (pack of 50)', Math.max(1, Math.ceil(r.items.length * 4 / 50)));
  }

  const sections: BomSection[] = [
    { title: 'Equipment', rows: [...equip.values()].sort((a, b) => a.item.localeCompare(b.item)).map((r) => ({ ...r, unit: 'each' })) },
    {
      title: 'Cabling',
      rows: [
        ...[...bulkFt].map(([name, ft]) => ({
          key: `bulk|${name}`,
          item: name,
          detail: `${runs.get(name)} run${runs.get(name) === 1 ? '' : 's'}, ${fmtFt(ft)} + 10% slack${COPPER.has(name.split(' ')[0]) ? ` ≈ ${Math.ceil((ft * 1.1) / 1000)} × 1000 ft box` : ''}`,
          qty: Math.ceil(ft * 1.1), unit: 'ft',
        })),
        ...[...cords].sort().map(([k, n]) => { const [item, len] = k.split('|'); return { key: `cord|${k}`, item, detail: len, qty: n, unit: 'each' }; }),
        ...[...unknown].map(([item, n]) => ({ key: `cable|${item}`, item, detail: 'length not set on the diagram', qty: n, unit: 'each' })),
      ],
    },
    { title: 'Transceivers', rows: [...transceivers].sort().map(([item, n]) => ({ key: `xcvr|${item}`, item, detail: 'one per active SFP port with a fiber / copper link', qty: n, unit: 'each' })) },
    {
      title: 'Terminations',
      rows: [
        ...(wallEnds ? [{ key: 'term|keystone', item: 'Cat6 keystone jack + faceplate', detail: 'wall end of each horizontal run from a patch panel', qty: wallEnds, unit: 'each' }] : []),
        ...(lcEnds ? [{ key: 'term|lc', item: 'LC duplex connector / pigtail (splice)', detail: 'each backbone fiber end on a fiber panel', qty: lcEnds, unit: 'each' }] : []),
      ],
    },
    { title: 'Racks & accessories', rows: [...racks, ...accessories].map(([item, n]) => ({ key: `rack|${item}`, item, detail: '', qty: n, unit: 'each' })) },
    { title: 'Circuits & services', rows: [...services, ...air].map(([item, n]) => ({ key: `svc|${item}`, item, detail: 'monthly', qty: n, unit: 'each' })) },
  ].filter((s) => s.rows.length);

  /* Port capacity of switches, firewalls and panels. */
  const used = new Map<string, Set<string>>();
  for (const e of edges) for (const [nid, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) if (h) used.set(nid, (used.get(nid) ?? new Set()).add(h));
  const capacity: CapacityRow[] = devices
    .filter((d) => {
      const s = st(d);
      if (!s) return false;
      return (s.style !== 'icon' && (s.category === 'Switching' || s.category === 'Firewalls')) || ['firewall', 'router', 'sdwan'].includes(s.id);
    })
    .map((d) => {
      const s = st(d)!;
      const ports = s.ports.filter((x) => x.kind === 'rj45' || x.kind === 'sfp');
      const u = used.get(d.id) ?? new Set();
      const n = ports.filter((x) => u.has(x.id)).length;
      const poe = Object.entries(d.data.ports ?? {}).filter(([id, pd]) => pd.poe && u.has(id));
      const poeW = Math.round(poe.reduce((w, [, pd]) => w + (POE_WATTS[pd.poe!] ?? 15.4), 0));
      const budget = POE_BUDGET[s.id] ?? 0;
      const warn = [
        n / Math.max(1, ports.length) >= 0.8 ? `${Math.round((n / ports.length) * 100)}% of ports used` : '',
        budget && poeW > budget ? `PoE over budget (${poeW} of ${budget} W)` : budget && poeW > budget * 0.8 ? 'PoE above 80% of budget' : '',
      ].filter(Boolean).join('; ');
      return { device: d.data.name, model: d.data.model ?? s.defaults?.model ?? s.name, ports: ports.length, used: n, free: ports.length - n, poePorts: poe.length, poeW, poeBudgetW: budget, warning: warn };
    })
    .sort((a, b) => a.device.localeCompare(b.device));
  return { sections, capacity, work };
}

/** The bill of materials as rows for a sheet / CSV: Section, Item, Detail, Qty, Unit. */
export function bomRows(sections: BomSection[]): (string | number)[][] {
  return sections.flatMap((s) => s.rows.map((r) => [s.title, r.item, r.detail, r.qty, r.unit]));
}
