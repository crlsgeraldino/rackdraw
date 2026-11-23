'use client';

import { useReactFlow } from '@xyflow/react';
import { useMemo, useRef, useState } from 'react';
import { setPref } from '@/lib/prefs';
import { DEVICE_STATUSES, type AppNode, type DeviceData, type DeviceNode } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

type Col = { key: string; label: string; mono?: boolean; width: number };

const BASE: Col[] = [
  { key: 'name', label: 'Name', width: 150 },
  { key: 'model', label: 'Model', width: 130 },
  { key: 'ip', label: 'IP', mono: true, width: 110 },
  { key: 'mac', label: 'MAC', mono: true, width: 130 },
  { key: 'serial', label: 'Serial', mono: true, width: 110 },
  { key: 'location', label: 'Location', width: 110 },
  { key: 'status', label: 'Status', width: 100 },
  { key: 'assetTag', label: 'Asset tag', width: 90 },
];

const key = (s: string) => s.trim().toLowerCase();

function valueOf(d: DeviceData, k: string): string {
  if (k.startsWith('x:')) return d.extraFields?.find((f) => key(f.label) === key(k.slice(2)))?.value ?? '';
  if (k === 'status') return d.status ?? 'active';
  return ((d as Record<string, unknown>)[k] as string | undefined) ?? '';
}

function patchFor(d: DeviceData, k: string, v: string): Partial<DeviceData> {
  if (k.startsWith('x:')) {
    const label = k.slice(2);
    const list = d.extraFields ?? [];
    const has = list.some((f) => key(f.label) === key(label));
    const next = (has ? list.map((f) => (key(f.label) === key(label) ? { ...f, value: v } : f)) : [...list, { label, value: v }]).filter((f) => f.value !== '' || key(f.label) !== key(label));
    return { extraFields: next.length ? next : undefined };
  }
  if (k === 'name') return { name: v };
  return { [k]: v || undefined } as Partial<DeviceData>;
}

/** One editable cell: shows the value, edits in place; Enter / Tab / leaving the cell saves (one undo step each). */
function Cell({ value, mono, onSave }: { value: string; mono?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => { if (draft !== null && draft !== value) onSave(draft); setDraft(null); };
  return (
    <input
      className={`h-full w-full bg-transparent px-1.5 text-xs outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`}
      value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/**
 * View → Device Table (like Visio's External Data window): every device as a spreadsheet row under the drawing.
 * Type in the cells to fill in details, sort by a column, filter, and click a row's name to go to the device.
 */
export function DeviceTable() {
  const project = useCurrentProject();
  const rf = useReactFlow<AppNode>();
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [q, setQ] = useState('');
  const [height, setHeight] = useState(220);
  const drag = useRef<{ y: number; h: number } | null>(null);

  // The client's own fields (Define Shape Data and any used on a device).
  const cols = useMemo(() => {
    const labels = new Map<string, string>();
    for (const d of project.fieldDefs ?? []) if (d.label.trim()) labels.set(key(d.label), d.label.trim());
    for (const pg of project.pages) for (const n of pg.nodes) if (n.type === 'device') for (const f of n.data.extraFields ?? []) if (f.label.trim() && !labels.has(key(f.label))) labels.set(key(f.label), f.label.trim());
    return [...BASE, ...[...labels.values()].map((l): Col => ({ key: `x:${l}`, label: l, width: 110 }))];
  }, [project.fieldDefs, project.pages]);

  const rows = useMemo(() => {
    const out: { pageId: string; pageName: string; n: DeviceNode }[] = [];
    for (const pg of project.pages) {
      if (scope === 'page' && pg.id !== project.activePageId) continue;
      for (const n of pg.nodes) if (n.type === 'device') out.push({ pageId: pg.id, pageName: pg.name, n });
    }
    const term = q.trim().toLowerCase();
    const shown = term ? out.filter((r) => cols.some((c) => valueOf(r.n.data, c.key).toLowerCase().includes(term))) : out;
    return [...shown].sort((a, b) => valueOf(a.n.data, sort.key).localeCompare(valueOf(b.n.data, sort.key), undefined, { numeric: true }) * sort.dir);
  }, [project.pages, project.activePageId, scope, q, sort, cols]);

  const s = useDiagram.getState();
  const go = (pageId: string, id: string) => {
    if (pageId !== project.activePageId) s.setActivePage(pageId);
    setTimeout(() => {
      useDiagram.getState().selectItem(pageId, 'node', id);
      void rf.fitView({ nodes: [{ id }], maxZoom: 1.2, padding: 1.5, duration: 200 });
    }, pageId !== project.activePageId ? 150 : 0);
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-gray-300 bg-white" style={{ height }}>
      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200"
        onPointerDown={(e) => { drag.current = { y: e.clientY, h: height }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setHeight(Math.max(110, Math.min(600, drag.current.h - (e.clientY - drag.current.y)))); }}
        onPointerUp={() => { drag.current = null; }}
        title="Drag to resize"
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-1 text-xs">
        <span className="font-semibold text-gray-700">Device Table</span>
        <select className="rounded border border-gray-300 px-1 py-0.5" value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'all')}>
          <option value="page">This page</option>
          <option value="all">All pages</option>
        </select>
        <input className="w-48 rounded border border-gray-300 px-1.5 py-0.5" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-gray-400">{rows.length} device{rows.length === 1 ? '' : 's'} · type in a cell to change it</span>
        <button className="ml-auto rounded px-1.5 text-base leading-none text-gray-500 hover:bg-gray-100" onClick={() => setPref('deviceTable', false)} aria-label="Close the device table">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: 28 + (scope === 'all' ? 110 : 0) + cols.reduce((w, c) => w + c.width, 0) }}>
          <thead className="sticky top-0 z-10 bg-gray-100">
            <tr>
              <th className="w-7 border border-gray-200" />
              {scope === 'all' && <th className="border border-gray-200 px-1.5 py-1 text-left font-medium text-gray-600" style={{ width: 110 }}>Page</th>}
              {cols.map((c) => (
                <th key={c.key} className="cursor-pointer select-none border border-gray-200 px-1.5 py-1 text-left font-medium text-gray-600 hover:bg-gray-200" style={{ width: c.width }}
                  onClick={() => setSort(sort.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pageId, pageName, n }) => (
              <tr key={n.id} className={n.selected && pageId === project.activePageId ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                <td className="border border-gray-200 text-center">
                  <button className="text-blue-600 hover:text-blue-800" title="Go to this device" aria-label={`Go to ${n.data.name}`} onClick={() => go(pageId, n.id)}>➜</button>
                </td>
                {scope === 'all' && <td className="truncate border border-gray-200 px-1.5 text-gray-500">{pageName}</td>}
                {cols.map((c) => (
                  <td key={c.key} className="h-6 border border-gray-200 p-0">
                    {c.key === 'status' ? (
                      <select className="h-full w-full bg-transparent px-1 text-xs outline-none" value={valueOf(n.data, 'status')}
                        onChange={(e) => s.updateDeviceOnPage(pageId, n.id, { status: e.target.value as DeviceData['status'] })}>
                        {DEVICE_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                      </select>
                    ) : (
                      <Cell value={valueOf(n.data, c.key)} mono={c.mono} onSave={(v) => s.updateDeviceOnPage(pageId, n.id, patchFor(n.data, c.key, v))} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 2} className="px-3 py-4 text-center text-gray-400">{q ? 'No device matches the filter.' : 'No devices here yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
