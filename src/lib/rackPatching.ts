import { displayColors } from './display';
import { allDevices } from './project';
import { rackLabel } from './rack';
import type { PortState } from './stencils';
import type { CableData, DeviceNode, Project, Rack, StencilDef } from './types';

/*
 * Rack connections: the diagram's cables seen from a rack. A cable whose ends are both on equipment in the same rack
 * is a patch cord drawn on the rack's front; a cable to anything else (another rack, an unracked device) is listed
 * with where it goes.
 */

export interface PatchEnd {
  nodeId: string;
  /** Port id on the device's stencil (missing when the cable is attached to the device, not a port). */
  port?: string;
  /** Rack and position of that device, when it is mounted somewhere. */
  rack?: Rack;
  position?: string;
}

export interface RackCable {
  id: string;
  a: PatchEnd;
  b: PatchEnd;
  data?: CableData;
  /** Both ends in this rack. */
  inside: boolean;
  color: string;
  width: number;
  dash?: string;
}

/** Where each device is mounted (rack and item), across the project's racks. */
function mountsOf(p: Project) {
  const at = new Map<string, { rack: Rack; position: string }>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) at.set(it.nodeId, { rack: r, position: rackLabel(it) });
  return at;
}

/** Every cable (on any page) with at least one end on a device mounted in `rack`; ends in the rack come first. */
export function rackCables(p: Project, rack: Rack): RackCable[] {
  const mounts = mountsOf(p);
  const colors = displayColors(p);
  const here = (id: string) => mounts.get(id)?.rack.id === rack.id;
  const out: RackCable[] = [];
  for (const pg of p.pages) {
    for (const e of pg.edges) {
      const ends: PatchEnd[] = [
        { nodeId: e.source, port: e.sourceHandle ?? undefined, ...mounts.get(e.source) },
        { nodeId: e.target, port: e.targetHandle ?? undefined, ...mounts.get(e.target) },
      ];
      const [inA, inB] = [here(ends[0].nodeId), here(ends[1].nodeId)];
      if (!inA && !inB) continue;
      const [a, b] = inA ? ends : [ends[1], ends[0]];
      const st = colors.cable(e.data);
      out.push({ id: e.id, a, b, data: e.data, inside: inA && inB, color: st.color, width: st.width, dash: st.dash });
    }
  }
  return out;
}

/** Port states for lighting up rack-mounted equipment: every port with a cable on any page. */
export function rackPortStates(p: Project): Map<string, Record<string, PortState>> {
  const states = new Map<string, Record<string, PortState>>();
  for (const pg of p.pages) for (const e of pg.edges) {
    for (const [n, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
      if (!h) continue;
      const s = states.get(n) ?? {};
      s[h] = 'connected';
      states.set(n, s);
    }
  }
  return states;
}

/** A port's printed name ("X1", "24"), or the id when the stencil doesn't know it. */
export function portName(stencil: StencilDef | undefined, port: string | undefined) {
  if (!port) return '';
  return stencil?.ports.find((q) => q.id === port)?.label ?? port;
}

/** Rows of a rack's patching schedule: from (in this rack) → to, with cable type and VLAN. */
export function patchRows(p: Project, rack: Rack, stencil: (id: string) => StencilDef | undefined) {
  const devices = new Map<string, DeviceNode>(allDevices(p).map((n) => [n.id, n]));
  const end = (x: PatchEnd) => {
    const d = devices.get(x.nodeId);
    const port = portName(d ? stencil(d.data.stencilId) : undefined, x.port);
    return {
      position: x.position ?? '',
      device: d?.data.name ?? 'Missing device',
      port,
      where: x.rack ? (x.rack.id === rack.id ? '' : x.rack.name) : 'Not racked',
    };
  };
  return rackCables(p, rack)
    .map((c) => ({ id: c.id, fromId: c.a.nodeId, fromPort: c.a.port, from: end(c.a), to: end(c.b), cable: c.data?.cable ?? 'Cat6', vlan: c.data?.vlan ?? '', label: c.data?.label ?? '', length: c.data?.length ?? '', color: c.color, inside: c.inside }))
    .sort((x, y) => (rack.items.find((it) => rackLabel(it) === y.from.position)?.u ?? 0) - (rack.items.find((it) => rackLabel(it) === x.from.position)?.u ?? 0) || x.from.port.localeCompare(y.from.port, undefined, { numeric: true }));
}
