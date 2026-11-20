'use client';

import { useReactFlow, useViewport, ViewportPortal } from '@xyflow/react';
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
        setPts([p, p]);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const p = local(e);
        setPts((cur) => (tool === 'line' ? [cur[0], straight(cur[0], p, e.shiftKey)] : tool === 'connector' ? [cur[0], p] : [...cur, p]));
      }}
      onPointerUp={(e) => {
        if (!drawing.current) return;
        drawing.current = false;
        const s = useDiagram.getState();
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
      {pts.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-blue-600 px-2 py-0.5 text-xs text-white shadow">
        {tool === 'line' ? 'Line tool' : tool === 'connector' ? 'Connector tool: drag from one item to another' : 'Pencil tool'} · Esc to stop
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
