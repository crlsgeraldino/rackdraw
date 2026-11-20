'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, useNodesStore, type EdgeProps, type NodesStore } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { roundedPath, routeOrthogonal, type Obstacle, type Side } from '@/lib/router';
import { INFO_GAP, overlaySize, useOverlayVersion } from '@/lib/overlays';
import type { CableEdge, DeviceData } from '@/lib/types';
import { getStencil } from '@/store/useDiagramStore';
import { useDisplay } from './useDisplay';

/** Items cables steer around: devices, notes and drawing shapes (not zones or the backdrop). */
const BLOCKING = new Set(['device', 'note', 'shape']);

/** A compact string of every obstacle's box, so edges only re-route when something actually moved or resized. */
function obstacleKey(s: NodesStore) {
  let key = '';
  const add = (id: string, x: number, y: number, w: number, h: number) => {
    key += `${id},${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)};`;
  };
  for (const n of s.nodeLookup.values()) {
    if (n.hidden || !BLOCKING.has(n.type ?? '')) continue;
    const w = n.measured?.width, h = n.measured?.height;
    if (!w || !h) continue;
    const { x, y } = n.internals.positionAbsolute;
    add(n.id, x, y, w, h);
    if (n.type !== 'device') continue;
    // A device's label and info box sit outside its box; steer around them too (see DeviceLabel / DeviceInfoBox).
    const d = n.data as DeviceData;
    const label = overlaySize(`${n.id}|label`);
    if (label) {
      const o = d.labelOffset ?? { x: 0, y: 0 };
      const icon = !!getStencil(d.stencilId) && getStencil(d.stencilId)!.style === 'icon';
      add(`${n.id}#label`, (icon ? x + w / 2 - label.w / 2 : x) + o.x, y + h + 4 + o.y, label.w, label.h);
    }
    const info = d.infoBox?.show ? overlaySize(`${n.id}|info`) : undefined;
    if (info) {
      const o = d.infoBox?.offset ?? { x: 0, y: 0 };
      add(`${n.id}#info`, x + w + INFO_GAP + o.x, y + o.y, info.w, info.h);
    }
  }
  return key;
}

// Every cable on the page shares the same obstacle list; parse it once per change.
let cache: { key: string; list: Obstacle[] } = { key: '', list: [] };
function parseObstacles(key: string): Obstacle[] {
  if (cache.key === key) return cache.list;
  const list = key.split(';').filter(Boolean).map((s) => {
    const [id, x, y, w, h] = s.split(',');
    // Labels and info boxes ("<device>#…") get a smaller gap so cables can still pass between them and the device.
    return { id, left: +x, top: +y, right: +x + +w, bottom: +y + +h, clearance: id.includes('#') ? 6 : undefined };
  });
  cache = { key, list };
  return list;
}

function CableEdgeView(props: EdgeProps<CableEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerStart, markerEnd } = props;
  const route = data?.route ?? 'step';
  // Only right-angle cables are routed around devices; subscribing costs nothing for the others.
  useOverlayVersion(); // re-route when a label or info box changes size
  const key = useNodesStore((s) => (route === 'step' ? obstacleKey(s) : ''));

  const [path, labelX, labelY] = useMemo((): [string, number, number] => {
    const pos = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
    if (route === 'straight') return getStraightPath(pos).slice(0, 3) as [string, number, number];
    if (route === 'curved') return getBezierPath(pos).slice(0, 3) as [string, number, number];
    const pts = source === target ? null : routeOrthogonal(
      { x: sourceX, y: sourceY, side: sourcePosition as Side },
      { x: targetX, y: targetY, side: targetPosition as Side },
      parseObstacles(key),
      source,
      target,
    );
    if (pts && pts.length > 1) {
      const { d, mid } = roundedPath(pts);
      return [d, mid.x, mid.y];
    }
    // No clear path (e.g. devices overlapping): fall back to a plain right-angle line.
    return getSmoothStepPath({ ...pos, borderRadius: 8, offset: 16 }).slice(0, 3) as [string, number, number];
  }, [route, key, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  const style = useDisplay().cable(data);
  const text = [data?.label, data?.vlan && `VLAN ${data.vlan}`].filter(Boolean).join(' · ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: style.color,
          strokeWidth: selected ? style.width + 2 : style.width,
          strokeDasharray: style.dash,
        }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute whitespace-nowrap rounded border bg-white px-1.5 py-0.5 text-[10px] shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: style.color, color: style.color }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { cable: memo(CableEdgeView) };
