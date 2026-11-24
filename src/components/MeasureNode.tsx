'use client';

import { useReactFlow, type NodeProps } from '@xyflow/react';
import { useRef } from 'react';
import { realLength } from '@/lib/units';
import type { MeasureNode } from '@/lib/types';
import { dashFor, patternOf } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';
import { activePage } from '@/lib/project';

const TICK = 7;

/**
 * Dimension line (Visio "Dimension" shape): an arrowed line with end ticks and its real length from the page's
 * scale. Drag the line to move it; when selected, drag either end to stretch it.
 */
function MeasureNodeView({ id, data, selected }: NodeProps<MeasureNode>) {
  const rf = useReactFlow();
  const scale = useDiagram((s) => activePage(s.projects[s.currentId]).scale);
  const moveEnd = useDiagram((s) => s.moveMeasureEnd);
  const snapshot = useDiagram((s) => s.snapshot);
  const drag = useRef<{ end: 'a' | 'b'; moved: boolean } | null>(null);
  const { dx, dy } = data;
  const len = Math.hypot(dx, dy);
  const ux = len ? dx / len : 1, uy = len ? dy / len : 0;
  // Ticks across the line at both ends.
  const tx = -uy * TICK, ty = ux * TICK;
  const text = [data.label, scale ? realLength(len, scale) : `${Math.round(len)} px`].filter(Boolean).join(' ');
  const color = selected ? '#2563eb' : '#334155';
  const marker = `nc-dim-${id}`;
  // Walls show their length only while selected (like Visio), dimension lines always.
  const wall = data.variant === 'wall';
  const plain = data.variant === 'line';
  const lineColor = selected ? '#2563eb' : data.color ?? '#374151';
  // A plain line shows only its own label (no measured length).
  const label = plain ? data.label ?? '' : text;

  const endHandle = (end: 'a' | 'b') => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || data.locked) return;
      e.stopPropagation();
      drag.current = { end, moved: false };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        d.moved = true;
        snapshot();
      }
      let p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
      // Shift keeps the line horizontal or vertical.
      if (e.shiftKey) {
        const other = end === 'b' ? { x: 0, y: 0 } : { x: dx, y: dy };
        const base = rf.getInternalNode(id)?.internals.positionAbsolute ?? { x: 0, y: 0 };
        const o = { x: base.x + other.x, y: base.y + other.y };
        p = Math.abs(p.x - o.x) > Math.abs(p.y - o.y) ? { x: p.x, y: o.y } : { x: o.x, y: p.y };
      }
      moveEnd(id, end, { x: Math.round(p.x), y: Math.round(p.y) });
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  });

  return (
    <div className="nc-measure relative" style={{ width: 1, height: 1 }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
        {/* Wide invisible stroke so the thin line is easy to click and drag. */}
        <line x1={0} y1={0} x2={dx} y2={dy} stroke="transparent" strokeWidth={Math.max(12, (data.thickness ?? 0) + 6)} style={{ pointerEvents: 'stroke' }} />
        {plain ? (
          <line
            x1={0} y1={0} x2={dx} y2={dy} stroke={lineColor} strokeWidth={data.thickness ?? 2} strokeLinecap="round"
            strokeDasharray={dashFor(patternOf(data), data.thickness ?? 2).strokeDasharray}
            markerStart={data.arrowStart ? `url(#${marker}-l)` : undefined} markerEnd={data.arrowEnd ? `url(#${marker}-l)` : undefined}
          />
        ) : wall ? (
          <line x1={0} y1={0} x2={dx} y2={dy} stroke={selected ? '#2563eb' : '#4b5563'} strokeWidth={data.thickness ?? 8} strokeLinecap="square" />
        ) : (
          <>
            <line x1={0} y1={0} x2={dx} y2={dy} stroke={color} strokeWidth={1.5} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />
            <line x1={-tx} y1={-ty} x2={tx} y2={ty} stroke={color} strokeWidth={1.5} />
            <line x1={dx - tx} y1={dy - ty} x2={dx + tx} y2={dy + ty} stroke={color} strokeWidth={1.5} />
          </>
        )}
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,1 L10,5 L0,9 z" fill={color} />
          </marker>
          <marker id={`${marker}-l`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,1 L10,5 L0,9 z" fill={lineColor} />
          </marker>
        </defs>
      </svg>
      {(plain ? !!data.label : !wall || selected || data.label || data.showLength) && <div
        className="absolute whitespace-nowrap rounded bg-white/90 px-1 text-[11px] font-medium"
        // A wall's length sits beside it (outside the wall), a dimension's on the line.
        style={{ left: dx / 2 + (wall ? -uy * ((data.thickness ?? 8) / 2 + 10) : 0), top: dy / 2 + (wall ? ux * ((data.thickness ?? 8) / 2 + 10) : 0), transform: 'translate(-50%, -50%)', color }}
        title={scale ? undefined : 'Set the page scale (right panel, nothing selected) to see real lengths'}
      >
        {label}
      </div>}
      {selected && !data.locked && (
        <>
          <span className="nodrag nopan absolute h-3 w-3 cursor-crosshair rounded-full border-2 border-blue-600 bg-white" style={{ left: -6, top: -6 }} {...endHandle('a')} />
          <span className="nodrag nopan absolute h-3 w-3 cursor-crosshair rounded-full border-2 border-blue-600 bg-white" style={{ left: dx - 6, top: dy - 6 }} {...endHandle('b')} />
        </>
      )}
    </div>
  );
}

export default MeasureNodeView;
