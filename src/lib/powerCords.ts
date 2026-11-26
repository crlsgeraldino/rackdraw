/**
 * Power cords in a rack: each device's power supplies (inlets) plugged into an outlet of a PDU or a UPS, and a PDU's
 * input into a UPS. Kept with the rack (Rack.power), drawn on its back, counted in the bill of materials, and used
 * for the load on each PDU / UPS and the redundancy check (a device's two supplies on two different feeds).
 */
import { isUps, upsRating } from './rackPower';
import { isPassThrough } from './trace';
import type { DeviceNode, PowerCord, Rack, RackItem, StencilDef } from './types';

type Stencils = (id: string) => StencilDef | undefined;

export interface Inlet { id: string; label: string }
export interface PowerSource {
  itemId: string;
  label: string;
  kind: 'pdu' | 'ups';
  outlets: number;
}

/** Outlets on a PDU accessory unless set; on a UPS; on a switched PDU device. */
export const PDU_OUTLETS = 8;
export const UPS_OUTLETS = 6;
/** A 15 A / 120 V PDU's continuous rating (80%), used when the rack's circuit isn't set. */
export const PDU_DEFAULT_W = 1440;

/** Equipment that ships with two power supplies unless the device says otherwise. */
const DUAL_PSU = new Set(['server', 'san', 'switch-core-24sfp', 'tape-library', 'nvr']);

const isSwitchedPdu = (st?: StencilDef) => st?.id === 'pdu-network' || (!!st?.custom && /\bpdu\b/i.test(st.name));

/** Whether a rack item gives power: a PDU (accessory or switched PDU device) or a UPS. */
export function sourceOf(it: RackItem, d: DeviceNode | undefined, st: StencilDef | undefined): PowerSource | null {
  if (it.kind === 'pdu') return { itemId: it.id, label: `${it.label || 'PDU'} (U${it.u})`, kind: 'pdu', outlets: it.outlets ?? PDU_OUTLETS };
  if (it.kind !== 'device' || !d) return null;
  if (isUps(d, st)) return { itemId: it.id, label: d.data.name, kind: 'ups', outlets: it.outlets ?? UPS_OUTLETS };
  if (isSwitchedPdu(st)) return { itemId: it.id, label: d.data.name, kind: 'pdu', outlets: it.outlets ?? PDU_OUTLETS };
  return null;
}

/** A rack item's power inlets: a PDU's input, a device's power supplies (none for a UPS, patch panels, shelves). */
export function inletsOf(it: RackItem, d: DeviceNode | undefined, st: StencilDef | undefined): Inlet[] {
  if (it.kind === 'pdu') return [{ id: 'IN', label: 'Input' }];
  if (it.kind !== 'device' || !d) return [];
  if (isUps(d, st)) return []; // plugged into the wall
  if (isSwitchedPdu(st)) return [{ id: 'IN', label: 'Input' }];
  if (isPassThrough(d, st)) return [];
  const own = (st?.ports ?? []).filter((p) => p.kind === 'power');
  if (own.length) return own.map((p) => ({ id: p.id, label: p.label || p.id }));
  const n = d.data.psus ?? (st && !st.custom && DUAL_PSU.has(st.id) ? 2 : 1);
  return n >= 2 ? [{ id: 'PSU1', label: 'PSU 1' }, { id: 'PSU2', label: 'PSU 2' }] : [{ id: 'PSU', label: 'Power' }];
}

/** The rack's items with their device and stencil. */
function rackParts(rack: Rack, devices: Map<string, DeviceNode>, stencil: Stencils) {
  return rack.items.map((it) => {
    const d = it.nodeId ? devices.get(it.nodeId) : undefined;
    const st = d ? stencil(d.data.stencilId) : undefined;
    return { it, d, st, source: sourceOf(it, d, st), inlets: inletsOf(it, d, st) };
  });
}

export const powerSources = (rack: Rack, devices: Map<string, DeviceNode>, stencil: Stencils) =>
  rackParts(rack, devices, stencil).map((x) => x.source).filter((s): s is PowerSource => !!s).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pdu' ? -1 : 1));

/** The cords that still make sense (both ends in the rack, the inlet and outlet exist), one per inlet and outlet. */
export function validCords(rack: Rack, devices: Map<string, DeviceNode>, stencil: Stencils): PowerCord[] {
  const parts = new Map(rackParts(rack, devices, stencil).map((x) => [x.it.id, x]));
  const usedIn = new Set<string>(), usedOut = new Set<string>();
  return (rack.power ?? []).filter((c) => {
    const from = parts.get(c.from), to = parts.get(c.to)?.source;
    if (!from || !to || c.from === c.to || !from.inlets.some((i) => i.id === c.inlet)) return false;
    if (!Number.isInteger(c.outlet) || c.outlet < 1 || c.outlet > to.outlets) return false;
    const a = `${c.from}|${c.inlet}`, b = `${c.to}|${c.outlet}`;
    if (usedIn.has(a) || usedOut.has(b)) return false;
    usedIn.add(a); usedOut.add(b);
    return true;
  });
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Plugs in everything not plugged in yet: a PDU's input into the UPS; a device's supplies spread over the PDUs (two
 * supplies on two different PDUs when there are two), else into the UPS. Existing cords stay.
 */
export function plugInAll(rack: Rack, devices: Map<string, DeviceNode>, stencil: Stencils): PowerCord[] {
  const parts = rackParts(rack, devices, stencil);
  const cords = validCords(rack, devices, stencil);
  const sources = powerSources(rack, devices, stencil);
  if (!sources.length) return cords;
  const taken = new Set(cords.map((c) => `${c.to}|${c.outlet}`));
  const plugged = new Set(cords.map((c) => `${c.from}|${c.inlet}`));
  const free = (s: PowerSource) => { for (let o = 1; o <= s.outlets; o++) if (!taken.has(`${s.itemId}|${o}`)) return o; return 0; };
  const plug = (from: string, inlet: string, s: PowerSource) => {
    const o = free(s);
    if (!o) return false;
    cords.push({ id: `pc-${uid()}`, from, inlet, to: s.itemId, outlet: o });
    taken.add(`${s.itemId}|${o}`);
    plugged.add(`${from}|${inlet}`);
    return true;
  };
  const pdus = sources.filter((s) => s.kind === 'pdu'), upses = sources.filter((s) => s.kind === 'ups');
  // PDUs into the UPS(es) first, round robin.
  let k = 0;
  for (const x of parts) {
    if (!x.source || x.source.kind !== 'pdu' || !upses.length) continue;
    for (const inl of x.inlets) if (!plugged.has(`${x.it.id}|${inl.id}`)) { plug(x.it.id, inl.id, upses[k % upses.length]); k++; }
  }
  // Then the equipment, into PDUs when there are any (a PDU fed by a UPS is how racks are wired), else the UPS.
  const targets = pdus.length ? pdus : upses;
  let next = 0;
  for (const x of parts) {
    if (x.source || !x.inlets.length) continue;
    x.inlets.forEach((inl, i) => {
      if (plugged.has(`${x.it.id}|${inl.id}`)) return;
      // Supply i of a device on PDU i (A / B feeds); a single supply on the next PDU in turn.
      const order = x.inlets.length > 1 ? targets.map((_, j) => targets[(i + j) % targets.length]) : targets.map((_, j) => targets[(next + j) % targets.length]);
      for (const s of order) if (s.itemId !== x.it.id && plug(x.it.id, inl.id, s)) break;
    });
    if (x.inlets.length === 1) next++;
  }
  return cords;
}

export interface SourceLoad extends PowerSource {
  /** Watts drawn in normal running (supplies share the load). */
  loadW: number;
  /** Watts if every device on it had to run from it alone (the other feed failed). */
  failoverW: number;
  capacityW: number;
  /** The capacity is a typical figure (PDU without a circuit set, UPS without a size). */
  assumed: boolean;
}

/**
 * The load on each PDU and UPS from the cords (a device's watts split over its plugged supplies; a PDU fed by a UPS
 * adds its load to the UPS), the devices left unplugged, and warnings: overloaded, no redundancy, failover overload.
 */
export function powerLoads(rack: Rack, devices: Map<string, DeviceNode>, stencil: Stencils, watts: (nodeId: string) => number, circuitW?: number): { sources: SourceLoad[]; unplugged: string[]; warnings: string[] } {
  const parts = rackParts(rack, devices, stencil);
  const byItem = new Map(parts.map((x) => [x.it.id, x]));
  const cords = validCords(rack, devices, stencil);
  const sources = powerSources(rack, devices, stencil);
  const load = new Map<string, number>(), fail = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const warnings: string[] = [];
  const unplugged: string[] = [];
  // The feed (top source) an item's cord leads to: a PDU plugged into a UPS leads to the UPS.
  const feedOf = (itemId: string): string => {
    const up = cords.find((c) => c.from === itemId);
    return up ? feedOf(up.to) : itemId;
  };
  for (const x of parts) {
    if (x.source || !x.inlets.length || !x.d) continue;
    const mine = cords.filter((c) => c.from === x.it.id);
    if (!mine.length) { unplugged.push(x.d.data.name); continue; }
    const w = watts(x.d.id);
    for (const c of mine) { add(load, c.to, w / mine.length); add(fail, c.to, w); }
    if (x.inlets.length > 1) {
      if (mine.length < x.inlets.length) warnings.push(`${x.d.data.name}: only ${mine.length} of its ${x.inlets.length} power supplies are plugged in`);
      else if (new Set(mine.map((c) => c.to)).size === 1) warnings.push(`${x.d.data.name}: both power supplies are on ${byItem.get(mine[0].to)?.source?.label}, so it has no redundancy`);
      else if (new Set(mine.map((c) => feedOf(c.to))).size === 1) warnings.push(`${x.d.data.name}: both power supplies end up on ${byItem.get(feedOf(mine[0].to))?.source?.label}, so it has no redundancy`);
    }
  }
  // A PDU's load reaches the UPS it is plugged into.
  for (const c of cords) {
    if (!byItem.get(c.from)?.source) continue;
    add(load, c.to, load.get(c.from) ?? 0);
    add(fail, c.to, fail.get(c.from) ?? 0);
  }
  const out = sources.map((s): SourceLoad => {
    const x = byItem.get(s.itemId)!;
    const ups = s.kind === 'ups' && x.d ? upsRating(x.d) : undefined;
    const capacityW = ups ? ups.capacityW : circuitW ?? PDU_DEFAULT_W;
    const loadW = Math.round(load.get(s.itemId) ?? 0), failoverW = Math.round(fail.get(s.itemId) ?? 0);
    if (loadW > capacityW) warnings.push(`${s.label} is overloaded: ${loadW} W of ${capacityW} W`);
    else if (failoverW > capacityW) warnings.push(`If the other feed fails, ${s.label} would carry ${failoverW} W of ${capacityW} W`);
    return { ...s, loadW, failoverW, capacityW, assumed: ups ? ups.assumed : circuitW === undefined };
  });
  return { sources: out, unplugged, warnings };
}
