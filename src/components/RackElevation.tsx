import type { ReactNode } from 'react';
import { rackLabel } from '@/lib/rack';
import { shelfArtHeight, shelfWidth, TRAY_PX } from '@/lib/rackShelf';
import { isSmallGear } from '@/lib/autoRack';
import type { RackCable } from '@/lib/rackPatching';
import { IconArt, PanelArt, type PortState } from '@/lib/stencils';
import type { DeviceNode, Rack, RackItem, StencilDef } from '@/lib/types';

/*
 * A rack elevation drawn as plain SVG. The rack view uses it interactively; the PDF export renders the same
 * component off-screen, so what you see is what gets printed. Drawn like a real cabinet: steel frame and rails,
 * a dark interior, shaded faceplates with screwed-in ears, and patch cords hanging between ports.
 */

export const U_H = 40; // one rack unit (1.75") at 19" = 440px wide, roughly to scale
export const INNER_W = 440;
export const RAIL = 34;
export const TOP = 44;
const BOTTOM = 46;
const LABEL_W = 250;
const LEADER = 26; // gap between the rack and the labels, crossed by a leader line (like Visio's rack callouts)

export function rackSize(rack: Rack) {
  return { width: RAIL * 2 + INNER_W + LEADER + LABEL_W, height: TOP + rack.units * U_H + BOTTOM };
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
  /** Ports with a cable, per device: lit like on the diagram. */
  portStates?: Map<string, Record<string, PortState>>;
  /** The rack's cables: patch cords between its own equipment are drawn on the front; others get a short lead. */
  cables?: RackCable[];
  /** Cable highlighted (hovered in the patching list). */
  hotCable?: string | null;
  /** Pointer over a port on the front (screen position for a card), or null when it leaves. */
  onPortHover?: (h: { nodeId: string; port: string; x: number; y: number } | null) => void;
}

/**
 * Where a device's front-panel art sits in its slot, and its scale across (kx) and down (ky). A full-width
 * faceplate (a 19 in switch, a vendor's picture of one) fills the slot from post to post, as the real one does, even
 * if the picture is a little wider or narrower than the slot; something clearly narrower (a desktop firewall on a
 * shelf) keeps its proportions and is centred.
 */
export function artBox(st: StencilDef, x: number, y: number, w: number, h: number) {
  const pad = 3;
  const iw = w - pad * 2, ih = h - pad * 2;
  const k = Math.min(iw / st.width, ih / st.height);
  // Pictures only: the built-in panels are drawn to their own proportions and would look squashed.
  const fullWidth = st.style === 'image' && st.width / st.height >= (iw / ih) * 0.7;
  if (fullWidth) return { x: x + pad, y: y + pad, w: iw, h: ih, kx: iw / st.width, ky: ih / st.height, stretch: true };
  const aw = st.width * k, ah = st.height * k;
  return { x: x + (w - aw) / 2, y: y + (h - ah) / 2, w: aw, h: ah, kx: k, ky: k, stretch: false };
}

/** A device standing on a shelf: its box (on the shelf's tray, at its own proportions). */
function shelfBox(it: RackItem, st: StencilDef | undefined, x0: number, y: number) {
  const ah = shelfArtHeight(it.height);
  const w = shelfWidth(st, it.height);
  return { x: x0 + (it.shelf?.x ?? 0), y: y + it.height * U_H - TRAY_PX - ah, w, h: ah };
}

/** Where a port of a device on a shelf is (its centre and size). */
function shelfPort(st: StencilDef | undefined, box: { x: number; y: number; w: number; h: number }, port: string | undefined) {
  if (!st || !port) return undefined;
  if (st.style === 'icon' || !(st.width > 0) || !(st.height > 0)) {
    const ps = st.ports.filter((p) => p.kind === 'rj45' || p.kind === 'sfp' || p.kind === 'link' || p.kind === 'console');
    const i = ps.findIndex((p) => p.id === port);
    return i < 0 ? undefined : { cx: box.x + (box.w * (i + 1)) / (ps.length + 1), cy: box.y + box.h * 0.72, w: 8, h: 7 };
  }
  const p = st.ports.find((q) => q.id === port);
  if (!p) return undefined;
  const kx = box.w / st.width, ky = box.h / st.height;
  return { cx: box.x + (p.x + p.w / 2) * kx, cy: box.y + (p.y + p.h / 2) * ky, w: p.w * kx, h: p.h * ky };
}

/** A small device on a shelf, front or back: its own art at its own size, standing on the tray. */
function ShelfDevice({ it, face, x0, y, device, stencil, ports }: { it: RackItem; face: 'front' | 'rear'; x0: number; y: number; device?: DeviceNode; stencil?: StencilDef; ports?: Record<string, PortState> }) {
  const b = shelfBox(it, stencil, x0, y);
  if (face === 'rear') {
    // Seen from the back the device stands at the mirrored place on the shelf.
    const rx = x0 + INNER_W - (b.x - x0) - b.w;
    return (
      <g>
        <rect x={rx} y={b.y} width={b.w} height={b.h} rx={2} fill="#2a2c31" stroke="#0b0c0f" />
        <text x={rx + b.w / 2} y={b.y + b.h / 2 + 3} fontSize={7} fill="#d1d5db" textAnchor="middle">{rearName(device?.data.name ?? '').slice(0, Math.max(4, Math.floor(b.w / 5)))}</text>
      </g>
    );
  }
  if (!stencil || stencil.style === 'icon' || !(stencil.width > 0)) {
    const size = Math.min(b.h - 6, 18);
    return (
      <g>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill="url(#rk-face-light)" stroke="#0b0c0f" />
        {stencil && <g transform={`translate(${b.x + 4},${b.y + 3})`}><IconArt id={stencil.id} size={size} /></g>}
        {(stencil?.ports ?? []).map((p) => { const s = shelfPort(stencil, b, p.id); return s ? <MiniJack key={p.id} cx={s.cx} cy={s.cy} lit={ports?.[p.id] === 'connected'} /> : null; })}
      </g>
    );
  }
  return stencil.style === 'image'
    ? <image href={stencil.image} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio="none" />
    : <g transform={`translate(${b.x},${b.y})`}><PanelArt stencil={stencil} portStates={ports ?? {}} width={b.w} height={b.h} /></g>;
}

/** A port's box on the rack's front (for pointing at it), in the elevation's coordinates. */
function portBox(rack: Rack, it: RackItem, st: StencilDef | undefined, port: string): { x: number; y: number; w: number; h: number } | null {
  const y = slotY(rack, it.u, it.height), h = it.height * U_H, w = INNER_W;
  if (it.shelf) {
    const s = shelfPort(st, shelfBox(it, st, RAIL, y), port);
    return s ? { x: s.cx - Math.max(4, s.w / 2), y: s.cy - Math.max(4, s.h / 2), w: Math.max(8, s.w), h: Math.max(8, s.h) } : null;
  }
  if (!st || st.style === 'icon') {
    const spot = jackSpots(st, RAIL, y).get(port);
    return spot ? { x: spot[0] - 9, y: spot[1] - 8, w: 18, h: 16 } : null;
  }
  const p = st.ports.find((q) => q.id === port);
  if (!p) return null;
  const a = artBox(st, RAIL, y, w, h);
  return { x: a.x + p.x * a.kx, y: a.y + p.y * a.ky, w: p.w * a.kx, h: p.h * a.ky };
}

function onFace(it: RackItem, face: 'front' | 'rear') {
  return it.depth === 'full' || it.depth === face;
}

/* ------------------------------------------------------------------ */
/*  Shared paint                                                       */
/* ------------------------------------------------------------------ */

/** Gradients and shadows used across the drawing (ids repeat across elevations on one page; they are identical). */
function Defs() {
  return (
    <defs>
      <linearGradient id="rk-post" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#4b5160" /><stop offset="0.45" stopColor="#2b2f38" /><stop offset="1" stopColor="#3d424e" />
      </linearGradient>
      <linearGradient id="rk-cap" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#4a505c" /><stop offset="1" stopColor="#23262d" />
      </linearGradient>
      <linearGradient id="rk-cavity" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#07080a" /><stop offset="0.12" stopColor="#14161b" /><stop offset="0.88" stopColor="#14161b" /><stop offset="1" stopColor="#07080a" />
      </linearGradient>
      <linearGradient id="rk-rail" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#9aa1ad" /><stop offset="0.5" stopColor="#d7dbe2" /><stop offset="1" stopColor="#8a919d" />
      </linearGradient>
      <linearGradient id="rk-face" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#4a4e57" /><stop offset="0.08" stopColor="#363940" /><stop offset="0.92" stopColor="#25272c" /><stop offset="1" stopColor="#15161a" />
      </linearGradient>
      <linearGradient id="rk-face-light" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#e9ecf1" /><stop offset="0.1" stopColor="#cfd4dc" /><stop offset="0.9" stopColor="#b5bbc5" /><stop offset="1" stopColor="#8d939e" />
      </linearGradient>
      <linearGradient id="rk-ear" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#8b919c" /><stop offset="0.5" stopColor="#c9ced6" /><stop offset="1" stopColor="#7d838e" />
      </linearGradient>
      <linearGradient id="rk-lcd" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#1d4d5c" /><stop offset="1" stopColor="#0d2b35" />
      </linearGradient>
      <filter id="rk-shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.35" />
      </filter>
      <filter id="rk-item-shadow" x="-5%" y="-20%" width="110%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.7" />
      </filter>
    </defs>
  );
}

/** A shaded steel faceplate. */
function Face({ x, y, w, h, light, fill }: { x: number; y: number; w: number; h: number; light?: boolean; fill?: string }) {
  return (
    <g filter="url(#rk-item-shadow)">
      <rect x={x} y={y + 1} width={w} height={h - 2} rx={2} fill={fill ?? (light ? 'url(#rk-face-light)' : 'url(#rk-face)')} />
      <rect x={x} y={y + 1} width={w} height={1.5} fill="#ffffff" opacity={light ? 0.7 : 0.18} />
    </g>
  );
}

function Screw({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={3.6} fill="#e5e7eb" stroke="#4b5563" strokeWidth={0.8} />
      <path d={`M${cx - 2} ${cy} H${cx + 2} M${cx} ${cy - 2} V${cy + 2}`} stroke="#4b5563" strokeWidth={1} />
    </g>
  );
}

/** Mounting ears over the rails, screwed in at each unit, like rack-mount equipment in Visio's rack stencils. */
function Ears({ x, y, h, units }: { x: number; y: number; h: number; units: number }) {
  const ear = 15;
  const screws: ReactNode[] = [];
  for (let i = 0; i < units; i++) {
    const cy = y + i * U_H + U_H / 2;
    screws.push(<Screw key={`l${i}`} cx={x - ear / 2 + 1} cy={cy} />, <Screw key={`r${i}`} cx={x + INNER_W + ear / 2 - 1} cy={cy} />);
  }
  return (
    <>
      <rect x={x - ear} y={y + 1} width={ear + 2} height={h - 2} rx={2} fill="url(#rk-ear)" stroke="#00000066" />
      <rect x={x + INNER_W - 2} y={y + 1} width={ear + 2} height={h - 2} rx={2} fill="url(#rk-ear)" stroke="#00000066" />
      {screws}
    </>
  );
}

/** Rows of small vent slots (perforated steel). */
function Vents({ x, y, w, h, color = '#0b0c0f' }: { x: number; y: number; w: number; h: number; color?: string }) {
  const out: ReactNode[] = [];
  const cols = Math.max(1, Math.floor(w / 9)), rows = Math.max(1, Math.floor(h / 7));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push(<rect key={`${r}-${c}`} x={x + c * 9 + (r % 2 ? 4 : 0)} y={y + r * 7} width={5} height={3} rx={1.5} fill={color} />);
  }
  return <g opacity={0.9}>{out}</g>;
}

function Led({ cx, cy, color = '#22c55e' }: { cx: number; cy: number; color?: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={color} opacity={0.25} />
      <circle cx={cx} cy={cy} r={2} fill={color} />
    </g>
  );
}

/** A small RJ45 jack on a faceplate (lit green with a cable). */
function MiniJack({ cx, cy, lit }: { cx: number; cy: number; lit?: boolean }) {
  return (
    <g>
      <rect x={cx - 8} y={cy - 7} width={16} height={14} rx={1} fill="#c7cbd2" stroke={lit ? '#22c55e' : '#00000088'} strokeWidth={lit ? 2 : 0.8} />
      <path d={`M${cx - 6} ${cy - 4} H${cx + 6} V${cy + 5} H${cx + 2} V${cy + 3} H${cx - 2} V${cy + 5} H${cx - 6} Z`} fill="#16181c" />
      {lit && <rect x={cx + 3} y={cy - 6} width={3} height={2} fill="#22c55e" />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/*  Equipment                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where the network ports of equipment drawn without a front panel (servers, NAS, UPS, symbols) sit on its faceplate:
 * a row of jacks right of centre, in the top unit. The cords plug in there.
 */
function jackSpots(st: StencilDef | undefined, x: number, y: number): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const ports = (st?.ports ?? []).filter((p) => p.kind === 'rj45' || p.kind === 'link' || p.kind === 'console');
  ports.forEach((p, i) => out.set(p.id, [x + INNER_W - 150 + i * 22, y + U_H / 2]));
  return out;
}

/** The front of a device drawn without its own front-panel art: a realistic faceplate for its kind. */
function DeviceFace({ x, y, h, device, stencil, ports }: { x: number; y: number; h: number; device?: DeviceNode; stencil?: StencilDef; ports?: Record<string, PortState> }) {
  const w = INNER_W;
  const kind = stencil?.id ?? '';
  const name = device?.data.name ?? 'Device';
  const drives = kind === 'server' || kind === 'nas' || kind === 'san' || kind === 'nvr' || kind === 'tape-library';
  const parts: ReactNode[] = [<Face key="f" x={x} y={y} w={w} h={h} light={drives} />];
  const ink = drives ? '#1f2937' : '#e5e7eb';

  if (drives) {
    // Hot-swap drive bays with activity LEDs, a vent grille, and the power button.
    const rows = Math.max(1, Math.round(h / U_H));
    const perRow = 4, bw = 44, rowH = (h - 10) / rows, bh = Math.min(28, rowH - 4);
    for (let r = 0; r < rows; r++) for (let c = 0; c < perRow; c++) {
      const bx = x + 14 + c * (bw + 4), by = y + 5 + r * rowH + (rowH - bh) / 2;
      parts.push(
        <g key={`b${r}-${c}`}>
          <rect x={bx} y={by} width={bw} height={bh} rx={2} fill="#2b2f36" stroke="#111" />
          <rect x={bx + 3} y={by + 3} width={bw - 14} height={bh - 6} rx={1} fill="#3b4049" />
          <Led cx={bx + bw - 6} cy={by + 6} color={(r + c) % 3 === 0 ? '#60a5fa' : '#22c55e'} />
          <rect x={bx + bw - 8} y={by + bh - 9} width={4} height={5} rx={1} fill="#6b7280" />
        </g>,
      );
    }
    const vx = x + 14 + perRow * (bw + 4) + 6;
    parts.push(<Vents key="v" x={vx} y={y + 8} w={x + w - 172 - vx} h={h - 16} color="#6b7280" />);
    parts.push(<circle key="pwr" cx={x + w - 18} cy={y + h / 2} r={6} fill="#e5e7eb" stroke="#4b5563" />, <Led key="pl" cx={x + w - 18} cy={y + h / 2} color="#3b82f6" />);
  } else if (kind === 'ups') {
    // LCD status screen, control buttons, vents.
    parts.push(
      <g key="lcd" fontFamily="Consolas, monospace">
        <rect x={x + 18} y={y + 8} width={92} height={h - 16} rx={3} fill="#0a0a0a" />
        <rect x={x + 22} y={y + 12} width={84} height={h - 24} rx={2} fill="url(#rk-lcd)" />
        <text x={x + 28} y={y + 26} fontSize={9} fill="#7dd3fc">ONLINE</text>
        <text x={x + 28} y={y + 40} fontSize={9} fill="#7dd3fc">BAT 100%</text>
        {h > 60 && <text x={x + 28} y={y + 54} fontSize={9} fill="#7dd3fc">LOAD 32%</text>}
      </g>,
    );
    [0, 1, 2].forEach((i) => parts.push(<rect key={`btn${i}`} x={x + 122} y={y + 10 + i * ((h - 20) / 3)} width={18} height={(h - 20) / 3 - 4} rx={3} fill="#3f444d" stroke="#111" />));
    parts.push(<Vents key="v" x={x + 152} y={y + U_H} w={w - 200} h={h - U_H - 8} />);
    parts.push(<Led key="on" cx={x + w - 20} cy={y + 14} />, <Led key="bat" cx={x + w - 20} cy={y + 28} color="#facc15" />);
  } else {
    // Anything else (routers, appliances, symbols): a plain faceplate with a status LED and a badge of its symbol.
    if (stencil?.style === 'icon') {
      const size = Math.min(h - 10, 30);
      parts.push(<g key="i" transform={`translate(${x + 14},${y + (h - size) / 2})`}><rect width={size} height={size} rx={4} fill="#f4f4f5" /><IconArt id={stencil.id} size={size} /></g>);
    }
    parts.push(<Led key="s" cx={x + 58} cy={y + h / 2} />);
    parts.push(<Vents key="v" x={x + 74} y={y + 9} w={w - 260} h={h - 18} />);
  }
  // The name, engraved on the faceplate.
  parts.push(<text key="n" x={x + w - 34} y={y + h - 5} fontSize={8} fill={ink} opacity={0.75} textAnchor="end">{name.length > 26 ? `${name.slice(0, 25)}…` : name}</text>);
  for (const [id, [cx, cy]] of jackSpots(stencil, x, y)) parts.push(<MiniJack key={`j${id}`} cx={cx} cy={cy} lit={ports?.[id] === 'connected'} />);
  return <>{parts}</>;
}

/** A device's name for its back: a vendor's front-view shape is often named "… - Front"; that part is dropped. */
export const rearName = (name: string) => name.replace(/\s*[-–(]\s*front(\s*view)?\s*\)?\s*$/i, '') || name;

/** The back of any device: power supplies with fans and a handle, a row of fans, and its network ports. */
function DeviceRear({ x, y, h, device, stencil, ports }: { x: number; y: number; h: number; device?: DeviceNode; stencil?: StencilDef; ports?: Record<string, PortState> }) {
  const w = INNER_W;
  if (stencil?.id.startsWith('patch-panel-fiber')) {
    // A fiber panel's back: splice cassettes with the trunk's fibers coiled in, and the trunk cable gland.
    const parts: ReactNode[] = [<Face key="f" x={x} y={y} w={w} h={h} fill="#202227" />];
    for (let b = 0; b < 4; b++) {
      const bx = x + 34 + b * 96, cy = y + h / 2;
      parts.push(
        <g key={b}>
          <rect x={bx} y={cy - 10} width={84} height={20} rx={3} fill="#374151" stroke="#6b7280" />
          <ellipse cx={bx + 42} cy={cy} rx={30} ry={6} fill="none" stroke="#22d3ee" strokeWidth={1.2} opacity={0.8} />
          <ellipse cx={bx + 42} cy={cy} rx={24} ry={4} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={0.7} />
        </g>,
      );
    }
    parts.push(<circle key="gl" cx={x + w - 40} cy={y + h / 2} r={Math.min(9, h / 2 - 3)} fill="#111" stroke="#9ca3af" />);
    parts.push(<text key="n" x={x + w - 56} y={y + h - 4} fontSize={8} fill="#d1d5db" textAnchor="end">{device?.data.name ?? 'Fiber panel'} (rear)</text>);
    return <>{parts}</>;
  }
  if (stencil?.id.startsWith('patch')) {
    // A patch panel's back: punch-down (110) blocks, one per six ports, with the cable bundles tied off.
    const parts: ReactNode[] = [<Face key="f" x={x} y={y} w={w} h={h} fill="#202227" />];
    const rows = Math.max(1, Math.round(h / U_H));
    for (let r = 0; r < rows; r++) {
      const cy = y + r * U_H + U_H / 2;
      for (let b = 0; b < 4; b++) {
        const bx = x + 34 + b * 96;
        parts.push(
          <g key={`${r}-${b}`}>
            <rect x={bx} y={cy - 9} width={84} height={18} rx={2} fill="#e5e7eb" stroke="#6b7280" />
            {Array.from({ length: 6 }, (_, i) => <rect key={i} x={bx + 4 + i * 13.5} y={cy - 6} width={10} height={12} rx={1} fill={['#2563eb', '#f97316', '#16a34a', '#92400e'][i % 4]} opacity={0.85} />)}
          </g>,
        );
      }
      parts.push(<path key={`t${r}`} d={`M${x + 20} ${cy + 12} H${x + w - 20}`} stroke="#9ca3af" strokeWidth={4} strokeLinecap="round" opacity={0.5} />);
    }
    parts.push(<text key="n" x={x + w - 12} y={y + h - 4} fontSize={8} fill="#d1d5db" textAnchor="end">{device?.data.name ?? 'Patch panel'} (rear)</text>);
    return <>{parts}</>;
  }
  const fanR = Math.min(h / 2 - 5, 15);
  const parts: ReactNode[] = [<Face key="f" x={x} y={y} w={w} h={h} />];
  for (let i = 0; i < 2; i++) {
    const px = x + w - 112 + i * 54;
    parts.push(
      <g key={`psu${i}`}>
        <rect x={px} y={y + 5} width={48} height={h - 10} rx={2} fill="#17191d" stroke="#000" />
        <circle cx={px + 18} cy={y + h / 2} r={Math.min(h / 2 - 9, 11)} fill="#0b0c0f" stroke="#4b5563" />
        <path d={`M${px + 12} ${y + h / 2} H${px + 24} M${px + 18} ${y + h / 2 - 6} V${y + h / 2 + 6}`} stroke="#374151" strokeWidth={1.5} />
        <rect x={px + 34} y={y + h / 2 - 6} width={9} height={12} rx={1} fill="#111" stroke="#9ca3af" strokeWidth={0.8} />
        <Led cx={px + 40} cy={y + 10} />
      </g>,
    );
  }
  const fans = Math.max(1, Math.min(4, Math.floor((w - 300) / (fanR * 2 + 12))));
  for (let i = 0; i < fans; i++) {
    const cx = x + 30 + fanR + i * (fanR * 2 + 12), cy = y + h / 2;
    parts.push(
      <g key={`fan${i}`}>
        <circle cx={cx} cy={cy} r={fanR} fill="#0b0c0f" stroke="#4b5563" />
        <circle cx={cx} cy={cy} r={fanR * 0.6} fill="none" stroke="#374151" />
        <circle cx={cx} cy={cy} r={fanR * 0.25} fill="#374151" />
      </g>,
    );
  }
  // Ports on the back only for equipment without a front panel (servers, NAS, UPS); switches show theirs on the front.
  const jacks = stencil?.style === 'icon' ? stencil.ports.filter((p) => p.kind === 'rj45' || p.kind === 'sfp').slice(0, 6) : [];
  jacks.forEach((p, i) => parts.push(<MiniJack key={p.id} cx={x + w - 140 - (jacks.length - i) * 20} cy={y + h / 2} lit={ports?.[p.id] === 'connected'} />));
  parts.push(<text key="n" x={x + w - 120} y={y + h - 4} fontSize={8} fill="#d1d5db" textAnchor="end">{rearName(device?.data.name ?? 'Device')} (rear)</text>);
  return <>{parts}</>;
}

function ItemArt({ it, face, x, y, h, device, stencil, ports }: { it: RackItem; face: 'front' | 'rear'; x: number; y: number; h: number; device?: DeviceNode; stencil?: StencilDef; ports?: Record<string, PortState> }) {
  const w = INNER_W;
  const parts: ReactNode[] = [];

  if (it.kind === 'device') {
    if (face === 'rear') parts.push(<DeviceRear key="r" x={x} y={y} h={h} device={device} stencil={stencil} ports={ports} />);
    else if (!stencil || stencil.style === 'icon') parts.push(<DeviceFace key="d" x={x} y={y} h={h} device={device} stencil={stencil} ports={ports} />);
    else {
      parts.push(<Face key="p" x={x} y={y} w={w} h={h} fill="#1a1b1f" />);
      // The front-panel art in the slot: post to post for a full-width faceplate, else centred in proportion.
      const { x: ax, y: ay, w: aw, h: ah, stretch } = artBox(stencil, x, y, w, h);
      // A desktop unit mounted with its rack-mount kit: steel brackets from the unit out to the rails.
      if (!stretch && isSmallGear(stencil)) {
        for (const [bx, bw] of [[x, ax - x], [ax + aw, x + w - ax - aw]] as const) {
          if (bw < 4) continue;
          parts.push(
            <g key={`kit${bx}`}>
              <rect x={bx} y={y + 3} width={bw} height={h - 6} rx={1.5} fill="url(#rk-ear)" stroke="#00000055" />
              {Array.from({ length: Math.max(1, Math.floor(bw / 26)) }, (_, i) => <rect key={i} x={bx + 8 + i * 26} y={y + h / 2 - 3} width={14} height={6} rx={3} fill="#1f2228" opacity={0.7} />)}
            </g>,
          );
        }
      }
      parts.push(
        stencil.style === 'image'
          ? <image key="a" href={stencil.image} x={ax} y={ay} width={aw} height={ah} preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'} />
          : <g key="a" transform={`translate(${ax},${ay})`}><PanelArt stencil={stencil} portStates={ports ?? {}} width={aw} height={ah} /></g>,
      );
      // A light sheen across the top of the panel.
      parts.push(<rect key="sheen" x={ax} y={ay} width={aw} height={Math.min(6, ah * 0.08)} fill="#ffffff" opacity={0.08} pointerEvents="none" />);
    }
  } else if (it.kind === 'blank') {
    parts.push(<Face key="p" x={x} y={y} w={w} h={h} />);
    for (let r = 0; r < it.height; r++) {
      const cy = y + r * U_H + U_H / 2;
      for (let i = 0; i < 14; i++) parts.push(<rect key={`${r}-${i}`} x={x + 34 + i * 27} y={cy - 2.5} width={18} height={5} rx={2.5} fill="#0e0f12" stroke="#ffffff10" />);
    }
  } else if (it.kind === 'cable-manager') {
    // Brush-strip panel: a slot closed by bristles, with finger rings either side.
    parts.push(<Face key="p" x={x} y={y} w={w} h={h} fill="#151619" />);
    const sy = y + h / 2 - 7;
    parts.push(<rect key="slot" x={x + 70} y={sy} width={w - 140} height={14} rx={7} fill="#050506" />);
    const bristles: ReactNode[] = [];
    for (let i = 0; i < (w - 150) / 3; i++) bristles.push(<line key={i} x1={x + 75 + i * 3} x2={x + 76 + i * 3} y1={sy + 1} y2={sy + 13} stroke="#3f434a" strokeWidth={1} />);
    parts.push(<g key="br">{bristles}</g>);
    for (const rx of [x + 22, x + w - 48]) parts.push(<rect key={`r${rx}`} x={rx} y={y + 8} width={26} height={h - 16} rx={8} fill="none" stroke="#9ca3af" strokeWidth={3} />);
  } else if (it.kind === 'shelf') {
    parts.push(<rect key="tray" x={x} y={y + h - 10} width={w} height={7} fill="url(#rk-ear)" stroke="#00000066" />);
    parts.push(<rect key="lip" x={x} y={y + h - 16} width={w} height={6} fill="#6b7280" opacity={0.9} />);
    parts.push(<rect key="l" x={x} y={y + h - 22} width={5} height={18} fill="#9ca3af" />);
    parts.push(<rect key="r" x={x + w - 5} y={y + h - 22} width={5} height={18} fill="#9ca3af" />);
  } else if (it.kind === 'pdu') {
    // Outlet strip: C13 sockets, a current display and a breaker.
    parts.push(<Face key="p" x={x} y={y} w={w} h={h} fill="#141518" />);
    parts.push(<rect key="disp" x={x + 14} y={y + h / 2 - 9} width={38} height={18} rx={2} fill="#1c0606" stroke="#000" />);
    parts.push(<text key="amps" x={x + 33} y={y + h / 2 + 4} fontSize={10} fill="#f87171" textAnchor="middle" fontFamily="Consolas, monospace">4.2A</text>);
    for (let i = 0; i < 8; i++) {
      const ox = x + 70 + i * 40, oy = y + h / 2 - 9;
      parts.push(
        <g key={i}>
          <path d={`M${ox} ${oy + 3} L${ox + 3} ${oy} H${ox + 23} L${ox + 26} ${oy + 3} V${oy + 18} H${ox} Z`} fill="#26282d" stroke="#6b7280" />
          <rect x={ox + 7} y={oy + 6} width={2.5} height={6} fill="#0a0a0a" /><rect x={ox + 16.5} y={oy + 6} width={2.5} height={6} fill="#0a0a0a" />
          <rect x={ox + 11.5} y={oy + 12} width={3} height={3} fill="#0a0a0a" />
        </g>,
      );
    }
    parts.push(<rect key="brk" x={x + w - 48} y={y + 8} width={30} height={h - 16} rx={2} fill="#26282d" stroke="#6b7280" />, <rect key="brk2" x={x + w - 40} y={y + h / 2 - 5} width={14} height={10} rx={1} fill="#e5e7eb" />);
  } else {
    parts.push(<Face key="p" x={x} y={y} w={w} h={h} />);
    parts.push(<Vents key="v" x={x + 30} y={y + 9} w={w - 60} h={h - 18} />);
  }
  return <>{parts}</>;
}

/** Where a port sits on the rack's front (its centre), in the elevation's coordinates. */
function portPoint(rack: Rack, it: RackItem, st: StencilDef | undefined, port: string | undefined): [number, number] {
  const y = slotY(rack, it.u, it.height), h = it.height * U_H, w = INNER_W;
  if (it.shelf) {
    const b = shelfBox(it, st, RAIL, y);
    const s = shelfPort(st, b, port);
    return s ? [s.cx, s.cy] : [b.x + b.w / 2, b.y + b.h / 2];
  }
  if (!st || st.style === 'icon') return (port ? jackSpots(st, RAIL, y).get(port) : undefined) ?? [RAIL + w - 160, y + U_H / 2];
  const p = port ? st.ports.find((q) => q.id === port) : undefined;
  if (!p) return [RAIL + 24, y + h / 2];
  const a = artBox(st, RAIL, y, w, h);
  return [a.x + (p.x + p.w / 2) * a.kx, a.y + (p.y + p.h / 2) * a.ky];
}

/**
 * Patch cords hang between the two ports, sagging more the further apart they are. Long runs (more than a few units
 * apart) are dressed like a real rack: down from the port, across to the nearer side post, along it (a vertical
 * cable manager), then back in to the other port. `lane` spreads such cords so they don't overlap.
 */
function cordPath([ax, ay]: [number, number], [bx, by]: [number, number], lane = 0) {
  // Only a cord between neighbouring units hangs straight across; any longer one would cover the equipment between.
  if (Math.abs(by - ay) <= U_H * 1.5) {
    const sag = 14 + Math.abs(bx - ax) * 0.06 + Math.abs(by - ay) * 0.15;
    return `M${ax} ${ay} C${ax} ${ay + sag} ${bx} ${by + sag} ${bx} ${by}`;
  }
  const left = (ax + bx) / 2 < RAIL + INNER_W / 2;
  const sx = left ? RAIL + 6 + (lane % 5) * 4 : RAIL + INNER_W - 6 - (lane % 5) * 4;
  const [t, b2] = ay < by ? [[ax, ay], [bx, by]] : [[bx, by], [ax, ay]];
  const r = 10;
  const dir = left ? -1 : 1;
  const y1 = t[1] + 14, y2 = b2[1] + 14;
  return `M${t[0]} ${t[1]} Q${t[0]} ${y1} ${t[0] + dir * r} ${y1} H${sx - dir * r} Q${sx} ${y1} ${sx} ${y1 + r} V${y2 - r} Q${sx} ${y2} ${sx - dir * r} ${y2} H${b2[0] - dir * r} Q${b2[0]} ${y2} ${b2[0]} ${b2[1]}`;
}

/** The RJ45 plug's boot where a cord meets its port. */
function Plug({ x, y, color, w }: { x: number; y: number; color: string; w: number }) {
  const bw = Math.max(6, w * 1.9);
  return (
    <g>
      <rect x={x - bw / 2} y={y - 3} width={bw} height={9} rx={1.5} fill={color} stroke="#0b0c0f" strokeWidth={0.8} />
      <rect x={x - bw / 2 + 1} y={y - 2} width={bw - 2} height={2} fill="#ffffff" opacity={0.35} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/*  The elevation                                                      */
/* ------------------------------------------------------------------ */

export function RackElevation({ rack, face, devices, stencil, selectedId, preview, hiddenId, onItemPointerDown, svgRef, width, portStates, cables, hotCable, onPortHover }: Props) {
  const size = rackSize(rack);
  const x0 = RAIL;
  const frameR = RAIL * 2 + INNER_W;
  const labelX = frameR + LEADER + 6;
  const bodyBottom = TOP + rack.units * U_H;

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
      <Defs />
      <text x={RAIL + INNER_W / 2} y={16} fontSize={14} fontWeight={700} textAnchor="middle" fill="#111827">
        {rack.name} — {face === 'front' ? 'FRONT' : 'REAR'} ({rack.units}U)
      </text>

      {/* Cabinet: top cap with vents, steel side posts, dark interior, plinth with levelling feet. */}
      <g filter="url(#rk-shadow)">
        <rect x={-2} y={TOP - 20} width={frameR + 4} height={16} rx={4} fill="url(#rk-cap)" />
        <rect x={0} y={TOP - 6} width={frameR} height={rack.units * U_H + 12} rx={3} fill="#1b1d22" />
        <rect x={-2} y={bodyBottom + 6} width={frameR + 4} height={18} rx={4} fill="url(#rk-cap)" />
      </g>
      <Vents x={frameR * 0.22} y={TOP - 15} w={frameR * 0.56} h={7} color="#111318" />
      <rect x={0} y={TOP - 6} width={RAIL} height={rack.units * U_H + 12} fill="url(#rk-post)" />
      <rect x={frameR - RAIL} y={TOP - 6} width={RAIL} height={rack.units * U_H + 12} fill="url(#rk-post)" />
      <rect x={x0} y={TOP} width={INNER_W} height={rack.units * U_H} fill="url(#rk-cavity)" />
      {[12, frameR - 52].map((fx) => (
        <g key={fx}>
          <rect x={fx} y={bodyBottom + 24} width={40} height={6} rx={1} fill="#111318" />
          <rect x={fx + 12} y={bodyBottom + 30} width={16} height={8} rx={2} fill="#0b0c0f" />
        </g>
      ))}
      {/* Rails with square cage-nut holes, and unit numbers on the posts. */}
      <rect x={x0 - 12} y={TOP} width={10} height={rack.units * U_H} fill="url(#rk-rail)" />
      <rect x={x0 + INNER_W + 2} y={TOP} width={10} height={rack.units * U_H} fill="url(#rk-rail)" />
      {Array.from({ length: rack.units }, (_, i) => {
        const u = rack.units - i;
        const y = TOP + i * U_H;
        return (
          <g key={u}>
            <line x1={x0} x2={x0 + INNER_W} y1={y} y2={y} stroke="#ffffff" opacity={0.05} />
            <line x1={x0 - 12} x2={x0 - 2} y1={y} y2={y} stroke="#6b7280" opacity={0.8} />
            <line x1={x0 + INNER_W + 2} x2={x0 + INNER_W + 12} y1={y} y2={y} stroke="#6b7280" opacity={0.8} />
            <text x={RAIL / 2 - 6} y={y + U_H / 2 + 4} fontSize={10} textAnchor="middle" fill="#cbd5e1" fontWeight={600}>{u}</text>
            <text x={frameR - RAIL / 2 + 6} y={y + U_H / 2 + 4} fontSize={10} textAnchor="middle" fill="#cbd5e1" fontWeight={600}>{u}</text>
            {[8, 20, 32].map((dy) => (
              <g key={dy}>
                <rect x={x0 - 9} y={y + dy - 2} width={4} height={4} fill="#1f2228" />
                <rect x={x0 + INNER_W + 5} y={y + dy - 2} width={4} height={4} fill="#1f2228" />
              </g>
            ))}
          </g>
        );
      })}

      {rack.items.filter((it) => onFace(it, face) && it.id !== hiddenId).sort((a, b) => (a.shelf ? 1 : 0) - (b.shelf ? 1 : 0)).map((it) => {
        const y = slotY(rack, it.u, it.height);
        const h = it.height * U_H;
        const device = it.nodeId ? devices.get(it.nodeId) : undefined;
        const st = device ? stencil(device.data.stencilId) : undefined;
        if (it.shelf) {
          // A small device on a shelf: drawn on the tray; the shelf's label names what stands on it.
          const b = shelfBox(it, st, x0, y);
          const bx = face === 'rear' ? x0 + INNER_W - (b.x - x0) - b.w : b.x;
          return (
            <g key={it.id} onPointerDown={onItemPointerDown ? (e) => onItemPointerDown(it, e) : undefined} style={onItemPointerDown ? { cursor: 'grab' } : undefined}>
              <title>{device?.data.name ?? 'Missing device'}</title>
              <ShelfDevice it={it} face={face} x0={x0} y={y} device={device} stencil={st} ports={device ? portStates?.get(device.id) : undefined} />
              {selectedId === it.id && <rect x={bx - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} fill="none" stroke="#3b82f6" strokeWidth={3} rx={3} />}
            </g>
          );
        }
        const onShelfNames = it.kind === 'shelf' ? rack.items.filter((x) => x.shelf?.id === it.id).map((x) => devices.get(x.nodeId ?? '')?.data.name).filter(Boolean) : [];
        const name = it.kind === 'device' ? device?.data.name ?? 'Missing device' : onShelfNames.length ? `${it.label ?? 'Shelf'}: ${onShelfNames.join(', ')}` : it.label ?? it.kind;
        const extra = it.kind === 'device' ? [device?.data.model, device?.data.ip].filter(Boolean).join(' · ') : '';
        const ghost = it.depth !== 'full' && it.depth !== face;
        return (
          <g
            key={it.id}
            onPointerDown={onItemPointerDown ? (e) => onItemPointerDown(it, e) : undefined}
            style={onItemPointerDown ? { cursor: 'grab' } : undefined}
            opacity={ghost ? 0.4 : 1}
          >
            {it.kind !== 'shelf' && <Ears x={x0} y={y} h={h} units={it.height} />}
            <ItemArt it={it} face={face} x={x0} y={y} h={h} device={device} stencil={st} ports={device ? portStates?.get(device.id) : undefined} />
            <line x1={frameR + 2} x2={labelX - 4} y1={y + h / 2} y2={y + h / 2} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 2" />
            <circle cx={labelX - 4} cy={y + h / 2} r={2} fill="#9ca3af" />
            {selectedId === it.id && <rect x={x0 - 16} y={y - 1} width={INNER_W + 32} height={h + 2} fill="none" stroke="#3b82f6" strokeWidth={3} rx={3} />}
            <text x={labelX} y={y + h / 2 - (extra ? 2 : -4)} fontSize={12} fill="#111827">
              <tspan fontWeight={600}>{rackLabel(it)}</tspan> {name}
            </text>
            {extra && <text x={labelX} y={y + h / 2 + 12} fontSize={10} fill="#6b7280">{extra}</text>}
          </g>
        );
      })}

      {face === 'front' && cables && cables.length > 0 && (() => {
        // Patch cords on the front: between two ports in this rack, or a short lead from a port whose cable leaves it.
        const itemOf = new Map(rack.items.filter((it) => it.nodeId && it.id !== hiddenId && onFace(it, 'front')).map((it) => [it.nodeId!, it]));
        const at = (nodeId: string, port?: string) => {
          const it = itemOf.get(nodeId);
          if (!it) return null;
          const d = devices.get(nodeId);
          return portPoint(rack, it, d ? stencil(d.data.stencilId) : undefined, port);
        };
        return (
          <g pointerEvents="none">
            {cables.map((c, ci) => {
              const a = at(c.a.nodeId, c.a.port);
              if (!a) return null;
              const b = c.inside ? at(c.b.nodeId, c.b.port) : null;
              const hot = hotCable === c.id;
              const w = Math.max(2.5, Math.min(4, c.width)) + (hot ? 2 : 0);
              const d = b ? cordPath(a, b, ci) : `M${a[0]} ${a[1]} q 0 18 ${a[0] < RAIL + INNER_W / 2 ? -16 : 16} 26`;
              return (
                <g key={c.id} opacity={hotCable && !hot ? 0.3 : 1}>
                  <path d={d} fill="none" stroke="#000" strokeWidth={w + 2.5} strokeLinecap="round" opacity={0.55} />
                  <path d={d} fill="none" stroke={c.color} strokeWidth={w} strokeLinecap="round" strokeDasharray={b ? undefined : '5 3'} />
                  {b && <path d={d} fill="none" stroke="#ffffff" strokeWidth={w * 0.3} strokeLinecap="round" opacity={0.35} transform="translate(-0.6,-0.6)" />}
                  {[a, b].filter(Boolean).map((p, i) => <Plug key={i} x={p![0]} y={p![1]} color={c.color} w={w} />)}
                </g>
              );
            })}
          </g>
        );
      })()}

      {face === 'front' && (() => {
        // Ports marked down / disabled in their notes, and (in the rack view) a hover area on every port.
        const out: ReactNode[] = [];
        for (const it of rack.items) {
          if (it.kind !== 'device' || !it.nodeId || it.id === hiddenId) continue;
          const d = devices.get(it.nodeId);
          if (!d) continue;
          const st = stencil(d.data.stencilId);
          const ids = !st || st.style === 'icon' ? [...jackSpots(st, RAIL, 0).keys()] : st.ports.map((q) => q.id);
          for (const pid of ids) {
            const b = portBox(rack, it, st, pid);
            if (!b) continue;
            const status = d.data.ports?.[pid]?.status;
            if (status === 'down' || status === 'disabled') {
              const c = status === 'down' ? '#ef4444' : '#9ca3af';
              out.push(
                <g key={`s${it.id}${pid}`} pointerEvents="none">
                  <rect x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} fill="none" stroke={c} strokeWidth={1.6} rx={1.5} />
                  {status === 'disabled' && <path d={`M${b.x + 2} ${b.y + b.h - 2} L${b.x + b.w - 2} ${b.y + 2}`} stroke={c} strokeWidth={1.4} />}
                </g>,
              );
            }
            if (onPortHover) {
              out.push(
                <rect
                  key={`h${it.id}${pid}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="#ffffff" fillOpacity={0} style={{ cursor: 'help' }}
                  onPointerEnter={(e) => onPortHover({ nodeId: d.id, port: pid, x: e.clientX, y: e.clientY })}
                  onPointerLeave={() => onPortHover(null)}
                  onPointerDown={onItemPointerDown ? (e) => { onPortHover(null); onItemPointerDown(it, e); } : undefined}
                />,
              );
            }
          }
        }
        return <g>{out}</g>;
      })()}

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
