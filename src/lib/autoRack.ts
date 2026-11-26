import { findFreeU, fits, RACK_SIZES } from './rack';
import { INNER_PX, placeOnShelf, SHELF_GAP, SHELF_PAD, shelfWidth, U_PX } from './rackShelf';
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

/**
 * Rack units a device takes: its stencil's; for an imported shape that doesn't say (a picture of a faceplate, or a
 * vendor stencil drawn at another scale), worked out from its shape: a wide, flat faceplate is rack equipment, 19 in
 * wide. Otherwise none (not rack equipment).
 */
export function rackUnitsOf(st?: StencilDef) {
  if (st?.rackUnits && st.rackUnits > 0) return st.rackUnits;
  return guessedUnits(st);
}

function guessedUnits(st?: StencilDef): number {
  if (!st?.custom || !(st.width > 0) || !(st.height > 0)) return 0;
  const ratio = st.width / st.height;
  const gear = roleFromText(`${st.name} ${st.defaults?.model ?? ''}`.toLowerCase());
  // Faceplates are at least 4:1 (a 10U chassis is 19 x 17.5 in, about 1:1, but those come with a size).
  // A tall picture (2.5:1 to 4:1) is a multi-unit chassis only for servers, storage and UPSs; a switch or firewall
  // that shape is a small desktop unit (on a shelf).
  if (ratio < 4 && !(ratio >= 2.5 && (gear === 'server' || gear === 'storage' || gear === 'ups'))) return 0;
  return Math.max(1, Math.min(10, Math.round(19 / ratio / 1.75)));
}

/** Built-in shapes of small equipment that isn't rack-mount but lives in the rack on a shelf. */
const SHELF_BUILT_IN = new Set(['modem', 'lte-router']);

/**
 * Small equipment, narrower than a 19 in faceplate: a desktop firewall or switch (the stencil says so), the ISP
 * modem, a picture narrower than a faceplate, or an imported switch / firewall / router shape without a rack size.
 * In a rack it stands on a shelf, or is mounted with a rack-mount kit (bracket) bought separately.
 */
export function isSmallGear(st?: StencilDef): boolean {
  if (!st) return false;
  if (st.desktop !== undefined) return st.desktop;
  if (!st.custom) return SHELF_BUILT_IN.has(st.id);
  if (!(st.width > 0) || !(st.height > 0)) return false;
  const units = rackUnitsOf(st);
  if (units) return st.style === 'image' && st.width / st.height < ((INNER_PX - 6) / (units * U_PX - 6)) * 0.7;
  const role = roleFromText(`${st.name} ${st.defaults?.model ?? ''}`.toLowerCase());
  return role === 'edge' || role === 'switch' || role === 'server' || role === 'storage';
}

/**
 * Small equipment that goes on a shelf by default: what has no rack-mount kit of its own (SonicWall TZs do). A shape
 * of your own with a rack height you chose (Edit shape → Rack height) is mounted, unless you said it's a desktop unit.
 */
export const isShelfDevice = (st?: StencilDef) =>
  isSmallGear(st) && !st?.rackKit && !(st?.custom && st.rackUnits && st.desktop === undefined);

/** The rack-mount kit a small device needs when it is mounted rather than on a shelf; undefined = none needed. */
export function rackKitFor(st: StencilDef | undefined, onShelf: boolean): string | undefined {
  if (onShelf || !isSmallGear(st)) return undefined;
  return st?.rackKit ?? `Rack mount kit (brackets) for ${st?.name ?? 'desktop unit'}`;
}

/** Whether Rack from Diagram puts a device in the rack: mounted (it has a rack size) or on a shelf. */
export const rackable = (st?: StencilDef) => isSmallGear(st) || rackUnitsOf(st) > 0;

/** The order equipment goes into a rack, top down. */
const ROLE_ORDER: Role[] = ['edge', 'panel', 'switch', 'server', 'storage', 'other', 'ups'];

/**
 * Mounts `devices` (rack-mountable ones) in an existing rack, in the planner's order, each in the highest free
 * space; the rack grows (up to MAX_RACK_U) when it is full. Returns the rack and what didn't fit.
 */
export function mountInto(rack: Rack, devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined): { rack: Rack; mounted: number; left: DeviceNode[] } {
  const gear = devices
    .map((d) => ({ d, st: stencil(d.data.stencilId) }))
    .map((x) => ({ ...x, units: rackUnitsOf(x.st) || 1, role: rackRole(x.d, x.st), shelf: isShelfDevice(x.st) }))
    .filter((x) => x.shelf || rackable(x.st))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  let r: Rack = { ...rack, items: [...rack.items] };
  const left: DeviceNode[] = [];
  let mounted = 0;
  const widthOf = (it: RackItem) => { const d = devices.find((x) => x.id === it.nodeId); return shelfWidth(d ? stencil(d.data.stencilId) : undefined, it.height); };
  for (const g of gear) {
    if (g.shelf) {
      let placed = placeOnShelf(r, g.d.id, shelfWidth(g.st, 1), widthOf);
      while (!placed && r.units < MAX_RACK_U) {
        r = { ...r, units: RACK_SIZES.find((n) => n > r.units) ?? MAX_RACK_U };
        placed = placeOnShelf(r, g.d.id, shelfWidth(g.st, 1), widthOf);
      }
      if (placed) { r = placed; mounted++; } else left.push(g.d);
      continue;
    }
    let u = g.role === 'ups' ? lowestFree(r, g.units) : findFreeU(r, g.units, 'full');
    while (u === null && r.units < MAX_RACK_U) {
      // Grow from the top: positions count from the bottom, so what is mounted stays put.
      r = { ...r, units: RACK_SIZES.find((n) => n > r.units) ?? MAX_RACK_U };
      u = findFreeU(r, g.units, 'full');
    }
    if (u === null) { left.push(g.d); continue; }
    r.items.push({ id: `ri-${uid()}`, kind: 'device', nodeId: g.d.id, u, height: g.units, depth: 'full' });
    mounted++;
  }
  return { rack: r, mounted, left };
}

function lowestFree(rack: Rack, height: number): number | null {
  for (let u = 1; u + height - 1 <= rack.units; u++) if (fits(rack, u, height, 'full')) return u;
  return null;
}

/** The devices Rack from Diagram mounts: those with a rack size (their stencil's, or worked out). */
export function mountableGear(devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined): DeviceNode[] {
  return devices.filter((d) => rackable(stencil(d.data.stencilId)));
}

/**
 * Devices on a page that look like rack equipment (a switch, firewall, server… by their stencil, model or name) but
 * have no rack size, so Rack from Diagram leaves them out: shown to the user so they can set Rack units.
 */
export function unsizedGear(devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined): DeviceNode[] {
  return devices.filter((d) => {
    const st = stencil(d.data.stencilId);
    if (rackable(st)) return false;
    if (st && !st.custom) return st.style !== 'icon' && (st.category === 'Switching' || st.category === 'Firewalls');
    return rackRole(d, st) !== 'other' && roleFromText(`${st?.name ?? ''} ${d.data.model ?? ''}`.toLowerCase()) !== undefined;
  });
}

/**
 * Plans a rack for `devices` (rack-mountable ones are used, others ignored). `cables` (node pairs) decide which
 * switch each patch panel sits above. Returns the rack (not yet added) and how many devices it holds.
 */
export function planRack(name: string, devices: DeviceNode[], stencil: (id: string) => StencilDef | undefined, cables: { a: string; b: string }[], options: { spare?: number } = {}): { rack: Rack; mounted: number } {
  const all = devices
    .map((d) => ({ d, st: stencil(d.data.stencilId) }))
    .map((x) => ({ ...x, units: rackUnitsOf(x.st) || (isSmallGear(x.st) ? 1 : 0), role: rackRole(x.d, x.st), shelf: isShelfDevice(x.st) }));
  const gear = all.filter((x) => !x.shelf && x.units > 0);
  const small = all.filter((x) => x.shelf);
  const by = (r: Role) => gear.filter((g) => g.role === r);
  const linked = (a: string, b: string) => cables.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)).length;

  // Top to bottom: what goes in, in order (null = a cable manager / blanking panel).
  type Slot = { g?: (typeof gear)[number]; acc?: 'cable-manager' | 'blank'; shelf?: { g: (typeof gear)[number]; x: number }[] };
  const top: Slot[] = [];
  // Small equipment (the ISP modem, a desktop firewall) on shelves at the top, side by side.
  let shelf: { g: (typeof gear)[number]; x: number }[] = [];
  let x = SHELF_PAD;
  for (const g of small) {
    const w = shelfWidth(g.st, 1);
    if (shelf.length && x + w > INNER_PX - SHELF_PAD) { top.push({ shelf }); shelf = []; x = SHELF_PAD; }
    shelf.push({ g, x });
    x += w + SHELF_GAP;
  }
  if (shelf.length) top.push({ shelf });
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
    else if (s.shelf) {
      const id = `ri-${uid()}`;
      items.push({ id, kind: 'shelf', label: 'Shelf', u: u + 1, height: 1, depth: 'full' });
      for (const o of s.shelf) add({ kind: 'device', nodeId: o.g.d.id, u: u + 1, height: 1, depth: 'full', shelf: { id, x: o.x } });
    } else add({ kind: s.acc!, label: s.acc === 'cable-manager' ? 'Cable manager' : 'Blanking panel', u: u + 1, height: 1, depth: s.acc === 'cable-manager' ? 'full' : 'front' });
  }
  if (middle.length && top.length) { u -= 1; add({ kind: 'blank', label: 'Blanking panel', u: u + 1, height: 1, depth: 'front' }); }
  for (const g of middle) { u -= g.units; add({ kind: 'device', nodeId: g.d.id, u: u + 1, height: g.units, depth: 'full' }); }
  // From the bottom up: UPS, then a rear PDU above it.
  let b = 1;
  for (const g of bottom) { add({ kind: 'device', nodeId: g.d.id, u: b, height: g.units, depth: 'full' }); b += g.units; }
  if (b <= u) add({ kind: 'pdu', label: 'PDU', u: b, height: 1, depth: 'rear' });

  return { rack: { id: `r-${uid()}`, name, units, items }, mounted: gear.length + small.length };
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
  const mountable = devices.filter((d) => rackable(stencil(d.data.stencilId)));
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
    if (!rackable(stencil(d.data.stencilId))) continue;
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
