'use client';

import { useMemo, useState } from 'react';
import { billOfMaterials, bomRows } from '@/lib/bom';
import { downloadBlob, safeName } from '@/lib/export';
import { writeXlsx } from '@/lib/xlsx';
import { getStencil, useCurrentProject } from '@/store/useDiagramStore';

const HEADER = ['Section', 'Item', 'Detail', 'Qty', 'Unit'];
const CAP_HEADER = ['Device', 'Model', 'Ports', 'Used', 'Free', 'PoE ports', 'PoE W', 'PoE budget W', 'Check'];

/** Data → Bill of Materials: what to order for this client, counted from its diagrams and racks, plus port capacity. */
export function BomDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const { sections, capacity } = useMemo(() => billOfMaterials(project, getStencil), [project]);
  const [tab, setTab] = useState<'bom' | 'capacity'>('bom');
  const [copied, setCopied] = useState(false);
  const capRows = capacity.map((c) => [c.device, c.model, c.ports, c.used, c.free, c.poePorts || '', c.poeW || '', c.poeBudgetW || '', c.warning]);
  const file = `${safeName(project.name)}-bill-of-materials`;
  const [header, rows] = tab === 'bom' ? [HEADER, bomRows(sections)] : [CAP_HEADER, capRows];

  const toExcel = () => downloadBlob(`${file}.xlsx`, new Blob([writeXlsx(tab === 'bom' ? 'Bill of materials' : 'Port capacity', header, rows) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const toCsv = () => {
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBlob(`${file}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  };
  const copy = async () => {
    await navigator.clipboard.writeText([header, ...rows].map((r) => r.map((c) => String(c).replace(/[\t\n]+/g, ' ')).join('\t')).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const btn = 'rounded border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-[min(1000px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Bill of materials">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Bill of materials</h2>
          <span className="ml-3 text-xs text-gray-500">Counted from every page and rack of {project.name}. Set cable lengths on the diagram for exact cable totals.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex items-center gap-1 border-b border-gray-200 px-4 py-1.5">
          {(['bom', 'capacity'] as const).map((t) => (
            <button key={t} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-50 font-medium text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setTab(t)}>
              {t === 'bom' ? 'Materials' : `Port capacity (${capacity.length})`}
            </button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button className={btn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button className={btn} onClick={toCsv}>CSV</button>
            <button className="rounded bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700" onClick={toExcel}>Excel</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'bom' ? (
            sections.length ? sections.map((s) => (
              <section key={s.title} className="mb-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{s.title}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="w-16 py-1 pr-3 text-right font-semibold tabular-nums text-gray-900">{r.qty.toLocaleString()}</td>
                        <td className="w-12 py-1 pr-3 text-xs text-gray-500">{r.unit}</td>
                        <td className="py-1 pr-3 text-gray-800">{r.item}</td>
                        <td className="py-1 text-xs text-gray-500">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )) : <p className="text-sm text-gray-500">Nothing to count yet: add devices, cables or racks.</p>
          ) : capacity.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{CAP_HEADER.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {capacity.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 pr-3 font-medium text-gray-800">{c.device}</td>
                    <td className="py-1 pr-3 text-xs text-gray-500">{c.model}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.ports}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.used}</td>
                    <td className="py-1 pr-3 tabular-nums">
                      <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-gray-200 align-middle"><span className={`block h-full ${c.used / Math.max(1, c.ports) >= 0.8 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${(c.used / Math.max(1, c.ports)) * 100}%` }} /></span>
                      <span className="ml-2">{c.free}</span>
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{c.poePorts || ''}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.poeW || ''}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.poeBudgetW || ''}</td>
                    <td className="py-1 text-xs text-amber-700">{c.warning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No switches, firewalls or patch panels yet.</p>}
        </div>
      </div>
    </div>
  );
}
