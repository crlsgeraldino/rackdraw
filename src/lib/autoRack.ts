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

export function rackRole(d: DeviceNode, st?: StencilDef): Role {
  const text = `${st?.id ?? ''} ${st?.name ?? ''} ${st?.category ?? ''} ${d.data.model ?? ''} ${d.data.name}`.toLowerCase();
  if (/patch[\s-]*panel|keystone|fiber panel/.test(text)) return 'panel';
  if (/\bups\b|battery backup/.test(text)) return 'ups';
  if (/firewall|router|gateway|sonicwall|fortigate|utm|sd-?wan|edge|vpn|\bntu\b|demarc|csu|wan optimi/.test(text)) return 'edge';
  if (/switch/.test(text)) return 'switch';
  if (/\bnas\b|\bsan\b|storage|backup/.test(text)) return 'storage';
  if (/server|host|hypervisor|nvr/.test(text)) return 'server';
  return 'other';
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
    const { rack, mounted: n } = planRack(where ? `${where} rack` : fallbackName, list, stencil, cables, options);
    if (!n) continue;
    if (where) rack.location = where;
    racks.push(rack);
    mounted += n;
  }
  return { racks, mounted };
}
