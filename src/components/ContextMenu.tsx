'use client';

import { editScreenTip } from './ribbon/Ribbon';
import { useEffect } from 'react';
import type { CableRoute } from '@/lib/types';
import { getStencil, useCurrentPage, useDiagram } from '@/store/useDiagramStore';
import { OPEN_CHECK_EVENT } from './CheckPanel';
import { openChangeShape } from './ChangeShapeDialog';

/** Asks the palette to open the stencil editor for a custom stencil (it owns the editor). */
export const EDIT_STENCIL_EVENT = 'netcraft:edit-stencil';
/** Opens Edit shape for a device: its custom stencil, or an editable copy of a built-in one (then used by that device). */
export const editStencil = (stencilId: string, nodeId?: string) =>
  window.dispatchEvent(new CustomEvent(EDIT_STENCIL_EVENT, { detail: { stencilId, nodeId } }));

export type MenuTarget = { x: number; y: number } & ({ kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'pane' });

/** Right-click menu on the canvas (devices, shapes, cables, empty canvas), like Visio's shortcut menu. */
export function ContextMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const page = useCurrentPage();
  const s = useDiagram.getState();

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  const node = target.kind === 'node' ? page.nodes.find((n) => n.id === target.id) : undefined;
  const edge = target.kind === 'edge' ? page.edges.find((e) => e.id === target.id) : undefined;
  const selCount = page.nodes.filter((n) => n.selected && n.type !== 'backdrop').length;
  const locked = node && node.type !== 'backdrop' && !!node.data.locked;
  const stencil = node?.type === 'device' ? getStencil(node.data.stencilId) : undefined;
  const fmt = s.formatKind();

  type Item = { label: string; run: () => void; keys?: string; disabled?: boolean; danger?: boolean } | 'sep';
  const items: Item[] = [];
  if (node) {
    if (node.type === 'device') {
      if (stencil) items.push({ label: 'Edit shape & ports…', keys: 'Double-click', run: () => editStencil(stencil.id, node.id) });
      items.push({ label: 'Change Shape…', run: openChangeShape });
      items.push({ label: node.data.infoBox?.show ? 'Hide info box' : 'Show info box', run: () => s.mapDevices([node.id], (d) => ({ infoBox: { ...d.infoBox, show: !d.infoBox?.show } })) });
      items.push('sep');
    }
    if (node.type === 'zone') {
      items.push({ label: 'Fit to contents', run: () => s.fitZoneToContents(node.id) }, 'sep');
    }
    items.push(
      { label: 'Cut', keys: 'Ctrl+X', run: () => { if (!document.execCommand('cut')) s.cutSelected(); }, disabled: locked },
      { label: 'Copy', keys: 'Ctrl+C', run: () => { if (!document.execCommand('copy')) s.copySelected(); } },
      { label: 'Duplicate', keys: 'Ctrl+D', run: s.duplicateSelected },
      'sep',
      { label: 'Bring to front', keys: 'Ctrl+Shift+F', run: () => s.orderSelected('front') },
      { label: 'Send to back', keys: 'Ctrl+Shift+B', run: () => s.orderSelected('back') },
    );
    if (selCount > 1) items.push({ label: 'Group', keys: 'Ctrl+G', run: s.groupSelected });
    if (node.type !== 'backdrop' && node.data.group) items.push({ label: 'Ungroup', keys: 'Ctrl+Shift+G', run: s.ungroupSelected });
    if (node.type !== 'backdrop') items.push({ label: node.data.tip ? 'Edit ScreenTip…' : 'ScreenTip…', run: () => void editScreenTip() });
    if (node.type === 'device' || (node.type === 'shape' && node.data.kind !== 'window' && node.data.kind !== 'callout')) {
      items.push({ label: 'Rotate right 90°', run: () => s.rotateSelection(90) }, { label: 'Rotate left 90°', run: () => s.rotateSelection(-90) });
    }
    items.push(
      { label: locked ? 'Unlock' : 'Lock position', run: () => s.setSelectionLocked(!locked) },
      'sep',
      { label: 'Copy format', run: () => s.copyFormat() },
      { label: `Paste format${fmt ? ` (${fmt})` : ''}`, run: () => s.pasteFormat(), disabled: !fmt },
      'sep',
      { label: 'Delete', keys: 'Del', run: s.deleteSelected, disabled: locked, danger: true },
    );
  } else if (edge) {
    const route = edge.data?.route ?? 'step';
    const setRoute = (r: CableRoute) => s.updateEdgesData([edge.id], { route: r });
    items.push(
      { label: `${route === 'step' ? '✓ ' : ''}Right angles`, run: () => setRoute('step') },
      { label: `${route === 'straight' ? '✓ ' : ''}Straight`, run: () => setRoute('straight') },
      { label: `${route === 'curved' ? '✓ ' : ''}Curved`, run: () => setRoute('curved') },
      'sep',
      { label: 'Copy format', run: () => s.copyFormat() },
      { label: `Paste format${fmt ? ` (${fmt})` : ''}`, run: () => s.pasteFormat(), disabled: fmt !== 'cable' },
      'sep',
      { label: 'Delete cable', keys: 'Del', run: s.deleteSelected, danger: true },
    );
  } else {
    items.push(
      { label: 'Paste', keys: 'Ctrl+V', run: () => s.paste() },
      'sep',
      { label: 'Check diagram…', run: () => window.dispatchEvent(new Event(OPEN_CHECK_EVENT)) },
    );
  }

  // Keep the menu on screen.
  const left = Math.min(target.x, window.innerWidth - 230);
  const top = Math.min(target.y, window.innerHeight - items.length * 28 - 16);

  return (
    <>
      <div className="fixed inset-0 z-[1500]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-[1501] w-56 rounded border border-gray-200 bg-white py-1 text-sm shadow-xl" style={{ left, top: Math.max(8, top) }} role="menu">
        {items.map((it, i) =>
          it === 'sep' ? (
            <div key={`sep${i}`} className="my-1 border-t border-gray-100" />
          ) : (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              className={`flex w-full items-center px-3 py-1 text-left hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent ${it.danger ? 'text-red-600' : 'text-gray-800'}`}
              onClick={() => { it.run(); onClose(); }}
            >
              <span className="flex-1">{it.label}</span>
              {it.keys && <span className="text-[11px] text-gray-400">{it.keys}</span>}
            </button>
          ),
        )}
      </div>
    </>
  );
}
