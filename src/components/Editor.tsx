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
import { allNodes } from '@/lib/project';
import type { AppNode, CableEdge, ShapeKind } from '@/lib/types';
import { getStencil, useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
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
      className="rounded px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
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

  const view = useDiagram((s) => s.view);
  const setView = useDiagram((s) => s.setView);
  const page = useCurrentPage();
  const bounds = () => rf.getNodesBounds(page.nodes);

  /** For the PDF: show each page in turn and capture it. */
  const renderPage: PageRenderer = async (pg) => {
    if (!pg.nodes.length) return null;
    useDiagram.getState().setActivePage(pg.id);
    await new Promise((r) => setTimeout(r, 700));
    return renderCanvasPng(rf.getNodesBounds(pg.nodes));
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

  const sorted = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3">
      <div className="mr-3 flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6.5h4.5V14" /></svg>
        <span className="font-semibold text-gray-900">NetCraft</span>
      </div>

      <select
        className="max-w-56 rounded border border-gray-300 px-2 py-1 text-sm"
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
      <Btn onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶ Undo</Btn>
      <Btn onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷ Redo</Btn>

      <div className="ml-auto" />
      <ViewMenu />
      <DataMenu />
      <div className="relative">
        <button
          onClick={() => setMenu((m) => !m)}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? 'Exporting…' : 'Export ▾'}
        </button>
        {menu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DND_TYPE);
    if (!id) return;
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (id === '__zone') return addZone(pos);
    if (id === '__note') return addNote(pos);
    if (id.startsWith('__shape:')) return addShape(id.slice(8) as ShapeKind, pos);
    const s = getStencil(id);
    if (!s) return;
    addStencil(id, { x: pos.x - (s.width * s.scale) / 2, y: pos.y - (s.height * s.scale) / 2 });
  }, [rf, addStencil, addZone, addNote, addShape]);

  // Keyboard shortcuts (outside of text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
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
        <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'zone' || n.type === 'backdrop' ? 'transparent' : n.type === 'note' ? '#fde68a' : '#374151')} />
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
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
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
