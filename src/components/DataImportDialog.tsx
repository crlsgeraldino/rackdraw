'use client';

import { useMemo, useState } from 'react';
import { FIELDS, MATCH_KEYS, autoMap, mappingFromNames, mappingToNames, planImport, type FieldKey, type Mapping, type Table } from '@/lib/dataImport';
import { STENCILS } from '@/lib/stencils';
import type { DataLink } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const LABEL: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

export function DataImportDialog({ fileName, table, link, onClose }: { fileName: string; table: Table; link?: DataLink; onClose: () => void }) {
  const project = useCurrentProject();
  const custom = useDiagram((s) => s.customStencils);
  const [mapping, setMapping] = useState<Mapping>(() => (link ? mappingFromNames(link.columns, table.headers) : autoMap(table.headers)));
  const firstMatch = (m: Mapping) => (MATCH_KEYS.find((k) => m[k] >= 0) ?? 'name') as FieldKey;
  const [matchKey, setMatchKey] = useState<FieldKey>(() => (link && mapping[link.matchKey as FieldKey] >= 0 ? (link.matchKey as FieldKey) : firstMatch(mapping)));
  const [createMissing, setCreateMissing] = useState(link?.createMissing ?? false);
  const [stencilId, setStencilId] = useState('workstation');
  const stencils = [...Object.values(custom), ...STENCILS];

  const plan = useMemo(() => (mapping[matchKey] >= 0 ? planImport(project, table, mapping, matchKey, createMissing) : null), [project, table, mapping, matchKey, createMissing]);
  const setCol = (k: FieldKey, i: number) => setMapping((m) => ({ ...m, [k]: i }));

  const apply = () => {
    if (!plan) return;
    const res = useDiagram.getState().applyImport(plan, stencilId, {
      fileName, columns: mappingToNames(mapping, table.headers), matchKey, createMissing, lastApplied: Date.now(),
    });
    alert(`Updated ${res.updated} device${res.updated === 1 ? '' : 's'}${res.created ? `, added ${res.created}` : ''}.${plan.skipped.length ? `\n${plan.skipped.length} row${plan.skipped.length === 1 ? '' : 's'} skipped.` : ''}\n\nUse Data → Refresh after you edit the sheet. Undo reverts this import.`);
    onClose();
  };

  const nothing = plan && !plan.updates.length && !plan.creates.length;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex h-[620px] max-h-full w-[980px] max-w-full flex-col rounded-lg bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">{link ? 'Refresh data' : 'Import data'}</h2>
            <p className="text-xs text-gray-500">{fileName} · {table.rows.length} rows · {table.headers.length} columns</p>
          </div>
          <button className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="w-80 shrink-0 overflow-y-auto border-r border-gray-200 p-3 text-sm">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Columns</h3>
            <table className="w-full">
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.key}>
                    <td className="py-0.5 pr-2 text-xs text-gray-600">{f.label}</td>
                    <td className="py-0.5">
                      <select className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs" value={mapping[f.key]} onChange={(e) => setCol(f.key, Number(e.target.value))}>
                        <option value={-1}>— not imported —</option>
                        {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Match rows to devices by</h3>
            <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={matchKey} onChange={(e) => setMatchKey(e.target.value as FieldKey)}>
              {MATCH_KEYS.map((k) => <option key={k} value={k} disabled={mapping[k] < 0}>{LABEL[k]}{mapping[k] < 0 ? ' (column not mapped)' : ''}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-gray-400">NetCraft ID is exact (use Data → Export device list). Names, asset tags, serials, IPs and MACs ignore case and spacing.</p>

            <label className="mt-4 flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
              Add devices for rows that don&apos;t match
            </label>
            {createMissing && (
              <label className="mt-1 block text-xs text-gray-600">
                New devices use the row&apos;s Type when it names a stencil, otherwise:
                <select className="mt-0.5 w-full rounded border border-gray-300 px-1 py-0.5 text-xs" value={stencilId} onChange={(e) => setStencilId(e.target.value)}>
                  {stencils.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col p-3 text-sm">
            {!plan ? (
              <p className="text-gray-500">Map a column for “{LABEL[matchKey]}” to match rows to devices.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-blue-50 px-2 py-1 text-blue-700"><b>{plan.updates.length}</b> to update</span>
                  {createMissing && <span className="rounded bg-green-50 px-2 py-1 text-green-700"><b>{plan.creates.length}</b> to add</span>}
                  <span className="rounded bg-gray-100 px-2 py-1 text-gray-600"><b>{plan.unchanged}</b> already up to date</span>
                  {plan.skipped.length > 0 && <span className="rounded bg-amber-50 px-2 py-1 text-amber-700"><b>{plan.skipped.length}</b> skipped</span>}
                </div>
                <div className="flex-1 overflow-y-auto rounded border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-left text-[10px] uppercase text-gray-500">
                      <tr><th className="px-2 py-1">Device</th><th className="px-2 py-1">Field</th><th className="px-2 py-1">Now</th><th className="px-2 py-1">After import</th></tr>
                    </thead>
                    <tbody>
                      {plan.updates.slice(0, 300).flatMap((u) => u.changes.map((c, i) => (
                        <tr key={`${u.nodeId}-${c.field}`} className="border-t border-gray-100">
                          <td className="px-2 py-0.5 font-medium">{i === 0 ? u.name : ''}</td>
                          <td className="px-2 py-0.5 text-gray-500">{LABEL[c.field]}</td>
                          <td className="px-2 py-0.5 text-gray-400 line-through">{c.from}</td>
                          <td className="px-2 py-0.5 text-blue-700">{c.to}</td>
                        </tr>
                      )))}
                      {createMissing && plan.creates.slice(0, 200).map((c, i) => (
                        <tr key={`new-${i}`} className="border-t border-gray-100">
                          <td className="px-2 py-0.5 font-medium text-green-700">+ {c.data.name}</td>
                          <td className="px-2 py-0.5 text-gray-500" colSpan={3}>{[c.type, c.data.model, c.data.ip].filter(Boolean).join(' · ') || 'new device'}</td>
                        </tr>
                      ))}
                      {plan.skipped.slice(0, 200).map((s) => (
                        <tr key={`skip-${s.row}`} className="border-t border-gray-100 text-amber-700">
                          <td className="px-2 py-0.5">Row {s.row}</td>
                          <td className="px-2 py-0.5" colSpan={3}>Skipped: {s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">Empty cells never erase existing values.</p>
              </>
            )}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-2.5">
          <button className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Cancel</button>
          <button disabled={!plan || !!nothing} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" onClick={apply}>
            {nothing ? 'Nothing to change' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>
  );
}
