'use client';

import { useUpdateNodeInternals } from '@xyflow/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { PortDef, StencilDef } from '@/lib/types';

/*
 * Icon devices are drawn inside a 64×64 box with blank space around the picture, so a port on the box edge left
 * the cable stopping short of the icon (e.g. above the modem). Like Visio's connection points on the shape, each
 * icon port is moved in from the box edge to the first painted pixel of the picture along its side's centre line.
 * Measured once per icon from the rendered SVG and cached.
 */

type Offsets = Record<string, { x: number; y: number }>;
const cache = new Map<string, Offsets>();

function measure(svg: SVGSVGElement, ports: PortDef[]): Offsets | null {
  const shapes = [...svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon')] as SVGGeometryElement[];
  if (!shapes.length || typeof shapes[0].isPointInFill !== 'function') return null;
  const vb = svg.viewBox.baseVal;
  const size = vb && vb.width ? vb.width : 64;
  const hit = (x: number, y: number) => shapes.some((s) => {
    const p = new DOMPoint(x, y);
    const filled = s.getAttribute('fill') !== 'none' && getComputedStyle(s).fill !== 'none';
    return (filled && s.isPointInFill(p)) || s.isPointInStroke(p);
  });
  const out: Offsets = {};
  for (const p of ports) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const dir = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[p.side];
    let d = 0;
    for (; d < size / 2; d += 0.5) if (hit(cx + dir[0] * d, cy + dir[1] * d)) break;
    if (d >= size / 2) d = 0; // nothing painted along that line: keep the box edge
    // React Flow ends a cable at the port's outer edge, so put that edge (not the port's centre) on the picture.
    else d += (p.side === 'top' || p.side === 'bottom' ? p.h : p.w) / 2;
    out[p.id] = { x: dir[0] * d, y: dir[1] * d };
  }
  return out;
}

/** Ref for the icon's wrapper element, and each port's offset (in stencil units) from its box-edge position. */
export function useIconPortOffsets(nodeId: string, stencil: StencilDef | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const key = stencil?.style === 'icon' ? stencil.id : null;
  const [offsets, setOffsets] = useState<Offsets | undefined>(() => (key ? cache.get(key) : undefined));
  const update = useUpdateNodeInternals();
  useLayoutEffect(() => {
    if (!key || !stencil) return;
    let o = cache.get(key);
    if (!o) {
      const svg = ref.current?.querySelector('svg');
      const m = svg ? measure(svg, stencil.ports) : null;
      if (!m) return;
      cache.set(key, m);
      o = m;
    }
    if (o !== offsets) setOffsets(o);
  }, [key, stencil, offsets]);
  // Handles moved: let React Flow re-measure them so cables end at the new points.
  useLayoutEffect(() => {
    if (offsets) update(nodeId);
  }, [offsets, nodeId, update]);
  return { ref, offsets: key ? offsets : undefined };
}
