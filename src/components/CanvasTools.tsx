'use client';

import { NodeToolbar, Position, useReactFlow, useViewport, ViewportPortal } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { guideZoom, useGuides } from '@/lib/guides';
import { setPresenting, setTool, useTool } from '@/lib/tools';
import type { AppNode } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';

/** Blue alignment guides while dragging (dynamic grid). Also keeps the snap distance in step with the zoom. */
export function GuidesLayer() {
  const { zoom } = useViewport();
  const { x, y } = useGuides();
  useEffect(() => { guideZoom.value = zoom; }, [zoom]);
  if (!x.length && !y.length) return null;
  const w = 1 / zoom;
  const far = 100000;
  return (
    <ViewportPortal>
      {x.map((gx) => <div key={`x${gx}`} className="pointer-events-none absolute" style={{ left: gx - w / 2, top: -far, width: w, height: far * 2, background: '#2563eb' }} />)}
      {y.map((gy) => <div key={`y${gy}`} className="pointer-events-none absolute" style={{ top: gy - w / 2, left: -far, height: w, width: far * 2, background: '#2563eb' }} />)}
    </ViewportPortal>
  );
}

/**
 * Line and Pencil tools: while one is on, dragging on the canvas draws a straight line (Shift = horizontal / vertical)
 * or a freehand shape. The tool stays on for the next one, like Visio; Esc or the Pointer tool turns it off.
 */
export function DrawOverlay() {
  const tool = useTool((s) => s.tool);
  const rf = useReactFlow<AppNode>();
  const box = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]); // screen points relative to the overlay
  const drawing = useRef(false);
  const from = useRef<string | null>(null); // connector tool: where the drag started
  const start = useRef<{ x: number; y: number } | null>(null); // box tools: the corner the drag started at

  useEffect(() => {
    if (!tool) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTool(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [tool]);

  if (!tool) return null;
  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toFlow = (p: { x: number; y: number }) => {
    const r = box.current!.getBoundingClientRect();
    const f = rf.screenToFlowPosition({ x: p.x + r.left, y: p.y + r.top }, { snapToGrid: false });
    return { x: Math.round(f.x), y: Math.round(f.y) };
  };
  // Connector tool: the device or shape under the pointer (not background-page items).
  const nodeAt = (e: React.PointerEvent) => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const n = el.closest<HTMLElement>('.react-flow__node');
      const id = n?.dataset.id;
      if (!id || id.startsWith('bg:')) continue;
      const node = rf.getNode(id);
      if (node && (node.type === 'device' || node.type === 'shape')) return id;
    }
    return null;
  };
  const connect = (a: string, b: string) => {
    const s = useDiagram.getState();
    const pg = s.projects[s.currentId].pages.find((p) => p.id === s.projects[s.currentId].activePageId)!;
    const ends = (id: string) => {
      const n = rf.getInternalNode(id);
      if (!n) return { center: { x: 0, y: 0 }, ports: [] as { id: string; x: number; y: number }[] };
      const pos = n.internals.positionAbsolute;
      const used = new Set(pg.edges.flatMap((e) => [e.source === id ? e.sourceHandle : null, e.target === id ? e.targetHandle : null]).filter(Boolean));
      const all = [...(n.internals.handleBounds?.source ?? []), ...(n.internals.handleBounds?.target ?? [])]
        .filter((h) => h.id)
        .map((h) => ({ id: h.id!, x: pos.x + h.x + h.width / 2, y: pos.y + h.y + h.height / 2, free: !used.has(h.id!) }));
      const free = all.filter((h) => h.free);
      return { center: { x: pos.x + (n.measured.width ?? 0) / 2, y: pos.y + (n.measured.height ?? 0) / 2 }, ports: free.length ? free : all };
    };
    const pick = pickPorts(ends(a), ends(b));
    if (pick) s.onConnect({ source: a, sourceHandle: pick[0], target: b, targetHandle: pick[1] });
  };
  const boxTool = tool === 'rect' || tool === 'ellipse';
  // Shift: a square / circle.
  const square = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d };
  };
  const straight = (a: { x: number; y: number }, b: { x: number; y: number }, shift: boolean) =>
    !shift ? b : Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };

  return (
    <div
      ref={box}
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (tool === 'connector') {
          from.current = nodeAt(e);
          if (!from.current) return;
        }
        drawing.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const p = local(e);
        start.current = p;
        setPts([p, p]);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const p = local(e);
        setPts((cur) => (tool === 'line' ? [cur[0], straight(cur[0], p, e.shiftKey)] : tool === 'connector' || boxTool ? [cur[0], boxTool && e.shiftKey ? square(cur[0], p) : p] : [...cur, p]));
      }}
      onPointerUp={(e) => {
        if (!drawing.current) return;
        drawing.current = false;
        const s = useDiagram.getState();
        if (boxTool) {
          setPts([]);
          const s0 = start.current ?? local(e);
          const end = e.shiftKey ? square(s0, local(e)) : local(e);
          const a = toFlow(s0), b = toFlow(end);
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
          if (w < 6 && h < 6) return; // a click, not a drawing
          s.addShape(tool === 'rect' ? 'rect' : 'ellipse', { x: x + w / 2, y: y + h / 2 });
          const pg = s.projects[s.currentId].pages.find((p) => p.id === s.projects[s.currentId].activePageId);
          const made = useDiagram.getState().projects[s.currentId].pages.find((p) => p.id === pg?.id)?.nodes.at(-1);
          if (made) useDiagram.getState().setNodeBox(made.id, { x, y }, Math.max(20, w), Math.max(14, h));
          return;
        }
        if (tool === 'connector') {
          setPts([]);
          const to = nodeAt(e);
          if (from.current && to && to !== from.current) connect(from.current, to);
          from.current = null;
          return;
        }
        const end = tool === 'line' ? straight(pts[0], local(e), e.shiftKey) : local(e);
        const all = tool === 'line' ? [pts[0], end] : [...pts, end];
        setPts([]);
        if (Math.hypot(end.x - all[0].x, end.y - all[0].y) < 4 && all.length < 4) return; // a click, not a drawing
        if (tool === 'line') s.addLine(toFlow(all[0]), toFlow(end));
        else {
          // Keep the drawing light: drop points closer than 3px on screen.
          const kept = all.filter((p, i) => i === 0 || i === all.length - 1 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) >= 3);
          s.addFreeform(kept.map(toFlow));
        }
      }}
      title={tool === 'line' ? 'Drag to draw a line (Shift = straight). Esc to stop.' : tool === 'connector' ? 'Drag from one device or shape to another to connect them. Esc to stop.' : 'Drag to draw freehand. Esc to stop.'}
    >
      {pts.length > 1 && boxTool && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {(() => {
            const [a, b] = [pts[0], pts[pts.length - 1]];
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            return tool === 'rect'
              ? <rect x={x} y={y} width={w} height={h} fill="#3b82f61a" stroke="#2563eb" strokeWidth={2} />
              : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="#3b82f61a" stroke="#2563eb" strokeWidth={2} />;
          })()}
        </svg>
      )}
      {pts.length > 1 && !boxTool && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-blue-600 px-2 py-0.5 text-xs text-white shadow">
        {tool === 'line' ? 'Line tool' : tool === 'connector' ? 'Connector tool: drag from one item to another' : tool === 'rect' ? 'Rectangle tool (Shift: square)' : tool === 'ellipse' ? 'Ellipse tool (Shift: circle)' : 'Pencil tool'} · Esc to stop
      </div>
    </div>
  );
}

/** Full Screen: page name, page n of m, and how to move on / leave. Fades to the corner. */
export function PresentBar() {
  const s = useDiagram();
  const proj = s.projects[s.currentId];
  const pages = proj.pages.filter((p) => !p.background);
  const i = pages.findIndex((p) => p.id === proj.activePageId);
  const go = (d: number) => { const p = pages[i + d]; if (p) s.setActivePage(p.id); };
  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-full bg-gray-900/70 px-3 py-1 text-xs text-white opacity-40 transition-opacity hover:opacity-100">
      <button className="px-1 disabled:opacity-30" disabled={i <= 0} onClick={() => go(-1)} aria-label="Previous page">◀</button>
      <span>{pages[i]?.name ?? ''} · {i + 1} / {pages.length}</span>
      <button className="px-1 disabled:opacity-30" disabled={i >= pages.length - 1} onClick={() => go(1)} aria-label="Next page">▶</button>
      <button className="ml-1 rounded bg-white/20 px-1.5" onClick={() => setPresenting(false)}>Esc · Exit</button>
    </div>
  );
}

type PortPt = { id: string; x: number; y: number };

/**
 * Connector tool: which ports to join, like Visio's connector picking the nearest connection points — on the first
 * item, the (free) port nearest the second item's centre; on the second, the port nearest that one.
 */
export function pickPorts(A: { center: { x: number; y: number }; ports: PortPt[] }, B: { center: { x: number; y: number }; ports: PortPt[] }): [string, string] | null {
  const near = (ports: PortPt[], q: { x: number; y: number }) =>
    ports.reduce<PortPt | null>((best, p) => (!best || Math.hypot(p.x - q.x, p.y - q.y) < Math.hypot(best.x - q.x, best.y - q.y) ? p : best), null);
  const sa = near(A.ports, B.center);
  const sb = sa ? near(B.ports, sa) : null;
  return sa && sb ? [sa.id, sb.id] : null;
}

const ARROWS = [
  { dir: 'top', pos: Position.Top, path: 'M7 1 L13 9 H9 V13 H5 V9 H1 Z' },
  { dir: 'right', pos: Position.Right, path: 'M13 7 L5 13 V9 H1 V5 H5 V1 Z' },
  { dir: 'bottom', pos: Position.Bottom, path: 'M7 13 L1 5 H5 V1 H9 V5 H13 Z' },
  { dir: 'left', pos: Position.Left, path: 'M1 7 L9 1 V5 H13 V9 H9 V13 Z' },
] as const;

/**
 * AutoConnect (Visio): around the one selected device or shape, four blue arrows; clicking one adds a copy of it on
 * that side, already connected (devices with a cable between facing ports).
 */
export function AutoConnectArrows() {
  const tool = useTool((s) => s.tool);
  const s = useDiagram();
  const proj = s.projects[s.currentId];
  const page = proj.pages.find((p) => p.id === proj.activePageId);
  const sel = page?.nodes.filter((n) => n.selected) ?? [];
  const n = sel.length === 1 ? sel[0] : null;
  if (tool || !n || (n.type !== 'device' && n.type !== 'shape') || n.data.locked || (n.type === 'shape' && n.data.kind === 'callout')) return null;
  return (
    <>
      {ARROWS.map((a) => (
        <NodeToolbar key={a.dir} nodeId={n.id} position={a.pos} offset={a.dir === 'top' ? 34 : 12} isVisible>
          <button
            className="nodrag nopan flex h-5 w-5 items-center justify-center rounded opacity-60 hover:bg-blue-50 hover:opacity-100"
            title={`Add a connected copy ${a.dir === 'top' ? 'above' : a.dir === 'bottom' ? 'below' : `to the ${a.dir}`}`}
            onClick={() => s.autoConnect(n.id, a.dir)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14"><path d={a.path} fill="#3b82f6" /></svg>
          </button>
        </NodeToolbar>
      ))}
    </>
  );
}
