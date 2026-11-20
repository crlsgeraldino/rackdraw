'use client';

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportCsv, exportImage, exportPdf, readProjectFile, renderCanvasPng, saveProjectFile, type PageRenderer } from '@/lib/export';
import { printProject, type PrintOptions } from '@/lib/print';
import { allNodes } from '@/lib/project';
import type { AppNode, CableEdge, ShapeKind } from '@/lib/types';
import { CLIP_MIME, getStencil, useCurrentPage, useCurrentProject, useDiagram, type Clipboard } from '@/store/useDiagramStore';
import { ArrangeMenu } from './ArrangeMenu';
import { CheckPanel, OPEN_CHECK_EVENT } from './CheckPanel';
import { parseLength, scaleFrom, SET_SCALE_EVENT } from '@/lib/units';
import { ContextMenu, editStencil, type MenuTarget } from './ContextMenu';
import { FindBar } from './FindBar';
import { PrintDialog } from './PrintDialog';
import { edgeTypes } from './CableEdgeView';
import { nodeTypes } from './nodes';
import { DND_TYPE, Palette } from './Palette';
import { PropertiesPanel } from './PropertiesPanel';
import { DataMenu } from './DataMenu';
import { useDisplay } from './useDisplay';
import { Legend, ViewMenu } from './ViewMenu';
import { PageTabs } from './PageTabs';
import { RackView } from './RackView';

function Btn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="whitespace-nowrap rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const inField = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]');

/** Readable text for other apps (tickets, email): one line per copied device, shape or note. */
function clipText(clip: Clipboard) {
  return clip.nodes
    .map((n) => {
      if (n.type === 'device') return [n.data.name, n.data.ip, n.data.model, n.data.serial].filter(Boolean).join('\t');
      if (n.type === 'shape') return n.data.text;
      if (n.type === 'note') return n.data.text;
      if (n.type === 'zone') return n.data.title;
      return '';
    })
    .filter(Boolean)
    .join('\r\n');
}

/** Copy/cut/paste of diagram items through the system clipboard (so it also works between NetCraft windows). */
function useClipboardEvents() {
  useEffect(() => {
    const { copySelected, cutSelected, paste } = useDiagram.getState();
    const put = (e: ClipboardEvent, clip: Clipboard | null) => {
      if (!clip) return;
      e.preventDefault();
      e.clipboardData?.setData(CLIP_MIME, JSON.stringify(clip));
      e.clipboardData?.setData('text/plain', clipText(clip));
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!inField(e.target) && !window.getSelection()?.toString() && useDiagram.getState().view === 'diagram') put(e, copySelected());
    };
    const onCut = (e: ClipboardEvent) => {
      if (!inField(e.target) && !window.getSelection()?.toString() && useDiagram.getState().view === 'diagram') put(e, cutSelected());
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target) || useDiagram.getState().view !== 'diagram') return;
      const raw = e.clipboardData?.getData(CLIP_MIME);
      if (!raw) return;
      try {
        const clip = JSON.parse(raw) as Clipboard;
        if (clip?.format !== 'netcraft-clip' || !Array.isArray(clip.nodes)) return;
        e.preventDefault();
        paste(clip);
      } catch {
        // Not ours.
      }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}

function Toolbar() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const projects = useDiagram((s) => s.projects);
  const { newProject, openProject, deleteProject, importProject, undo, redo } = useDiagram.getState();
  const canUndo = useDiagram((s) => s.past.length > 0);
  const canRedo = useDiagram((s) => s.future.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const view = useDiagram((s) => s.view);
  const setView = useDiagram((s) => s.setView);
  const page = useCurrentPage();
  /**
   * What to capture: the nodes (by id, so React Flow uses its live measurements rather than sizes saved in the
   * diagram), widened to take in device labels and info boxes that sit outside their device.
   */
  const contentBounds = (ids: string[]) => {
    const b = rf.getNodesBounds(ids);
    let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.width, b.y + b.height];
    document.querySelectorAll('.react-flow__viewport .nc-infobox, .react-flow__viewport .nc-device-label, .react-flow__viewport .nc-measure *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const a = rf.screenToFlowPosition({ x: r.left, y: r.top }, { snapToGrid: false });
      const z = rf.screenToFlowPosition({ x: r.right, y: r.bottom }, { snapToGrid: false });
      [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, z.x), Math.max(y1, z.y)];
    });
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  const bounds = () => contentBounds(page.nodes.map((n) => n.id));

  /** For the PDF: show each page in turn and capture it. */
  const renderPage: PageRenderer = async (pg) => {
    if (!pg.nodes.length) return null;
    useDiagram.getState().setActivePage(pg.id);
    await new Promise((r) => setTimeout(r, 700));
    return renderCanvasPng(contentBounds(pg.nodes.map((n) => n.id)));
  };

  const run = async (fn: () => Promise<void> | void, needsCanvas = true) => {
    if (!allNodes(project).length && !(project.racks ?? []).length) return alert('This client has no diagram or racks yet.');
    setMenu(false);
    setBusy(true);
    try {
      // Picture exports capture the live canvas, so show the diagram first.
      if (needsCanvas && useDiagram.getState().view !== 'diagram') {
        setView('diagram');
        await new Promise((r) => setTimeout(r, 500));
      }
      await fn();
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async (f?: File) => {
    if (!f) return;
    try {
      const { project: p, stencils } = await readProjectFile(f);
      importProject(p, stencils);
      setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Installed app: open .netcraft.json files double-clicked in Explorer (File Handling API).
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer: (cb: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      for (const h of files) await onOpen(await h.getFile());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+P prints the client documentation instead of the app screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPrinting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const doPrint = (o: PrintOptions) => {
    setPrinting(false);
    const back = project.activePageId;
    run(async () => {
      try {
        await printProject(project, renderPage, o);
      } finally {
        useDiagram.getState().setActivePage(back);
      }
    }, o.pageIds.length > 0);
  };

  // Menu copy/cut go through the browser's copy command, so the system clipboard gets them too.
  const { copySelected, cutSelected, paste } = useDiagram.getState();
  const menuCopy = () => { if (!document.execCommand('copy')) copySelected(); };
  const menuCut = () => { if (!document.execCommand('cut')) cutSelected(); };

  const sorted = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3">
      <div className="mr-3 flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6.5h4.5V14" /></svg>
        <span className="hidden font-semibold text-gray-900 xl:inline">NetCraft</span>
      </div>

      <select
        className="max-w-40 rounded border border-gray-300 px-2 py-1 text-sm xl:max-w-56"
        value={project.id}
        onChange={(e) => {
          openProject(e.target.value);
          setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
        }}
        title="Client diagram"
      >
        {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Btn onClick={() => setNaming('')} title="New client diagram">+ New</Btn>
      {naming !== null && (
        <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/30 pt-32" onMouseDown={() => setNaming(null)}>
          <form
            className="w-80 rounded-lg bg-white p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (naming.trim()) {
                newProject(naming.trim());
                setNaming(null);
              }
            }}
          >
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="nc-client-name">New client</label>
            <input
              id="nc-client-name"
              autoFocus
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              placeholder="Client name"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100" onClick={() => setNaming(null)}>Cancel</button>
              <button type="submit" disabled={!naming.trim()} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create</button>
            </div>
          </form>
        </div>
      )}
      <Btn onClick={() => fileRef.current?.click()} title="Open a .netcraft.json file">Open</Btn>
      <Btn onClick={() => saveProjectFile(project)} title="Save to a .netcraft.json file">Save file</Btn>
      <Btn onClick={() => { if (confirm(`Delete "${project.name}" from this browser? This cannot be undone.`)) deleteProject(project.id); }} title="Delete this client diagram">Delete</Btn>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { onOpen(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="mx-2 h-6 w-px bg-gray-200" />
      <div className="flex rounded border border-gray-300 p-0.5 text-sm" role="tablist" aria-label="View">
        {(['diagram', 'racks'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded px-3 py-0.5 ${view === v ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            {v === 'diagram' ? 'Diagram' : `Racks${project.racks?.length ? ` (${project.racks.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-gray-200" />
      <Btn onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶<span className="hidden xl:inline"> Undo</span></Btn>
      <Btn onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷<span className="hidden xl:inline"> Redo</span></Btn>

      <div className="ml-auto" />
      {view === 'diagram' && <ArrangeMenu onCopy={menuCopy} onCut={menuCut} onPaste={() => paste()} />}
      <ViewMenu />
      <DataMenu />
      {printing && <PrintDialog onPrint={doPrint} onClose={() => setPrinting(false)} />}
      <div className="relative">
        <button
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          className="whitespace-nowrap rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Export ▾'}
        </button>
        {menu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
            <button className="flex w-full items-center px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => { setMenu(false); setPrinting(true); }}>Print… <span className="ml-auto text-xs text-gray-400">Ctrl+P</span></button>
            <div className="my-1 border-t border-gray-100" />
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => run(async () => { const back = project.activePageId; try { await exportPdf(project, renderPage); } finally { useDiagram.getState().setActivePage(back); } })}>PDF report <span className="text-xs text-gray-400">diagram, racks, tables</span></button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => run(() => { if (!page.nodes.length) return alert('This page is empty.'); return exportImage('png', project, bounds(), page.name); })}>PNG image <span className="text-xs text-gray-400">Word, email</span></button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => run(() => { if (!page.nodes.length) return alert('This page is empty.'); return exportImage('svg', project, bounds(), page.name); })}>SVG vector <span className="text-xs text-gray-400">Visio, Office</span></button>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => run(() => exportCsv(project), false)}>CSV tables <span className="text-xs text-gray-400">Excel</span></button>
          </div>
        )}
      </div>
    </header>
  );
}

function Canvas() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const display = useDisplay();
  // Items on hidden layers are hidden on the canvas (and so in picture exports).
  const nodes = useMemo(
    () => page.nodes.map((n) => ((n.type === 'device' || n.type === 'shape') && n.data.layer && display.hidden.has(n.data.layer) ? { ...n, hidden: true } : n)),
    [page.nodes, display.hidden],
  );
  const edges = useMemo(
    () =>
      page.edges.map((e) => {
        const hidden = !!(e.data?.layer && display.hidden.has(e.data.layer));
        const arrows = e.data?.arrows ?? 'none';
        if (!hidden && arrows === 'none') return e;
        // Arrowheads take the line's color.
        const marker = { type: MarkerType.ArrowClosed, color: display.cable(e.data).color, width: 16, height: 16 };
        return {
          ...e,
          hidden,
          markerEnd: arrows === 'end' || arrows === 'both' ? marker : undefined,
          markerStart: arrows === 'start' || arrows === 'both' ? marker : undefined,
        };
      }),
    [page.edges, display],
  );
  const { onNodesChange, onEdgesChange, onConnect, addStencil, addZone, addNote, addShape, snapshot, deleteSelected, duplicateSelected } = useDiagram.getState();
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // "Set scale": the user clicks two points a known distance apart.
  const [calib, setCalib] = useState<{ x: number; y: number }[] | null>(null);
  useEffect(() => {
    const start = () => setCalib([]);
    window.addEventListener(SET_SCALE_EVENT, start);
    return () => window.removeEventListener(SET_SCALE_EVENT, start);
  }, []);
  useEffect(() => {
    if (!calib) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCalib(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [calib]);
  const calibClick = (e: React.MouseEvent) => {
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
    const pts = [...(calib ?? []), p];
    if (pts.length < 2) return setCalib(pts);
    setCalib(null);
    const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const answer = prompt('How far apart are those two points in real life?\ne.g. 30 ft, 12\' 6", 9.5 m', '');
    if (answer === null) return;
    const d = parseLength(answer, page.scale?.unit ?? 'ft');
    const scale = d && scaleFrom(px, d);
    if (!scale) return alert('Could not read that distance. Try something like 30 ft or 9.5 m.');
    useDiagram.getState().setPageScale(scale);
  };
  const { selectItem } = useDiagram.getState();
  /** Right-click selects what's under the pointer (unless it's already part of the selection), then opens the menu. */
  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    const pg = page;
    if (target.kind === 'node' && !pg.nodes.find((n) => n.id === target.id)?.selected) selectItem(pg.id, 'node', target.id);
    if (target.kind === 'edge' && !pg.edges.find((x) => x.id === target.id)?.selected) selectItem(pg.id, 'edge', target.id);
    setMenu(target);
  };
  useEffect(() => {
    const open = () => setChecking(true);
    window.addEventListener(OPEN_CHECK_EVENT, open);
    return () => window.removeEventListener(OPEN_CHECK_EVENT, open);
  }, []);
  useClipboardEvents();

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DND_TYPE);
    if (!id) return;
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (id === '__zone') return addZone(pos);
    if (id === '__note') return addNote(pos);
    if (id === '__measure') return useDiagram.getState().addMeasure({ x: pos.x - 100, y: pos.y });
    if (id.startsWith('__shape:')) return addShape(id.slice(8) as ShapeKind, pos);
    const s = getStencil(id);
    if (!s) return;
    addStencil(id, { x: pos.x - (s.width * s.scale) / 2, y: pos.y - (s.height * s.scale) / 2 });
  }, [rf, addStencil, addZone, addNote, addShape]);

  // Keyboard shortcuts (outside of text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Find works from anywhere, even while typing in a field.
      if (mod && !e.shiftKey && (key === 'f' || key === 'h')) {
        e.preventDefault();
        setFind({ replace: key === 'h' });
        return;
      }
      if (inField(e.target) || !mod) return;
      const s = useDiagram.getState();
      if (key === 'd' && !e.shiftKey) { e.preventDefault(); duplicateSelected(); }
      else if (key === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroupSelected(); else s.groupSelected(); }
      else if (key === 'f' && e.shiftKey) { e.preventDefault(); s.orderSelected('front'); }
      else if (key === 'b' && e.shiftKey) { e.preventDefault(); s.orderSelected('back'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateSelected]);

  return (
    <div className="relative flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
      <ReactFlow<AppNode, CableEdge>
        key={page.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={snapshot}
        onNodeContextMenu={(e, n) => openMenu(e, { kind: 'node', id: n.id, x: e.clientX, y: e.clientY })}
        onEdgeContextMenu={(e, ed) => openMenu(e, { kind: 'edge', id: ed.id, x: e.clientX, y: e.clientY })}
        onPaneContextMenu={(e) => openMenu(e as React.MouseEvent, { kind: 'pane', x: e.clientX, y: e.clientY })}
        onNodeDoubleClick={(_, n) => { if (n.type === 'device') editStencil(n.data.stencilId, n.id); }}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'cable' }}
        snapToGrid
        snapGrid={[10, 10]}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
        <Panel position="top-left"><Legend /></Panel>
        <Controls />
        <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'zone' || n.type === 'backdrop' || n.type === 'measure' ? 'transparent' : n.type === 'note' ? '#fde68a' : '#374151')} />
      </ReactFlow>
      {page.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-dashed border-gray-300 bg-white/80 px-6 py-4 text-center text-sm text-gray-500">
            {page.kind === 'floorplan'
              ? <>Add a floor plan image from the panel on the right, then drag devices onto it.</>
              : <>Drag a device from the left to start documenting <b>{project.name}</b>.</>}
          </div>
        </div>
      )}
      {find && <FindBar replaceMode={find.replace} onClose={() => setFind(null)} />}
      {checking && <CheckPanel onClose={() => setChecking(false)} />}
      {menu && <ContextMenu target={menu} onClose={() => setMenu(null)} />}
      {calib && (
        <div className="absolute inset-0 z-30 cursor-crosshair" onClick={calibClick}>
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white shadow">
            {calib.length ? 'Now click the second point' : 'Set scale: click the first of two points a known distance apart (e.g. both sides of a door)'} · Esc cancels
          </div>
          {calib.map((p, i) => {
            const host = (e: HTMLElement | null) => e?.parentElement?.getBoundingClientRect();
            const s = rf.flowToScreenPosition(p);
            return <span key={i} ref={(el) => { const r = host(el); if (el && r) { el.style.left = `${s.x - r.left - 5}px`; el.style.top = `${s.y - r.top - 5}px`; } }} className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-600 shadow" />;
          })}
        </div>
      )}
      <button onClick={deleteSelected} className="sr-only">Delete selected</button>
    </div>
  );
}

export default function Editor() {
  // Saved diagrams load asynchronously from IndexedDB; wait so edits aren't made to the placeholder project.
  const [hydrated, setHydrated] = useState(() => useDiagram.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useDiagram.persist.onFinishHydration(() => setHydrated(true));
    if (useDiagram.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);
  const view = useDiagram((s) => s.view);

  // Undo/redo work in both views (outside of text fields, which have their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const { undo, redo } = useDiagram.getState();
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated) return <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading your diagrams…</div>;

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-gray-50 text-gray-900">
        <Toolbar />
        {view === 'racks' ? (
          <RackView />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Palette />
            <div className="flex min-w-0 flex-1 flex-col">
              <Canvas />
              <PageTabs />
            </div>
            <PropertiesPanel />
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
