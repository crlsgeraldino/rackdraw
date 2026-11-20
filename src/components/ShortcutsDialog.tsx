'use client';

import { useEffect, useState } from 'react';
import { SHORTCUTS_EVENT } from '@/lib/events';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: 'Tools', keys: [['Ctrl+1', 'Pointer'], ['Ctrl+2', 'Add a text box'], ['Ctrl+3', 'Connector'], ['Ctrl+4', 'Pencil'], ['Ctrl+6', 'Line'], ['Ctrl+8', 'Rectangle'], ['Ctrl+9', 'Ellipse'], ['Esc', 'Back to the pointer']] },
  { title: 'Edit', keys: [['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+C / X / V', 'Copy / Cut / Paste'], ['Ctrl+D', 'Duplicate'], ['Del', 'Delete'], ['F2', 'Edit the text of the selected item'], ['Ctrl+A', 'Select all'], ['Ctrl+F / Ctrl+H', 'Find / Replace']] },
  { title: 'Arrange', keys: [['Arrow keys', 'Nudge one grid step'], ['Shift+Arrow', 'Nudge one pixel'], ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup'], ['Ctrl+Shift+F', 'Bring to front'], ['Ctrl+Shift+B', 'Send to back'], ['Shift while dragging', 'Straight lines, square boxes']] },
  { title: 'View', keys: [['Ctrl+Shift+W', 'Fit the page'], ['Ctrl+scroll', 'Zoom'], ['F5', 'Full Screen (arrows change page, Esc ends)'], ['Ctrl+F1', 'Collapse the ribbon'], ['F1', 'This list']] },
];

/** F1: Visio-style keyboard shortcuts at a glance. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(SHORTCUTS_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="max-h-[88vh] w-[min(760px,94vw)] overflow-y-auto rounded-lg bg-white p-5 shadow-xl" role="dialog" aria-label="Keyboard shortcuts">
        <div className="mb-3 flex items-center">
          <h2 className="text-base font-semibold text-gray-900">Keyboard shortcuts</h2>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {g.keys.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt><kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{k}</kbd></dt>
                    <dd className="text-gray-700">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
