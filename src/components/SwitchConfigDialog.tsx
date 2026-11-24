'use client';

import { strToU8, zipSync } from 'fflate';
import { useEffect, useMemo, useState } from 'react';
import { SWITCH_CONFIG_EVENT } from '@/lib/events';
import { downloadBlob, safeName } from '@/lib/export';
import { CONFIG_STYLES, configFileName, configurableSwitches, switchConfig, type ConfigStyle } from '@/lib/switchConfig';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Opens the switch configuration starter (Data → Switch Config, or from a switch's Port Map). */
export function SwitchConfigHost() {
  const [open, setOpen] = useState<{ nodeId?: string } | null>(null);
  useEffect(() => {
    const show = (e: Event) => setOpen({ nodeId: (e as CustomEvent<string | undefined>).detail });
    window.addEventListener(SWITCH_CONFIG_EVENT, show);
    return () => window.removeEventListener(SWITCH_CONFIG_EVENT, show);
  }, []);
  return open ? <SwitchConfigDialog nodeId={open.nodeId} onClose={() => setOpen(null)} /> : null;
}

function SwitchConfigDialog({ nodeId, onClose }: { nodeId?: string; onClose: () => void }) {
  const project = useCurrentProject();
  const switches = useMemo(() => configurableSwitches(project, getStencil), [project]);
  const selected = () => {
    const s = useDiagram.getState();
    const pg = s.projects[s.currentId].pages.find((x) => x.id === s.projects[s.currentId].activePageId);
    return pg?.nodes.find((n) => n.selected && n.type === 'device')?.id;
  };
  const [id, setId] = useState(() => [nodeId, selected()].find((x) => x && switches.some((d) => d.id === x)) ?? switches[0]?.id);
  const [style, setStyle] = useState<ConfigStyle>('ios');
  const [shut, setShut] = useState(false);
  const [msg, setMsg] = useState('');
  const sw = switches.find((d) => d.id === id);
  const text = useMemo(() => (sw ? switchConfig(project, sw, getStencil, { style, shutUnused: shut }) : ''), [project, sw, style, shut]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Copied.'); } catch { alert('The clipboard is blocked here. Use Save instead.'); }
  };
  const saveOne = () => sw && downloadBlob(configFileName(sw, style), new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const saveAll = () => {
    const files: Record<string, Uint8Array> = {};
    for (const d of switches) files[configFileName(d, style)] = strToU8(switchConfig(project, d, getStencil, { style, shutUnused: shut }));
    downloadBlob(`${safeName(project.name)} switch configs.zip`, new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }));
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex h-[min(760px,94vh)] w-[min(980px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Switch configuration" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-gray-900">Switch configuration starter</h2>
            <p className="text-[11px] text-gray-500">From the documentation: VLANs, port descriptions, access / trunk ports, PoE, ports turned off, management address. Review and test before applying; RackDraw never connects to the switch.</p>
          </div>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>
        {!sw ? (
          <p className="p-6 text-center text-sm text-gray-500">No switches in this client yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2 text-sm">
              <select className="max-w-xs rounded border border-gray-300 px-1.5 py-1" value={id} onChange={(e) => { setId(e.target.value); setMsg(''); }} aria-label="Switch">
                {switches.map((d) => <option key={d.id} value={d.id}>{d.data.name}{d.data.model ? ` — ${d.data.model}` : ''}</option>)}
              </select>
              <select className="rounded border border-gray-300 px-1.5 py-1" value={style} onChange={(e) => { setStyle(e.target.value as ConfigStyle); setMsg(''); }} aria-label="Style">
                {CONFIG_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-700" title="Ports with nothing documented on them are turned off (good practice: nobody plugs into an open port unnoticed)">
                <input type="checkbox" checked={shut} onChange={(e) => setShut(e.target.checked)} /> Turn off unused ports
              </label>
            </div>
            <pre className="m-4 mt-2 min-h-0 flex-1 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800">{text}</pre>
          </>
        )}
        <footer className="flex items-center gap-2 border-t border-gray-200 px-4 py-2.5 text-sm">
          <span className="text-xs text-gray-500">{msg || 'Ports with no VLAN documented are left as they are and listed at the top.'}</span>
          <span className="flex-1" />
          <button type="button" disabled={!sw} className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" onClick={copy}>Copy</button>
          <button type="button" disabled={switches.length < 2} className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" onClick={saveAll}>Save all ({switches.length})</button>
          <button type="button" disabled={!sw} className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-40" onClick={saveOne}>Save…</button>
        </footer>
      </div>
    </div>
  );
}
