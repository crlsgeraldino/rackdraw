'use client';

import { useMemo, useState } from 'react';
import { STENCILS, StencilThumb } from '@/lib/stencils';
import type { StencilCategory } from '@/lib/types';

export const DND_TYPE = 'application/x-netcraft-stencil';

const ORDER: StencilCategory[] = ['Firewalls', 'Switching', 'WAN', 'Wireless', 'Servers', 'Endpoints'];

export function Palette() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = STENCILS.filter((s) => !term || `${s.name} ${s.vendor ?? ''} ${s.category}`.toLowerCase().includes(term));
    return ORDER.map((c) => ({ c, items: list.filter((s) => s.category === c) })).filter((g) => g.items.length);
  }, [q]);

  const drag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(DND_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-2">
        <input
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          placeholder="Search shapes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map(({ c, items }) => (
          <section key={c} className="mb-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{c}</h3>
            <div className="grid grid-cols-1 gap-1">
              {items.map((s) => (
                <div
                  key={s.id}
                  draggable
                  onDragStart={(e) => drag(e, s.id)}
                  className={`flex cursor-grab gap-2 rounded border border-transparent p-1.5 hover:border-gray-200 hover:bg-gray-50 active:cursor-grabbing ${s.style === 'panel' ? 'flex-col items-start' : 'items-center'}`}
                  title={`Drag onto the canvas: ${s.name}`}
                >
                  <div className={s.style === 'icon' ? 'flex w-10 shrink-0 justify-center' : ''}><StencilThumb stencil={s} /></div>
                  <span className="text-xs text-gray-700">{s.name}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
        <section className="mb-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layout</h3>
          <div className="grid grid-cols-2 gap-1">
            <div draggable onDragStart={(e) => drag(e, '__zone')} className="cursor-grab rounded border-2 border-dashed border-blue-400 bg-blue-50 p-2 text-center text-[11px] text-blue-700">Zone / room</div>
            <div draggable onDragStart={(e) => drag(e, '__note')} className="cursor-grab rounded bg-yellow-100 p-2 text-center text-[11px] text-gray-700 shadow-sm">Note</div>
          </div>
        </section>
      </div>
      <p className="border-t border-gray-200 p-2 text-[10px] leading-snug text-gray-500">
        Drag a shape onto the canvas. Drag from one port to another to draw a cable.
      </p>
    </aside>
  );
}
