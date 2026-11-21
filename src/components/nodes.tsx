'use client';

import { Handle, NodeResizer, Position, useInternalNode, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { activePage } from '@/lib/project';
import { IconArt, PanelArt, type PortState } from '@/lib/stencils';
import { DEFAULT_LABEL_FIELDS, DEVICE_STATUSES, isDocumented, type BackdropNode, type DeviceData, type DeviceNode, type NoteNode, type PortDef, dashFor, listLines, lookStyle, patternOf, textDirStyle, type ShapeData, type ShapeNode, type StencilDef, type ZoneNode } from '@/lib/types';
import { useCurrentPage, useCurrentProject, useDiagram, useStencil } from '@/store/useDiagramStore';
import { deviceFieldValue } from '@/lib/report';
import { expandFields } from '@/lib/headerFooter';
import { setActiveCell, setCell } from '@/lib/table';
import { rememberCaret } from '@/lib/symbols';
import { resolveLink } from '@/lib/links';
import { DeviceInfoBox } from './DeviceInfoBox';
import { DeviceQuickInfo, useQuickInfoHover } from './DeviceQuickInfo';
import { useOverlaySize } from '@/lib/overlays';
import { useDragOffset } from './useDragOffset';
import { EDIT_TEXT_EVENT } from '@/lib/events';
import { normDeg, turnedBox } from '@/lib/rotation';
import { useIconPortOffsets } from './iconPorts';
import MeasureNodeView from './MeasureNode';
import { NodeBadges } from './NodeBadges';
import { useDisplay } from './useDisplay';

const SIDES: PortDef['side'][] = ['top', 'right', 'bottom', 'left'];
/** Which way a port faces once the device is turned clockwise by `deg` (quarter turns). */
const turnSide = (side: PortDef['side'], deg: number) => SIDES[(SIDES.indexOf(side) + Math.round(deg / 90)) % 4];

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
  const sizeRef = useOverlaySize<HTMLDivElement>(`${id}|label`);
  // Dragging a label that sits beside its icon keeps it on that side (moved from there).
  const drag = useDragOffset(data.labelOffset, (labelOffset) => update(id, data.labelBeside ? { labelOffset, labelSide: 'left' } : { labelOffset }), !!data.locked);
  const snapshot = useDiagram((s) => s.snapshot);
  // Double-click the label (or F2) to rename the device right there (like typing on a Visio shape).
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === id && !data.locked) setEditing(true); };
    window.addEventListener(EDIT_TEXT_EVENT, on);
    return () => window.removeEventListener(EDIT_TEXT_EVENT, on);
  }, [id, data.locked]);
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
      className={`nc-device-label nodrag nopan absolute cursor-move select-none text-[11px] leading-tight text-gray-800 ${
        variant === 'icon' && data.labelBeside ? 'right-full top-1/2 mr-2 flex -translate-y-1/2 flex-col items-end whitespace-nowrap text-right'
          : variant === 'icon' ? 'top-full mt-1 flex w-40 flex-col items-center text-center' : 'left-0 top-full mt-1 flex gap-2 whitespace-nowrap'}`}
      style={{ translate: `${off.x}px ${off.y}px`, ...lookStyle(data) }}
      {...(editing ? {} : drag)}
      onDoubleClick={(e) => { if (data.locked || data.lockText || id.startsWith('bg:')) return; e.stopPropagation(); setEditing(true); }}
      title={data.locked ? undefined : 'Drag to move the label · double-click to rename'}
    >
      {editing ? (
        <input
          autoFocus
          className="nodrag w-40 rounded border border-blue-400 bg-white px-1 text-[11px] font-semibold outline-none"
          defaultValue={data.name}
          onFocus={(e) => e.currentTarget.select()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { e.currentTarget.value = data.name; e.currentTarget.blur(); }
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== data.name) { snapshot(); update(id, { name: v }); }
            setEditing(false);
          }}
        />
      ) : lines.map((l) => text(l.f, l.v!))}
    </div>
  );
}

/**
 * Data Graphics (Visio): the chosen fields as small tags above the device — ✔ / ✘ for yes-no values and a coloured
 * dot for status when shown as icons.
 */
function DataGraphics({ data }: { data: DeviceData }) {
  const graphics = useCurrentProject().display?.dataGraphics;
  if (!graphics?.length) return null;
  const items = graphics.flatMap((g) => {
    const v = deviceFieldValue(data, g.field).trim();
    if (!v) return [];
    const label = g.field.startsWith('x:') ? g.field.slice(2) : g.field;
    if (g.style === 'icon') {
      if (/^(yes|true|y|1)$/i.test(v)) return [<span key={g.field} title={`${label}: ${v}`} className="rounded bg-green-600 px-1 text-[10px] font-bold text-white">✔</span>];
      if (/^(no|false|n|0)$/i.test(v)) return [<span key={g.field} title={`${label}: ${v}`} className="rounded bg-red-600 px-1 text-[10px] font-bold text-white">✘</span>];
      if (g.field === 'status') {
        const c = DEVICE_STATUSES.find((s) => s.label === v)?.color ?? '#6b7280';
        return [<span key={g.field} title={`Status: ${v}`} className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: c }} />];
      }
    }
    return [<span key={g.field} title={label} className="max-w-40 truncate rounded border border-slate-300 bg-white/95 px-1 text-[10px] leading-4 text-slate-700 shadow-sm">{v}</span>];
  });
  if (!items.length) return null;
  return <div className="nc-data-graphics pointer-events-none absolute bottom-full left-0 mb-1 flex items-center gap-1 whitespace-nowrap">{items}</div>;
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
  // Turned devices: the box is the one around the turned drawing; the drawing turns inside it. Icons turn in place.
  const rot = normDeg(data.rotation ?? 0);
  const icon = stencil.style === 'icon';
  const tb = icon ? { w: base.width, h: base.height } : turnedBox(base.width, base.height, rot);
  const zoom = width ? width / tb.w : 1;
  const k = (icon ? 1 : stencil.scale) * zoom;
  const resizer = (
    <NodeResizer
      isVisible={selected && !data.locked}
      keepAspectRatio
      minWidth={Math.min(tb.w, Math.max(24, tb.w * 0.2))}
      minHeight={Math.min(tb.h, Math.max(8, tb.h * 0.2))}
      maxWidth={tb.w * 6}
      maxHeight={tb.h * 6}
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
        position={SIDE[turnSide(p.side, rot)]}
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
        <DataGraphics data={data} />
        <div ref={iconPorts.ref} className="relative" style={{ width: stencil.width * k, height: stencil.height * k, ...outline, ...fade, transform: rot ? `rotate(${rot}deg)` : undefined }}>
          <IconArt id={stencil.id} size={stencil.width * k} />
          {handles}
        </div>
        {selected && !data.locked && !id.startsWith('bg:') && <DeviceRotateHandle id={id} />}
        <DeviceLabel id={id} data={data} variant="icon" />
        <DeviceInfoBox id={id} data={data} />
      </div>
    );
  }

  const aw = stencil.width * k, ah = stencil.height * k;
  const tbk = turnedBox(aw, ah, rot);
  const box = { width: tbk.w, height: tbk.h };
  return (
    <div className={`relative ${selected ? 'nc-selected-panel' : ''}`} style={rot ? box : undefined} {...hover.bind}>
      {resizer}
      {quickInfo}
      <NodeBadges data={data} selected={selected} />
      {/* The drawing, its port markers and its ports turn together; React Flow reads the turned port positions. */}
      <div
        className={rot ? 'absolute' : undefined}
        style={rot ? { width: aw, height: ah, left: (box.width - aw) / 2, top: (box.height - ah) / 2, transform: `rotate(${rot}deg)` } : undefined}
      >
        <div style={{ ...(selected ? {} : outline), ...fade }}>
          {stencil.style === 'image'
            ? <ImageArt stencil={stencil} portStates={states} k={k} />
            : <PanelArt stencil={stencil} portStates={states} width={stencil.width * k} height={stencil.height * k} />}
        </div>
        {markers}
        {handles}
      </div>
      {selected && !data.locked && !id.startsWith('bg:') && <DeviceRotateHandle id={id} />}
      <DataGraphics data={data} />
      <DeviceLabel id={id} data={data} variant="panel" />
      <DeviceInfoBox id={id} data={data} />
    </div>
  );
}

function ZoneNodeView({ data, selected }: NodeProps<ZoneNode>) {
  const zs = data.style ?? 'dashed';
  return (
    <>
      <NodeResizer isVisible={selected && !data.locked} minWidth={160} minHeight={100} color={data.color} />
      <div
        className={`relative h-full w-full ${zs === 'band' ? 'flex' : ''} ${zs === 'header' || zs === 'band' ? 'rounded-md' : 'rounded-lg'} border-2 ${zs === 'dashed' ? 'border-dashed' : ''}`}
        style={{ borderColor: data.color, background: `${data.color}${zs === 'filled' ? '30' : '12'}` }}
      >
        <NodeBadges data={data} selected={selected} />
        {zs === 'header' ? (
          // Heading band across the top, like Visio's container headings.
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white" style={{ background: data.color, ...lookStyle(data) }}>{data.title}</div>
        ) : zs === 'band' ? (
          // Side band with the title reading up.
          <div className="flex w-7 shrink-0 items-center justify-center text-xs font-semibold uppercase tracking-wide text-white" style={{ background: data.color, writingMode: 'vertical-rl', transform: 'rotate(180deg)', ...lookStyle(data) }}>{data.title}</div>
        ) : (
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: data.color, ...lookStyle(data) }}>
            {data.title}
          </div>
        )}
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
        style={lookStyle(data)}
        rows={Math.max(2, data.text.split('\n').length)}
        value={data.text}
        readOnly={!!data.lockText}
        onChange={(e) => update(id, { text: e.target.value })}
      />
    </div>
  );
}

function ShapeOutline({ d, w, h, id }: { d: ShapeData; w: number; h: number; id?: string }) {
  const lw = d.lineWidth ?? 2;
  const grad = d.gradient && d.fill !== 'transparent' && id ? `nc-grad-${id.replace(/[^\w-]/g, '_')}` : null;
  const common = {
    fill: grad ? `url(#${grad})` : d.fill, fillOpacity: d.fillTransparency ? 1 - d.fillTransparency / 100 : undefined,
    stroke: d.stroke, strokeWidth: lw, ...dashFor(patternOf(d), lw), vectorEffect: 'non-scaling-stroke' as const,
  };
  const out = outline(d, w, h, common);
  if (!grad || !out) return out;
  return (
    <>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixWhite(d.fill, 0.8)} />
          <stop offset="1" stopColor={d.fill} />
        </linearGradient>
      </defs>
      {out}
    </>
  );
}

/** Places a picture so only its uncropped part fills the box (Picture → Crop). */
function cropStyle(c?: { l: number; t: number; r: number; b: number }): React.CSSProperties {
  if (!c) return { left: 0, top: 0, width: '100%', height: '100%' };
  const kw = Math.max(0.05, 1 - c.l - c.r), kh = Math.max(0.05, 1 - c.t - c.b);
  return { width: `${100 / kw}%`, height: `${100 / kh}%`, left: `${(-c.l / kw) * 100}%`, top: `${(-c.t / kh) * 100}%` };
}

/** Mixes a #rrggbb colour with white (amount 0 = the colour, 1 = white). */
function mixWhite(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** The props every outline shares (fill, line, dashes). */
type OutlineProps = { fill: string; fillOpacity?: number; stroke: string; strokeWidth: number; strokeDasharray?: string; strokeLinecap?: 'round'; vectorEffect: 'non-scaling-stroke' };

function outline(d: ShapeData, w: number, h: number, common: OutlineProps) {
  switch (d.kind) {
    case 'table': return null;
    case 'offpage': {
      // Visio's off-page reference: a box with a pointed end.
      const tip = Math.min(h / 2, w / 3);
      return <polygon points={`1,1 ${w - tip},1 ${w - 1},${h / 2} ${w - tip},${h - 1} 1,${h - 1}`} {...common} strokeLinejoin="round" />;
    }
    case 'image': return d.stroke === 'transparent' ? null : <rect x={0.5} y={0.5} width={w - 1} height={h - 1} {...common} fill="none" />;
    case 'rect': return <rect x={1} y={1} width={w - 2} height={h - 2} rx={d.rounding ? Math.min(d.rounding, w / 2, h / 2) : undefined} {...common} />;
    case 'callout': {
      const cs = d.calloutStyle ?? 'box';
      if (cs === 'oval') return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...common} />;
      // A line callout: the text sits on a rule, with no box round it.
      if (cs === 'line') return <line x1={0} y1={h - 1} x2={w} y2={h - 1} {...common} fill="none" />;
      return <rect x={1} y={1} width={w - 2} height={h - 2} rx={cs === 'rounded' ? Math.min(h / 2, 24) : 6} {...common} />;
    }
    case 'rounded': return <rect x={1} y={1} width={w - 2} height={h - 2} rx={Math.min(16, h / 3)} {...common} />;
    case 'ellipse': return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...common} />;
    case 'freeform': return <polyline points={(d.points ?? []).map(([px, py]) => `${px * w},${py * h}`).join(' ')} {...common} fill={d.fill === 'transparent' ? 'none' : d.fill} strokeLinecap="round" strokeLinejoin="round" />;
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
    color: data.textColor, fontSize: data.fontSize, lineHeight: data.lineSpacing ?? 1.2, fontFamily: data.fontFamily,
    fontWeight: data.bold ? 700 : undefined, fontStyle: data.italic ? 'italic' : undefined, textDecoration: [data.underline && 'underline', data.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    textAlign: data.align ?? 'center',
  };
  const justify = data.align === 'left' ? 'justify-start' : data.align === 'right' ? 'justify-end' : 'justify-center';
  const items = data.valign === 'top' ? 'items-start' : data.valign === 'bottom' ? 'items-end' : 'items-center';
  // Free rotation (Visio's rotation handle) for drawing shapes; doors turn in 90° steps, windows and callouts don't.
  const rotatable = data.kind !== 'door' && data.kind !== 'window' && data.kind !== 'callout' && data.kind !== 'table';
  const isTable = data.kind === 'table';
  const outer = useRef<HTMLDivElement>(null);
  // Insert → Field: codes like &[Client] or &[Page] show their values (the codes stay in the text while editing).
  const fieldText = useDiagram((s) => {
    if (!data.text?.includes('&[')) return data.text;
    const p = s.projects[s.currentId];
    return expandFields(data.text, p, p.activePageId);
  });
  // Off-page reference: shows the other page's name (and follows renames) unless given its own text.
  const offName = useDiagram((s) => {
    if (data.kind !== 'offpage') return null;
    const t = resolveLink(data.link);
    return t?.kind === 'page' ? s.projects[s.currentId].pages.find((p) => p.id === t.pageId)?.name ?? '(deleted page)' : null;
  });
  const shownText = data.kind === 'offpage' && !data.text ? offName ?? '' : fieldText;
  const rfi = useReactFlow();
  const goToPair = () => {
    const t = resolveLink(data.link);
    if (t?.kind !== 'page') return;
    const st = useDiagram.getState();
    if (!st.projects[st.currentId].pages.some((p) => p.id === t.pageId)) return alert('The page this reference points to no longer exists.');
    st.setActivePage(t.pageId);
    // Select the partner and bring it into view once the other page is drawn.
    setTimeout(() => {
      const pair = data.pair;
      if (!pair || !activePage(useDiagram.getState().projects[st.currentId]).nodes.some((n) => n.id === pair)) return;
      useDiagram.getState().selectIds([pair]);
      void rfi.fitView({ nodes: [{ id: pair }], maxZoom: 1.2, padding: 2, duration: 250 });
    }, 150);
  };
  const listed = listLines(shownText ?? '', data.list);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === id && !data.locked && !data.lockText && !isTable) { snapshot(); setEditing(true); } };
    window.addEventListener(EDIT_TEXT_EVENT, on);
    return () => window.removeEventListener(EDIT_TEXT_EVENT, on);
  }, [id, data.locked, data.lockText, snapshot, isTable]);
  // A turned shape gets its own resize handles, turned with it (React Flow's only work square to the page).
  const turned = rotatable && ((data.rotation ?? 0) % 360) !== 0;
  return (
    <div ref={outer} className="relative" style={{ width: w, height: h }} onDoubleClick={() => { if (data.kind === 'offpage') goToPair(); else if (!isTable && !data.lockText) { snapshot(); setEditing(true); } }}>
      <NodeResizer isVisible={selected && !data.locked && !turned} keepAspectRatio={data.kind === 'image'} minWidth={20} minHeight={14} color="#3b82f6" handleStyle={{ width: 9, height: 9, borderRadius: 2 }} onResizeStart={snapshot} />
      <NodeBadges data={data} selected={selected} />
      {data.kind === 'callout' && data.target && <CalloutLeader target={data.target} x={positionAbsoluteX} y={positionAbsoluteY} w={w} h={h} color={data.stroke === 'transparent' ? '#d97706' : data.stroke} />}
      {isTable ? <TableBody id={id} data={data} /> : (
      <div className="absolute inset-0" style={{ transform: rotatable && data.rotation ? `rotate(${data.rotation}deg)` : undefined }}>
      <svg className="absolute inset-0 overflow-visible" width={w} height={h} style={{ zIndex: data.kind === 'image' ? 1 : undefined, transform: data.kind === 'door' && data.rotation ? `rotate(${data.rotation}deg)` : undefined, filter: data.shadow ? 'drop-shadow(3px 4px 3px rgba(0,0,0,0.35))' : undefined }}>
        <ShapeOutline d={data} w={w} h={h} id={id} />
      </svg>
      {data.kind === 'image' && data.src && (
        // Pictures stretch with their box (resizing keeps the proportions); the border, if any, is drawn over them.
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ filter: data.shadow ? 'drop-shadow(3px 4px 3px rgba(0,0,0,0.35))' : undefined, transform: data.flipX || data.flipY ? `scale(${data.flipX ? -1 : 1}, ${data.flipY ? -1 : 1})` : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.src} alt={data.text || 'Picture'} draggable={false} className="absolute max-w-none select-none" style={cropStyle(data.crop)} />
        </div>
      )}
      {data.kind === 'text' && selected && !editing && <div className="nc-ui pointer-events-none absolute inset-0 rounded border border-dashed border-blue-400" />}
      {editing ? (
        <textarea
          autoFocus
          className="nodrag absolute inset-1 resize-none bg-white/80 outline-none"
          style={textStyle}
          defaultValue={data.text}
          onBlur={(e) => { rememberCaret(id, e.target.selectionStart ?? e.target.value.length); update(id, { text: e.target.value }); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
        />
      ) : (
        <div className={`pointer-events-none absolute inset-0 flex whitespace-pre-wrap px-2 py-1 ${items} ${justify}`} style={{ ...textStyle, ...textDirStyle(data.textDir) }}>
          {listed ? (
            <div className="w-full">
              {listed.map((l, i) => (
                <div key={i} className="flex gap-1.5" style={{ justifyContent: data.align === 'right' ? 'flex-end' : data.align === 'left' ? 'flex-start' : 'center' }}>
                  {l.mark && <span className="shrink-0">{l.mark}</span>}
                  <span>{l.text || '\u00a0'}</span>
                </div>
              ))}
            </div>
          ) : shownText}
        </div>
      )}
      {rotatable && selected && !data.locked && !editing && <RotateHandle id={id} center={outer} />}
      {turned && selected && !data.locked && !editing && <TurnedResizer id={id} x={positionAbsoluteX} y={positionAbsoluteY} w={w} h={h} rotation={data.rotation ?? 0} />}
      </div>
      )}
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Handle key={side} id={side} type="source" position={SIDE[side]} className="nc-handle-side" />
      ))}
    </div>
  );
}

/**
 * Insert → Table: a grid of cells. Double-click a cell to type in it; Tab / Shift+Tab move between cells (Tab in the
 * last cell adds a row, like Word), Enter finishes (Shift+Enter = new line), Esc cancels.
 */
function TableBody({ id, data }: { id: string; data: ShapeData }) {
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const cells = data.cells?.length ? data.cells : [['']];
  const nc = Math.max(1, ...cells.map((r) => r.length));
  const project = useCurrentProject();
  const line = data.stroke === 'transparent' ? '#374151' : data.stroke;
  const border = `${data.lineWidth ?? 1}px solid ${line}`;
  const save = (r: number, c: number, v: string, then?: { r: number; c: number } | null) => {
    let next = cells.map((row) => [...row, ...Array(Math.max(0, nc - row.length)).fill('')]);
    if (next[r][c] !== v) next = setCell(next, r, c, v);
    const grew = !!then && then.r >= next.length;
    if (grew) next = [...next, Array(nc).fill('')];
    update(id, { cells: next });
    if (grew) {
      // The table gets taller by one row, so the rows keep their size.
      const st = useDiagram.getState();
      const n = activePage(st.projects[st.currentId]).nodes.find((x) => x.id === id);
      const h = n?.height ?? n?.measured?.height;
      const w = n?.width ?? n?.measured?.width;
      if (n && h && w) st.setNodeBox(id, n.position, w, Math.round(h + h / cells.length));
    }
    setEdit(then ?? null);
    if (then) setActiveCell(id, then.r, then.c);
  };
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: data.fill === 'transparent' ? undefined : data.fill, filter: data.shadow ? 'drop-shadow(3px 4px 3px rgba(0,0,0,0.35))' : undefined }}>
      <table className="h-full w-full border-collapse" style={{ tableLayout: 'fixed', color: data.textColor, fontSize: data.fontSize, fontFamily: data.fontFamily, lineHeight: 1.2 }}>
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: nc }, (_, c) => {
                const head = data.headerRow && r === 0;
                const v = row[c] ?? '';
                return (
                  <td
                    key={c}
                    className="overflow-hidden px-1.5 align-middle"
                    style={{ border, background: head ? `color-mix(in srgb, ${line} 16%, white)` : undefined, fontWeight: head || data.bold ? 700 : undefined, fontStyle: data.italic ? 'italic' : undefined, textAlign: data.align ?? 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    onPointerDown={() => setActiveCell(id, r, c)}
                    onDoubleClick={(e) => { e.stopPropagation(); if (data.locked || data.lockText) return; snapshot(); setActiveCell(id, r, c); setEdit({ r, c }); }}
                  >
                    {edit && edit.r === r && edit.c === c ? (
                      <textarea
                        autoFocus
                        rows={1}
                        className="nodrag nopan block h-full w-full resize-none bg-white/90 outline-none"
                        style={{ font: 'inherit', textAlign: 'inherit' }}
                        defaultValue={v}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => { if (e.target.isConnected) save(r, c, e.target.value); }}
                        onKeyDown={(e) => {
                          const t = e.currentTarget;
                          if (e.key === 'Escape') { e.preventDefault(); setEdit(null); }
                          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(r, c, t.value); }
                          else if (e.key === 'Tab') {
                            e.preventDefault();
                            const i = r * nc + c + (e.shiftKey ? -1 : 1);
                            save(r, c, t.value, i < 0 ? null : { r: Math.floor(i / nc), c: i % nc });
                          }
                          e.stopPropagation();
                        }}
                      />
                    ) : (v.includes('&[') ? expandFields(v, project, project.activePageId) : v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RESIZE_HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/**
 * Resize handles for a rotated shape, drawn turned with it. Dragging one keeps the opposite side where it is: the
 * pointer is measured in the shape's own (turned) axes, then the new box is placed back on the page.
 */
function TurnedResizer({ id, x, y, w, h, rotation }: { id: string; x: number; y: number; w: number; h: number; rotation: number }) {
  const rf = useReactFlow();
  const setBox = useDiagram((s) => s.setNodeBox);
  const snapshot = useDiagram((s) => s.snapshot);
  const drag = useRef<{ ax: number; ay: number; sx: number; sy: number } | null>(null);
  const t = (rotation * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const turn = (vx: number, vy: number) => ({ x: vx * c - vy * s, y: vx * s + vy * c });
  return (
    <>
      <div className="nc-ui pointer-events-none absolute inset-0 border border-dashed border-blue-500" />
      {RESIZE_HANDLES.map(([sx, sy]) => (
        <span
          key={`${sx}${sy}`}
          className="nc-ui nodrag nopan absolute h-[9px] w-[9px] rounded-sm border border-white bg-blue-500"
          style={{ left: w / 2 + (sx * w) / 2 - 4.5, top: h / 2 + (sy * h) / 2 - 4.5, cursor: 'move' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            snapshot();
            // The fixed point: the opposite corner / side, on the page.
            const a = turn((-sx * w) / 2, (-sy * h) / 2);
            drag.current = { ax: x + w / 2 + a.x, ay: y + h / 2 + a.y, sx, sy };
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false });
            const vx = p.x - d.ax, vy = p.y - d.ay;
            const lx = vx * c + vy * s, ly = -vx * s + vy * c; // pointer in the shape's axes
            const nw = d.sx ? Math.max(30, Math.round(lx * d.sx)) : w;
            const nh = d.sy ? Math.max(20, Math.round(ly * d.sy)) : h;
            const off = turn((d.sx * nw) / 2, (d.sy * nh) / 2);
            const cx = d.ax + off.x, cy = d.ay + off.y;
            setBox(id, { x: cx - nw / 2, y: cy - nh / 2 }, nw, nh);
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        />
      ))}
    </>
  );
}

/** Rotate handle for a device: drag it round to turn the device (whole degrees, 15° with Shift, catches 0/90/180/270). */
function DeviceRotateHandle({ id }: { id: string }) {
  const setRotation = useDiagram((s) => s.setDeviceRotation);
  const snapshot = useDiagram((s) => s.snapshot);
  const node = useRef<HTMLSpanElement>(null);
  const active = useRef(false);
  return (
    <>
      <span className="nc-ui pointer-events-none absolute left-1/2 h-4 w-px -translate-x-1/2 bg-blue-500" style={{ top: -20 }} />
      <span
        ref={node}
        className="nc-ui nodrag nopan absolute left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border-2 border-blue-600 bg-white"
        style={{ top: -26 }}
        title="Drag to rotate (Shift: 15° steps)"
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); snapshot(); active.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!active.current) return;
          const r = (node.current!.parentElement as HTMLElement).getBoundingClientRect();
          let a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90;
          if (e.shiftKey) a = Math.round(a / 15) * 15;
          else {
            a = Math.round(a);
            const right = Math.round(a / 90) * 90;
            if (Math.abs(a - right) <= 4) a = right;
          }
          setRotation(id, a);
        }}
        onPointerUp={() => { active.current = false; }}
        onPointerCancel={() => { active.current = false; }}
      />
    </>
  );
}

/** Drag to turn the shape about its centre; snaps to whole degrees, to 15° steps with Shift, and to 0/90/180/270. */
function RotateHandle({ id, center }: { id: string; center: React.RefObject<HTMLDivElement | null> }) {
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const active = useRef(false);
  const angleAt = (e: React.PointerEvent) => {
    const r = center.current!.getBoundingClientRect();
    let a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90;
    a = ((a % 360) + 360) % 360;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else {
      a = Math.round(a);
      const right = Math.round(a / 90) * 90;
      if (Math.abs(a - right) <= 4) a = right;
    }
    return a % 360;
  };
  return (
    <>
      <span className="nc-ui pointer-events-none absolute left-1/2 h-5 w-px -translate-x-1/2 bg-blue-500" style={{ top: -22 }} />
      <span
        className="nc-ui nodrag nopan absolute left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border-2 border-blue-600 bg-white"
        style={{ top: -28 }}
        title="Drag to rotate (Shift: 15° steps)"
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); snapshot(); active.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (active.current) update(id, { rotation: angleAt(e) }); }}
        onPointerUp={() => { active.current = false; }}
        onPointerCancel={() => { active.current = false; }}
      />
    </>
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
