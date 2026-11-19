'use client';

import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { IconArt, PanelArt, type PortState } from '@/lib/stencils';
import type { DeviceNode, NoteNode, PortDef, StencilDef, ZoneNode } from '@/lib/types';
import { useCurrentProject, useDiagram, useStencil } from '@/store/useDiagramStore';

const SIDE: Record<PortDef['side'], Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

function usePortStates(nodeId: string) {
  const edges = useCurrentProject().edges;
  return useMemo(() => {
    const states: Record<string, PortState> = {};
    for (const e of edges) {
      for (const [n, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
        if (n !== nodeId || !h) continue;
        if (e.selected) states[h] = 'selected';
        else if (states[h] !== 'selected') states[h] = 'connected';
      }
    }
    return states;
  }, [edges, nodeId]);
}

/** Imported artwork with a highlight drawn over each connected or selected port. */
function ImageArt({ stencil, portStates, k }: { stencil: StencilDef; portStates: Record<string, PortState>; k: number }) {
  const w = stencil.width * k;
  const h = stencil.height * k;
  return (
    <div className="relative" style={{ width: w, height: h }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL artwork, not an optimizable asset */}
      <img src={stencil.image} alt={stencil.name} width={w} height={h} draggable={false} style={{ display: 'block', width: w, height: h }} />
      <svg className="pointer-events-none absolute inset-0" viewBox={`0 0 ${stencil.width} ${stencil.height}`} width={w} height={h}>
        {stencil.ports.map((p) => {
          const st = portStates[p.id];
          if (!st || st === 'idle') return null;
          const color = st === 'selected' ? '#3b82f6' : '#22c55e';
          const pad = 2 / k;
          return <rect key={p.id} x={p.x - pad} y={p.y - pad} width={p.w + pad * 2} height={p.h + pad * 2} rx={pad} fill={`${color}33`} stroke={color} strokeWidth={2 / k} />;
        })}
      </svg>
    </div>
  );
}

/** Diagram size of a stencil before any resizing. */
export function baseSize(stencil: StencilDef) {
  const k = stencil.style === 'icon' ? 1 : stencil.scale;
  return { width: stencil.width * k, height: stencil.height * k };
}

function DeviceNodeView({ id, data, selected, width }: NodeProps<DeviceNode>) {
  const stencil = useStencil(data.stencilId);
  const states = usePortStates(id);
  const snapshot = useDiagram((s) => s.snapshot);
  if (!stencil) {
    return (
      <div className="w-48 rounded border border-red-400 bg-red-50 p-2 text-xs text-red-800">
        <div className="font-semibold">{data.name}</div>
        Its stencil is missing from this computer&apos;s library. Import the stencil library or the project file that contains it.
      </div>
    );
  }
  // Resizing sets the node's width; everything (art, ports, highlights) scales from it, keeping proportions.
  const base = baseSize(stencil);
  const zoom = width ? width / base.width : 1;
  const k = (stencil.style === 'icon' ? 1 : stencil.scale) * zoom;
  const resizer = (
    <NodeResizer
      isVisible={selected}
      keepAspectRatio
      minWidth={Math.min(base.width, Math.max(24, base.width * 0.2))}
      minHeight={Math.min(base.height, Math.max(8, base.height * 0.2))}
      maxWidth={base.width * 6}
      maxHeight={base.height * 6}
      color="#3b82f6"
      handleStyle={{ width: 9, height: 9, borderRadius: 2 }}
      lineStyle={{ borderWidth: 0 }}
      onResizeStart={snapshot}
    />
  );

  const handles = stencil.ports.map((p) => {
    const custom = data.ports?.[p.id];
    const title = [custom?.label || p.label, p.role, custom?.description, custom?.vlan && `VLAN ${custom.vlan}`].filter(Boolean).join(' · ');
    return (
      <Handle
        key={p.id}
        id={p.id}
        type="source"
        position={SIDE[p.side]}
        title={title}
        className={stencil.style === 'icon' ? 'nc-handle-dot' : 'nc-handle-port'}
        style={{ left: p.x * k, top: p.y * k, width: p.w * k, height: p.h * k }}
      />
    );
  });

  if (stencil.style === 'icon') {
    return (
      <div className={`relative flex flex-col items-center ${selected ? 'nc-selected-icon' : ''}`} style={{ width: stencil.width * k }}>
        {resizer}
        <div className="relative" style={{ width: stencil.width * k, height: stencil.height * k }}>
          <IconArt id={stencil.id} size={stencil.width * k} />
          {handles}
        </div>
        <div className="pointer-events-none absolute top-full mt-1 w-40 text-center text-[11px] leading-tight text-gray-800">
          <div className="font-semibold">{data.name}</div>
          {data.ip && <div className="font-mono text-gray-500">{data.ip}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${selected ? 'nc-selected-panel' : ''}`}>
      {resizer}
      {stencil.style === 'image'
        ? <ImageArt stencil={stencil} portStates={states} k={k} />
        : <PanelArt stencil={stencil} portStates={states} width={stencil.width * k} height={stencil.height * k} />}
      {handles}
      <div className="pointer-events-none absolute left-0 top-full mt-1 flex gap-2 whitespace-nowrap text-[11px] text-gray-800">
        <span className="font-semibold">{data.name}</span>
        {data.ip && <span className="font-mono text-gray-500">{data.ip}</span>}
      </div>
    </div>
  );
}

function ZoneNodeView({ data, selected }: NodeProps<ZoneNode>) {
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} color={data.color} />
      <div
        className="h-full w-full rounded-lg border-2 border-dashed"
        style={{ borderColor: data.color, background: `${data.color}12` }}
      >
        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: data.color }}>
          {data.title}
        </div>
      </div>
    </>
  );
}

function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  const update = useDiagram((s) => s.updateNodeData);
  return (
    <div className={`min-w-[140px] rounded bg-yellow-100 p-2 text-xs shadow ${selected ? 'ring-2 ring-blue-500' : ''}`}>
      <textarea
        className="nodrag w-full resize bg-transparent outline-none"
        rows={Math.max(2, data.text.split('\n').length)}
        value={data.text}
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </div>
  );
}

export const nodeTypes = {
  device: memo(DeviceNodeView),
  zone: memo(ZoneNodeView),
  note: memo(NoteNodeView),
};
