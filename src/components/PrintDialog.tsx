'use client';

import { HeaderFooterEditor } from './HeaderFooterEditor';

import { useState } from 'react';
import { PAPER, type PaperSize, type PrintOptions } from '@/lib/print';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const PREF_KEY = 'netcraft.print';

/** Paper and orientation are remembered per viewer. */
function loadPrefs(): Pick<PrintOptions, 'paper' | 'landscape'> {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { paper: v.paper in PAPER ? v.paper : 'letter', landscape: v.landscape !== false };
  } catch {
    return { paper: 'letter', landscape: true };
  }
}

export function PrintDialog({ onPrint, onClose }: { onPrint: (o: PrintOptions) => void; onClose: () => void }) {
  const p = useCurrentProject();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [pageIds, setPageIds] = useState(() => p.pages.filter((pg) => pg.nodes.length && !pg.background).map((pg) => pg.id));
  const [racks, setRacks] = useState(!!p.racks?.length);
  const [tables, setTables] = useState(true);
  const tb = p.titleBlock;

  const submit = () => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      // Not remembered; printing still works.
    }
    onPrint({ ...prefs, pageIds, racks, tables });
  };
  const nothing = !pageIds.length && !(racks && p.racks?.length) && !tables;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form
        className="w-[420px] max-w-full rounded-lg bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <h2 className="font-semibold text-gray-900">Print</h2>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="space-y-3 p-4 text-sm">
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Paper</span>
              <select className="w-full rounded border border-gray-300 px-1.5 py-1" value={prefs.paper} onChange={(e) => setPrefs({ ...prefs, paper: e.target.value as PaperSize })}>
                {(Object.keys(PAPER) as PaperSize[]).map((k) => <option key={k} value={k}>{PAPER[k].label}</option>)}
              </select>
            </label>
            <label className="block w-36">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Orientation</span>
              <select className="w-full rounded border border-gray-300 px-1.5 py-1" value={prefs.landscape ? 'l' : 'p'} onChange={(e) => setPrefs({ ...prefs, landscape: e.target.value === 'l' })}>
                <option value="l">Landscape</option>
                <option value="p">Portrait</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-[11px] font-medium text-gray-500">Include</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {p.pages.map((pg) => (
                <label key={pg.id} className={`flex items-center gap-2 ${pg.nodes.length ? '' : 'text-gray-400'}`}>
                  <input
                    type="checkbox"
                    disabled={!pg.nodes.length}
                    checked={pageIds.includes(pg.id)}
                    onChange={(e) => setPageIds(e.target.checked ? [...pageIds, pg.id] : pageIds.filter((x) => x !== pg.id))}
                  />
                  {pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: {pg.name}{pg.nodes.length ? '' : ' (empty)'}
                </label>
              ))}
              <label className={`flex items-center gap-2 ${p.racks?.length ? '' : 'text-gray-400'}`}>
                <input type="checkbox" disabled={!p.racks?.length} checked={racks && !!p.racks?.length} onChange={(e) => setRacks(e.target.checked)} />
                Rack elevations{p.racks?.length ? ` (${p.racks.length})` : ' (none)'}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} />
                Device, rack and connection tables
              </label>
            </div>
          </fieldset>
          <p className="text-[11px] text-gray-500">
            {tb?.show ? 'Each sheet gets the title block.' : 'No title block.'}{' '}
            <button type="button" className="text-blue-600 hover:underline" onClick={() => useDiagram.getState().updateTitleBlock({ show: !tb?.show })}>
              {tb?.show ? 'Turn it off' : 'Add one'}
            </button>
            {' '}(edit it in the right panel with nothing selected).
          </p>
          <details className="rounded border border-gray-200 px-2 py-1">
            <summary className="cursor-pointer text-[11px] font-medium text-gray-600">Header &amp; footer</summary>
            <div className="pt-1.5"><HeaderFooterEditor /></div>
          </details>
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-2.5">
          <button type="button" className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={nothing} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Print…</button>
        </footer>
      </form>
    </div>
  );
}
