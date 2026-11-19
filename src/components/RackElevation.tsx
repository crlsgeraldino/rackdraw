import type { ReactNode } from 'react';
import { rackLabel } from '@/lib/rack';
import { IconArt, PanelArt } from '@/lib/stencils';
import type { DeviceNode, Rack, RackItem, StencilDef } from '@/lib/types';

/*
 * A rack elevation drawn as plain SVG. The rack view uses it interactively; the PDF export renders the same
 * component off-screen, so what you see is what gets printed.
 */

export const U_H = 40; // one rack unit (1.75") at 19" = 440px wide, roughly to scale
export const INNER_W = 440;
export const RAIL = 34;
export const TOP = 30;
const BOTTOM = 14;
const LABEL_W = 230;

export function rackSize(rack: Rack) {
  return { width: RAIL * 2 + INNER_W + LABEL_W, height: TOP + rack.units * U_H + BOTTOM };
}

/** Top y of a slot starting at `u` that is `h` units tall. */
export function slotY(rack: Rack, u: number, h: number) {
  return TOP + (rack.units - (u + h - 1)) * U_H;
}

/** Rack unit under the pointer for an item `height` units tall, given the rendered SVG's on-screen box. */
export function uAtPoint(rack: Rack, svg: SVGSVGElement, clientY: number, height: number, grabOffsetU = 0) {
  const box = svg.getBoundingClientRect();
  const k = box.height / rackSize(rack).height;
  const fromTop = Math.floor(((clientY - box.top) / k - TOP) / U_H) - grabOffsetU;
  return rack.units - fromTop - height + 1;
}

export interface RackPreview {
  u: number;
  height: number;
  valid: boolean;
}

interface Props {
  rack: Rack;
  face: 'front' | 'rear';
  devices: Map<string, DeviceNode>;
  stencil: (id: string) => StencilDef | undefined;
  selectedId?: string | null;
  preview?: RackPreview | null;
  /** Hide items being dragged so the preview shows where they will land. */
  hiddenId?: string | null;
  onItemPointerDown?: (item: RackItem, e: React.PointerEvent) => void;
  svgRef?: React.Ref<SVGSVGElement>;
  /** Rendered width in px; height follows the rack's proportions. */
  width?: number;
}

function onFace(it: RackItem, face: 'front' | 'rear') {
  return it.depth === 'full' || it.depth === face;
}

function Plate({ x, y, w, h, fill = '#27272a' }: { x: number; y: number; w: number; h: number; fill?: string }) {
  return (
    <>
      <rect x={x} y={y + 1} width={w} height={h - 2} rx={2} fill={fill} />
      <rect x={x} y={y + 1} width={w} height={3} fill="#ffffff14" />
    </>
  );
}

function ItemArt({ it, face, x, y, h, device, stencil }: { it: RackItem; face: 'front' | 'rear'; x: number; y: number; h: number; device?: DeviceNode; stencil?: StencilDef }) {
  const w = INNER_W;
  const parts: ReactNode[] = [];

  if (it.kind === 'device') {
    if (face === 'rear' || !stencil) {
      parts.push(<Plate key="p" x={x} y={y} w={w} h={h} fill="#3f3f46" />);
      parts.push(<rect key="psu1" x={x + w - 70} y={y + 6} width={26} height={h - 12} rx={2} fill="#18181b" />);
      parts.push(<rect key="psu2" x={x + w - 38} y={y + 6} width={26} height={h - 12} rx={2} fill="#18181b" />);
      parts.push(<text key="t" x={x + 14} y={y + h / 2 + 4} fontSize={12} fill="#e4e4e7">{device?.data.name ?? 'Device'}{face === 'rear' ? ' (rear)' : ''}</text>);
    } else {
      parts.push(<Plate key="p" x={x} y={y} w={w} h={h} fill="#1f1f22" />);
      // Fit the front-panel art inside the slot, keeping its proportions.
      const pad = 3;
      if (stencil.style === 'icon') {
        const size = h - pad * 2;
        parts.push(<g key="i" transform={`translate(${x + 10},${y + pad})`}><rect width={size} height={size} rx={4} fill="#f4f4f5" /><IconArt id={stencil.id} size={size} /></g>);
        parts.push(<text key="t" x={x + 20 + size} y={y + h / 2 + 4} fontSize={12} fill="#e4e4e7">{device?.data.name}</text>);
      } else {
        const k = Math.min((w - pad * 2) / stencil.width, (h - pad * 2) / stencil.height);
        const aw = stencil.width * k;
        const ah = stencil.height * k;
        const ax = x + (w - aw) / 2;
        const ay = y + (h - ah) / 2;
        parts.push(
          stencil.style === 'image'
            ? <image key="a" href={stencil.image} x={ax} y={ay} width={aw} height={ah} preserveAspectRatio="xMidYMid meet" />
            : <g key="a" transform={`translate(${ax},${ay})`}><PanelArt stencil={stencil} portStates={{}} width={aw} height={ah} /></g>,
        );
      }
    }
  } else if (it.kind === 'blank') {
    parts.push(<Plate key="p" x={x} y={y} w={w} h={h} />);
    for (let i = 0; i < 12; i++) parts.push(<rect key={i} x={x + 40 + i * 30} y={y + h / 2 - 2} width={18} height={4} rx={2} fill="#3f3f46" />);
  } else if (it.kind === 'cable-manager') {
    parts.push(<Plate key="p" x={x} y={y} w={w} h={h} fill="#18181b" />);
    for (let i = 0; i < 5; i++) parts.push(<rect key={i} x={x + 30 + i * 84} y={y + 7} width={44} height={h - 14} rx={8} fill="none" stroke="#71717a" strokeWidth={3} />);
  } else if (it.kind === 'shelf') {
    parts.push(<rect key="s" x={x} y={y + h - 8} width={w} height={6} fill="#71717a" />);
    parts.push(<rect key="l" x={x} y={y + h - 14} width={6} height={12} fill="#71717a" />);
    parts.push(<rect key="r" x={x + w - 6} y={y + h - 14} width={6} height={12} fill="#71717a" />);
  } else if (it.kind === 'pdu') {
    parts.push(<Plate key="p" x={x} y={y} w={w} h={h} fill="#18181b" />);
    for (let i = 0; i < 8; i++) parts.push(<rect key={i} x={x + 60 + i * 44} y={y + h / 2 - 9} width={22} height={18} rx={3} fill="#3f3f46" stroke="#a1a1aa" />);
  } else {
    parts.push(<Plate key="p" x={x} y={y} w={w} h={h} fill="#3f3f46" />);
  }
  return <>{parts}</>;
}

export function RackElevation({ rack, face, devices, stencil, selectedId, preview, hiddenId, onItemPointerDown, svgRef, width }: Props) {
  const size = rackSize(rack);
  const x0 = RAIL;
  const labelX = RAIL * 2 + INNER_W + 10;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size.width} ${size.height}`}
      width={width ?? size.width}
      height={(width ?? size.width) * (size.height / size.width)}
      fontFamily="Segoe UI, Arial, sans-serif"
      style={{ display: 'block' }}
    >
      <text x={RAIL + INNER_W / 2} y={18} fontSize={14} fontWeight={700} textAnchor="middle" fill="#111827">
        {rack.name} — {face === 'front' ? 'FRONT' : 'REAR'}
      </text>

      {/* Frame, cavity and rails */}
      <rect x={0} y={TOP - 6} width={RAIL * 2 + INNER_W} height={rack.units * U_H + 12} rx={4} fill="#3f3f46" />
      <rect x={x0} y={TOP} width={INNER_W} height={rack.units * U_H} fill="#e5e7eb" />
      {Array.from({ length: rack.units }, (_, i) => {
        const u = rack.units - i;
        const y = TOP + i * U_H;
        return (
          <g key={u}>
            <line x1={x0} x2={x0 + INNER_W} y1={y} y2={y} stroke="#d1d5db" />
            <text x={RAIL / 2} y={y + U_H / 2 + 4} fontSize={11} textAnchor="middle" fill="#e4e4e7">{u}</text>
            <text x={RAIL * 1.5 + INNER_W} y={y + U_H / 2 + 4} fontSize={11} textAnchor="middle" fill="#e4e4e7">{u}</text>
            {[8, 20, 32].map((dy) => (
              <g key={dy}>
                <rect x={x0 - 8} y={y + dy - 2} width={4} height={4} fill="#18181b" />
                <rect x={x0 + INNER_W + 4} y={y + dy - 2} width={4} height={4} fill="#18181b" />
              </g>
            ))}
          </g>
        );
      })}

      {rack.items.filter((it) => onFace(it, face) && it.id !== hiddenId).map((it) => {
        const y = slotY(rack, it.u, it.height);
        const h = it.height * U_H;
        const device = it.nodeId ? devices.get(it.nodeId) : undefined;
        const st = device ? stencil(device.data.stencilId) : undefined;
        const name = it.kind === 'device' ? device?.data.name ?? 'Missing device' : it.label ?? it.kind;
        const extra = it.kind === 'device' ? [device?.data.model, device?.data.ip].filter(Boolean).join(' · ') : '';
        const ghost = it.depth !== 'full' && it.depth !== face;
        return (
          <g
            key={it.id}
            onPointerDown={onItemPointerDown ? (e) => onItemPointerDown(it, e) : undefined}
            style={onItemPointerDown ? { cursor: 'grab' } : undefined}
            opacity={ghost ? 0.4 : 1}
          >
            <ItemArt it={it} face={face} x={x0} y={y} h={h} device={device} stencil={st} />
            {selectedId === it.id && <rect x={x0 - 2} y={y - 1} width={INNER_W + 4} height={h + 2} fill="none" stroke="#3b82f6" strokeWidth={3} rx={3} />}
            <text x={labelX} y={y + h / 2 - (extra ? 2 : -4)} fontSize={12} fill="#111827">
              <tspan fontWeight={600}>{rackLabel(it)}</tspan> {name}
            </text>
            {extra && <text x={labelX} y={y + h / 2 + 12} fontSize={10} fill="#6b7280">{extra}</text>}
          </g>
        );
      })}

      {preview && (
        <rect
          x={x0}
          y={slotY(rack, Math.max(1, Math.min(preview.u, rack.units - preview.height + 1)), preview.height)}
          width={INNER_W}
          height={preview.height * U_H}
          fill={preview.valid ? '#22c55e33' : '#ef444433'}
          stroke={preview.valid ? '#16a34a' : '#dc2626'}
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
