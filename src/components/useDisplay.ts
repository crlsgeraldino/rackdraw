'use client';

import { displayColors, hiddenLayers } from '@/lib/display';
import type { Project } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';

/*
 * Data colours and hidden layers, shared by every device and cable on the canvas.
 *
 * They depend on only a few things (the Design settings, layers, the IP plan's VLAN colours, and which values the
 * devices / cables have for the "colour by" field). The result is kept as the same object until one of those changes,
 * so a device or cable re-draws only when its own data changes — not on every keystroke or move anywhere in the
 * client (that made every item on a big page re-draw each time).
 */
type Display = ReturnType<typeof compute>;
const compute = (p: Project) => ({ ...displayColors(p), hidden: hiddenLayers(p) });

/** What the colours depend on, as a string: same string, same colours. */
function signature(p: Project): string {
  const s = p.display;
  const devices = p.pages.flatMap((pg) => pg.nodes).filter((n) => n.type === 'device');
  const edges = p.pages.flatMap((pg) => pg.edges);
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => (x ?? '').trim()))].sort().join('|');
  const field = (k: string) => uniq(devices.map((n) => (n.type === 'device' ? String((n.data as Record<string, unknown>)[k] ?? '') : '')));
  let dev = '';
  switch (s?.deviceColor) {
    case 'status': dev = uniq(devices.map((n) => (n.type === 'device' ? n.data.status ?? 'active' : ''))); break;
    case 'location': case 'model': case 'layer': dev = field(s.deviceColor); break;
    case 'warranty': dev = field('warrantyEnd'); break;
    default: dev = '';
  }
  const cab = s?.cableColor === 'vlan' ? uniq(edges.map((e) => e.data?.vlan)) : uniq(edges.map((e) => e.data?.cable ?? 'Cat6'));
  return JSON.stringify([
    s ?? null,
    (p.layers ?? []).map((l) => [l.id, l.name, l.visible, l.locked, l.print]),
    (p.vlans ?? []).map((v) => [v.vlan, v.name, v.color]),
    dev,
    cab,
  ]);
}

const byProject = new WeakMap<Project, Display>();
let last: { sig: string; value: Display } | null = null;

/** The display for a client: the same object as last time when nothing it depends on changed. */
export function displayOf(p: Project): Display {
  const hit = byProject.get(p);
  if (hit) return hit;
  const sig = signature(p);
  const value = last && last.sig === sig ? last.value : compute(p);
  last = { sig, value };
  byProject.set(p, value);
  return value;
}

/** Data colors and hidden layers for the current client. */
export function useDisplay() {
  return useDiagram((s) => displayOf(s.projects[s.currentId]));
}
