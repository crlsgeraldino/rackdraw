'use client';

import { useReactFlow } from '@xyflow/react';
import { useRef } from 'react';
import { useDiagram } from '@/store/useDiagramStore';

type Offset = { x: number; y: number };

/**
 * Pointer handlers that drag something attached to a node (its label, its info box) and save how far it moved.
 * Movement is converted from screen pixels to diagram units at the current zoom; one drag = one undo step.
 */
/** `offset` may be a function, read when the drag starts (for a position that depends on what is drawn). */
export function useDragOffset(offset: Offset | undefined | (() => Offset), save: (o: Offset) => void, disabled = false) {
  const rf = useReactFlow();
  const snapshot = useDiagram((s) => s.snapshot);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; zoom: number; moved: boolean } | null>(null);
  const current = () => (typeof offset === 'function' ? offset() : offset) ?? { x: 0, y: 0 };
  const end = () => { drag.current = null; };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || disabled) return;
      e.stopPropagation();
      const off = current();
      drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y, zoom: rf.getZoom(), moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x) / d.zoom, dy = (e.clientY - d.y) / d.zoom;
      if (!d.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 2) return;
        d.moved = true;
        snapshot();
      }
      save({ x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) });
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}
