'use client';

import { useEffect, useMemo, useState } from 'react';
import { numberText, orderItems, type NumberOptions, type NumberOrder, type NumberPlace } from '@/lib/numbering';
import { useCurrentPage, useDiagram } from '@/store/useDiagramStore';
import { useEscape } from '@/lib/useEscape';

export const NUMBER_SHAPES_EVENT = 'netcraft:number-shapes';
export const openNumberShapes = () => window.dispatchEvent(new Event(NUMBER_SHAPES_EVENT));

type Scope = 'selection' | 'devices' | 'all';

/**
 * Number Shapes (like Visio's add-on): gives the selected items, or every device on the page, numbered names in
 * reading order, e.g. AP-01, AP-02… or "Camera 1", "Camera 2"…. One undo step.
 */
export function NumberShapesDialog() {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  const page = useCurrentPage();
  const [scope, setScope] = useState<Scope>('selection');
  const [order, setOrder] = useState<NumberOrder>('rows');
  const [o, setO] = useState<NumberOptions>({ start: 1, step: 1, digits: 2, prefix: '', place: 'after', renumber: true });
  useEffect(() => {
    const show = () => {
      const pg = useDiagram.getState();
      const anySel = pg.projects[pg.currentId].pages.find((p) => p.id === pg.projects[pg.currentId].activePageId)?.nodes.some((n) => n.selected && n.type !== 'backdrop');
      setScope(anySel ? 'selection' : 'devices');
      setOpen(true);
    };
    window.addEventListener(NUMBER_SHAPES_EVENT, show);
    return () => window.removeEventListener(NUMBER_SHAPES_EVENT, show);
  }, []);

  const items = useMemo(() => page.nodes.flatMap((n) => {
    if (n.type === 'backdrop' || n.type === 'note' || n.type === 'measure') return [];
    if (n.type === 'shape' && n.data.kind === 'table') return [];
    if (scope === 'selection' ? !n.selected : scope === 'devices' ? n.type !== 'device' : false) return [];
    const text = n.type === 'device' ? n.data.name : n.type === 'shape' ? n.data.text : n.type === 'zone' ? n.data.title : '';
    if (n.data.locked) return [];
    return [{ id: n.id, x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 80, h: n.measured?.height ?? n.height ?? 80, text: text ?? '' }];
  }), [page.nodes, scope]);
  const ordered = useMemo(() => orderItems(items, order), [items, order]);
  const renamed = ordered.map((it, i) => ({ ...it, next: numberText(it.text, i, o) }));

  if (!open) return null;
  const num = (k: 'start' | 'step' | 'digits', min: number) => (
    <input type="number" min={min} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" value={o[k]}
      onChange={(e) => setO({ ...o, [k]: Math.max(min, Number(e.target.value) || min) })} />
  );
  const apply = () => {
    useDiagram.getState().renameItems(new Map(renamed.filter((r) => r.next !== r.text).map((r) => [r.id, r.next])));
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-[min(560px,94vw)] rounded-lg bg-white text-sm shadow-xl" role="dialog" aria-label="Number Shapes">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-900">Number Shapes</h2>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 text-xs">
          <span className="text-gray-600">Apply to</span>
          <select className="rounded border border-gray-300 px-1.5 py-0.5" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="selection">Selected items</option>
            <option value="devices">All devices on this page</option>
            <option value="all">Everything on this page (devices, shapes, zones)</option>
          </select>
          <span className="text-gray-600">Number</span>
          <div className="flex items-center gap-2">
            Start {num('start', 0)} Step {num('step', 1)} Digits {num('digits', 1)}
          </div>
          <span className="text-gray-600">Prefix</span>
          <input className="w-40 rounded border border-gray-300 px-1.5 py-0.5" placeholder="e.g. AP- or #" value={o.prefix} onChange={(e) => setO({ ...o, prefix: e.target.value })} />
          <span className="text-gray-600">Put the number</span>
          <select className="rounded border border-gray-300 px-1.5 py-0.5" value={o.place} onChange={(e) => setO({ ...o, place: e.target.value as NumberPlace })}>
            <option value="after">After the name (Camera 01)</option>
            <option value="before">Before the name (01 Camera)</option>
            <option value="replace">Instead of the name (prefix + number)</option>
          </select>
          <span />
          <label className="flex items-center gap-1.5" title="A name that already ends (or starts) with a number gets the new one instead of a second number">
            <input type="checkbox" checked={o.renumber} disabled={o.place === 'replace'} onChange={(e) => setO({ ...o, renumber: e.target.checked })} />
            Replace an existing number (renumber)
          </label>
          <span className="text-gray-600">Order</span>
          <select className="rounded border border-gray-300 px-1.5 py-0.5" value={order} onChange={(e) => setOrder(e.target.value as NumberOrder)}>
            <option value="rows">Left to right, then top to bottom</option>
            <option value="columns">Top to bottom, then left to right</option>
            <option value="selection">Drawing order (back to front)</option>
          </select>
        </div>
        <div className="mx-4 max-h-48 overflow-y-auto rounded border border-gray-200">
          {renamed.length === 0 && <p className="px-3 py-4 text-center text-xs text-gray-400">Nothing to number. Select devices or shapes first, or choose another option above.</p>}
          {renamed.map((r) => (
            <div key={r.id} className="flex gap-2 border-b border-gray-100 px-3 py-1 text-xs last:border-0">
              <span className="w-1/2 truncate text-gray-500">{r.text || '(no name)'}</span>
              <span className="text-gray-400">→</span>
              <span className="truncate font-medium text-gray-900">{r.next}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <span className="mr-auto text-[11px] text-gray-400">Locked items are skipped. Undo with Ctrl+Z.</span>
          <button className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50" onClick={() => setOpen(false)}>Cancel</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={!renamed.length} onClick={apply}>Number {renamed.length || ''}</button>
        </div>
      </div>
    </div>
  );
}
