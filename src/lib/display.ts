/**
 * Data-driven colors ("data graphics"): devices colored by status, location, model or layer, cables by type or VLAN,
 * with a legend. Colors for free-text values come from a fixed palette in sorted order, so they are stable.
 */
import { allDevices } from './project';
import { CABLE_STYLES, DEVICE_STATUSES, type CableData, type CableType, type DeviceNode, type DisplaySettings, type Project } from './types';

export const DEFAULT_DISPLAY: DisplaySettings = { deviceColor: 'none', cableColor: 'type', showLegend: true };

const PALETTE = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#059669', '#dc2626', '#7c3aed', '#65a30d'];
const NONE = '#9ca3af';

export interface LegendEntry {
  label: string;
  color: string;
  dashed?: boolean;
}

export interface DisplayColors {
  device: (n: DeviceNode) => string | null;
  cable: (d: CableData | undefined) => { color: string; dash?: string; width: number };
  deviceLegend: LegendEntry[];
  cableLegend: LegendEntry[];
  deviceTitle: string;
  cableTitle: string;
}

function paletteFor(values: string[]) {
  const sorted = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return new Map(sorted.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
}

export function displayColors(p: Project): DisplayColors {
  const s = p.display ?? DEFAULT_DISPLAY;
  const devices = allDevices(p);
  const layerName = new Map((p.layers ?? []).map((l) => [l.id, l.name]));

  // Devices
  let device: DisplayColors['device'] = () => null;
  let deviceLegend: LegendEntry[] = [];
  let deviceTitle = '';
  if (s.deviceColor === 'status') {
    deviceTitle = 'Status';
    const by = new Map(DEVICE_STATUSES.map((x) => [x.value, x.color]));
    device = (n) => by.get(n.data.status ?? 'active') ?? NONE;
    const used = new Set(devices.map((n) => n.data.status ?? 'active'));
    deviceLegend = DEVICE_STATUSES.filter((x) => used.has(x.value)).map((x) => ({ label: x.label, color: x.color, dashed: x.value === 'planned' }));
  } else if (s.deviceColor !== 'none') {
    const field = s.deviceColor;
    deviceTitle = field === 'layer' ? 'Layer' : field === 'location' ? 'Location' : 'Model';
    const value = (n: DeviceNode) => (field === 'layer' ? layerName.get(n.data.layer ?? '') ?? '' : String(n.data[field] ?? '').trim());
    const pal = paletteFor(devices.map(value));
    device = (n) => pal.get(value(n)) ?? NONE;
    deviceLegend = [...pal.entries()].map(([label, color]) => ({ label, color }));
    if (devices.some((n) => !value(n))) deviceLegend.push({ label: field === 'layer' ? 'No layer' : `No ${deviceTitle.toLowerCase()}`, color: NONE });
  }

  // Cables
  let cable: DisplayColors['cable'] = (d) => CABLE_STYLES[(d?.cable ?? 'Cat6') as CableType];
  let cableLegend: LegendEntry[] = [];
  let cableTitle = 'Cable';
  const edges = p.pages.flatMap((pg) => pg.edges);
  if (s.cableColor === 'vlan') {
    cableTitle = 'VLAN';
    const pal = paletteFor(edges.map((e) => (e.data?.vlan ?? '').trim()));
    // A VLAN with its own colour in the IP plan uses it; its name goes in the legend.
    const plan = new Map((p.vlans ?? []).map((v) => [v.vlan.trim(), v]));
    for (const k of pal.keys()) { const c = plan.get(k)?.color; if (c) pal.set(k, c); }
    cable = (d) => {
      const base = CABLE_STYLES[(d?.cable ?? 'Cat6') as CableType];
      return { ...base, color: pal.get((d?.vlan ?? '').trim()) ?? NONE };
    };
    cableLegend = [...pal.entries()].map(([label, color]) => ({ label: `VLAN ${label}${plan.get(label)?.name ? ` ${plan.get(label)!.name}` : ''}`, color }));
    if (edges.some((e) => !(e.data?.vlan ?? '').trim())) cableLegend.push({ label: 'No VLAN', color: NONE });
  } else {
    const used = new Set(edges.map((e) => (e.data?.cable ?? 'Cat6') as CableType));
    cableLegend = (Object.keys(CABLE_STYLES) as CableType[]).filter((t) => used.has(t)).map((t) => ({ label: t, color: CABLE_STYLES[t].color, dashed: !!CABLE_STYLES[t].dash }));
  }

  // A color picked for one cable wins over the type/VLAN color.
  const byData = cable;
  const withOverride: DisplayColors['cable'] = (d) => ({ ...byData(d), ...(d?.color ? { color: d.color } : {}), ...(d?.weight ? { width: d.weight } : {}) });

  return { device, cable: withOverride, deviceLegend, cableLegend, deviceTitle, cableTitle };
}

/** Is this device or cable on a hidden layer? */
export function hiddenLayers(p: Project): Set<string> {
  return new Set((p.layers ?? []).filter((l) => !l.visible).map((l) => l.id));
}
