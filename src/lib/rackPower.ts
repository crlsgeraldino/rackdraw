/**
 * Rack power, heat, weight and UPS runtime: what a rack draws (each device's Power field, or a typical figure for
 * built-in equipment, plus the PoE it delivers), the heat to remove, its weight, the load on its power circuit
 * (against the 80% continuous rating), and how long its UPS holds it up.
 */
import { POE_WATTS } from './bom';
import type { DeviceNode, Project, Rack, StencilDef } from './types';

type Stencils = (id: string) => StencilDef | undefined;

/** Typical draw (W, without PoE) and weight (lb) of built-in equipment, used when a device has no figure of its own. */
export const TYPICAL: Record<string, { w: number; lb: number }> = {
  'sonicwall-tz570-670': { w: 40, lb: 5 }, firewall: { w: 60, lb: 10 }, router: { w: 40, lb: 8 }, sdwan: { w: 30, lb: 6 },
  'vpn-concentrator': { w: 60, lb: 10 }, 'wan-optimizer': { w: 100, lb: 15 }, 'csu-dsu': { w: 10, lb: 3 }, 'metro-ntu': { w: 15, lb: 4 },
  'switch-8': { w: 15, lb: 3 }, 'switch-16-poe': { w: 30, lb: 6 }, 'switch-24': { w: 30, lb: 7 }, 'switch-24-poe': { w: 45, lb: 8 },
  'switch-48': { w: 45, lb: 10 }, 'switch-48-poe': { w: 60, lb: 12 }, 'switch-core-24sfp': { w: 150, lb: 15 },
  'patch-panel-24': { w: 0, lb: 3 }, 'patch-panel-48': { w: 0, lb: 5 }, 'patch-panel-96': { w: 0, lb: 9 }, 'patch-panel-fiber-24': { w: 0, lb: 4 },
  server: { w: 400, lb: 50 }, nas: { w: 80, lb: 20 }, san: { w: 600, lb: 70 }, 'tape-library': { w: 100, lb: 40 }, nvr: { w: 60, lb: 25 },
  ups: { w: 0, lb: 60 }, wlc: { w: 50, lb: 10 }, kvm: { w: 20, lb: 8 }, 'console-server': { w: 20, lb: 6 }, 'pdu-network': { w: 10, lb: 8 },
  'ip-pbx': { w: 40, lb: 8 }, 'load-balancer': { w: 150, lb: 20 }, olt: { w: 150, lb: 15 }, dwdm: { w: 10, lb: 6 },
};

/** A UPS's rating, from its Shape Data, else read from its model ("1500VA"), else a typical 1500 VA unit. */
export interface UpsInfo {
  /** Output in watts. */
  capacityW?: number;
  /** Datasheet runtime at half load, minutes. */
  runtimeHalfMin?: number;
}

export function upsRating(d: DeviceNode): { capacityW: number; runtimeHalfMin: number; assumed: boolean } {
  const u = d.data.ups ?? {};
  let capacityW = u.capacityW, assumed = false;
  if (!capacityW) {
    const m = `${d.data.model ?? ''} ${d.data.name}`.match(/(\d+(?:\.\d+)?)\s*(k)?\s*VA\b/i);
    const va = m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined;
    capacityW = va ? Math.round(va * (va >= 3000 ? 0.9 : 0.66)) : 1000;
    assumed = true;
  }
  const runtimeHalfMin = u.runtimeHalfMin ?? 15;
  return { capacityW, runtimeHalfMin, assumed: assumed || u.runtimeHalfMin === undefined };
}

/** Runtime (minutes) at a load, from the datasheet's half-load runtime (batteries give less at higher loads). */
export function runtimeAt(loadW: number, capacityW: number, runtimeHalfMin: number) {
  if (loadW <= 0) return Infinity;
  return runtimeHalfMin * Math.pow((capacityW / 2) / loadW, 1.2);
}

export const isUps = (d: DeviceNode, st?: StencilDef) => st?.id === 'ups' || (!!st?.custom && /\bups\b/i.test(`${st.name} ${d.data.model ?? ''}`));

export interface RackPowerItem {
  nodeId: string;
  name: string;
  w: number;
  poeW: number;
  lb: number;
  /** Power and / or weight are typical figures, not the device's own. */
  typical: boolean;
}

export interface RackPower {
  items: RackPowerItem[];
  totalW: number;
  poeW: number;
  btu: number;
  weightLb: number;
  typicalCount: number;
  circuit?: { volts: number; amps: number; redundant: boolean; continuousW: number; pct: number };
  ups: { id: string; name: string; capacityW: number; loadW: number; pct: number; runtimeMin: number; assumed: boolean }[];
  warnings: string[];
}

export function rackPower(p: Project, rack: Rack, stencil: Stencils): RackPower {
  const devices = new Map(p.pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n]));
  const items: RackPowerItem[] = [];
  const upsList: DeviceNode[] = [];
  // Ports with a cable plugged in (PoE is only drawn by something connected).
  const cabled = new Set<string>();
  for (const e of p.pages.flatMap((pg) => pg.edges)) {
    if (e.sourceHandle) cabled.add(`${e.source}|${e.sourceHandle}`);
    if (e.targetHandle) cabled.add(`${e.target}|${e.targetHandle}`);
  }
  for (const it of rack.items) {
    const d = it.nodeId ? devices.get(it.nodeId) : undefined;
    if (!d) continue;
    const st = stencil(d.data.stencilId);
    if (isUps(d, st)) upsList.push(d);
    const t = st && !st.custom ? TYPICAL[st.id] : undefined;
    const ownW = typeof d.data.powerW === 'number' ? d.data.powerW : undefined;
    const ownLb = typeof d.data.weightLb === 'number' ? d.data.weightLb : undefined;
    // PoE the switch delivers comes out of its own supply (at ~90% efficiency): only on cabled ports that are on.
    const poeW = Math.round(Object.entries(d.data.ports ?? {}).reduce((s, [port, pd]) =>
      s + (pd?.poe && pd.status !== 'disabled' && cabled.has(`${d.id}|${port}`) ? POE_WATTS[pd.poe] ?? 15.4 : 0), 0) / 0.9);
    items.push({
      nodeId: d.id,
      name: d.data.name,
      w: (ownW ?? t?.w ?? 0) + (ownW === undefined ? poeW : 0),
      poeW: ownW === undefined ? poeW : 0,
      lb: ownLb ?? t?.lb ?? 0,
      typical: (ownW === undefined && !!t && t.w > 0) || (ownLb === undefined && !!t),
    });
  }
  const totalW = items.reduce((s, x) => s + x.w, 0);
  const warnings: string[] = [];
  let circuit: RackPower['circuit'];
  if (rack.feedVolts && rack.feedAmps) {
    const continuousW = rack.feedVolts * rack.feedAmps * 0.8;
    circuit = { volts: rack.feedVolts, amps: rack.feedAmps, redundant: !!rack.redundantFeeds, continuousW, pct: totalW / continuousW };
    if (circuit.pct > 1) warnings.push(`Draws ${totalW} W: over the ${Math.round(continuousW)} W continuous rating (80%) of its ${rack.feedAmps} A / ${rack.feedVolts} V circuit${rack.redundantFeeds ? ' (each feed must carry it all)' : ''}`);
    else if (circuit.pct > 0.8) warnings.push(`Uses ${Math.round(circuit.pct * 100)}% of its circuit's continuous rating`);
  }
  // With power cords drawn, the cords say what each UPS carries (Rack → Power cords); without, it shares the rack.
  const ups = (rack.power?.length ? [] : upsList).map((u) => {
    const r = upsRating(u);
    // A UPS carries the rack's equipment (shared between UPSes when there are several).
    const loadW = Math.round(totalW / upsList.length);
    const pct = loadW / r.capacityW;
    const runtimeMin = runtimeAt(loadW, r.capacityW, r.runtimeHalfMin);
    if (pct > 1) warnings.push(`${u.data.name} is overloaded: ${loadW} W on a ${r.capacityW} W UPS`);
    else if (pct > 0.8) warnings.push(`${u.data.name} runs at ${Math.round(pct * 100)}% of its capacity`);
    if (pct <= 1 && runtimeMin < 10) warnings.push(`${u.data.name} holds the rack up for only about ${Math.max(1, Math.round(runtimeMin))} min`);
    return { id: u.id, name: u.data.name, capacityW: r.capacityW, loadW, pct, runtimeMin, assumed: r.assumed };
  });
  return {
    items, totalW, poeW: items.reduce((s, x) => s + x.poeW, 0), btu: Math.round(totalW * 3.412),
    weightLb: Math.round(items.reduce((s, x) => s + x.lb, 0)), typicalCount: items.filter((x) => x.typical).length,
    circuit, ups, warnings,
  };
}

export const fmtRuntime = (min: number) => (!Number.isFinite(min) ? '—' : min >= 120 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);
