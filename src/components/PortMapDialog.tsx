'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PORT_MAP_EVENT } from '@/lib/events';
import { downloadBlob, safeName } from '@/lib/export';
import { PORT_MAP_COLUMNS, PORT_MAP_CSS, portFaceSvg, portFill, portMap, portMapCells, portMapCsv, portMapDevices, portMapHtml, portMapTsv, type PortMap } from '@/lib/portMap';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const ROOT_ID = 'rd-portmap-print';

/** Prints the sheets: a print-only copy of them, then the system print dialog. */
function printSheets(body: string) {
  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<style>
#${ROOT_ID} { display: none; }
@media print {
  @page { margin: 0; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${PORT_MAP_CSS}
}
</style>${body}`;
  document.body.appendChild(root);
  const done = () => { root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/** Opens the port map when asked (Data → Port Map, or a device's "Port map" button). */
export function PortMapHost() {
  const [open, setOpen] = useState<{ nodeId?: string } | null>(null);
  useEffect(() => {
    const show = (e: Event) => setOpen({ nodeId: (e as CustomEvent<string | undefined>).detail });
    window.addEventListener(PORT_MAP_EVENT, show);
    return () => window.removeEventListener(PORT_MAP_EVENT, show);
  }, []);
  return open ? <PortMapDialog nodeId={open.nodeId} onClose={() => setOpen(null)} /> : null;
}

/** Port map of a switch, patch panel, firewall or router: its face, coloured by port state, and every port's details. */
export function PortMapDialog({ nodeId, onClose }: { nodeId?: string; onClose: () => void }) {
  const project = useCurrentProject();
  const devices = useMemo(() => portMapDevices(project, getStencil), [project]);
  const [id, setId] = useState(() => (nodeId && devices.some((d) => d.id === nodeId) ? nodeId : devices[0]?.id));
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const table = useRef<HTMLDivElement>(null);
  const map = useMemo(() => (id ? portMap(project, id, getStencil) : undefined), [project, id]);
  const allMaps = (): PortMap[] => devices.map((d) => portMap(project, d.id, getStencil)).filter((m): m is PortMap => !!m);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // Clicking a port on the face picks its row in the table.
  const pick = (e: React.MouseEvent) => {
    const port = (e.target as Element).closest('[data-port]')?.getAttribute('data-port');
    if (!port) return;
    setHot(port);
    setOnlyUsed(false);
    setTimeout(() => table.current?.querySelector(`[data-row="${CSS.escape(port)}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };

  const copy = async () => {
    if (!map) return;
    try {
      await navigator.clipboard.writeText(portMapTsv([map]));
      setMsg('Copied: paste it into Excel.');
    } catch {
      alert('The clipboard is blocked here. Use CSV instead.');
    }
  };

  const rows = map ? (onlyUsed ? map.rows.filter((r) => r.cabled || r.note || r.status || r.vlan || r.notes) : map.rows) : [];
  const face = map ? portFaceSvg(map, 900) : '';

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Port map" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
          <h2 className="font-semibold text-gray-900">Port map</h2>
          {devices.length > 0 && (
            <select className="min-w-0 max-w-md flex-1 rounded border border-gray-300 px-1.5 py-1 text-sm" value={id} onChange={(e) => { setId(e.target.value); setHot(null); setMsg(''); }} aria-label="Device">
              {devices.map((d) => <option key={d.id} value={d.id}>{d.data.name}{d.data.model ? ` — ${d.data.model}` : ''}</option>)}
            </select>
          )}
          <button type="button" className="ml-auto text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!map ? (
          <p className="p-6 text-center text-sm text-gray-500">No switches, patch panels, firewalls or routers in this client yet. Add one from the Shapes window, then come back here.</p>
        ) : (
          <>
            <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-600">
              <span className="font-medium text-gray-800">{[map.model, map.where].filter(Boolean).join(' · ') || 'Not racked'}</span>
              {' · '}{map.used} of {map.total} ports in use, <b>{map.free} free</b>
              {map.poe ? `, ${map.poe} PoE` : ''}{map.uplinks ? `, ${map.uplinks} uplink${map.uplinks === 1 ? '' : 's'}` : ''}
              {map.passThrough && ' · patch panel: each port shows both ends'}
            </div>
            {face && (
              <div className="shrink-0 px-4 pt-3">
                <div className="mx-auto max-w-[900px] [&_svg]:h-auto [&_svg]:w-full" onClick={pick} title="Click a port to find it in the table" dangerouslySetInnerHTML={{ __html: face }} />
                <p className="mt-1 text-center text-[10px] text-gray-500">
                  Green = in use (the VLAN&apos;s colour when the IP plan gives one) · white = free · red = down · grey = disabled · blue outline = uplink · orange dot = PoE
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 px-4 pt-2 text-xs text-gray-600">
              <label className="flex items-center gap-1"><input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> Only ports in use</label>
              <span className="text-gray-400">Edit a port in the Shape Data pane (select the device, then Ports).</span>
            </div>
            <div ref={table} className="m-4 mt-2 min-h-0 flex-1 overflow-auto rounded border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-[11px] text-gray-600">
                  <tr>{PORT_MAP_COLUMNS.map((c) => <th key={c} className="border-b border-gray-200 px-2 py-1 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = portFill(r);
                    return (
                      <tr key={r.id} data-row={r.id} className={`border-b border-gray-100 ${hot === r.id ? 'bg-amber-50' : ''}`} onClick={() => setHot(r.id)}>
                        {portMapCells(r).map((v, i) => (
                          <td key={i} className={`px-2 py-0.5 align-top ${i === 0 ? 'whitespace-nowrap font-mono' : ''}`}>
                            {i === 0 && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border align-[-1px]" style={{ background: c.fill, borderColor: c.stroke }} />}
                            {i === 3 && v && r.vlanColor && <span className="mr-1 inline-block h-2 w-2 rounded-sm align-[0px]" style={{ background: r.vlanColor }} />}
                            {v}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {!rows.length && <tr><td colSpan={PORT_MAP_COLUMNS.length} className="px-3 py-4 text-center text-gray-400">No ports in use.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        <footer className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-2.5 text-sm">
          {msg && <span className="text-xs text-green-700">{msg}</span>}
          {map && (
            <button className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50" onClick={() => { useDiagram.getState().selectOnlyNode(map.nodeId); useDiagram.getState().setView('diagram'); onClose(); }}>
              Show on diagram
            </button>
          )}
          <span className="flex-1" />
          <button className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={!map} onClick={copy}>Copy</button>
          <button className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={!devices.length} onClick={() => downloadBlob(`${safeName(project.name)} port maps.csv`, new Blob(['﻿' + portMapCsv(allMaps())], { type: 'text/csv;charset=utf-8' }))}>
            CSV (all)
          </button>
          <button className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={!devices.length} onClick={() => printSheets(portMapHtml(allMaps(), project.name, onlyUsed))}>
            Print all ({devices.length})
          </button>
          <button className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-40" disabled={!map} onClick={() => map && printSheets(portMapHtml([map], project.name, onlyUsed))}>
            Print…
          </button>
        </footer>
      </div>
    </div>
  );
}
