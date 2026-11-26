/**
 * Rack-only devices (Shape Data → Show on: Rack only): patch panels, cable managers and the like belong in the rack
 * elevation, not on the logical diagram. They stay in the client (bill of materials, port maps, cable paths); the
 * diagram just doesn't draw them. A cable run through rack-only patch panels (switch → panel → wall jack) is drawn
 * as one line from the switch to the jack, "via PP-A 12".
 */
import { endPortName } from './cableRole';
import { isPassThrough } from './trace';
import type { AppNode, CableData, CableEdge, DeviceNode, StencilDef } from './types';

export const isRackOnly = (n: AppNode | undefined): boolean => n?.type === 'device' && n.data.showOn === 'rack';

/**
 * What the diagram draws for a page's cables: `hidden` = cables touching a rack-only device (not drawn); `via` = one
 * line for each run through rack-only pass-through devices, from the visible device at one end to the one at the
 * other. A run ending in a rack-only device that isn't a pass-through (or a panel port with one cable) isn't drawn.
 */
export function drawingCables(nodes: AppNode[], edges: CableEdge[], stencil: (id: string) => StencilDef | undefined): { hidden: Set<string>; via: CableEdge[] } {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const rackOnly = new Set(nodes.filter(isRackOnly).map((n) => n.id));
  const hidden = new Set<string>();
  const via: CableEdge[] = [];
  if (!rackOnly.size) return { hidden, via };

  // The cables on each port of each rack-only pass-through device.
  const atPort = new Map<string, CableEdge[]>();
  const key = (id: string, h?: string | null) => `${id}|${h ?? ''}`;
  const through = new Set<string>();
  for (const id of rackOnly) {
    const d = byId.get(id) as DeviceNode;
    if (isPassThrough(d, stencil(d.data.stencilId))) through.add(id);
  }
  for (const e of edges) {
    if (!rackOnly.has(e.source) && !rackOnly.has(e.target)) continue;
    hidden.add(e.id);
    for (const [id, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
      if (through.has(id) && h) atPort.set(key(id, h), [...(atPort.get(key(id, h)) ?? []), e]);
    }
  }

  const done = new Set<string>();
  for (const e of edges) {
    if (!hidden.has(e.id) || done.has(e.id)) continue;
    // Start from a cable with a visible end.
    const startAtSource = !rackOnly.has(e.source) && byId.has(e.source);
    const startAtTarget = !rackOnly.has(e.target) && byId.has(e.target);
    if (!startAtSource && !startAtTarget) continue;
    const from = startAtSource ? { id: e.source, h: e.sourceHandle } : { id: e.target, h: e.targetHandle };
    let at = startAtSource ? { id: e.target, h: e.targetHandle } : { id: e.source, h: e.sourceHandle };
    const hops: string[] = [];
    const seen = new Set([e.id]);
    let end: { id: string; h?: string | null } | null = null;
    for (let i = 0; i < 12; i++) {
      if (!rackOnly.has(at.id)) { end = at; break; }
      if (!through.has(at.id) || !at.h) break;
      const d = byId.get(at.id) as DeviceNode;
      hops.push(`${d.data.name} ${endPortName(d, stencil(d.data.stencilId), at.h) || at.h}`.trim());
      const next = (atPort.get(key(at.id, at.h)) ?? []).find((x) => !seen.has(x.id));
      if (!next) break;
      seen.add(next.id);
      at = next.source === at.id && next.sourceHandle === at.h ? { id: next.target, h: next.targetHandle } : { id: next.source, h: next.sourceHandle };
    }
    for (const id of seen) done.add(id);
    if (!end || !byId.has(end.id) || (end.id === from.id && end.h === from.h)) continue;
    // The line looks like the cable at its start (type, colour, VLAN); its own label, length and text position
    // belong to that one cable, not to the whole run.
    const look: CableData = { ...((e.data ?? { cable: 'Cat6' }) as CableData) };
    for (const k of ['label', 'labelAt', 'length', 'showLength'] as const) delete look[k];
    via.push({
      id: `via:${e.id}`,
      type: 'cable',
      source: from.id,
      sourceHandle: from.h ?? null,
      target: end.id,
      targetHandle: end.h ?? null,
      data: { ...look, via: hops.join(', ') },
      selectable: false,
      deletable: false,
      focusable: false,
    } as CableEdge);
  }
  return { hidden, via };
}
