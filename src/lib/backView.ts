/**
 * Front and back of one device: a shape of your own can have a back view, another shape (vendor stencils come in
 * pairs: "Dell PowerEdge R760 - Front" / "… - Rear"). The device is then one device: its front picture on the diagram
 * (or its back, Shape Data → Show), both pictures in the rack, and the ports of both sides. The back's ports are added
 * to the device's shape with ids "R:<port>" and `face: 'rear'`, so cables, port maps, power cords and the bill of
 * materials see one device with all its ports.
 */
import type { PortDef, StencilDef } from './types';

// "… - Front", "… (Front)", "… Front", "…_Front", "… front view": a separator, then the word at the end.
const FRONT = /(?:\s*[-–_(]\s*|\s+)front(?:\s*view)?\s*\)?\s*$/i;
const BACK = /(?:\s*[-–_(]\s*|\s+)(?:rear|back)(?:\s*view)?\s*\)?\s*$/i;

/** "Dell PowerEdge R760 - Front" → "dell poweredge r760"; '' when the name doesn't say Front. */
export const frontKey = (name: string) => (FRONT.test(name) ? name.replace(FRONT, '').trim().toLowerCase() : '');
/** "Dell PowerEdge R760 - Rear" → "dell poweredge r760"; '' when the name doesn't say Rear / Back. */
export const backKey = (name: string) => (BACK.test(name) ? name.replace(BACK, '').trim().toLowerCase() : '');

/** Back-view shapes by library and name, worked out once per change of the shape library. */
const backIndex = new WeakMap<object, Map<string, StencilDef>>();
function backsOf(custom: Record<string, StencilDef>) {
  let ix = backIndex.get(custom);
  if (!ix) {
    ix = new Map();
    for (const s of Object.values(custom)) { const k = backKey(s.name); if (k) ix.set(`${s.library ?? ''}|${k}`, s); }
    backIndex.set(custom, ix);
  }
  return ix;
}

/** The back view of a shape: the one it names (Edit shape → Back view), else the "… Rear" of its "… Front" name. */
export function backOf(front: StencilDef, custom: Record<string, StencilDef>): StencilDef | undefined {
  if (!front.custom) return undefined;
  if (front.rear !== undefined) { const b = front.rear ? custom[front.rear] : undefined; return b && b.id !== front.id ? b : undefined; }
  const k = frontKey(front.name);
  const b = k ? backsOf(custom).get(`${front.library ?? ''}|${k}`) : undefined;
  return b && b.id !== front.id ? b : undefined;
}

/** A back port's id on the combined device. */
export const backPortId = (id: string) => `R:${id}`;
export const isBackPort = (id?: string | null) => !!id && id.startsWith('R:');

/** The same front and back give the same combined shape (React re-renders depend on it). */
const combined = new WeakMap<StencilDef, { back: StencilDef; out: StencilDef }>();

/** The shape with its back: `back` set, and the back's ports added (ids "R:…", face 'rear'). */
export function withBack(front: StencilDef, back: StencilDef): StencilDef {
  const hit = combined.get(front);
  if (hit && hit.back === back) return hit.out;
  const backPorts: PortDef[] = back.ports.map((p) => ({ ...p, id: backPortId(p.id), face: 'rear' }));
  const out: StencilDef = { ...front, back, ports: [...front.ports, ...backPorts] };
  combined.set(front, { back, out });
  return out;
}

/** A side of the device as its own shape: its picture and only that side's ports (ids as on the device). */
export function sideOf(st: StencilDef, side: 'front' | 'back'): StencilDef {
  if (!st.back) return st;
  if (side === 'front') return sideCache(st, 'front', () => ({ ...st, back: undefined, ports: st.ports.filter((p) => p.face !== 'rear') }));
  return sideCache(st, 'back', () => ({ ...st.back!, ports: st.ports.filter((p) => p.face === 'rear') }));
}
const sides = new WeakMap<StencilDef, Partial<Record<'front' | 'back', StencilDef>>>();
function sideCache(st: StencilDef, side: 'front' | 'back', make: () => StencilDef) {
  const m = sides.get(st) ?? {};
  if (!m[side]) { m[side] = make(); sides.set(st, m); }
  return m[side]!;
}

/** The ids of the shapes used as some other shape's back (so the palette can mark them). */
export function backIds(custom: Record<string, StencilDef>): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(custom)) { const b = backOf(s, custom); if (b) out.add(b.id); }
  return out;
}
