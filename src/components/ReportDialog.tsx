'use client';

import { useMemo, useState } from 'react';
import { writeDocx } from '@/lib/docx';
import { downloadBlob, safeName } from '@/lib/export';
import { DEFAULT_REPORT, reportFields, runReport, type ReportDef, type ReportOp } from '@/lib/report';
import { writeXlsx } from '@/lib/xlsx';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const uid = () => Math.random().toString(36).slice(2, 10);
const stencilName = (id: string) => getStencil(id)?.name ?? id;

const OPS: { value: ReportOp; label: string }[] = [
  { value: 'exists', label: 'has a value' },
  { value: 'missing', label: 'is empty' },
  { value: 'equals', label: 'is' },
  { value: 'contains', label: 'contains' },
];

/** Data → Reports: Visio's Report wizard — define, preview and export device reports. Definitions are saved per client. */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const saveReports = useDiagram((s) => s.saveReports);
  const saved = project.reports ?? [];
  const reports = saved.length ? saved : [{ id: 'default', ...DEFAULT_REPORT }];
  const [currentId, setCurrentId] = useState(reports[0].id);
  const def = reports.find((r) => r.id === currentId) ?? reports[0];
  const fields = useMemo(() => reportFields(project), [project]);
  const result = useMemo(() => runReport(project, def, stencilName), [project, def]);
  const [copied, setCopied] = useState(false);

  const save = (list: ReportDef[]) => saveReports(list);
  const change = (patch: Partial<ReportDef>) => save(reports.map((r) => (r.id === def.id ? { ...r, ...patch } : r)));
  const add = () => {
    const r: ReportDef = { ...DEFAULT_REPORT, id: `r-${uid()}`, name: `Report ${reports.length + 1}` };
    save([...reports, r]);
    setCurrentId(r.id);
  };
  const remove = () => {
    if (!confirm(`Delete the report "${def.name}"?`)) return;
    const rest = reports.filter((r) => r.id !== def.id);
    save(rest);
    setCurrentId(rest[0]?.id ?? 'default');
  };
  const toggleField = (key: string) => change({ fields: def.fields.includes(key) ? def.fields.filter((k) => k !== key) : [...def.fields, key] });
  const move = (i: number, d: -1 | 1) => {
    const f = [...def.fields];
    const j = i + d;
    if (j < 0 || j >= f.length) return;
    [f[i], f[j]] = [f[j], f[i]];
    change({ fields: f });
  };
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k.replace(/^x:/, '');
  const file = `${safeName(project.name)}-${safeName(def.name)}`;

  const toExcel = () => downloadBlob(`${file}.xlsx`, new Blob([writeXlsx(def.name, result.header, result.rows) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const toWord = () => {
    const sub = [project.site, new Date().toLocaleDateString(), `${result.count} device${result.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const bytes = writeDocx({
      title: `${project.name} – ${def.name}`,
      landscape: result.header.length > 5,
      media: {},
      blocks: [
        { kind: 'title', text: def.name },
        { kind: 'para', text: `${project.name}${sub ? ` · ${sub}` : ''}`, color: '#6B7280' },
        { kind: 'table', header: result.header, rows: result.rows.map((r) => r.map((c) => String(c))) },
      ],
    });
    downloadBlob(`${file}.docx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  };
  const toCsv = () => {
    const csv = [result.header, ...result.rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBlob(`${file}.csv`, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  };
  const copy = async () => {
    // Tab-separated, so it pastes into Excel or Word as a table.
    const tsv = [result.header, ...result.rows].map((r) => r.map((c) => String(c).replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sel = 'rounded border border-gray-300 px-1.5 py-1 text-sm';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Reports">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Reports</h2>
          <span className="ml-3 text-xs text-gray-500">Pick the devices and fields, then export to Excel, Word or CSV. Reports are saved with this client.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* Saved reports */}
          <div className="flex w-48 shrink-0 flex-col border-r border-gray-200 p-2">
            <ul className="flex-1 space-y-0.5 overflow-auto">
              {reports.map((r) => (
                <li key={r.id}>
                  <button className={`w-full truncate rounded px-2 py-1 text-left text-sm ${r.id === def.id ? 'bg-blue-50 font-medium text-blue-800' : 'hover:bg-gray-50'}`} onClick={() => setCurrentId(r.id)}>{r.name}</button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-1">
              <button className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" onClick={add}>New</button>
              <button className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40" onClick={remove} disabled={!saved.length}>Delete</button>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-auto p-3">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
              <span className="text-gray-600">Name</span>
              <input className={`${sel} max-w-sm`} value={def.name} onChange={(e) => change({ name: e.target.value })} />
              <span className="text-gray-600">Devices on</span>
              <div className="flex flex-wrap items-center gap-2">
                <select className={sel} value={def.pageId ?? ''} onChange={(e) => change({ pageId: e.target.value || undefined })}>
                  <option value="">Every page</option>
                  {project.pages.map((pg) => <option key={pg.id} value={pg.id}>{pg.name}</option>)}
                </select>
                <span className="text-gray-600">layer</span>
                <select className={sel} value={def.layer ?? ''} onChange={(e) => change({ layer: e.target.value || undefined })}>
                  <option value="">Any</option>
                  <option value="-">No layer</option>
                  {(project.layers ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <span className="text-gray-600">Only where</span>
              <div className="flex flex-wrap items-center gap-2">
                <select className={sel} value={def.filter?.field ?? ''} onChange={(e) => change({ filter: e.target.value ? { op: def.filter?.op ?? 'exists', value: def.filter?.value, field: e.target.value } : undefined })}>
                  <option value="">(all devices)</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                {def.filter && (
                  <>
                    <select className={sel} value={def.filter.op} onChange={(e) => change({ filter: { ...def.filter!, op: e.target.value as ReportOp } })}>
                      {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {(def.filter.op === 'equals' || def.filter.op === 'contains') && (
                      <input className={`${sel} w-40`} value={def.filter.value ?? ''} onChange={(e) => change({ filter: { ...def.filter!, value: e.target.value } })} />
                    )}
                  </>
                )}
              </div>
              <span className="text-gray-600">Sort by</span>
              <div className="flex items-center gap-3">
                <select className={sel} value={def.sortBy ?? ''} onChange={(e) => change({ sortBy: e.target.value || undefined })}>
                  <option value="">Diagram order</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={!!def.totals} onChange={(e) => change({ totals: e.target.checked || undefined })} /> Totals row</label>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fields</div>
                <div className="grid max-h-40 grid-cols-2 gap-x-2 overflow-auto rounded border border-gray-200 p-1.5 text-sm">
                  {fields.map((f) => (
                    <label key={f.key} className="flex items-center gap-1.5 truncate">
                      <input type="checkbox" checked={def.fields.includes(f.key)} onChange={() => toggleField(f.key)} />
                      <span className={f.key.startsWith('x:') ? 'italic' : ''}>{f.label}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Italic names are your own fields (My fields).</p>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Column order</div>
                <ol className="max-h-40 overflow-auto rounded border border-gray-200 p-1 text-sm">
                  {def.fields.map((k, i) => (
                    <li key={k} className="flex items-center gap-1 rounded px-1 hover:bg-gray-50">
                      <span className="flex-1 truncate">{label(k)}</span>
                      <button className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(k)} up`}>↑</button>
                      <button className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === def.fields.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(k)} down`}>↓</button>
                      <button className="px-1 text-gray-400 hover:text-red-600" onClick={() => toggleField(k)} aria-label={`Remove ${label(k)}`}>×</button>
                    </li>
                  ))}
                  {!def.fields.length && <li className="px-1 text-gray-400">Tick fields on the left.</li>}
                </ol>
              </div>
            </div>

            <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preview · {result.count} device{result.count === 1 ? '' : 's'}</div>
            <div className="min-h-24 flex-1 overflow-auto rounded border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-100">
                  <tr>{result.header.map((h, i) => <th key={i} className="border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className={def.totals && i === result.rows.length - 1 ? 'bg-gray-50 font-semibold' : 'odd:bg-white even:bg-gray-50/50'}>
                      {r.map((c, j) => <td key={j} className="border-b border-gray-100 px-2 py-0.5 align-top whitespace-pre-wrap">{String(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-2">
          <button className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-40" onClick={toExcel} disabled={!def.fields.length}>Excel (.xlsx)</button>
          <button className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40" onClick={toWord} disabled={!def.fields.length}>Word (.docx)</button>
          <button className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40" onClick={toCsv} disabled={!def.fields.length}>CSV</button>
          <button className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40" onClick={copy} disabled={!def.fields.length}>{copied ? 'Copied' : 'Copy table'}</button>
          <button className="ml-auto rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
