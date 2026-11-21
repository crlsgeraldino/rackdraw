'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, useNodesStore, useReactFlow, type EdgeProps, type NodesStore } from '@xyflow/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { roundedPath, routeOrthogonal, type Obstacle, type Side } from '@/lib/router';
import { INFO_GAP, overlaySize, useOverlayVersion } from '@/lib/overlays';
import { lookStyle, type CableEdge, type DeviceData } from '@/lib/types';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { findJumps, JUMP_R, otherDrawnRoutes, otherRouteEntries, publishDrawn, publishRoute, separateParallel, useRoutesVersion } from '@/lib/jumps';
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
      if (icon && d.labelBeside) add(`${n.id}#label`, x - 8 - label.w + o.x, y + h / 2 - label.h / 2 + o.y, label.w, label.h);
      else add(`${n.id}#label`, (icon ? x + w / 2 - label.w / 2 : x) + o.x, y + h + 4 + o.y, label.w, label.h);
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

  // Corner points of a right-angle route around obstacles (null: not routed, or no clear path).
  const pts = useMemo(() => {
    if (route !== 'step' || source === target) return null;
    const r = routeOrthogonal(
      { x: sourceX, y: sourceY, side: sourcePosition as Side },
      { x: targetX, y: targetY, side: targetPosition as Side },
      parseObstacles(key),
      source,
      target,
    );
    return r && r.length > 1 ? r : null;
  }, [route, key, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  // Line jumps: share this route with the other cables and hop over the ones crossing it.
  const jumpsOn = useCurrentProject().display?.lineJumps !== false;
  // Every right-angle route is shared: for line jumps and for spacing parallel cables apart.
  useEffect(() => {
    publishRoute(id, pts);
  }, [id, pts]);
  useEffect(() => () => { publishRoute(id, null); publishDrawn(id, null); }, [id]);
  const routesVersion = useRoutesVersion();
  // Spread into lanes where it would run on top of other cables.
  const laned = useMemo(
    () => (pts ? separateParallel(id, pts, otherRouteEntries(id)) : null),
    // routesVersion: re-lane when another cable moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, pts, routesVersion],
  );
  useEffect(() => {
    publishDrawn(id, laned);
  }, [id, laned]);

  const [path, labelX, labelY] = useMemo((): [string, number, number] => {
    const pos = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
    if (route === 'straight') return getStraightPath(pos).slice(0, 3) as [string, number, number];
    if (route === 'curved') return getBezierPath(pos).slice(0, 3) as [string, number, number];
    if (laned) {
      const { d, mid } = roundedPath(laned, 8, jumpsOn ? findJumps(laned, otherDrawnRoutes(id)) : undefined, JUMP_R);
      return [d, mid.x, mid.y];
    }
    // No clear path (e.g. devices overlapping): fall back to a plain right-angle line.
    return getSmoothStepPath({ ...pos, borderRadius: 8, offset: 16 }).slice(0, 3) as [string, number, number];
    // routesVersion: recompute hops when another cable moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, laned, jumpsOn, routesVersion, id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  // Text position along the cable (Visio lets you drag connector text); the middle unless moved.
  const at = data?.labelAt;
  const labelPt = useMemo(() => (at === undefined ? { x: labelX, y: labelY } : pointAlong(path, at)), [path, at, labelX, labelY]);
  const rf = useReactFlow();
  const update = useDiagram((s) => s.updateEdgeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const dragging = useRef(false);
  const style = useDisplay().cable(data);
  const text = [data?.label, data?.vlan && `VLAN ${data.vlan}`, data?.showLength && data.length].filter(Boolean).join(' · ');

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
            data-edge-label={id}
            className="nodrag nopan pointer-events-auto absolute cursor-move whitespace-nowrap rounded border bg-white px-1.5 py-0.5 text-[10px] shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelPt.x}px, ${labelPt.y}px)`, borderColor: style.color, color: style.color, ...lookStyle(data ?? {}) }}
            title="Drag along the cable to move the text · double-click to centre it"
            onPointerDown={(e) => {
              if (e.button !== 0 || id.startsWith('bg:')) return;
              e.stopPropagation();
              snapshot();
              dragging.current = true;
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
              update(id, { labelAt: Math.round(nearestAlong(path, p) * 1000) / 1000 });
            }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
            onDoubleClick={(e) => { e.stopPropagation(); snapshot(); update(id, { labelAt: undefined }); }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** A hidden SVG path for measuring cable paths (length, points along them). */
let probe: SVGPathElement | null = null;
function measurePath(d: string) {
  if (!probe) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden');
    probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(probe);
    document.body.appendChild(svg);
  }
  probe.setAttribute('d', d);
  return probe;
}

/** Point a fraction `t` of the way along an SVG path. */
export function pointAlong(d: string, t: number) {
  const p = measurePath(d);
  const pt = p.getPointAtLength(Math.max(0, Math.min(1, t)) * p.getTotalLength());
  return { x: pt.x, y: pt.y };
}

/** Fraction along the path of the point nearest to `q` (kept off the very ends). */
function nearestAlong(d: string, q: { x: number; y: number }) {
  const p = measurePath(d);
  const len = p.getTotalLength();
  let best = 0.5, bestD = Infinity;
  for (let i = 0; i <= 200; i++) {
    const pt = p.getPointAtLength((i / 200) * len);
    const dd = (pt.x - q.x) ** 2 + (pt.y - q.y) ** 2;
    if (dd < bestD) { bestD = dd; best = i / 200; }
  }
  return Math.max(0.05, Math.min(0.95, best));
}

export const edgeTypes = { cable: memo(CableEdgeView) };
