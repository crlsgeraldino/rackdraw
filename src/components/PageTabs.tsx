'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageKind } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Visio-style page tabs under the canvas: switch, add, rename (double-click), and a menu per page. */
export function PageTabs() {
  const project = useCurrentProject();
  const { setActivePage, addPage, renamePage, duplicatePage, deletePage, movePage, setPageBackground, setBackgroundOf, addBackgroundPage } = useDiagram.getState();
  const backgrounds = project.pages.filter((p) => p.background);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu && !adding) return;
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) { setMenu(null); setAdding(false); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu, adding]);

  const startRename = (id: string, name: string) => { setRenaming(id); setDraft(name); setMenu(null); };
  const finishRename = () => {
    if (renaming && draft.trim()) renamePage(renaming, draft.trim());
    setRenaming(null);
  };
  const add = (kind: PageKind) => {
    const n = project.pages.filter((p) => p.kind === kind).length + 1;
    addPage(kind === 'floorplan' ? `Floor plan ${n}` : `Network ${n}`, kind);
    setAdding(false);
  };

  return (
    <div ref={bar} className="relative flex h-9 shrink-0 items-stretch gap-0.5 border-t border-gray-200 bg-gray-100 px-2 text-sm" role="tablist" aria-label="Pages">
      {project.pages.map((p, i) => {
        const active = p.id === project.activePageId;
        return (
          <div
            key={p.id}
            role="tab"
            aria-selected={active}
            className={`group -mt-px flex items-center gap-1.5 border-x border-b px-3 ${active ? 'border-gray-200 bg-white font-medium text-gray-900' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}
            onClick={() => setActivePage(p.id)}
            onDoubleClick={() => startRename(p.id, p.name)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: (e.currentTarget as HTMLElement).offsetLeft }); }}
            title={p.background
              ? 'Background page: shown behind the pages that use it · double-click to rename'
              : `${p.kind === 'floorplan' ? 'Floor plan' : 'Network'} page${p.backgroundId ? ` · background: ${project.pages.find((x) => x.id === p.backgroundId)?.name ?? ''}` : ''} · double-click to rename`}
          >
            <span aria-hidden className="text-[11px] text-gray-400">{p.background ? '▭' : p.kind === 'floorplan' ? '▦' : '⧉'}</span>
            {renaming === p.id ? (
              <input
                autoFocus
                className="w-32 rounded border border-blue-400 px-1 text-sm outline-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(null); }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className={`max-w-40 truncate ${p.background ? 'italic text-gray-500' : ''}`}>{p.name}</span>
            )}
            <button
              className={`rounded px-0.5 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-700 ${active ? '' : 'invisible group-hover:visible'}`}
              onClick={(e) => { e.stopPropagation(); setMenu(menu?.id === p.id ? null : { id: p.id, x: (e.currentTarget.parentElement as HTMLElement).offsetLeft }); }}
              aria-label={`Page options for ${p.name}`}
            >
              ▾
            </button>
            {menu?.id === p.id && (
              <div className="absolute bottom-full z-50 mb-1 w-52 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg" style={{ left: menu.x }} onClick={(e) => e.stopPropagation()}>
                <button className="block w-full px-3 py-1 text-left hover:bg-gray-50" onClick={() => startRename(p.id, p.name)}>Rename</button>
                <button className="block w-full px-3 py-1 text-left hover:bg-gray-50" onClick={() => { duplicatePage(p.id); setMenu(null); }}>Duplicate</button>
                {!p.background && (
                  <label className="block px-3 py-1 text-gray-700">
                    <span className="text-xs text-gray-500">Background</span>
                    <select className="mt-0.5 w-full rounded border border-gray-300 px-1 py-0.5 text-sm" value={p.backgroundId ?? ''} onChange={(e) => { setBackgroundOf(p.id, e.target.value || null); setMenu(null); }}>
                      <option value="">None</option>
                      {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                )}
                <button
                  className="block w-full px-3 py-1 text-left hover:bg-gray-50"
                  title={p.background ? 'Make this a normal page again' : 'Draw this page behind other pages (title block, logo, border)'}
                  onClick={() => { setPageBackground(p.id, !p.background); setMenu(null); }}
                >
                  {p.background ? 'Make foreground page' : 'Make background page'}
                </button>
                <button className="block w-full px-3 py-1 text-left hover:bg-gray-50 disabled:opacity-40" disabled={i === 0} onClick={() => { movePage(p.id, -1); setMenu(null); }}>Move left</button>
                <button className="block w-full px-3 py-1 text-left hover:bg-gray-50 disabled:opacity-40" disabled={i === project.pages.length - 1} onClick={() => { movePage(p.id, 1); setMenu(null); }}>Move right</button>
                <button
                  className="block w-full px-3 py-1 text-left text-red-600 hover:bg-red-50 disabled:opacity-40"
                  disabled={project.pages.length <= 1}
                  onClick={() => {
                    setMenu(null);
                    const n = p.nodes.filter((x) => x.type === 'device').length;
                    if (confirm(`Delete page "${p.name}"${n ? ` and its ${n} device${n === 1 ? '' : 's'} (also removed from racks)` : ''}? You can undo this.`)) deletePage(p.id);
                  }}
                >
                  Delete page
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="relative flex items-center">
        <button className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800" onClick={() => setAdding((a) => !a)} title="Add a page" aria-label="Add a page">＋</button>
        {adding && (
          <div className="absolute bottom-full left-0 z-50 mb-1 w-48 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => add('network')}>⧉ Network diagram</button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => add('floorplan')}>▦ Floor plan</button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" title="A page drawn behind other pages: put the title block, logo or border here once" onClick={() => { addBackgroundPage(); setAdding(false); }}>▭ Background page</button>
          </div>
        )}
      </div>
    </div>
  );
}
