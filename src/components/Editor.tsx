'use client';

import {
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIND_EVENT } from '@/lib/events';
import { usePref } from '@/lib/prefs';
import type { AppNode, CableEdge, ShapeKind } from '@/lib/types';
import { askText, PromptHost } from './PromptHost';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useFollowLink } from './NodeBadges';
import { AutoConnectArrows, DrawOverlay, GuidesLayer, PresentBar } from './CanvasTools';
import { setPresenting, setTool, usePresenting, type DrawTool } from '@/lib/tools';
import { EDIT_TEXT_EVENT, SHORTCUTS_EVENT } from '@/lib/events';
import { parseLength, scaleFrom, SET_SCALE_EVENT } from '@/lib/units';
import { CLIP_MIME, getStencil, portTaken, useCurrentPage, useCurrentProject, useDiagram, type Clipboard } from '@/store/useDiagramStore';
import { activePage } from '@/lib/project';
import { edgeTypes } from './CableEdgeView';
import { PageSheet, RULER, Rulers } from './CanvasPage';
import { CheckPanel, OPEN_CHECK_EVENT } from './CheckPanel';
import { NavigatorPanel } from './NavigatorPanel';
import { CommentsPanel, OPEN_COMMENTS_EVENT } from './CommentsPanel';
import { ContextMenu, editStencil, type MenuTarget } from './ContextMenu';
import { FindBar } from './FindBar';
import { nodeTypes } from './nodes';
import { PageTabs } from './PageTabs';
import { DND_TYPE, Palette } from './Palette';
import { PropertiesPanel } from './PropertiesPanel';
import { RackView } from './RackView';
import { Ribbon } from './ribbon/Ribbon';
import { StatusBar } from './StatusBar';
import { useDisplay } from './useDisplay';
import { Legend } from './ViewMenu';

export function Btn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
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

function Canvas() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const display = useDisplay();
  // Layer Properties: hidden layers are hidden on the canvas (and so in exports); locked layers can't be selected or
  // moved; non-printing layers are tagged so prints and picture exports leave them out.
  const layerProps = useMemo(() => {
    const locked = new Set<string>(), noPrint = new Set<string>();
    for (const l of project.layers ?? []) {
      if (l.locked) locked.add(l.id);
      if (l.print === false) noPrint.add(l.id);
    }
    return { locked, noPrint };
  }, [project.layers]);
  // Background page (Visio): its items are drawn behind this page's, and can't be selected or changed from here.
  const bgPage = page.backgroundId ? project.pages.find((p) => p.id === page.backgroundId && p.background) : undefined;
  const bg = useMemo(() => {
    if (!bgPage) return { nodes: [] as AppNode[], edges: [] as CableEdge[] };
    const fixed = { selected: false, selectable: false, draggable: false, connectable: false, deletable: false, focusable: false };
    return {
      nodes: bgPage.nodes.map((n) => ({
        ...n, ...fixed, id: `bg:${n.id}`, zIndex: -1000 + (n.zIndex ?? 0), className: 'nc-bg',
        ...(n.type === 'shape' && n.data.target ? { data: { ...n.data, target: `bg:${n.data.target}` } } : {}),
      }) as AppNode),
      edges: bgPage.edges.map((e) => ({ ...e, selected: false, selectable: false, deletable: false, focusable: false, id: `bg:${e.id}`, source: `bg:${e.source}`, target: `bg:${e.target}`, zIndex: -1000, className: 'nc-bg' })),
    };
  }, [bgPage]);
  // Icons with a cable on their bottom port: their label goes beside them (the cable would cross it below).
  const labelBeside = useMemo(() => {
    const out = new Set<string>();
    const byId = new Map(page.nodes.map((n) => [n.id, n]));
    for (const e of page.edges) for (const [id, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
      const n = byId.get(id);
      if (n?.type !== 'device' || n.data.labelOffset || !h) continue; // a dragged label stays where it was put
      const st = getStencil(n.data.stencilId);
      if (st?.style === 'icon' && st.ports.find((p) => p.id === h)?.side === 'bottom') out.add(id);
    }
    return out;
  }, [page.nodes, page.edges]);
  const nodes = useMemo(
    () => [...bg.nodes, ...page.nodes].map((n) => {
      if (n.type === 'device') {
        const beside = labelBeside.has(n.id) || n.data.labelSide === 'left';
        if (beside || n.data.labelBeside) n = { ...n, data: { ...n.data, labelBeside: beside || undefined } };
      }
      const layer = (n.type === 'device' || n.type === 'shape' || n.type === 'measure') ? n.data.layer : undefined;
      // ScreenTip (Insert → ScreenTip): hover text. Devices show theirs in the quick info card instead.
      if (n.type !== 'device' && n.type !== 'backdrop' && n.data.tip) n = { ...n, domAttributes: { title: n.data.tip } } as AppNode;
      if (!layer) return n;
      if (display.hidden.has(layer)) return { ...n, hidden: true };
      const locked = layerProps.locked.has(layer), noPrint = layerProps.noPrint.has(layer);
      if (!locked && !noPrint) return n;
      return {
        ...n,
        ...(locked ? { selectable: false, draggable: false, deletable: false, selected: false } : {}),
        ...(noPrint ? { className: [n.className, 'nc-noprint'].filter(Boolean).join(' ') } : {}),
      };
    }),
    [page.nodes, bg.nodes, display.hidden, layerProps, labelBeside],
  );
  const edges = useMemo(
    () =>
      [...bg.edges, ...page.edges].map((e) => {
        const hidden = !!(e.data?.layer && display.hidden.has(e.data.layer));
        const locked = !!(e.data?.layer && layerProps.locked.has(e.data.layer));
        const noPrint = !!(e.data?.layer && layerProps.noPrint.has(e.data.layer));
        const arrows = e.data?.arrows ?? 'none';
        const lp = { ...(locked ? { selectable: false, deletable: false, selected: false } : {}), ...(noPrint ? { className: 'nc-noprint' } : {}) };
        if (!hidden && arrows === 'none') return locked || noPrint ? { ...e, ...lp } : e;
        // Arrowheads take the line's color.
        const marker = { type: MarkerType.ArrowClosed, color: display.cable(e.data).color, width: 16, height: 16 };
        return {
          ...e,
          ...lp,
          hidden,
          markerEnd: arrows === 'end' || arrows === 'both' ? marker : undefined,
          markerStart: arrows === 'start' || arrows === 'both' ? marker : undefined,
        };
      }),
    [page.edges, bg.edges, display, layerProps],
  );
  const { onNodesChange, onEdgesChange, onConnect, addStencil, addZone, addNote, addShape, snapshot, deleteSelected, duplicateSelected } = useDiagram.getState();
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [comments, setComments] = useState<{ add: boolean } | null>(null);
  useEffect(() => {
    const open = (e: Event) => { setChecking(false); setComments({ add: !!(e as CustomEvent<{ add?: boolean }>).detail?.add }); };
    window.addEventListener(OPEN_COMMENTS_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMENTS_EVENT, open);
  }, []);
  useEffect(() => {
    const open = (e: Event) => setFind({ replace: !!(e as CustomEvent<{ replace?: boolean }>).detail?.replace });
    window.addEventListener(FIND_EVENT, open);
    return () => window.removeEventListener(FIND_EVENT, open);
  }, []);
  const presenting = usePresenting((s) => s.on);
  const snap = usePref('snapToGrid');
  const navPane = usePref('navPane');
  const reconnecting = useRef<string | null>(null); // cable whose end is being moved
  const follow = useFollowLink();
  const minimap = usePref('minimap') && !presenting;
  const rulers = usePref('rulers') && !presenting;
  // Full Screen: fit each page to the screen.
  useEffect(() => {
    if (!presenting) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.04, duration: 200 }), 120);
    return () => clearTimeout(t);
  }, [presenting, page.id, rf]);
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
  const calibClick = async (e: React.MouseEvent) => {
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
    const pts = [...(calib ?? []), p];
    if (pts.length < 2) return setCalib(pts);
    setCalib(null);
    const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const answer = await askText('How far apart are those two points in real life?\ne.g. 30 ft, 12\' 6", 9.5 m');
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
    if (id === '__wall') return useDiagram.getState().addMeasure({ x: pos.x - 150, y: pos.y }, 'wall');
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
      if (inField(e.target)) return;
      const s = useDiagram.getState();
      // Visio's keys: F2 edits the selected item's text, F1 lists the shortcuts.
      if (e.key === 'F2') {
        const sel = activePage(s.projects[s.currentId]).nodes.filter((n) => n.selected && (n.type === 'device' || n.type === 'shape'));
        if (sel.length === 1) { e.preventDefault(); window.dispatchEvent(new CustomEvent(EDIT_TEXT_EVENT, { detail: sel[0].id })); }
        return;
      }
      if (e.key === 'F1') { e.preventDefault(); window.dispatchEvent(new Event(SHORTCUTS_EVENT)); return; }
      if (!mod) return;
      const tools: Record<string, DrawTool | null> = { '1': null, '3': 'connector', '4': 'pencil', '6': 'line', '8': 'rect', '9': 'ellipse' };
      if (!e.shiftKey && key in tools) { e.preventDefault(); setTool(tools[key]); return; }
      if (!e.shiftKey && key === '2') { e.preventDefault(); const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); s.addShape('text', c); return; }
      if (e.shiftKey && key === 'w') { e.preventDefault(); rf.fitView({ padding: 0.1, duration: 200 }); return; }
      if (key === 'd' && !e.shiftKey) { e.preventDefault(); duplicateSelected(); }
      else if (key === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroupSelected(); else s.groupSelected(); }
      else if (key === 'a' && !e.shiftKey) { e.preventDefault(); s.selectAll(); }
      else if (key === 'f' && e.shiftKey) { e.preventDefault(); s.orderSelected('front'); }
      else if (key === 'b' && e.shiftKey) { e.preventDefault(); s.orderSelected('back'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateSelected, rf]);

  return (
    <div className="relative flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
      {rulers && <Rulers />}
      <div className="absolute inset-0" style={rulers ? { left: RULER, top: RULER } : undefined}>
      <ReactFlow<AppNode, CableEdge>
        key={page.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(c) => {
          const pg = activePage(useDiagram.getState().projects[useDiagram.getState().currentId]);
          // When moving a cable's end, the cable's own ports don't count.
          const moving = reconnecting.current;
          const others = moving ? { ...pg, edges: pg.edges.filter((e) => e.id !== moving) } : pg;
          return !portTaken(others, c.source, c.sourceHandle) && !portTaken(others, c.target, c.targetHandle);
        }}
        edgesReconnectable={!presenting}
        onReconnectStart={(_, edge) => { reconnecting.current = edge.id; }}
        onReconnectEnd={() => { reconnecting.current = null; }}
        onReconnect={(old, c) => useDiagram.getState().reconnectEdge(old.id, c)}
        nodesDraggable={!presenting}
        nodesConnectable={!presenting}
        elementsSelectable={!presenting}
        onNodeDragStart={snapshot}
        onNodeClick={(_, n) => { if (presenting && n.type !== 'backdrop' && n.data.link) follow(n.data.link); }}
        onNodeContextMenu={(e, n) => openMenu(e, { kind: 'node', id: n.id, x: e.clientX, y: e.clientY })}
        onEdgeContextMenu={(e, ed) => openMenu(e, { kind: 'edge', id: ed.id, x: e.clientX, y: e.clientY })}
        onPaneContextMenu={(e) => openMenu(e as React.MouseEvent, { kind: 'pane', x: e.clientX, y: e.clientY })}
        onNodeDoubleClick={(_, n) => { if (n.type === 'device') editStencil(n.data.stencilId, n.id); }}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'cable' }}
        snapToGrid={snap}
        snapGrid={[10, 10]}
        disableKeyboardA11y
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: false }}
        style={{ background: '#d9dde3' }}
      >
        <PageSheet />
        <GuidesLayer />
        {!presenting && <AutoConnectArrows />}
        <Panel position="top-left"><Legend /></Panel>
        {minimap && <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'zone' || n.type === 'backdrop' || n.type === 'measure' ? 'transparent' : n.type === 'note' ? '#fde68a' : '#374151')} />}
      </ReactFlow>
      {!presenting && <DrawOverlay />}
      {presenting && <PresentBar />}
      </div>
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
      {navPane && !presenting && <NavigatorPanel />}
      {comments && <CommentsPanel key={String(comments.add)} startAdding={comments.add} onClose={() => setComments(null)} />}
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
  const presenting = usePresenting((s) => s.on);
  const shapesPane = usePref('shapesPane');
  const propsPane = usePref('propsPane');

  // Undo/redo work in both views (outside of text fields, which have their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const { undo, redo } = useDiagram.getState();
      // Full Screen (F5): arrows / Page Up / Page Down change page, Esc ends.
      if (e.key === 'F5') { e.preventDefault(); useDiagram.getState().setView('diagram'); setPresenting(true); return; }
      if (usePresenting.getState().on) {
        const p = useDiagram.getState();
        const proj = p.projects[p.currentId];
        const pages = proj.pages.filter((x) => !x.background);
        const i = pages.findIndex((x) => x.id === proj.activePageId);
        if (e.key === 'Escape') setPresenting(false);
        else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key) && i < pages.length - 1) p.setActivePage(pages[i + 1].id);
        else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) && i > 0) p.setActivePage(pages[i - 1].id);
        else return;
        e.preventDefault();
        return;
      }
      // Arrow keys nudge the selection: one grid step, or one pixel with Shift (like Visio).
      if (!mod && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && useDiagram.getState().view === 'diagram') {
        const step = e.shiftKey ? 1 : 10;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft']!;
        e.preventDefault();
        useDiagram.getState().nudgeSelection(d[0], d[1]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    // Leaving the browser's full screen (Esc / F11) ends Full Screen too.
    const onFs = () => { if (!document.fullscreenElement && usePresenting.getState().on) setPresenting(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  if (!hydrated) return <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading your diagrams…</div>;

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-gray-50 text-gray-900">
        {!presenting && <Ribbon />}
        {view === 'racks' && !presenting ? (
          <RackView />
        ) : (
          <div className="flex min-h-0 flex-1">
            {shapesPane && !presenting && <Palette />}
            <div className="flex min-w-0 flex-1 flex-col">
              <Canvas />
              {!presenting && <PageTabs />}
            </div>
            {propsPane && !presenting && <PropertiesPanel />}
          </div>
        )}
        {!presenting && <StatusBar />}
        <PromptHost />
        <ShortcutsDialog />
      </div>
    </ReactFlowProvider>
  );
}
