'use client';

import { useReactFlow, useViewport, ViewportPortal } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { guideZoom, useGuides } from '@/lib/guides';
import { setTool, useTool } from '@/lib/tools';
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
  const straight = (a: { x: number; y: number }, b: { x: number; y: number }, shift: boolean) =>
    !shift ? b : Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };

  return (
    <div
      ref={box}
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drawing.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const p = local(e);
        setPts([p, p]);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const p = local(e);
        setPts((cur) => (tool === 'line' ? [cur[0], straight(cur[0], p, e.shiftKey)] : [...cur, p]));
      }}
      onPointerUp={(e) => {
        if (!drawing.current) return;
        drawing.current = false;
        const s = useDiagram.getState();
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
      title={tool === 'line' ? 'Drag to draw a line (Shift = straight). Esc to stop.' : 'Drag to draw freehand. Esc to stop.'}
    >
      {pts.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-blue-600 px-2 py-0.5 text-xs text-white shadow">
        {tool === 'line' ? 'Line tool' : 'Pencil tool'} · Esc to stop
      </div>
    </div>
  );
}
