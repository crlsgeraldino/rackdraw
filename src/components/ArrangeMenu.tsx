'use client';

import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { isLocked, type AlignMode, type DistributeAxis } from '@/lib/arrange';
import { deviceSize, layoutPage, type LayoutKind, type LayoutItem } from '@/lib/autolayout';
import { INFO_GAP, overlaySize } from '@/lib/overlays';
import type { AppNode } from '@/lib/types';
import { getStencil, useCurrentPage, useDiagram } from '@/store/useDiagramStore';
import { OPEN_CHECK_EVENT } from './CheckPanel';

const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Tiny line icons for the align/distribute commands. */
export function AlignIcon({ mode }: { mode: AlignMode | `dist-${DistributeAxis}` }) {
  const bar = '#2563eb';
  const box = { fill: '#cbd5e1', stroke: '#475569', strokeWidth: 1 };
  const shapes: Record<string, React.ReactNode> = {
    left: <><line x1="2" y1="1" x2="2" y2="15" stroke={bar} strokeWidth="1.5" /><rect x="3" y="3" width="10" height="4" {...box} /><rect x="3" y="9" width="6" height="4" {...box} /></>,
    center: <><line x1="8" y1="1" x2="8" y2="15" stroke={bar} strokeWidth="1.5" /><rect x="2" y="3" width="12" height="4" {...box} /><rect x="5" y="9" width="6" height="4" {...box} /></>,
    right: <><line x1="14" y1="1" x2="14" y2="15" stroke={bar} strokeWidth="1.5" /><rect x="3" y="3" width="10" height="4" {...box} /><rect x="7" y="9" width="6" height="4" {...box} /></>,
    top: <><line x1="1" y1="2" x2="15" y2="2" stroke={bar} strokeWidth="1.5" /><rect x="3" y="3" width="4" height="10" {...box} /><rect x="9" y="3" width="4" height="6" {...box} /></>,
    middle: <><line x1="1" y1="8" x2="15" y2="8" stroke={bar} strokeWidth="1.5" /><rect x="3" y="2" width="4" height="12" {...box} /><rect x="9" y="5" width="4" height="6" {...box} /></>,
    bottom: <><line x1="1" y1="14" x2="15" y2="14" stroke={bar} strokeWidth="1.5" /><rect x="3" y="3" width="4" height="10" {...box} /><rect x="9" y="7" width="4" height="6" {...box} /></>,
    'dist-h': <><rect x="1" y="4" width="3" height="8" {...box} /><rect x="6.5" y="4" width="3" height="8" {...box} /><rect x="12" y="4" width="3" height="8" {...box} /></>,
    'dist-v': <><rect x="4" y="1" width="8" height="3" {...box} /><rect x="4" y="6.5" width="8" height="3" {...box} /><rect x="4" y="12" width="8" height="3" {...box} /></>,
  };
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{shapes[mode]}</svg>;
}

export const ALIGN: { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Align left' },
  { mode: 'center', label: 'Align center' },
  { mode: 'right', label: 'Align right' },
  { mode: 'top', label: 'Align top' },
  { mode: 'middle', label: 'Align middle' },
  { mode: 'bottom', label: 'Align bottom' },
];

/** What the current selection allows. */
export function useSelectionState() {
  const page = useCurrentPage();
  const sel = page.nodes.filter((n) => n.selected && n.type !== 'backdrop');
  const free = sel.filter((n) => !isLocked(n));
  return {
    count: sel.length,
    movable: free.length,
    grouped: sel.some((n) => n.type !== 'backdrop' && n.data.group),
    locked: sel.some(isLocked),
    unlocked: free.length > 0,
  };
}

/** Align / distribute / group / lock buttons, shown in the properties panel when several items are selected. */
export function ArrangeButtons() {
  const st = useSelectionState();
  const { alignSelected, distributeSelected, groupSelected, ungroupSelected, setSelectionLocked } = useDiagram.getState();
  const btn = 'flex h-7 w-7 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40';
  return (
    <div className="space-y-2">
      <div>
        <span className="mb-1 block text-[11px] font-medium text-gray-500">Align</span>
        <div className="flex gap-1">
          {ALIGN.map((a) => (
            <button key={a.mode} className={btn} disabled={st.movable < 2} onClick={() => alignSelected(a.mode)} title={a.label} aria-label={a.label}><AlignIcon mode={a.mode} /></button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Space evenly</span>
          <div className="flex gap-1">
            <button className={btn} disabled={st.movable < 3} onClick={() => distributeSelected('h')} title="Distribute horizontally (3 or more items)" aria-label="Distribute horizontally"><AlignIcon mode="dist-h" /></button>
            <button className={btn} disabled={st.movable < 3} onClick={() => distributeSelected('v')} title="Distribute vertically (3 or more items)" aria-label="Distribute vertically"><AlignIcon mode="dist-v" /></button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <button className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40" disabled={st.count < 2} onClick={groupSelected} title={`Group (${MOD}G)`}>Group</button>
          {st.grouped && <button className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50" onClick={ungroupSelected} title={`Ungroup (${MOD}Shift+G)`}>Ungroup</button>}
          <button className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50" onClick={() => setSelectionLocked(st.unlocked)}>{st.unlocked ? 'Lock' : 'Unlock'}</button>
        </div>
      </div>
    </div>
  );
}

/** Auto-arrange (top down): the selected devices (2 or more), else every device on the page. */
export function useAutoArrange() {
  const rf = useReactFlow<AppNode>();
  const page = useCurrentPage();
  const { setPositions } = useDiagram.getState();
  return (kind: LayoutKind = 'top-down', spacing = 1) => {
    const sel = page.nodes.filter((n) => n.selected && n.type === 'device');
    const nodes = (sel.length >= 2 ? sel : page.nodes.filter((n) => n.type === 'device')).filter((n) => !isLocked(n));
    if (nodes.length < 2) return alert('Add or select at least two devices to arrange.');
    const items: LayoutItem[] = nodes.map((n) => {
      const size = deviceSize(n, getStencil);
      const d = n.type === 'device' ? n.data : undefined;
      // Leave room for the info box beside the device and the label under it.
      const info = d?.infoBox?.show ? overlaySize(`${n.id}|info`) : undefined;
      const label = overlaySize(`${n.id}|label`);
      const s = d ? getStencil(d.stencilId) : undefined;
      return {
        id: n.id,
        w: size.w + (info ? INFO_GAP + info.w : 0),
        h: Math.max(size.h + (label ? label.h + 8 : 0), info?.h ?? 0),
        category: s?.category ?? 'Custom',
        name: d?.name ?? '',
      };
    });
    const origin = { x: Math.min(...nodes.map((n) => n.position.x)), y: Math.min(...nodes.map((n) => n.position.y)) };
    // Where each cable plugs into a device, left to right, so devices are laid out in port order.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const portX = (id: string, handle?: string | null) => {
      const n = byId.get(id);
      if (!n || n.type !== 'device' || !handle) return undefined;
      const st = getStencil(n.data.stencilId);
      const p = st?.ports.find((x) => x.id === handle);
      return p ? p.x + p.w / 2 : undefined;
    };
    setPositions(layoutPage(kind, items, page.edges, origin, { spacing, portX }));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 80);
  };
}

/** Toolbar "Arrange" menu: clipboard, align, distribute, group, order and lock, like Visio's Home/Arrange tab. */
export function ArrangeMenu({ onCopy, onCut, onPaste }: { onCopy: () => void; onCut: () => void; onPaste: () => void }) {
  const [open, setOpen] = useState(false);
  const st = useSelectionState();
  const { duplicateSelected, alignSelected, distributeSelected, groupSelected, ungroupSelected, orderSelected, setSelectionLocked, copyFormat, pasteFormat, formatKind } = useDiagram.getState();
  const page = useCurrentPage();
  const run = (fn: () => void) => () => { fn(); setOpen(false); };
  const hasEdgeSel = page.edges.some((e) => e.selected);
  const kind = formatKind();
  const autoArrange = useAutoArrange();
  const item = (label: string, fn: () => void, disabled: boolean, keys?: string, icon?: React.ReactNode) => (
    <button key={label} className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent" onClick={run(fn)} disabled={disabled}>
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {keys && <span className="text-[11px] text-gray-400">{keys}</span>}
    </button>
  );
  const sep = (k: string) => <div key={k} className="my-1 border-t border-gray-100" />;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="whitespace-nowrap rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100" aria-expanded={open}>Arrange ▾</button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[calc(100vh-4rem)] w-64 overflow-y-auto rounded border border-gray-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setOpen(false)}>
          {item('Cut', onCut, !st.count, `${MOD}X`)}
          {item('Copy', onCopy, !st.count, `${MOD}C`)}
          {item('Paste', onPaste, false, `${MOD}V`)}
          {item('Duplicate', duplicateSelected, !st.count, `${MOD}D`)}
          {sep('a')}
          <div className="px-3 py-1">
            <span className="mb-1 block text-[11px] text-gray-500">Align and space evenly</span>
            <div className="flex gap-1">
              {ALIGN.map((a) => (
                <button key={a.mode} className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40" disabled={st.movable < 2} onClick={run(() => alignSelected(a.mode))} title={a.label} aria-label={a.label}><AlignIcon mode={a.mode} /></button>
              ))}
              <button className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40" disabled={st.movable < 3} onClick={run(() => distributeSelected('h'))} title="Distribute horizontally" aria-label="Distribute horizontally"><AlignIcon mode="dist-h" /></button>
              <button className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40" disabled={st.movable < 3} onClick={run(() => distributeSelected('v'))} title="Distribute vertically" aria-label="Distribute vertically"><AlignIcon mode="dist-v" /></button>
            </div>
          </div>
          {item('Auto-arrange (top down)', autoArrange, false)}
          {sep('b')}
          {item('Group', groupSelected, st.count < 2, `${MOD}G`)}
          {item('Ungroup', ungroupSelected, !st.grouped, `${MOD}Shift+G`)}
          {sep('c')}
          {item('Bring to front', () => orderSelected('front'), !st.count, `${MOD}Shift+F`)}
          {item('Send to back', () => orderSelected('back'), !st.count, `${MOD}Shift+B`)}
          {sep('d')}
          {item('Lock position', () => setSelectionLocked(true), !st.unlocked)}
          {item('Unlock', () => setSelectionLocked(false), !st.locked)}
          {sep('e')}
          {item('Copy format', () => { if (!copyFormat()) alert('Select one cable, shape or device to copy its format.'); }, !st.count && !hasEdgeSel)}
          {item(`Paste format${kind ? ` (${kind})` : ''}`, () => { if (!pasteFormat()) alert(`Select ${kind === 'cable' ? 'cables' : kind === 'shape' ? 'shapes' : 'devices'} to paste the format onto.`); }, !kind)}
          {sep('f')}
          {item('Check diagram…', () => window.dispatchEvent(new Event(OPEN_CHECK_EVENT)), false)}
          <p className="px-3 pb-1 pt-1.5 text-[10px] leading-snug text-gray-400">Select several items with Shift+click or by dragging a box with Shift held.</p>
        </div>
      )}
    </div>
  );
}
