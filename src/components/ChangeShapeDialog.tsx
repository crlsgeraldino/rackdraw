'use client';

import { useEffect, useMemo, useState } from 'react';
import { STENCILS, StencilThumb } from '@/lib/stencils';
import type { StencilDef } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';

/** Opens Change Shape for the selected devices. */
export const CHANGE_SHAPE_EVENT = 'netcraft:change-shape';
export const openChangeShape = () => window.dispatchEvent(new Event(CHANGE_SHAPE_EVENT));

/**
 * Change Shape (Visio): pick another shape for the selected devices. Name, details, notes and racks stay; cables
 * and port notes move to the matching ports of the new shape.
 */
export function ChangeShapeDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const custom = useDiagram((s) => s.customStencils);
  useEffect(() => {
    const show = () => { setQ(''); setOpen(true); };
    window.addEventListener(CHANGE_SHAPE_EVENT, show);
    return () => window.removeEventListener(CHANGE_SHAPE_EVENT, show);
  }, []);
  const all = useMemo(() => [...STENCILS.filter((s) => s.category !== 'Layout'), ...Object.values(custom)], [custom]);
  const term = q.trim().toLowerCase();
  const shown = all.filter((s) => !term || `${s.name} ${s.vendor ?? ''} ${s.category} ${s.library ?? ''}`.toLowerCase().includes(term));
  const groups = new Map<string, StencilDef[]>();
  for (const s of shown) {
    const g = s.custom ? s.library || 'My stencils' : s.category;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  if (!open) return null;
  const pick = (s: StencilDef) => {
    const dropped = useDiagram.getState().changeShape(s.id);
    setOpen(false);
    if (dropped) alert(`${dropped} cable${dropped === 1 ? '' : 's'} had no matching port on "${s.name}" and ${dropped === 1 ? 'was' : 'were'} removed. Undo (Ctrl+Z) to go back.`);
  };
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="flex max-h-[85vh] w-[min(720px,94vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Change Shape" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-900">Change Shape</h2>
          <input autoFocus className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" placeholder="Search shapes" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <p className="border-b border-gray-100 px-4 py-1.5 text-[11px] text-gray-500">The device keeps its name, details, notes and rack spot; cables and port notes move to the matching ports.</p>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {[...groups.entries()].map(([g, list]) => (
            <section key={g} className="mb-3">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g}</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {list.map((s) => (
                  <button key={s.id} className="flex flex-col items-start gap-1 rounded border border-gray-200 p-1.5 text-left hover:border-blue-400 hover:bg-blue-50" onClick={() => pick(s)} title={s.name}>
                    <div className="flex h-10 w-full items-center justify-center overflow-hidden"><StencilThumb stencil={s} /></div>
                    <span className="w-full truncate text-[11px] text-gray-700">{s.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!shown.length && <p className="py-6 text-center text-sm text-gray-400">No shapes match.</p>}
        </div>
      </div>
    </div>
  );
}
