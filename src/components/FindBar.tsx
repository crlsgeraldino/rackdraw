'use client';

import { useReactFlow } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findInProject, type FindHit } from '@/lib/find';
import type { AppNode } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const MAX_SHOWN = 200;

/** Find (and replace) text across every page of the client: device fields, ports, zones, notes, shapes and cables. */
export function FindBar({ onClose, replaceMode }: { onClose: () => void; replaceMode: boolean }) {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const { selectItem, replaceInHits } = useDiagram.getState();
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(replaceMode);
  const [current, setCurrent] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setShowReplace((r) => r || replaceMode), [replaceMode]);
  useEffect(() => input.current?.focus(), [replaceMode]);

  const hits = useMemo(() => findInProject(project, term, matchCase), [project, term, matchCase]);
  // Several fields of one item can match; the list shows each field, navigation goes item by item.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return hits.filter((h) => {
      const k = `${h.kind}:${h.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [hits]);

  const show = (h: FindHit) => {
    selectItem(h.pageId, h.kind, h.id);
    // The canvas remounts when the page changes; zoom once it has the item.
    setTimeout(() => {
      const pg = useDiagram.getState().projects[project.id].pages.find((p) => p.id === h.pageId);
      const edge = h.kind === 'edge' ? pg?.edges.find((e) => e.id === h.id) : undefined;
      const ids = edge ? [edge.source, edge.target] : [h.id];
      rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.6, maxZoom: 1.5, duration: 300 });
    }, 350);
  };
  const go = (dir: 1 | -1) => {
    if (!items.length) return;
    const i = (current + dir + items.length) % items.length;
    setCurrent(i);
    show(items[i]);
  };

  const replaceOne = (h: FindHit) => {
    replaceInHits([h], term, replacement, matchCase);
  };
  const replaceAll = () => {
    if (!hits.length) return;
    if (!confirm(`Replace "${term}" with "${replacement}" in ${hits.length} field${hits.length === 1 ? '' : 's'}? You can undo this with Ctrl+Z.`)) return;
    replaceInHits(hits, term, replacement, matchCase);
  };

  const field = 'min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500';
  return (
    <div className="absolute left-1/2 top-2 z-20 w-[420px] max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white shadow-lg" role="search">
      <div className="flex items-center gap-1 p-2">
        <button className="w-5 text-xs text-gray-500 hover:text-gray-800" onClick={() => setShowReplace((r) => !r)} title="Toggle replace" aria-expanded={showReplace}>{showReplace ? '▾' : '▸'}</button>
        <input
          ref={input}
          className={field}
          placeholder="Find name, IP, serial, VLAN, label…"
          value={term}
          onChange={(e) => { setTerm(e.target.value); setCurrent(-1); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') onClose();
          }}
          aria-label="Find"
        />
        <span className="w-16 shrink-0 text-center text-[11px] text-gray-500">{term ? (items.length ? `${current >= 0 ? current + 1 : 0} of ${items.length}` : 'No results') : ''}</span>
        <button className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40" disabled={!items.length} onClick={() => go(-1)} title="Previous (Shift+Enter)" aria-label="Previous result">▲</button>
        <button className="rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40" disabled={!items.length} onClick={() => go(1)} title="Next (Enter)" aria-label="Next result">▼</button>
        <button className="rounded px-1.5 py-1 text-gray-500 hover:bg-gray-100" onClick={onClose} title="Close (Esc)" aria-label="Close find">×</button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1 px-2 pb-2 pl-8">
          <input
            className={field}
            placeholder="Replace with…"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            aria-label="Replace with"
          />
          <button className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40" disabled={!hits.length} onClick={replaceAll}>Replace all</button>
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-gray-100 px-3 py-1 text-[11px] text-gray-600">
        <label className="flex items-center gap-1"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <span className="ml-auto text-gray-400">Searches every page of {project.name}</span>
      </div>
      {term && hits.length > 0 && (
        <ul className="max-h-64 overflow-y-auto border-t border-gray-100 py-1 text-xs">
          {hits.slice(0, MAX_SHOWN).map((h, i) => {
            const isCurrent = current >= 0 && items[current]?.id === h.id;
            return (
              <li key={`${h.kind}:${h.id}:${h.path.join('.')}:${i}`} className={`group flex items-center gap-2 px-3 py-1 ${isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => { setCurrent(items.findIndex((x) => x.id === h.id && x.kind === h.kind)); show(h); }}>
                  <span className="font-medium text-gray-800">{h.item}</span>
                  <span className="text-gray-400"> · {h.label}{project.pages.length > 1 ? ` · ${h.pageName}` : ''}</span>
                  <span className="block truncate font-mono text-[11px] text-gray-600" title={h.value}>{h.value}</span>
                </button>
                {showReplace && (
                  <button className="hidden shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-gray-50 group-hover:block" onClick={() => replaceOne(h)} title="Replace in this field">Replace</button>
                )}
              </li>
            );
          })}
          {hits.length > MAX_SHOWN && <li className="px-3 py-1 text-gray-400">…and {hits.length - MAX_SHOWN} more. Refine the search.</li>}
        </ul>
      )}
    </div>
  );
}
