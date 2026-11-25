'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { readStencilLibrary, saveStencilLibrary } from '@/lib/export';
import { DEFAULT_LIBRARY, groupLibraries, resolveLibrary, sameLibrary, type StencilLibrary } from '@/lib/libraries';
import { allNodes } from '@/lib/project';
import { loadImageFile } from '@/lib/imageImport';
import { STENCILS, StencilThumb } from '@/lib/stencils';
import { NETWORK_SCOPES, STENCIL_CATEGORIES, type NetworkScope, type ShapeKind, type StencilDef } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';
import { editableCopy } from '@/lib/shapeCopy';
import { setPref, usePref } from '@/lib/prefs';
import { Drop } from './ribbon/parts';
import { askText } from './PromptHost';
import { PALETTE_EVENT, type PaletteAction } from '@/lib/events';
import { EDIT_STENCIL_EVENT } from './ContextMenu';
import { StencilEditor } from './StencilEditor';
import { VisioImportDialog } from './VisioImportDialog';

export const DND_TYPE = 'application/x-netcraft-stencil';

const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Per-viewer palette state: which library folders are collapsed. */
const COLLAPSED_KEY = 'netcraft.palette.collapsedLibraries';
function loadCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveCollapsed(names: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(names));
  } catch {
    // Storage blocked (private window, previews): folders simply reopen next time.
  }
}

const searchText = (s: StencilDef) => `${s.name} ${s.vendor ?? ''} ${s.category} ${s.networks?.join(' ') ?? ''} ${s.defaults?.model ?? ''}`.toLowerCase();

const ink = { fill: '#fff', stroke: '#374151', strokeWidth: 1.5 };
const SHAPES: { kind: ShapeKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'text', label: 'Text', icon: <text x="17" y="16" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">T</text> },
  { kind: 'rect', label: 'Box', icon: <rect x="3" y="3" width="28" height="16" {...ink} /> },
  { kind: 'rounded', label: 'Rounded', icon: <rect x="3" y="3" width="28" height="16" rx="6" {...ink} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <ellipse cx="17" cy="11" rx="14" ry="8" {...ink} /> },
  { kind: 'diamond', label: 'Diamond', icon: <polygon points="17,2 32,11 17,20 2,11" {...ink} /> },
  { kind: 'callout', label: 'Callout', icon: <><path d="M20 15l-8 6" stroke="#d97706" /><rect x="10" y="2" width="22" height="13" rx="3" fill="#fffbeb" stroke="#d97706" /></> },
  { kind: 'arrow', label: 'Arrow', icon: <polygon points="2,7 20,7 20,2 32,11 20,20 20,15 2,15" fill="#93c5fd" stroke="#374151" strokeWidth="1.5" /> },
];

/** A Visio-style stencil title bar that folds its shapes away. */
function StencilBar({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="mb-1 rounded border border-gray-200">
      <button className="flex w-full items-center gap-1 rounded-t bg-[#eef1f6] px-1.5 py-1 text-left text-xs font-medium text-gray-800 hover:bg-[#e3e8f1]" onClick={() => onToggle(!open)} aria-expanded={open}>
        <span className="w-3 shrink-0 text-[10px] text-gray-500" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="ml-auto text-[10px] font-normal text-gray-400">{count}</span>}
      </button>
      {open && <div className="p-1">{children}</div>}
    </section>
  );
}

export function Palette() {
  const [q, setQ] = useState('');
  /** Shapes window filter: only equipment for this kind of network (PAN … WAN). */
  const [net, setNet] = useState<NetworkScope | null>(null);
  const [editing, setEditing] = useState<StencilDef | null>(null);
  // Device to switch to the edited copy when a built-in shape is edited from the canvas.
  const [editFor, setEditFor] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const { stencilId, nodeId } = (e as CustomEvent<{ stencilId: string; nodeId?: string }>).detail;
      const own = useDiagram.getState().customStencils[stencilId];
      if (own) {
        setEditFor(null);
        setEditing(own);
        return;
      }
      const builtIn = STENCILS.find((s) => s.id === stencilId);
      if (!builtIn) return;
      try {
        setEditing(editableCopy(builtIn));
        setEditFor(nodeId ?? null);
      } catch (err) {
        alert((err as Error).message);
      }
    };
    window.addEventListener(EDIT_STENCIL_EVENT, open);
    return () => window.removeEventListener(EDIT_STENCIL_EVENT, open);
  }, []);
  // Ribbon commands (Insert tab) that use this window's import dialogs.
  useEffect(() => {
    const run = (e: Event) => {
      const action = (e as CustomEvent<PaletteAction>).detail;
      if (action === 'import-image') imageRef.current?.click();
      else if (action === 'import-visio') visioRef.current?.click();
      else if (action === 'import-library') libRef.current?.click();
    };
    window.addEventListener(PALETTE_EVENT, run);
    return () => window.removeEventListener(PALETTE_EVENT, run);
  }, []);
  const imageRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const visioRef = useRef<HTMLInputElement>(null);
  const [visioFile, setVisioFile] = useState<File | null>(null);
  const custom = useDiagram((s) => s.customStencils);
  const projects = useDiagram((s) => s.projects);
  const { saveCustomStencil, deleteCustomStencil, importStencils, renameLibrary, deleteLibrary } = useDiagram.getState();

  // Read after mount: the page is prerendered, where there is no localStorage.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => setCollapsed(loadCollapsed()), []);
  const updateCollapsed = (next: string[]) => {
    setCollapsed(next);
    saveCollapsed(next);
  };
  const isCollapsed = (name: string) => collapsed.some((n) => sameLibrary(n, name));
  const setFolderOpen = (name: string, open: boolean) =>
    updateCollapsed([...collapsed.filter((n) => !sameLibrary(n, name)), ...(open ? [] : [name])]);

  const customList = useMemo(() => Object.values(custom), [custom]);
  const libraries = useMemo(() => groupLibraries(customList), [customList]);
  const term = q.trim().toLowerCase();
  // Favorites (Visio): starred shapes from any stencil, kept at the top.
  const favIds = usePref('favorites');
  const favorites = useMemo(
    () => favIds.map((id) => custom[id] ?? STENCILS.find((s) => s.id === id)).filter((s): s is StencilDef => !!s && (!term || searchText(s).includes(term))),
    [favIds, custom, term],
  );
  const toggleFav = (id: string) => setPref('favorites', favIds.includes(id) ? favIds.filter((x) => x !== id) : [...favIds, id]);

  /** Libraries with the stencils that match the search (a matching library name shows all of it). */
  const shownLibraries = useMemo(
    () =>
      libraries
        .map((l) => ({
          library: l,
          stencils: !term || l.name.toLowerCase().includes(term) ? l.stencils : l.stencils.filter((s) => searchText(s).includes(term)),
        }))
        // A network filter (PAN … WAN) shows built-in equipment only: imported shapes aren't tagged.
        .filter((x) => x.stencils.length && !net),
    [libraries, term, net],
  );
  const groups = useMemo(() => {
    const list = STENCILS.filter((s) => (!term || searchText(s).includes(term)) && (!net || s.networks?.includes(net)));
    return STENCIL_CATEGORIES.map((c) => ({ c, items: list.filter((s) => s.category === c) })).filter((g) => g.items.length);
  }, [term, net]);

  const drag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(DND_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onImage = async (file?: File) => {
    if (!file) return;
    try {
      const img = await loadImageFile(file);
      setEditing({
        id: `custom-${uid()}`,
        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
        category: 'Custom',
        library: DEFAULT_LIBRARY,
        style: 'image',
        custom: true,
        image: img.dataUrl,
        width: img.width,
        height: img.height,
        // Start wide images at the built-in panel size and small ones at icon size.
        scale: Math.min(img.width >= img.height * 2 ? 524 : 96, img.width) / img.width,
        ports: [],
      });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onLibrary = async (file?: File) => {
    if (!file) return;
    try {
      const { stencils, library } = await readStencilLibrary(file);
      const into = library ? ` into "${resolveLibrary(library, libraries.map((l) => l.name))}"` : '';
      const added = importStencils(stencils, library);
      alert(added ? `Imported ${plural(added, 'stencil')}${into}.` : `Those stencils are already in your libraries (updated${into}).`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  /** Devices in any project drawn with one of these stencils. */
  const usesOf = (ids: Set<string>) =>
    Object.values(projects).reduce((n, p) => n + allNodes(p).filter((x) => x.type === 'device' && ids.has(x.data.stencilId)).length, 0);

  const remove = (s: StencilDef) => {
    const uses = usesOf(new Set([s.id]));
    const warn = uses ? `\n\nIt is used by ${plural(uses, 'device')} in your diagrams; they will show as "missing stencil" until you import it again.` : '';
    if (confirm(`Delete the stencil "${s.name}"?${warn}`)) deleteCustomStencil(s.id);
  };

  const removeLibrary = (l: StencilLibrary) => {
    const uses = usesOf(new Set(l.stencils.map((s) => s.id)));
    const warn = uses ? `\n\nIts stencils are used by ${plural(uses, 'device')} in your diagrams; they will show as "missing stencil" until you import the library again.` : '';
    if (confirm(`Delete the library "${l.name}" and its ${plural(l.stencils.length, 'stencil')}?${warn}`)) {
      deleteLibrary(l.name);
      if (isCollapsed(l.name)) updateCollapsed(collapsed.filter((n) => !sameLibrary(n, l.name)));
    }
  };

  const rename = async (l: StencilLibrary) => {
    const to = (await askText('Rename library', l.name))?.trim().replace(/\s+/g, ' ');
    if (!to || to === l.name) return;
    const other = libraries.find((x) => !sameLibrary(x.name, l.name) && sameLibrary(x.name, to));
    if (other && !confirm(`There is already a library named "${other.name}". Move the ${plural(l.stencils.length, 'stencil')} from "${l.name}" into it?`)) return;
    renameLibrary(l.name, to);
    if (isCollapsed(l.name)) updateCollapsed([...collapsed.filter((n) => !sameLibrary(n, l.name)), other?.name ?? to]);
  };

  const item = (s: StencilDef) => (
    <div
      key={s.id}
      draggable
      onDragStart={(e) => drag(e, s.id)}
      className={`group relative flex cursor-grab gap-2 rounded border border-transparent p-1.5 hover:border-gray-200 hover:bg-gray-50 active:cursor-grabbing ${s.style === 'icon' ? 'items-center' : 'flex-col items-start'}`}
      title={`Drag onto the canvas: ${s.name}`}
    >
      <div className={s.style === 'icon' ? 'flex w-10 shrink-0 justify-center' : ''}><StencilThumb stencil={s} /></div>
      <span className="text-xs text-gray-700">{s.name}</span>
      <button
        className={`absolute bottom-1 right-1 rounded px-0.5 text-[12px] leading-none ${favIds.includes(s.id) ? 'text-amber-500' : 'hidden text-gray-400 hover:text-amber-500 group-hover:block'}`}
        onClick={(e) => { e.stopPropagation(); toggleFav(s.id); }}
        title={favIds.includes(s.id) ? 'Remove from Favorites' : 'Add to Favorites'}
        aria-label={favIds.includes(s.id) ? `Remove ${s.name} from Favorites` : `Add ${s.name} to Favorites`}
      >
        {favIds.includes(s.id) ? '★' : '☆'}
      </button>
      {s.custom && (
        <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
          <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-blue-600" onClick={() => setEditing(s)} title="Edit stencil, ports and library">✎</button>
          <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-red-600" onClick={() => remove(s)} title="Delete stencil">✕</button>
        </div>
      )}
    </div>
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-300 bg-white">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-gray-300 bg-[#f3f3f3] px-2 text-[12px] font-semibold text-gray-700">
        Shapes
        <button className="rounded px-1 text-gray-500 hover:bg-gray-200" onClick={() => setPref('shapesPane', false)} title="Close (View → Task Panes to reopen)" aria-label="Close Shapes">×</button>
      </div>
      <div className="space-y-1.5 border-b border-gray-200 p-2">
        <input
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          placeholder="Search shapes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search shapes"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show equipment for">
          {[null, ...NETWORK_SCOPES.map((n) => n.value)].map((n) => (
            <button
              key={n ?? 'all'}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${net === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
              title={n ? NETWORK_SCOPES.find((x) => x.value === n)!.title : 'Equipment for every kind of network'}
              aria-pressed={net === n}
              onClick={() => setNet(n)}
            >
              {n ?? 'All'}
            </button>
          ))}
        </div>
        <Drop
          width={260}
          trigger={(open, isOpen) => (
            <button className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[12px] text-gray-800 hover:bg-gray-100 ${isOpen ? 'bg-gray-100' : ''}`} onClick={open}>
              More Shapes <span className="text-gray-400">▸</span>
            </button>
          )}
        >
          {(close) => (
            <div className="-m-1 text-[12px]">
              {[
                { label: 'Import Visio stencil (.vssx)…', sub: 'Vendor stencils (Dell, Ubiquiti, Cisco…); each file becomes a library', run: () => visioRef.current?.click() },
                { label: 'Import image as device…', sub: 'SVG, PNG or JPG, then mark its ports', run: () => imageRef.current?.click() },
                { label: 'Open stencil library…', sub: '.rackdraw-stencils.json from another tech', run: () => libRef.current?.click() },
                { label: 'Save all libraries…', sub: 'One file with every library, to share', run: () => saveStencilLibrary(customList, 'all-stencils'), disabled: !customList.length },
              ].map((it) => (
                <button key={it.label} disabled={it.disabled} className="block w-full rounded px-2 py-1.5 text-left hover:bg-blue-50 disabled:opacity-40" onClick={() => { close(); it.run(); }}>
                  <span className="block text-gray-900">{it.label}</span>
                  <span className="block text-[10px] text-gray-500">{it.sub}</span>
                </button>
              ))}
            </div>
          )}
        </Drop>
        <input ref={imageRef} type="file" hidden accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={visioRef} type="file" hidden accept=".vssx,.vsdx,.vstx,.vss,.vsd" onChange={(e) => { setVisioFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <input ref={libRef} type="file" hidden accept=".json,application/json" onChange={(e) => { onLibrary(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {favorites.length > 0 && (
          <section className="mb-3" aria-label="Favorites">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">★ Favorites ({favorites.length})</h3>
            <div className="rounded border border-amber-200 bg-amber-50/40 p-1">{favorites.map(item)}</div>
          </section>
        )}
        {shownLibraries.length > 0 && (
          <section className="mb-3" aria-label="My libraries">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">My libraries ({libraries.length})</h3>
            {shownLibraries.map(({ library: l, stencils }) => {
              // While searching, folders with matches open so the results are visible.
              const open = !!term || !isCollapsed(l.name);
              return (
                <div key={l.name} className="mb-1 rounded border border-gray-200">
                  <div className="group flex items-center rounded-t bg-gray-50 hover:bg-gray-100">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left text-xs font-medium text-gray-800"
                      onClick={() => setFolderOpen(l.name, !open)}
                      aria-expanded={open}
                      title={l.name}
                    >
                      <span className="w-3 shrink-0 text-[10px] text-gray-500" aria-hidden>{open ? '▾' : '▸'}</span>
                      <svg width="14" height="12" viewBox="0 0 14 12" className="shrink-0" aria-hidden>
                        <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3l1.5 1.5h4.5A1.5 1.5 0 0 1 13 4v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1 9.5z" fill="#fcd34d" stroke="#b45309" strokeWidth="0.8" />
                      </svg>
                      <span className="truncate">{l.name}</span>
                      <span className="ml-auto shrink-0 pl-1 text-[10px] font-normal text-gray-400">
                        {stencils.length !== l.stencils.length ? `${stencils.length}/` : ''}{l.stencils.length}
                      </span>
                    </button>
                    <div className="hidden shrink-0 gap-0.5 pr-1 group-focus-within:flex group-hover:flex">
                      <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-blue-600" onClick={() => rename(l)} title="Rename library">✎</button>
                      <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-blue-600" onClick={() => saveStencilLibrary(l.stencils, l.name, l.name)} title="Export this library to a .rackdraw-stencils.json file (to share it or move it to another computer)">⤓</button>
                      <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-red-600" onClick={() => removeLibrary(l)} title="Delete library">✕</button>
                    </div>
                  </div>
                  {open && <div className="grid grid-cols-1 gap-1 p-1">{stencils.map(item)}</div>}
                </div>
              );
            })}
          </section>
        )}
        {groups.map(({ c, items }) => (
          <StencilBar key={c} title={c} count={items.length} open={!!term || !!net || !isCollapsed(`builtin:${c}`)} onToggle={(o) => setFolderOpen(`builtin:${c}`, o)}>
            <div className="grid grid-cols-1 gap-1">{items.map(item)}</div>
          </StencilBar>
        ))}
        <StencilBar title="Drawing Tools" open={!isCollapsed('builtin:Drawing')} onToggle={(o) => setFolderOpen('builtin:Drawing', o)}>
          <div className="grid grid-cols-3 gap-1">
            {SHAPES.map((s) => (
              <div key={s.kind} draggable onDragStart={(e) => drag(e, `__shape:${s.kind}`)} className="flex cursor-grab flex-col items-center gap-0.5 rounded border border-gray-200 p-1 text-[10px] text-gray-600 hover:bg-gray-50" title={`Drag onto the canvas: ${s.label}`}>
                <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden>{s.icon}</svg>
                {s.label}
              </div>
            ))}
          </div>
        </StencilBar>
        <StencilBar title="Layout" open={!isCollapsed('builtin:Layout')} onToggle={(o) => setFolderOpen('builtin:Layout', o)}>
          <div className="grid grid-cols-2 gap-1">
            <div draggable onDragStart={(e) => drag(e, '__zone')} className="cursor-grab rounded border-2 border-dashed border-blue-400 bg-blue-50 p-2 text-center text-[11px] text-blue-700">Zone / room</div>
            <div draggable onDragStart={(e) => drag(e, '__note')} className="cursor-grab rounded bg-yellow-100 p-2 text-center text-[11px] text-gray-700 shadow-sm">Note</div>
            <div draggable onDragStart={(e) => drag(e, '__measure')} className="col-span-2 flex cursor-grab items-center justify-center gap-1.5 rounded border border-gray-200 p-1.5 text-[11px] text-gray-700 hover:bg-gray-50" title="Drag onto a floor plan to measure a distance (set the page scale first)">
              <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden><path d="M2 1v8M38 1v8M3 5h34M3 5l4-3M3 5l4 3M37 5l-4-3M37 5l-4 3" stroke="#334155" fill="none" strokeWidth="1.2" /></svg>
              Dimension line
            </div>
          </div>
        </StencilBar>
        <StencilBar title="Floor Plan" open={!isCollapsed('builtin:FloorPlan')} onToggle={(o) => setFolderOpen('builtin:FloorPlan', o)}>
          <div className="grid grid-cols-3 gap-1">
            {[
              { id: '__wall', label: 'Wall', title: 'Drag onto the page, then drag its ends', icon: <path d="M3 11h28" stroke="#4b5563" strokeWidth="5" /> },
              { id: '__shape:door', label: 'Door', title: 'Door with its swing; rotate or flip it in the panel', icon: <><path d="M10 19V5" stroke="#374151" strokeWidth="2.5" /><path d="M10 5A14 14 0 0 1 24 19" stroke="#374151" fill="none" /><path d="M10 19h14" stroke="#374151" strokeDasharray="2 2" /></> },
              { id: '__shape:window', label: 'Window', title: 'Window frame; stretch it along a wall', icon: <><rect x="3" y="8" width="28" height="6" fill="#fff" stroke="#374151" /><path d="M3 11h28" stroke="#374151" /></> },
            ].map((s) => (
              <div key={s.id} draggable onDragStart={(e) => drag(e, s.id)} className="flex cursor-grab flex-col items-center gap-0.5 rounded border border-gray-200 p-1 text-[10px] text-gray-600 hover:bg-gray-50" title={s.title}>
                <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden>{s.icon}</svg>
                {s.label}
              </div>
            ))}
          </div>
        </StencilBar>
      </div>
      <p className="border-t border-gray-200 p-2 text-[10px] leading-snug text-gray-500">
        Drag a shape onto the canvas. Drag from one port to another to draw a cable.
      </p>

      {visioFile && <VisioImportDialog key={`${visioFile.name}:${visioFile.lastModified}:${visioFile.size}`} file={visioFile} onClose={() => setVisioFile(null)} />}
      {editing && (
        <StencilEditor
          initial={editing}
          isNew={!custom[editing.id]}
          onCancel={() => { setEditing(null); setEditFor(null); }}
          onSave={(s) => {
            saveCustomStencil(s);
            if (editFor) useDiagram.getState().updateDevicesData([editFor], { stencilId: s.id });
            setEditing(null);
            setEditFor(null);
          }}
        />
      )}
    </aside>
  );
}
