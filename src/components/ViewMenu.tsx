'use client';

import { useState } from 'react';
import { DEFAULT_DISPLAY } from '@/lib/display';
import { setPref, usePref } from '@/lib/prefs';
import type { CableColorBy, DeviceColorBy } from '@/lib/types';
import { useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { useDisplay } from './useDisplay';

const DEVICE_OPTIONS: { value: DeviceColorBy; label: string }[] = [
  { value: 'none', label: 'No color' },
  { value: 'status', label: 'Status (active / planned…)' },
  { value: 'location', label: 'Location' },
  { value: 'model', label: 'Model' },
  { value: 'layer', label: 'Layer' },
];
const CABLE_OPTIONS: { value: CableColorBy; label: string }[] = [
  { value: 'type', label: 'Cable type' },
  { value: 'vlan', label: 'VLAN' },
];

/** On-canvas legend for the current data colors. */
export function Legend() {
  const project = useCurrentProject();
  const d = useDisplay();
  const s = project.display ?? DEFAULT_DISPLAY;
  if (!s.showLegend) return null;
  const groups = [
    { title: d.deviceTitle, items: d.deviceLegend },
    { title: d.cableTitle, items: s.cableColor === 'vlan' ? d.cableLegend : [] },
  ].filter((g) => g.title && g.items.length);
  if (!groups.length) return null;
  return (
    <div className="max-w-56 rounded border border-gray-200 bg-white/95 p-2 text-[11px] shadow-sm">
      {groups.map((g) => (
        <div key={g.title} className="mb-1 last:mb-0">
          <div className="mb-0.5 font-semibold uppercase tracking-wide text-gray-500">{g.title}</div>
          {g.items.map((i) => (
            <div key={i.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.dashed ? 'transparent' : i.color, border: `2px ${i.dashed ? 'dashed' : 'solid'} ${i.color}` }} />
              <span className="truncate">{i.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Toolbar "View" menu: data colors, legend and layers. */
export function ViewMenu({ label = 'View' }: { label?: string } = {}) {
  const project = useCurrentProject();
  const page = useCurrentPage();
  const { mapAllDevices, setDisplay, addLayer, renameLayer, deleteLayer, toggleLayer, assignSelectionToLayer, updateLayer, setActiveLayer } = useDiagram.getState();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const quickInfo = usePref('quickInfo');
  const s = project.display ?? DEFAULT_DISPLAY;
  const layers = project.layers ?? [];
  const selected = page.nodes.filter((n) => n.selected && (n.type === 'device' || n.type === 'shape')).length + page.edges.filter((e) => e.selected).length;
  const count = (id: string) =>
    project.pages.reduce((n, pg) => n + pg.nodes.filter((x) => (x.type === 'device' || x.type === 'shape') && x.data.layer === id).length + pg.edges.filter((e) => e.data?.layer === id).length, 0);
  const hiddenCount = layers.filter((l) => !l.visible).length;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
        {label}{hiddenCount ? ` (${hiddenCount} hidden)` : ''} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[27rem] rounded border border-gray-200 bg-white p-3 text-sm shadow-lg">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block text-xs text-gray-600">
              Color devices by
              <select className="mt-0.5 w-full rounded border border-gray-300 px-1 py-1 text-sm" value={s.deviceColor} onChange={(e) => setDisplay({ deviceColor: e.target.value as DeviceColorBy })}>
                {DEVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-gray-600">
              Color cables by
              <select className="mt-0.5 w-full rounded border border-gray-300 px-1 py-1 text-sm" value={s.cableColor} onChange={(e) => setDisplay({ cableColor: e.target.value as CableColorBy })}>
                {CABLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <label className="mb-3 flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={s.showLegend} onChange={(e) => setDisplay({ showLegend: e.target.checked })} /> Show legend
          </label>
          <label className="-mt-2 mb-3 flex items-center gap-1.5 text-xs text-gray-600" title="Where two cables cross, the horizontal one hops over the other (also in prints and exports)">
            <input type="checkbox" checked={s.lineJumps !== false} onChange={(e) => setDisplay({ lineJumps: e.target.checked })} /> Line jumps where cables cross
          </label>
          <label className="-mt-2 mb-3 flex items-center gap-1.5 text-xs text-gray-600" title="Hover a device to see its details (IP, serial, rack, ports…) in a floating card">
            <input type="checkbox" checked={quickInfo} onChange={(e) => setPref('quickInfo', e.target.checked)} /> Quick info on hover
          </label>
          <div className="-mt-1 mb-3 flex items-center gap-2 text-xs text-gray-600">
            Info boxes on all devices:
            <button className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50" onClick={() => mapAllDevices((d) => ({ infoBox: { ...d.infoBox, show: true } }))}>Show</button>
            <button className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50" onClick={() => mapAllDevices((d) => (d.infoBox ? { infoBox: { ...d.infoBox, show: false } } : {}))}>Hide</button>
          </div>

          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layer properties</h4>
          {layers.length === 0 && <p className="mb-1 text-xs text-gray-400">Group devices, shapes and cables (e.g. Cameras, Wi-Fi, Power, Planned work) to show, hide, lock or leave them out of prints together.</p>}
          {layers.length > 0 && (
            <div className="grid grid-cols-[1fr_2rem_2.5rem_2.25rem_2rem_2.5rem_4.5rem_1rem] items-center gap-x-1 border-b border-gray-200 pb-0.5 text-[10px] font-medium text-gray-500">
              <span>Name</span><span className="text-right">#</span><span className="text-center">Visible</span><span className="text-center">Print</span>
              <span className="text-center">Lock</span><span className="text-center" title="New devices, shapes and cables go on the active layer">Active</span><span /><span />
            </div>
          )}
          <ul className="mb-2 space-y-0.5 pt-0.5">
            {layers.map((l) => (
              <li key={l.id} className="group grid grid-cols-[1fr_2rem_2.5rem_2.25rem_2rem_2.5rem_4.5rem_1rem] items-center gap-x-1">
                <input className="min-w-0 rounded border border-transparent px-1 text-sm hover:border-gray-200 focus:border-blue-400 focus:outline-none" value={l.name} onChange={(e) => renameLayer(l.id, e.target.value)} />
                <span className="text-right text-[10px] text-gray-400">{count(l.id)}</span>
                <input className="justify-self-center" type="checkbox" checked={l.visible} onChange={() => toggleLayer(l.id)} aria-label={`Show ${l.name}`} />
                <input className="justify-self-center" type="checkbox" checked={l.print !== false} onChange={(e) => updateLayer(l.id, { print: e.target.checked ? undefined : false })} aria-label={`Print ${l.name}`} title="Include in prints, PDF, pictures and the Word report" />
                <input className="justify-self-center" type="checkbox" checked={!!l.locked} onChange={(e) => updateLayer(l.id, { locked: e.target.checked || undefined })} aria-label={`Lock ${l.name}`} title="Items on this layer can't be selected, moved or deleted" />
                <input className="justify-self-center" type="radio" name="nc-active-layer" checked={!!l.active} onChange={() => setActiveLayer(l.id)} onClick={() => { if (l.active) setActiveLayer(null); }} aria-label={`Make ${l.name} the active layer`} />
                <button
                  className="rounded px-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-30"
                  disabled={!selected}
                  onClick={() => assignSelectionToLayer(l.id)}
                  title="Put the selected devices and cables on this layer"
                >
                  + selection
                </button>
                <button className="invisible rounded px-1 text-xs text-gray-400 hover:text-red-600 group-hover:visible" onClick={() => { if (confirm(`Delete layer "${l.name}"? Its devices and cables stay, with no layer.`)) deleteLayer(l.id); }} aria-label={`Delete ${l.name}`}>✕</button>
              </li>
            ))}
          </ul>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { addLayer(newName.trim()); setNewName(''); } }}>
            <input className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-0.5 text-sm" placeholder="New layer name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" disabled={!newName.trim()} className="rounded bg-gray-100 px-2 py-0.5 text-sm hover:bg-gray-200 disabled:opacity-50">Add</button>
          </form>
          {selected > 0 && layers.length > 0 && (
            <button className="mt-2 text-xs text-gray-500 hover:underline" onClick={() => assignSelectionToLayer(null)}>Remove selection from its layer</button>
          )}
          <div className="mt-2 text-right">
            <button className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
