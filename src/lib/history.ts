/** Undo / Redo lists: a plain-words name for each step, worked out by comparing the drawing before and after it. */
import type { AppNode, CableEdge, Page, Rack } from './types';

export interface HistoryState {
  pages: Page[];
  racks: Rack[];
  activePageId: string;
}

function nameOf(n: AppNode): string {
  switch (n.type) {
    case 'device': return n.data.name || 'device';
    case 'zone': return n.data.title || 'zone';
    case 'note': return 'note';
    case 'measure': return n.data.variant === 'wall' ? 'wall' : n.data.variant === 'line' ? 'line' : 'dimension line';
    case 'shape': return n.data.kind === 'text' ? `text "${(n.data.text || '').split('\n')[0].slice(0, 24)}"` : n.data.kind === 'image' ? 'picture' : n.data.kind === 'table' ? 'table' : (n.data.text || n.data.kind).split('\n')[0].slice(0, 24);
    case 'backdrop': return 'background picture';
    default: return 'item';
  }
}

/** What a node looks like apart from selection and on-screen measuring. */
const without = (o: object, keys: string[]) => { const c = { ...o } as Record<string, unknown>; for (const k of keys) delete c[k]; return c; };
const stripNode = (n: AppNode) => without(n, ['selected', 'measured', 'dragging']);
const stripEdge = (e: CableEdge) => without(e, ['selected']);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const things = (list: AppNode[], verb: string) => (list.length === 1 ? `${verb} ${nameOf(list[0])}` : `${verb} ${plural(list.length, 'item')}`);

function describePage(a: Page, b: Page): string | null {
  if (a.name !== b.name) return `Renamed page to "${b.name}"`;
  const an = new Map(a.nodes.map((n) => [n.id, n])), bn = new Map(b.nodes.map((n) => [n.id, n]));
  const added = b.nodes.filter((n) => !an.has(n.id)), removed = a.nodes.filter((n) => !bn.has(n.id));
  const ae = new Map(a.edges.map((e) => [e.id, e])), be = new Map(b.edges.map((e) => [e.id, e]));
  const eAdded = b.edges.filter((e) => !ae.has(e.id)), eRemoved = a.edges.filter((e) => !be.has(e.id));
  // A cable split / reconnect: cables both added and removed with the same count of items.
  if (added.length && removed.length) return `Changed ${plural(added.length + removed.length, 'item')}`;
  if (added.length) return added.length > 1 ? `Added ${plural(added.length, 'item')}${eAdded.length ? ` and ${plural(eAdded.length, 'cable')}` : ''}` : `Added ${nameOf(added[0])}`;
  if (removed.length) return things(removed, 'Deleted') + (eRemoved.length ? ` and ${plural(eRemoved.length, 'cable')}` : '');
  if (eAdded.length && eRemoved.length) return eAdded.length > eRemoved.length ? 'Split a cable' : 'Reconnected a cable';
  if (eAdded.length) return eAdded.length === 1 ? 'Added a cable' : `Added ${plural(eAdded.length, 'cable')}`;
  if (eRemoved.length) return eRemoved.length === 1 ? 'Deleted a cable' : `Deleted ${plural(eRemoved.length, 'cable')}`;

  const moved: AppNode[] = [], resized: AppNode[] = [], changed: AppNode[] = [], reordered: AppNode[] = [];
  for (const n of b.nodes) {
    const o = an.get(n.id);
    if (!o || o === n) continue;
    const x = stripNode(o) as Record<string, unknown>, y = stripNode(n) as Record<string, unknown>;
    if (same(x, y)) continue;
    if (!same(o.data, n.data)) changed.push(n);
    else if (o.position.x !== n.position.x || o.position.y !== n.position.y) {
      if ((o.width ?? 0) !== (n.width ?? 0) || (o.height ?? 0) !== (n.height ?? 0)) resized.push(n);
      else moved.push(n);
    } else if ((o.width ?? 0) !== (n.width ?? 0) || (o.height ?? 0) !== (n.height ?? 0)) resized.push(n);
    else if ((o.zIndex ?? 0) !== (n.zIndex ?? 0)) reordered.push(n);
  }
  if (changed.length) {
    // Text changes read best as what was typed.
    if (changed.length === 1) {
      const o = an.get(changed[0].id)!, n = changed[0];
      if (n.type === 'device' && o.type === 'device' && o.data.name !== n.data.name) return `Renamed ${o.data.name || 'device'} to ${n.data.name}`;
      if (n.type === 'shape' && o.type === 'shape' && o.data.text !== n.data.text) return `Typed in ${nameOf(n)}`;
    }
    return things(changed, 'Changed');
  }
  if (resized.length) return things(resized, 'Resized');
  if (moved.length) return things(moved, 'Moved');
  if (reordered.length) return things(reordered, 'Reordered');
  // Index order alone (Bring to Front / Send to Back).
  if (a.nodes.map((n) => n.id).join() !== b.nodes.map((n) => n.id).join()) return 'Changed the stacking order';
  const ec = b.edges.filter((e) => { const o = ae.get(e.id); return o && o !== e && !same(stripEdge(o), stripEdge(e)); });
  if (ec.length) return ec.length === 1 ? 'Changed a cable' : `Changed ${plural(ec.length, 'cable')}`;
  if (!same({ ...a, nodes: [], edges: [] }, { ...b, nodes: [], edges: [] })) return 'Changed page settings';
  return null;
}

/** A short name for the step that turned `a` into `b`. */
export function describeStep(a: HistoryState, b: HistoryState): string {
  const ap = new Map(a.pages.map((p) => [p.id, p])), bp = new Map(b.pages.map((p) => [p.id, p]));
  const pAdded = b.pages.filter((p) => !ap.has(p.id)), pRemoved = a.pages.filter((p) => !bp.has(p.id));
  if (pAdded.length) return `Added page "${pAdded[0].name}"`;
  if (pRemoved.length) return `Deleted page "${pRemoved[0].name}"`;
  if (a.pages.map((p) => p.id).join() !== b.pages.map((p) => p.id).join()) return 'Reordered pages';
  for (const p of b.pages) {
    const o = ap.get(p.id);
    if (!o || o === p) continue;
    const d = describePage(o, p);
    if (d) return a.pages.length > 1 && p.id !== b.activePageId ? `${d} (on ${p.name})` : d;
  }
  if (!same(a.racks, b.racks)) return 'Changed racks';
  return 'Change';
}
