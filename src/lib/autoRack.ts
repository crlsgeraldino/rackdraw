import { RACK_SIZES } from './rack';
import type { DeviceNode, Rack, RackItem, StencilDef } from './types';

/*
 * "Build rack from diagram": mounts a page's rack-mountable equipment in a new rack, laid out the way a tech would:
 *   firewall / router at the top,
 *   then each patch panel above the switch it is patched to, with a cable manager between them (short, tidy cords),
 *   remaining switches, a blanking panel,
 *   servers and storage,
 *   UPS at the bottom, a PDU on the rear above it.
 * The diagram's cables then show as patch cords in the rack.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

type Role = 'edge' | 'panel' | 'switch' | 'server' | 'storage' | 'ups' | 'other';

/** Built-in stencils whose role is known exactly. */
const BUILT_IN_ROLE: [RegExp, Role][] = [
  [/^patch-panel/, 'panel'],
  [/^ups$/, 'ups'],
  [/^(sonicwall|firewall|router|sdwan|vpn-concentrator|wan-optimizer|csu-dsu|metro-ntu)/, 'edge'],
  [/^switch-/, 'switch'],
  [/^(nas|san|tape-library)$/, 'storage'],
  [/^(server|nvr)$/, 'server'],
];

/** From words: whole words only ("Knowledge base server" is not an edge device, "Ledger DB host" is a host). */
function roleFromText(text: string): Role | undefined {
  if (/\bpatch[\s-]*panel\b|\bkeystone\b|\bfiber panel\b/.test(text)) return 'panel';
  if (/\bups\b|\bbattery backup\b/.test(text)) return 'ups';
  if (/\b(firewall|router|gateway|sonicwall|fortigate|utm|sd-?wan|vpn|ntu|demarc|csu)\b|\bwan optimi/.test(text)) return 'edge';
  if (/\bkvm\b|\bpdu\b|\bconsole server\b/.test(text)) return 'other';
  if (/\bswitch(es)?\b/.test(text)) return 'switch';
  if (/\b(nas|san|storage|backup)\b/.test(text)) return 'storage';
  if (/\b(server|host|hypervisor|nvr)\b/.test(text)) return 'server';
  return undefined;
}

export function rackRole(d: DeviceNode, st?: StencilDef): Role {
  if (st && !st.custom) {
    const hit = BUILT_IN_ROLE.find(([re]) => re.test(st.id));
    if (hit) return hit[1];
    if (st.category === 'Firewalls') return 'edge';
    return 'other';
  }
  // Imported stencils: what the stencil says it is first, then the device's own model and name.
  return roleFromText(`${st?.name ?? ''} ${st?.defaults?.model ?? ''}`.toLowerCase())
    ?? roleFromText(`${d.data.model ?? ''} ${d.data.name}`.toLowerCase())
    ?? 'other';
}

/** Rack units a device takes: its stencil's, else none (not rack equipment). */
export function rackUnitsOf(st?: StencilDef) {
  return st?.rackUnits && st.rackUnits > 0 ? st.rackUnits : 0;
}

/**
 * Plans a rack for `devices` (rack-mountable ones are used, others ignored). `cables` (node pairs) decide which
 * switch each patch panel sits above. Returns the rack (not yet added) and how many devices it holds.
 */
export function planRack(name: string, devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined, cables: { a: string; b: string }[], options: { spare?: number } = {}): { rack: Rack; mounted: number } {
  const gear = devices
    .map((d) => ({ d, st: stencil(d.data.stencilId) }))
    .map((x) => ({ ...x, units: rackUnitsOf(x.st), role: rackRole(x.d, x.st) }))
    .filter((x) => x.units > 0);
  const by = (r: Role) => gear.filter((g) => g.role === r);
  const linked = (a: string, b: string) => cables.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)).length;

  // Top to bottom: what goes in, in order (null = a cable manager / blanking panel).
  type Slot = { g?: (typeof gear)[number]; acc?: 'cable-manager' | 'blank' };
  const top: Slot[] = [];
  for (const g of by('edge')) top.push({ g });
  const panels = by('panel');
  const switches = by('switch');
  // Pair each panel with the switch it is patched to most (strongest pairs first), so an IDF's copper panels sit
  // right above their own switches and a fiber panel that only carries uplinks goes to the top.
  const pairs = panels.flatMap((p) => switches.map((s) => ({ p, s, n: linked(p.d.id, s.d.id) }))).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const partner = new Map<string, (typeof gear)[number]>();
  const placedSw = new Set<string>();
  for (const x of pairs) {
    if (partner.has(x.p.d.id) || placedSw.has(x.s.d.id)) continue;
    partner.set(x.p.d.id, x.s);
    placedSw.add(x.s.d.id);
  }
  for (const p of panels) if (!partner.has(p.d.id)) top.push({ g: p });
  for (const p of panels) {
    const sw = partner.get(p.d.id);
    if (sw) top.push({ g: p }, { acc: 'cable-manager' }, { g: sw });
  }
  for (const s of switches) if (!placedSw.has(s.d.id)) top.push({ g: s }, { acc: 'cable-manager' });
  if (top.length && top[top.length - 1].acc) top.pop();
  const middle = [...by('server'), ...by('storage'), ...by('other')];
  const bottom = by('ups');

  const used = [...top, ...middle.map((g) => ({ g })), ...bottom.map((g) => ({ g }))].reduce((n, s) => n + (s.g ? s.g.units : 1), 0);
  const need = used + (middle.length ? 1 : 0) + (options.spare ?? 4);
  const units = RACK_SIZES.find((u) => u >= need) ?? Math.max(need, RACK_SIZES[RACK_SIZES.length - 1]);

  const items: RackItem[] = [];
  const add = (it: Omit<RackItem, 'id'>) => items.push({ ...it, id: `ri-${uid()}` });
  // From the top down.
  let u = units;
  for (const s of top) {
    const h = s.g ? s.g.units : 1;
    u -= h;
    if (s.g) add({ kind: 'device', nodeId: s.g.d.id, u: u + 1, height: h, depth: 'full' });
    else add({ kind: s.acc!, label: s.acc === 'cable-manager' ? 'Cable manager' : 'Blanking panel', u: u + 1, height: 1, depth: s.acc === 'cable-manager' ? 'full' : 'front' });
  }
  if (middle.length && top.length) { u -= 1; add({ kind: 'blank', label: 'Blanking panel', u: u + 1, height: 1, depth: 'front' }); }
  for (const g of middle) { u -= g.units; add({ kind: 'device', nodeId: g.d.id, u: u + 1, height: g.units, depth: 'full' }); }
  // From the bottom up: UPS, then a rear PDU above it.
  let b = 1;
  for (const g of bottom) { add({ kind: 'device', nodeId: g.d.id, u: b, height: g.units, depth: 'full' }); b += g.units; }
  if (b <= u) add({ kind: 'pdu', label: 'PDU', u: b, height: 1, depth: 'rear' });

  return { rack: { id: `r-${uid()}`, name, units, items }, mounted: gear.length };
}

/**
 * Plans one rack per room for medium and large networks: devices are grouped by their Location (MDF, IDF-1,
 * Building B…), each group gets its own rack named after it. Devices without a location share a rack named
 * `fallbackName`. Returns the racks (not yet added) and how many devices they hold.
 */
/** Tallest rack the planner uses. */
export const MAX_RACK_U = 48;

/**
 * planRack, split over several racks when one would be taller than MAX_RACK_U: network gear (edge, panels, switches)
 * in one rack and the rest in others, then halves until each fits.
 */
export function planRackSplit(name: string, devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined, cables: { a: string; b: string }[], options: { spare?: number } = {}): { racks: Rack[]; mounted: number } {
  const one = planRack(name, devices, stencil, cables, options);
  const mountable = devices.filter((d) => rackUnitsOf(stencil(d.data.stencilId)) > 0);
  if (one.rack.units <= MAX_RACK_U || mountable.length < 2) return { racks: [one.rack], mounted: one.mounted };
  const net = new Set<Role>(['edge', 'panel', 'switch']);
  let a = mountable.filter((d) => net.has(rackRole(d, stencil(d.data.stencilId))));
  let b = mountable.filter((d) => !a.includes(d));
  if (!a.length || !b.length) {
    const half = Math.ceil(mountable.length / 2);
    a = mountable.slice(0, half);
    b = mountable.slice(half);
  }
  const first = planRackSplit(`${name} 1`, a, stencil, cables, options);
  const second = planRackSplit(`${name} 2`, b, stencil, cables, options);
  return { racks: [...first.racks, ...second.racks], mounted: first.mounted + second.mounted };
}

export function planRacks(fallbackName: string, devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined, cables: { a: string; b: string }[], options: { spare?: number } = {}): { racks: Rack[]; mounted: number } {
  const groups = new Map<string, DeviceNode[]>();
  for (const d of devices) {
    if (!rackUnitsOf(stencil(d.data.stencilId))) continue;
    const where = (d.data.location ?? '').trim();
    groups.set(where, [...(groups.get(where) ?? []), d]);
  }
  const racks: Rack[] = [];
  let mounted = 0;
  for (const [where, list] of groups) {
    const { racks: built, mounted: n } = planRackSplit(where ? `${where} rack` : fallbackName, list, stencil, cables, options);
    if (!n) continue;
    for (const rack of built) {
      if (where) rack.location = where;
      racks.push(rack);
    }
    mounted += n;
  }
  return { racks, mounted };
}
