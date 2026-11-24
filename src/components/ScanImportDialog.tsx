'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { notInScan, parseScan, planScan, type ScanParse, type ScanRow } from '@/lib/scanImport';
import { STENCILS } from '@/lib/stencils';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const today = () => new Date().toISOString().slice(0, 10);

/** Data → Network Scan: bring an IP scanner's results in as devices, or update the ones already drawn. */
export function ScanImportDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const custom = useDiagram((s) => s.customStencils);
  const [parsed, setParsed] = useState<ScanParse | null>(null);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [paste, setPaste] = useState('');
  const [target, setTarget] = useState<'new-page' | 'active-page'>('new-page');
  const [pageName, setPageName] = useState(`Scan ${today()}`);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const stencils = useMemo(
    () => [...STENCILS, ...Object.values(custom)].sort((a, b) => a.name.localeCompare(b.name)),
    [custom],
  );

  const load = (text: string, name: string) => {
    setError(''); setDone('');
    const r = parseScan(text);
    if (!r.hosts.length) {
      setParsed(null); setRows([]);
      setError(`No hosts with an IPv4 address found in ${name}. Use an nmap XML file (-oX) or a CSV / text export with an IP column.`);
      return;
    }
    setParsed(r);
    setFileName(name);
    setRows(planScan(project, r.hosts));
  };

  const pick = async (f?: File) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { setError('That file is too big for a scan export (over 50 MB).'); return; }
    load(await f.text(), f.name);
  };

  const missing = useMemo(() => (parsed ? notInScan(project, parsed.hosts, rows) : []), [project, parsed, rows]);
  const set = (i: number, patch: Partial<ScanRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const adds = rows.filter((r) => r.action === 'add').length;
  const updates = rows.filter((r) => r.action === 'update').length;

  const apply = () => {
    const r = useDiagram.getState().applyScan(rows, target, pageName.trim() || `Scan ${today()}`);
    setDone(`Added ${r.created} device${r.created === 1 ? '' : 's'} and updated ${r.updated}.`);
    setParsed(null);
    setRows([]);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex h-[min(760px,94vh)] w-[min(1120px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Import network scan" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">Import network scan</h2>
            <p className="text-[11px] text-gray-500">The hosts an IP scanner found become devices; devices already drawn are matched by MAC, then IP, then name, and updated.</p>
          </div>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!parsed ? (
          <div className="flex-1 overflow-y-auto p-4 text-sm text-gray-700">
            {done && <p className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-green-800">{done} Undo (Ctrl+Z) takes it back.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700" onClick={() => file.current?.click()}>Choose a scan file…</button>
              <span className="text-xs text-gray-500">nmap XML, or CSV / TSV / text with an IP column</span>
              <input ref={file} type="file" accept=".xml,.csv,.tsv,.txt" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <p className="mt-4 mb-1 text-xs font-medium text-gray-600">…or paste a list (a scanner&apos;s table, a router&apos;s DHCP clients, a spreadsheet):</p>
            <textarea className="h-32 w-full rounded border border-gray-300 p-2 font-mono text-xs outline-none focus:border-blue-500" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'IP,Name,MAC,Vendor\n192.168.1.20,FRONT-PC,00:11:22:33:44:55,Dell'} />
            <button type="button" disabled={!paste.trim()} className="mt-1 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-40" onClick={() => load(paste, 'the pasted text')}>Read pasted list</button>
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              <p className="mb-1 font-medium text-gray-700">Making a scan file</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li><b>nmap</b>: <code className="rounded bg-white px-1">nmap -sn 192.168.1.0/24 -oX scan.xml</code> — add <code className="rounded bg-white px-1">-O -sV</code> (as admin) for the OS and open ports, which make the device types better.</li>
                <li><b>Advanced IP Scanner</b>: scan, then File → Export → CSV.</li>
                <li><b>Angry IP Scanner</b>: Scan → Export all → CSV (turn on the MAC Address and MAC Vendor fetchers first).</li>
                <li>Scanning finds only devices that answer on the network you scan from. Run it from inside the client&apos;s network, with permission.</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2 text-xs text-gray-600">
              <span><b className="text-gray-900">{rows.length}</b> host{rows.length === 1 ? '' : 's'} in {fileName}{parsed.format === 'nmap' ? ' (nmap)' : ''}{parsed.skipped ? ` · ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} skipped` : ''}</span>
              <span>· <b className="text-green-700">{adds} new</b> · <b className="text-blue-700">{updates} to update</b></span>
              <button type="button" className="ml-auto text-blue-600 hover:underline" onClick={() => { setParsed(null); setRows([]); }}>Choose another file</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-white text-left text-[11px] text-gray-500">
                  <tr>{['Do', 'IP', 'Name', 'MAC', 'Vendor / OS', 'Open ports', 'Kind of device', 'In this client'].map((h) => <th key={h} className="border-b border-gray-200 px-1.5 py-1 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.host.ip} className={`border-b border-gray-100 ${r.action === 'skip' ? 'text-gray-400' : ''}`}>
                      <td className="px-1.5 py-0.5">
                        <select className="rounded border border-gray-300 px-1 py-0.5" value={r.action} onChange={(e) => set(i, { action: e.target.value as ScanRow['action'] })} aria-label={`What to do with ${r.host.ip}`}>
                          {r.match && <option value="update">Update</option>}
                          <option value="add">Add{r.match ? ' as new' : ''}</option>
                          <option value="skip">Skip</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-0.5 font-mono">{r.host.ip}</td>
                      <td className="max-w-[160px] truncate px-1.5 py-0.5" title={r.host.name}>{r.host.name ?? '—'}</td>
                      <td className="px-1.5 py-0.5 font-mono text-[10px]">{r.host.mac ?? '—'}</td>
                      <td className="max-w-[160px] truncate px-1.5 py-0.5" title={[r.host.vendor, r.host.os].filter(Boolean).join(' · ')}>{[r.host.vendor, r.host.os].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="max-w-[110px] truncate px-1.5 py-0.5 text-[10px]" title={r.host.ports.join(', ')}>{r.host.ports.join(', ') || '—'}</td>
                      <td className="px-1.5 py-0.5">
                        <select
                          className="max-w-[200px] rounded border border-gray-300 px-1 py-0.5 disabled:bg-gray-50"
                          value={r.stencilId} disabled={r.action !== 'add'} title={r.action === 'add' ? `Guessed from: ${r.why}` : 'An updated device keeps its shape'}
                          onChange={(e) => set(i, { stencilId: e.target.value, why: 'chosen' })} aria-label={`Kind of device for ${r.host.ip}`}
                        >
                          {!stencils.some((s) => s.id === r.stencilId) && <option value={r.stencilId}>{r.stencilId}</option>}
                          {stencils.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-1.5 py-0.5">
                        {r.match ? <span className="text-blue-700">{r.match.node.data.name} <span className="text-gray-400">(by {r.match.by})</span></span> : <span className="text-green-700">New</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {missing.length > 0 && (
                <details className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <summary className="cursor-pointer font-medium">{missing.length} device{missing.length === 1 ? '' : 's'} with an IP didn&apos;t answer this scan (switched off, moved, on another network, or gone)</summary>
                  <ul className="mt-1 columns-2 gap-6">
                    {missing.map((n) => <li key={n.id}>{n.data.name} <span className="font-mono text-amber-700">{n.data.ip}</span></li>)}
                  </ul>
                </details>
              )}
            </div>
            <footer className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-4 py-2.5 text-sm">
              <label className="flex items-center gap-1 text-xs"><input type="radio" checked={target === 'new-page'} onChange={() => setTarget('new-page')} /> New devices on a new page</label>
              {target === 'new-page' && <input className="w-40 rounded border border-gray-300 px-1.5 py-0.5 text-xs" value={pageName} onChange={(e) => setPageName(e.target.value)} aria-label="Page name" />}
              <label className="flex items-center gap-1 text-xs"><input type="radio" checked={target === 'active-page'} onChange={() => setTarget('active-page')} /> on this page</label>
              <span className="flex-1" />
              <button type="button" className="rounded px-3 py-1.5 text-gray-600 hover:bg-gray-100" onClick={onClose}>Cancel</button>
              <button type="button" disabled={!adds && !updates} className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-40" onClick={apply}>
                Import ({adds} new, {updates} updated)
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
