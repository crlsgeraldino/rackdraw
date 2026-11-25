import type { Rack, RackDepth, RackItem, RackItemKind } from './types';

/** Do two depth settings compete for the same physical space? */
function sharesFace(a: RackDepth, b: RackDepth) {
  return a === 'full' || b === 'full' || a === b;
}

/** True when an item of this size/depth can sit at `u` without leaving the rack or overlapping another item. */
export function fits(rack: Rack, u: number, height: number, depth: RackDepth, ignoreId?: string) {
  if (!Number.isInteger(u) || u < 1 || !Number.isInteger(height) || height < 1 || u + height - 1 > rack.units) return false;
  return !rack.items.some(
    (it) => it.id !== ignoreId && sharesFace(it.depth, depth) && u <= it.u + it.height - 1 && it.u <= u + height - 1,
  );
}

/** Highest free position (racks are usually filled from the top), or null if there is no room. */
export function findFreeU(rack: Rack, height: number, depth: RackDepth): number | null {
  for (let u = rack.units - height + 1; u >= 1; u--) if (fits(rack, u, height, depth)) return u;
  return null;
}

export function usedUnits(rack: Rack) {
  const taken = new Set<number>();
  for (const it of rack.items) for (let u = it.u; u < it.u + it.height; u++) taken.add(u);
  return taken.size;
}

export const ACCESSORIES: { kind: Exclude<RackItemKind, 'device'>; label: string; height: number; depth: RackDepth }[] = [
  { kind: 'blank', label: 'Blanking panel 1U', height: 1, depth: 'front' },
  { kind: 'blank', label: 'Blanking panel 2U', height: 2, depth: 'front' },
  { kind: 'cable-manager', label: 'Cable manager 1U', height: 1, depth: 'front' },
  { kind: 'shelf', label: 'Shelf 1U', height: 1, depth: 'full' },
  { kind: 'shelf', label: 'Shelf 2U', height: 2, depth: 'full' },
  { kind: 'pdu', label: 'PDU 1U', height: 1, depth: 'rear' },
  { kind: 'other', label: 'Other 1U', height: 1, depth: 'full' },
];

export const RACK_SIZES = [6, 9, 12, 15, 18, 22, 24, 27, 32, 42, 45, 48];

export function rackLabel(it: RackItem) {
  return it.height > 1 ? `U${it.u}–U${it.u + it.height - 1}` : `U${it.u}`;
}
