'use client';

import { useRef } from 'react';
import { STENCIL_CATEGORIES, type FieldDef, type FieldType } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const uid = () => Math.random().toString(36).slice(2, 10);
const TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'list', label: 'Pick list' },
  { value: 'yesno', label: 'Yes / No' },
];
const STARTERS: Omit<FieldDef, 'id'>[] = [
  { label: 'ISP', type: 'list', options: ['Spectrum', 'Verizon', 'Optimum', 'Pilot Fiber', 'AT&T'] },
  { label: 'Warranty expires', type: 'date' },
  { label: 'Firmware', type: 'text' },
  { label: 'Under contract', type: 'yesno' },
];

/**
 * Data → Define Shape Data (Visio): the fields every device of this client has, with a type, a pick-list for list
 * fields, "required" (flagged by Check Diagram) and an optional device category. Values are kept on each device by
 * field name, so they also show in the info box, quick info, reports and exports.
 */
export function DefineShapeDataDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const setDefs = useDiagram((s) => s.setFieldDefs);
  const defs = project.fieldDefs ?? [];
  const renaming = useRef<{ id: string; from: string } | null>(null);
  const change = (id: string, patch: Partial<FieldDef>) => setDefs(defs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = (d: Omit<FieldDef, 'id'>) => setDefs([...defs, { ...d, id: `f-${uid()}` }]);
  const remove = (d: FieldDef) => {
    if (confirm(`Remove the field "${d.label}"? Values already typed on devices stay as their own fields.`)) setDefs(defs.filter((x) => x.id !== d.id));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= defs.length) return;
    const next = [...defs];
    [next[i], next[j]] = [next[j], next[i]];
    setDefs(next);
  };
  const sel = 'rounded border border-gray-300 px-1.5 py-1 text-sm';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-[min(860px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Define Shape Data">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Define Shape Data</h2>
          <span className="ml-3 text-xs text-gray-500">Fields every device of {project.name} has, shown in Shape Data with the right kind of input.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {defs.length > 0 && (
            <div className="mb-1 grid grid-cols-[1fr_7rem_1.4fr_8rem_4rem_3.5rem] gap-2 px-1 text-[11px] font-medium text-gray-500">
              <span>Name</span><span>Type</span><span>Choices (pick list, one per comma)</span><span>Devices</span><span>Required</span><span />
            </div>
          )}
          <div className="space-y-1">
            {defs.map((d, i) => (
              <div key={d.id} className="grid grid-cols-[1fr_7rem_1.4fr_8rem_4rem_3.5rem] items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
                <input
                  className={sel} value={d.label} placeholder="Field name"
                  onFocus={() => { renaming.current = { id: d.id, from: d.label }; }}
                  onChange={(e) => change(d.id, { label: e.target.value })}
                  onBlur={() => {
                    const r = renaming.current;
                    renaming.current = null;
                    // Renaming a field renames it on every device that already has a value.
                    if (r && r.id === d.id && r.from !== d.label && d.label.trim()) setDefs(defs, { from: r.from, to: d.label.trim() });
                  }}
                />
                <select className={sel} value={d.type} onChange={(e) => change(d.id, { type: e.target.value as FieldType })}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {d.type === 'list' ? (
                  <input
                    className={sel} placeholder="e.g. Spectrum, Verizon, Pilot Fiber" defaultValue={(d.options ?? []).join(', ')}
                    onBlur={(e) => change(d.id, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                  />
                ) : <span className="text-xs text-gray-400">—</span>}
                <select className={sel} value={d.category ?? ''} onChange={(e) => change(d.id, { category: (e.target.value || undefined) as FieldDef['category'] })}>
                  <option value="">All devices</option>
                  {STENCIL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="checkbox" className="justify-self-center" checked={!!d.required} onChange={(e) => change(d.id, { required: e.target.checked || undefined })} aria-label={`${d.label} required`} />
                <div className="flex items-center justify-end gap-0.5 text-gray-500">
                  <button className="px-1 hover:text-gray-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${d.label} up`}>↑</button>
                  <button className="px-1 hover:text-gray-900 disabled:opacity-30" disabled={i === defs.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${d.label} down`}>↓</button>
                  <button className="px-1 hover:text-red-600" onClick={() => remove(d)} aria-label={`Remove ${d.label}`}>×</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50" onClick={() => add({ label: '', type: 'text' })}>+ Add field</button>
            <span className="text-xs text-gray-500">Quick add:</span>
            {STARTERS.filter((x) => !defs.some((d) => d.label.toLowerCase() === x.label.toLowerCase())).map((x) => (
              <button key={x.label} className="rounded border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50" onClick={() => add(x)}>{x.label}</button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-500">
            Values are typed per device under <b>Shape Data</b>. They show in the info box and quick info like your own fields, can be
            columns in Data → Reports, and go to Excel, CSV, Word and .vsdx. <b>Required</b> fields that are empty are listed by Check Diagram.
          </p>
        </div>
        <div className="flex justify-end border-t border-gray-200 px-4 py-2">
          <button className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
