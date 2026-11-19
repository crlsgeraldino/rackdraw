'use client';

import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { IconArt, PanelArt, STENCIL_MAP, type PortState } from '@/lib/stencils';
import type { DeviceNode, NoteNode, PortDef, ZoneNode } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

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

function DeviceNodeView({ id, data, selected }: NodeProps<DeviceNode>) {
  const stencil = STENCIL_MAP[data.stencilId];
  const states = usePortStates(id);
  if (!stencil) return <div className="rounded border border-red-400 bg-red-50 p-2 text-xs">Unknown stencil: {data.stencilId}</div>;
  const k = stencil.scale;

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
      <div className={`relative flex flex-col items-center ${selected ? 'nc-selected-icon' : ''}`} style={{ width: stencil.width }}>
        <div className="relative" style={{ width: stencil.width, height: stencil.height }}>
          <IconArt id={stencil.id} />
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
      <PanelArt stencil={stencil} portStates={states} />
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
