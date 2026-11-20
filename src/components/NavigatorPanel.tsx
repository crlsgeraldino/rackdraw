'use client';

import { useReactFlow } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { setPref } from '@/lib/prefs';
import type { AppNode, CableEdge, Page } from '@/lib/types';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Display name of an item in the navigator. */
function itemName(n: AppNode): string {
  if (n.type === 'device') return n.data.name || getStencil(n.data.stencilId)?.name || 'Device';
  if (n.type === 'zone') return n.data.title || 'Zone';
  if (n.type === 'note') return (n.data.text || 'Note').split('\n')[0];
  if (n.type === 'shape') return (n.data.text || n.data.kind).split('\n')[0];
  if (n.type === 'measure') return n.data.label || (n.data.variant === 'wall' ? 'Wall' : n.data.variant === 'line' ? 'Line' : 'Dimension');
  return 'Background picture';
}

const KIND_ORDER = ['device', 'zone', 'shape', 'note', 'measure'] as const;
const KIND_LABEL: Record<(typeof KIND_ORDER)[number], string> = { device: 'Devices', zone: 'Zones', shape: 'Shapes', note: 'Notes', measure: 'Lines & walls' };

/**
 * View → Navigation (like Visio's Drawing Explorer): every page of the client with its devices, zones, shapes and
 * cables. Type to filter; click an item to go to its page, select it and zoom to it.
 */
export function NavigatorPanel() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const { selectItem, setActivePage } = useDiagram.getState();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const term = q.trim().toLowerCase();

  const pages = useMemo(() => project.pages.map((pg) => {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    const match = (s: string) => !term || s.toLowerCase().includes(term);
    const groups = KIND_ORDER.map((kind) => ({
      kind,
      items: pg.nodes.filter((n) => n.type === kind && match(`${itemName(n)} ${n.type === 'device' ? `${n.data.ip ?? ''} ${n.data.model ?? ''}` : ''}`))
        .sort((a, b) => itemName(a).localeCompare(itemName(b), undefined, { numeric: true })),
    })).filter((g) => g.items.length);
    const cableName = (e: CableEdge) => `${itemName(byId.get(e.source) ?? ({ type: 'note', data: { text: '?' } } as AppNode))} ↔ ${itemName(byId.get(e.target) ?? ({ type: 'note', data: { text: '?' } } as AppNode))}`;
    const cables = pg.edges.filter((e) => match(`${cableName(e)} ${e.data?.label ?? ''} ${e.data?.vlan ?? ''}`));
    return { pg, groups, cables, cableName };
  }), [project.pages, term]);

  const go = (pg: Page, kind: 'node' | 'edge', id: string) => {
    selectItem(pg.id, kind, id);
    setTimeout(() => {
      const p = useDiagram.getState().projects[project.id].pages.find((x) => x.id === pg.id);
      const e = kind === 'edge' ? p?.edges.find((x) => x.id === id) : undefined;
      rf.fitView({ nodes: (e ? [e.source, e.target] : [id]).map((x) => ({ id: x })), padding: 0.6, maxZoom: 1.5, duration: 300 });
    }, pg.id === project.activePageId ? 30 : 350);
  };
  const toggle = (key: string) => setClosed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="absolute left-2 top-2 z-20 flex max-h-[80%] w-72 flex-col rounded-lg border border-gray-200 bg-white shadow-lg" role="dialog" aria-label="Navigation">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Navigation</h2>
        <button className="ml-auto rounded px-1.5 text-gray-500 hover:bg-gray-100" onClick={() => setPref('navPane', false)} aria-label="Close navigation">×</button>
      </header>
      <div className="border-b border-gray-100 p-2">
        <input className="w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:border-blue-500" placeholder="Filter by name, IP or model" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
        {pages.map(({ pg, groups, cables, cableName }) => {
          const open = !!term || !closed.has(pg.id);
          const total = groups.reduce((s, g) => s + g.items.length, 0);
          if (term && !total && !cables.length) return null;
          return (
            <li key={pg.id}>
              <div className={`flex items-center gap-1 px-2 py-1 ${pg.id === project.activePageId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <button className="w-4 text-[10px] text-gray-500" onClick={() => toggle(pg.id)} aria-label={open ? `Collapse ${pg.name}` : `Expand ${pg.name}`}>{open ? '▾' : '▸'}</button>
                <button className={`flex-1 truncate text-left font-medium ${pg.background ? 'italic text-gray-500' : 'text-gray-900'}`} onClick={() => setActivePage(pg.id)} title="Go to this page">
                  {pg.name}{pg.background ? ' (background)' : ''}
                </button>
                <span className="text-[10px] text-gray-400">{total}</span>
              </div>
              {open && (
                <div className="pb-1 pl-6">
                  {groups.map((g) => {
                    const key = `${pg.id}|${g.kind}`;
                    const gOpen = !!term || !closed.has(key);
                    return (
                      <div key={g.kind}>
                        <button className="flex w-full items-center gap-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500" onClick={() => toggle(key)}>
                          <span className="w-3">{gOpen ? '▾' : '▸'}</span>{KIND_LABEL[g.kind]} ({g.items.length})
                        </button>
                        {gOpen && g.items.map((n) => (
                          <button key={n.id} className={`block w-full truncate rounded px-2 py-0.5 text-left hover:bg-blue-50 ${n.selected && pg.id === project.activePageId ? 'bg-blue-100 text-blue-900' : 'text-gray-700'}`} onClick={() => go(pg, 'node', n.id)} title={itemName(n)}>
                            {itemName(n)}
                            {n.type === 'device' && n.data.ip && <span className="ml-1 font-mono text-[10px] text-gray-400">{n.data.ip}</span>}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {cables.length > 0 && (() => {
                    const key = `${pg.id}|cables`;
                    // Cables start collapsed (pages can have many); clicking opens them. A filter shows matches.
                    const cOpen = !!term || closed.has(key);
                    return (
                      <div>
                        <button className="flex w-full items-center gap-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500" onClick={() => toggle(key)}>
                          <span className="w-3">{cOpen ? '▾' : '▸'}</span>Cables ({cables.length})
                        </button>
                        {cOpen && cables.map((e) => (
                          <button key={e.id} className={`block w-full truncate rounded px-2 py-0.5 text-left hover:bg-blue-50 ${e.selected && pg.id === project.activePageId ? 'bg-blue-100 text-blue-900' : 'text-gray-700'}`} onClick={() => go(pg, 'edge', e.id)} title={cableName(e)}>
                            {cableName(e)}{e.data?.vlan ? <span className="ml-1 text-[10px] text-gray-400">VLAN {e.data.vlan}</span> : null}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
