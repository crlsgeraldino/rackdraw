'use client';

import { Handle, NodeResizer, Position, useInternalNode, type NodeProps } from '@xyflow/react';
import { memo, useMemo, useState } from 'react';
import { activePage } from '@/lib/project';
import { IconArt, PanelArt, type PortState } from '@/lib/stencils';
import { DEFAULT_LABEL_FIELDS, isDocumented, type BackdropNode, type DeviceData, type DeviceNode, type NoteNode, type PortDef, type ShapeData, type ShapeNode, type StencilDef, type ZoneNode } from '@/lib/types';
import { useCurrentPage, useDiagram, useStencil } from '@/store/useDiagramStore';
import { DeviceInfoBox } from './DeviceInfoBox';
import { DeviceQuickInfo, useQuickInfoHover } from './DeviceQuickInfo';
import { useOverlaySize } from '@/lib/overlays';
import { useDragOffset } from './useDragOffset';
import { useIconPortOffsets } from './iconPorts';
import MeasureNodeView from './MeasureNode';
import { NodeBadges } from './NodeBadges';
import { useDisplay } from './useDisplay';

const SIDE: Record<PortDef['side'], Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

function usePortStates(nodeId: string) {
  const edges = useCurrentPage().edges;
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

/**
 * The device's text on the diagram (name, IP… as chosen in the properties panel). Drag it to move it;
 * its offset is saved with the device.
 */
function DeviceLabel({ id, data, variant }: { id: string; data: DeviceData; variant: 'icon' | 'panel' }) {
  const update = useDiagram((s) => s.updateNodeData);
  const drag = useDragOffset(data.labelOffset, (labelOffset) => update(id, { labelOffset }), !!data.locked);
  const sizeRef = useOverlaySize<HTMLDivElement>(`${id}|label`);
  const fields = data.labelFields ?? DEFAULT_LABEL_FIELDS;
  const lines = fields.map((f) => ({ f, v: f === 'name' ? data.name : (data[f] as string | undefined) })).filter((l) => l.v);
  if (!lines.length) return null;
  const off = data.labelOffset ?? { x: 0, y: 0 };

  const text = (f: string, v: string) => (
    <span key={f} className={f === 'name' ? 'font-semibold' : f === 'ip' ? 'font-mono text-gray-500' : 'text-gray-600'}>{v}</span>
  );
  return (
    <div
      ref={sizeRef}
      className={`nc-device-label nodrag nopan absolute top-full mt-1 cursor-move select-none text-[11px] leading-tight text-gray-800 ${variant === 'icon' ? 'flex w-40 flex-col items-center text-center' : 'left-0 flex gap-2 whitespace-nowrap'}`}
      style={{ translate: `${off.x}px ${off.y}px` }}
      {...drag}
      title={data.locked ? undefined : 'Drag to move the label'}
    >
      {lines.map((l) => text(l.f, l.v!))}
    </div>
  );
}

/** Diagram size of a stencil before any resizing. */
export function baseSize(stencil: StencilDef) {
  const k = stencil.style === 'icon' ? 1 : stencil.scale;
  return { width: stencil.width * k, height: stencil.height * k };
}

function DeviceNodeView({ id, data, selected, dragging }: NodeProps<DeviceNode>) {
  const stencil = useStencil(data.stencilId);
  const hover = useQuickInfoHover(!!dragging);
  const quickInfo = <DeviceQuickInfo id={id} data={data} stencil={stencil} visible={hover.visible} card={hover.card} />;
  // Only a size the user set (resize handles / properties panel) scales the device. React Flow's `width` prop falls
  // back to the measured size, which would feed back into the drawing: one bad measurement (e.g. taken while the
  // canvas remounts at another zoom) would then stick and grow the device.
  const width = useDiagram((s) => {
    const p = s.projects[s.currentId];
    // Devices from a background page are shown with an id prefixed "bg:".
    if (id.startsWith('bg:')) return p.pages.flatMap((pg) => pg.nodes).find((n) => n.id === id.slice(3))?.width;
    return activePage(p).nodes.find((n) => n.id === id)?.width;
  });
  const states = usePortStates(id);
  const snapshot = useDiagram((s) => s.snapshot);
  const display = useDisplay();
  const iconPorts = useIconPortOffsets(id, stencil);
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
      isVisible={selected && !data.locked}
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

  // Data colors: a colored outline; planned devices dashed, retired ones faded.
  const tint = display.device({ id, data } as DeviceNode);
  const status = data.status ?? 'active';
  const outline: React.CSSProperties = tint
    ? { outline: `3px ${status === 'planned' ? 'dashed' : 'solid'} ${tint}`, outlineOffset: 4, borderRadius: 4 }
    : status === 'planned' ? { outline: '2px dashed #2563eb', outlineOffset: 4, borderRadius: 4 } : {};
  const fade: React.CSSProperties = status === 'retired' ? { opacity: 0.45, filter: 'grayscale(1)' } : status === 'planned' ? { opacity: 0.75 } : {};

  const handles = stencil.ports.map((p) => {
    const custom = data.ports?.[p.id];
    // Hovering a port shows everything written about it.
    const title = [
      [custom?.label || p.label, custom?.uplink && 'UPLINK', p.role].filter(Boolean).join(' · '),
      custom?.description && `→ ${custom.description}`,
      [custom?.ip, custom?.vlan && `VLAN ${custom.vlan}`].filter(Boolean).join(' · '),
      custom?.notes,
    ].filter(Boolean).join('\n');
    const off = iconPorts.offsets?.[p.id] ?? { x: 0, y: 0 };
    return (
      <Handle
        key={p.id}
        id={p.id}
        type="source"
        position={SIDE[p.side]}
        title={title}
        className={stencil.style === 'icon' ? 'nc-handle-dot' : 'nc-handle-port'}
        style={{ left: (p.x + off.x) * k, top: (p.y + off.y) * k, width: p.w * k, height: p.h * k }}
      />
    );
  });

  // Ports with notes: an orange frame for uplinks, a small blue dot for any other documented port.
  const markers = stencil.style === 'icon' ? null : stencil.ports.map((p) => {
    const pd = data.ports?.[p.id];
    if (!isDocumented(pd)) return null;
    const box = { left: p.x * k, top: p.y * k, width: p.w * k, height: p.h * k };
    return pd!.uplink
      ? <div key={p.id} className="pointer-events-none absolute rounded-sm" style={{ ...box, outline: '2px solid #f97316', outlineOffset: 1 }} />
      : <div key={p.id} className="pointer-events-none absolute" style={box}><span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-blue-600 ring-1 ring-white" /></div>;
  });

  if (stencil.style === 'icon') {
    return (
      <div className={`relative flex flex-col items-center ${selected ? 'nc-selected-icon' : ''}`} style={{ width: stencil.width * k }} {...hover.bind}>
        {resizer}
        {quickInfo}
        <NodeBadges data={data} selected={selected} />
        <div ref={iconPorts.ref} className="relative" style={{ width: stencil.width * k, height: stencil.height * k, ...outline, ...fade }}>
          <IconArt id={stencil.id} size={stencil.width * k} />
          {handles}
        </div>
        <DeviceLabel id={id} data={data} variant="icon" />
        <DeviceInfoBox id={id} data={data} />
      </div>
    );
  }

  return (
    <div className={`relative ${selected ? 'nc-selected-panel' : ''}`} {...hover.bind}>
      {resizer}
      {quickInfo}
      <NodeBadges data={data} selected={selected} />
      <div style={{ ...(selected ? {} : outline), ...fade }}>
        {stencil.style === 'image'
          ? <ImageArt stencil={stencil} portStates={states} k={k} />
          : <PanelArt stencil={stencil} portStates={states} width={stencil.width * k} height={stencil.height * k} />}
      </div>
      {markers}
      {handles}
      <DeviceLabel id={id} data={data} variant="panel" />
      <DeviceInfoBox id={id} data={data} />
    </div>
  );
}

function ZoneNodeView({ data, selected }: NodeProps<ZoneNode>) {
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} minWidth={160} minHeight={100} color={data.color} />
      <div
        className="relative h-full w-full rounded-lg border-2 border-dashed"
        style={{ borderColor: data.color, background: `${data.color}12` }}
      >
        <NodeBadges data={data} selected={selected} />
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

function ShapeOutline({ d, w, h }: { d: ShapeData; w: number; h: number }) {
  const common = { fill: d.fill, stroke: d.stroke, strokeWidth: 2, strokeDasharray: d.dashed ? '6 4' : undefined, vectorEffect: 'non-scaling-stroke' as const };
  switch (d.kind) {
    case 'rect': return <rect x={1} y={1} width={w - 2} height={h - 2} {...common} />;
    case 'callout': return <rect x={1} y={1} width={w - 2} height={h - 2} rx={6} {...common} />;
    case 'rounded': return <rect x={1} y={1} width={w - 2} height={h - 2} rx={Math.min(16, h / 3)} {...common} />;
    case 'ellipse': return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...common} />;
    case 'diamond': return <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} {...common} />;
    case 'door': {
      // Floor-plan door: the leaf (hinged bottom-left, drawn open) and its swing arc; flip mirrors the swing.
      const r = Math.min(w, h) - 2;
      const g = d.flip ? `matrix(-1 0 0 1 ${w} 0)` : undefined;
      return (
        <g transform={g}>
          <line x1={1} y1={h - 1} x2={r + 1} y2={h - 1} stroke={d.stroke} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          <line x1={1} y1={h - 1} x2={1} y2={h - 1 - r} stroke={d.stroke} strokeWidth={3} vectorEffect="non-scaling-stroke" />
          <path d={`M1 ${h - 1 - r} A${r} ${r} 0 0 1 ${r + 1} ${h - 1}`} fill="none" stroke={d.stroke} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        </g>
      );
    }
    case 'window':
      // Floor-plan window: the frame with a centre line for the glass.
      return (
        <g>
          <rect x={1} y={1} width={w - 2} height={h - 2} fill={d.fill} stroke={d.stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={1} y1={h / 2} x2={w - 1} y2={h / 2} stroke={d.stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'arrow': {
      const head = Math.min(w * 0.4, h);
      return <polygon points={`1,${h * 0.28} ${w - head},${h * 0.28} ${w - head},1 ${w - 1},${h / 2} ${w - head},${h - 1} ${w - head},${h * 0.72} 1,${h * 0.72}`} {...common} />;
    }
    default: return null;
  }
}

/** Drawing shape: box, ellipse, diamond, arrow or free text. Double-click to edit the text. */
/** Leader line of a callout: from the edge of its box to the middle of the item it points to. */
function CalloutLeader({ target, x, y, w, h, color }: { target: string; x: number; y: number; w: number; h: number; color: string }) {
  const t = useInternalNode(target);
  if (!t) return null;
  const tw = t.measured.width ?? 0, th = t.measured.height ?? 0;
  const tx = t.internals.positionAbsolute.x + tw / 2 - x, ty = t.internals.positionAbsolute.y + th / 2 - y;
  // Start where the line from the box centre to the target leaves the box.
  const cx = w / 2, cy = h / 2, dx = tx - cx, dy = ty - cy;
  const k = Math.min(Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? h / 2 / Math.abs(dy) : Infinity, 1);
  const sx = cx + dx * k, sy = cy + dy * k;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ zIndex: -1 }}>
      <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={color} strokeWidth={1.5} />
      <circle cx={tx} cy={ty} r={3} fill={color} />
    </svg>
  );
}

function ShapeNodeView({ id, data, selected, width, height, positionAbsoluteX, positionAbsoluteY }: NodeProps<ShapeNode>) {
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const [editing, setEditing] = useState(false);
  const w = width ?? 160, h = height ?? 80;
  const textStyle: React.CSSProperties = {
    color: data.textColor, fontSize: data.fontSize, lineHeight: 1.2,
    fontWeight: data.bold ? 700 : undefined, fontStyle: data.italic ? 'italic' : undefined, textDecoration: data.underline ? 'underline' : undefined,
    textAlign: data.align ?? 'center',
  };
  const justify = data.align === 'left' ? 'justify-start' : data.align === 'right' ? 'justify-end' : 'justify-center';
  const items = data.valign === 'top' ? 'items-start' : data.valign === 'bottom' ? 'items-end' : 'items-center';
  return (
    <div className="relative" style={{ width: w, height: h }} onDoubleClick={() => { snapshot(); setEditing(true); }}>
      <NodeResizer isVisible={selected && !data.locked} minWidth={30} minHeight={20} color="#3b82f6" handleStyle={{ width: 9, height: 9, borderRadius: 2 }} onResizeStart={snapshot} />
      <NodeBadges data={data} selected={selected} />
      {data.kind === 'callout' && data.target && <CalloutLeader target={data.target} x={positionAbsoluteX} y={positionAbsoluteY} w={w} h={h} color={data.stroke === 'transparent' ? '#d97706' : data.stroke} />}
      <svg className="absolute inset-0 overflow-visible" width={w} height={h} style={{ transform: (data.kind === 'arrow' || data.kind === 'door') && data.rotation ? `rotate(${data.rotation}deg)` : undefined }}>
        <ShapeOutline d={data} w={w} h={h} />
      </svg>
      {data.kind === 'text' && selected && !editing && <div className="pointer-events-none absolute inset-0 rounded border border-dashed border-blue-400" />}
      {editing ? (
        <textarea
          autoFocus
          className="nodrag absolute inset-1 resize-none bg-white/80 outline-none"
          style={textStyle}
          defaultValue={data.text}
          onBlur={(e) => { update(id, { text: e.target.value }); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
        />
      ) : (
        <div className={`pointer-events-none absolute inset-0 flex whitespace-pre-wrap px-2 py-1 ${items} ${justify}`} style={textStyle}>
          {data.text}
        </div>
      )}
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Handle key={side} id={side} type="source" position={SIDE[side]} className="nc-handle-side" />
      ))}
    </div>
  );
}

/** Floor plan / site photo behind the page. Locked = click-through; unlocked = move and resize it. */
function BackdropNodeView({ data, selected, width, height }: NodeProps<BackdropNode>) {
  const snapshot = useDiagram((s) => s.snapshot);
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} keepAspectRatio minWidth={100} minHeight={60} color="#6b7280" onResizeStart={snapshot} />
      {/* eslint-disable-next-line @next/next/no-img-element -- user floor plan as a data URL */}
      <img
        src={data.image}
        alt="Floor plan"
        draggable={false}
        style={{ width: width ?? data.naturalWidth, height: height ?? data.naturalHeight, opacity: data.opacity, display: 'block', pointerEvents: data.locked ? 'none' : 'auto' }}
      />
    </>
  );
}

export const nodeTypes = {
  measure: memo(MeasureNodeView),
  device: memo(DeviceNodeView),
  zone: memo(ZoneNodeView),
  note: memo(NoteNodeView),
  backdrop: memo(BackdropNodeView),
  shape: memo(ShapeNodeView),
};
