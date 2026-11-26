/**
 * Shelves: small equipment (a desktop firewall, an 8-port switch, the ISP modem) sits on a shelf in the rack at its
 * real proportions, side by side, instead of being stretched into a 19 in faceplate. A device on a shelf is a rack
 * item like any other, with `shelf: { id, x }`: the shelf item it stands on and its distance from the shelf's left end.
 */
import { findFreeU, fits } from './rack';
import type { Rack, RackItem, StencilDef } from './types';

/** The rack drawing's scale: one unit is 40 px high, the space between the rails 440 px wide (RackElevation). */
export const U_PX = 40;
export const INNER_PX = 440;
/** The shelf's tray (at the bottom of its slot), the margin at each end, and the gap between devices. */
export const TRAY_PX = 12;
export const SHELF_PAD = 8;
export const SHELF_GAP = 6;

/** Height available to a device standing on a shelf of `units`. */
export const shelfArtHeight = (units: number) => units * U_PX - TRAY_PX - 4;

/** How wide a device stands on a shelf of `units` (px of INNER_PX): its own proportions, at the shelf's height. */
export function shelfWidth(st: StencilDef | undefined, units: number): number {
  const h = shelfArtHeight(units);
  if (!st || st.style === 'icon' || !(st.width > 0) || !(st.height > 0)) return Math.min(96, INNER_PX - SHELF_PAD * 2);
  return Math.max(24, Math.min(INNER_PX - SHELF_PAD * 2, (st.width / st.height) * h));
}

/** The devices standing on a shelf, left to right. */
export function onShelf(rack: Rack, shelfId: string): RackItem[] {
  return rack.items.filter((it) => it.shelf?.id === shelfId).sort((a, b) => a.shelf!.x - b.shelf!.x);
}

/** The first free place on a shelf for something `width` wide (its x), or null when the shelf is full. */
export function freeShelfX(rack: Rack, shelf: RackItem, width: number, widthOf: (it: RackItem) => number, ignoreId?: string): number | null {
  let x = SHELF_PAD;
  for (const it of onShelf(rack, shelf.id)) {
    if (it.id === ignoreId) continue;
    if (it.shelf!.x - x >= width) return x;
    x = Math.max(x, it.shelf!.x + widthOf(it) + SHELF_GAP);
  }
  return INNER_PX - SHELF_PAD - x >= width ? x : null;
}

/** The shelf whose units include `u`, if there is one. */
export const shelfAt = (rack: Rack, u: number) => rack.items.find((it) => it.kind === 'shelf' && u >= it.u && u < it.u + it.height);

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Puts the device `nodeId` on a shelf: the one at `u` if it has room, else a new 1U shelf at `u` (or, without `u`,
 * the first shelf with room, else a new shelf in the highest free unit). Moving a device already on a shelf: pass its
 * item as `moving`. Returns the rack with it placed, or null when there is no room.
 */
export function placeOnShelf(rack: Rack, nodeId: string, width: number, widthOf: (it: RackItem) => number, u?: number, moving?: RackItem): Rack | null {
  const items = rack.items.filter((it) => it.id !== moving?.id);
  const r: Rack = { ...rack, items };
  const put = (shelf: RackItem, x: number, extra: RackItem[] = []): Rack => ({
    ...r,
    items: [...items, ...extra, { ...(moving ?? {}), id: moving?.id ?? `ri-${uid()}`, kind: 'device', nodeId, u: shelf.u, height: shelf.height, depth: shelf.depth, shelf: { id: shelf.id, x } }],
  });
  const candidates = u !== undefined ? [shelfAt(r, u)].filter((s): s is RackItem => !!s) : items.filter((it) => it.kind === 'shelf');
  for (const shelf of candidates) {
    const x = freeShelfX(r, shelf, width, widthOf);
    if (x !== null) return put(shelf, x);
  }
  if (u !== undefined && candidates.length) return null; // dropped on a full shelf
  const at = u ?? findFreeU(r, 1, 'full');
  if (at === null || !fits(r, at, 1, 'full')) return null;
  const shelf: RackItem = { id: `ri-${uid()}`, kind: 'shelf', label: 'Shelf', u: at, height: 1, depth: 'full' };
  return width <= INNER_PX - SHELF_PAD * 2 ? put(shelf, SHELF_PAD, [shelf]) : null;
}
