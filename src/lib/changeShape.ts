/**
 * Change Shape (Visio): which port of the new shape each old port's cable and notes move to. Same port id first,
 * then the same port name, then the next free port of the same kind (in order); ports with no match are dropped.
 */
import type { PortDef } from './types';

export function mapPorts(oldPorts: PortDef[], newPorts: PortDef[], used: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const byId = new Map(newPorts.map((p) => [p.id, p]));
  const norm = (s: string) => s.trim().toLowerCase();
  const order = [...used].sort((a, b) => oldPorts.findIndex((p) => p.id === a) - oldPorts.findIndex((p) => p.id === b));
  // Pass 1: same id. Pass 2: same name. Pass 3: same kind, in order.
  for (const id of order) if (byId.has(id) && !taken.has(id)) { out.set(id, id); taken.add(id); }
  for (const id of order) {
    if (out.has(id)) continue;
    const old = oldPorts.find((p) => p.id === id);
    const hit = old && newPorts.find((p) => !taken.has(p.id) && norm(p.label) === norm(old.label));
    if (hit) { out.set(id, hit.id); taken.add(hit.id); }
  }
  for (const id of order) {
    if (out.has(id)) continue;
    const old = oldPorts.find((p) => p.id === id);
    const hit = newPorts.find((p) => !taken.has(p.id) && (!old || p.kind === old.kind)) ?? newPorts.find((p) => !taken.has(p.id));
    if (hit) { out.set(id, hit.id); taken.add(hit.id); }
  }
  return out;
}
