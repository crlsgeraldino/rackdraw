import type { ReactNode } from 'react';
import type { PortDef, StencilDef } from './types';

/* ------------------------------------------------------------------ */
/*  Stencil catalog                                                    */
/*  Panel stencils are drawn in native units; ports are listed with    */
/*  their native geometry so each one becomes a connection point.     */
/* ------------------------------------------------------------------ */

function rj(id: string, label: string, x: number, y: number, side: 'top' | 'bottom', extra: Partial<PortDef> = {}): PortDef {
  return { id, label, kind: 'rj45', x, y, w: 60, h: 54, side, flip: side === 'bottom', ...extra };
}

const sonicwallTz: StencilDef = {
  id: 'sonicwall-tz570-670',
  name: 'SonicWall TZ570 / TZ670',
  vendor: 'SonicWall',
  category: 'Firewalls',
  width: 1048,
  height: 172,
  scale: 0.5,
  style: 'panel',
  rackUnits: 1,
  defaults: { model: 'TZ570 / TZ670' },
  ports: [
    { id: 'CONSOLE', label: 'Console', kind: 'console', x: 304, y: 76, w: 68, h: 60, side: 'top' },
    { id: 'X8', label: 'X8', kind: 'sfp', x: 390, y: 18, w: 66, h: 58, side: 'top' },
    { id: 'X9', label: 'X9', kind: 'sfp', x: 390, y: 80, w: 66, h: 58, side: 'bottom' },
    rj('X6', 'X6', 483, 22, 'top'),
    rj('X4', 'X4', 552, 22, 'top'),
    rj('X2', 'X2', 621, 22, 'top', { role: 'WAN' }),
    rj('X0', 'X0', 690, 22, 'top', { role: 'LAN' }),
    rj('X7', 'X7', 483, 80, 'bottom'),
    rj('X5', 'X5', 552, 80, 'bottom'),
    rj('X3', 'X3', 621, 80, 'bottom'),
    rj('X1', 'X1', 690, 80, 'bottom', { role: 'WAN' }),
    { id: 'PSU2', label: 'PSU 2', kind: 'power', x: 803, y: 50, w: 34, h: 92, side: 'bottom' },
    { id: 'PSU1', label: 'PSU 1', kind: 'power', x: 862, y: 50, w: 34, h: 92, side: 'bottom' },
  ],
};

function switchStencil(id: string, name: string, copper: number, sfp: number, poe: boolean): StencilDef {
  const ports: PortDef[] = [];
  const cols = copper / 2;
  const startX = 150;
  const pitch = 42;
  const groupGap = 16;
  let lastX = startX;
  for (let c = 0; c < cols; c++) {
    const x = startX + c * pitch + Math.floor(c / 6) * groupGap;
    lastX = x;
    ports.push({ id: `P${c * 2 + 1}`, label: `${c * 2 + 1}`, kind: 'rj45', x, y: 14, w: 38, h: 34, side: 'top' });
    ports.push({ id: `P${c * 2 + 2}`, label: `${c * 2 + 2}`, kind: 'rj45', x, y: 52, w: 38, h: 34, side: 'bottom', flip: true });
  }
  const sfpStart = lastX + 70;
  for (let s = 0; s < sfp; s++) {
    const col = Math.floor(s / 2);
    const top = s % 2 === 0;
    ports.push({
      id: `SFP${s + 1}`, label: `SFP ${s + 1}`, kind: 'sfp',
      x: sfpStart + col * 52, y: top ? 14 : 52, w: 46, h: 34, side: top ? 'top' : 'bottom',
    });
  }
  const width = sfpStart + Math.ceil(sfp / 2) * 52 + 60;
  ports.push({ id: 'CONSOLE', label: 'Console', kind: 'console', x: 40, y: 30, w: 44, h: 40, side: 'top' });
  return {
    id, name, category: 'Switching', width, height: 100, scale: 0.5, style: 'panel', ports, rackUnits: 1,
    defaults: { model: `${copper}-port${poe ? ' PoE+' : ''} managed switch` },
  };
}

function patchPanel(count: number): StencilDef {
  const ports: PortDef[] = [];
  for (let i = 0; i < count; i++) {
    const x = 90 + i * 36 + Math.floor(i / 6) * 14;
    ports.push({ id: `PP${i + 1}`, label: `${i + 1}`, kind: 'rj45', x, y: 34, w: 30, h: 28, side: 'bottom' });
  }
  return {
    id: `patch-panel-${count}`, name: `Patch panel ${count}-port`, category: 'Switching',
    width: 90 + count * 36 + Math.floor(count / 6) * 14 + 60, height: 90, scale: 0.5, style: 'panel', ports, rackUnits: 1,
  };
}

function icon(id: string, name: string, category: StencilDef['category'], ports: { id: string; label: string; side: PortDef['side']; kind?: PortDef['kind'] }[], defaults?: StencilDef['defaults'], rackUnits?: number): StencilDef {
  const size = 64;
  const pos: Record<PortDef['side'], [number, number]> = { top: [size / 2, 0], bottom: [size / 2, size], left: [0, size / 2], right: [size, size / 2] };
  return {
    id, name, category, width: size, height: size, scale: 1, style: 'icon', defaults, rackUnits,
    ports: ports.map((p) => {
      const [cx, cy] = pos[p.side];
      return { id: p.id, label: p.label, kind: p.kind ?? 'link', x: cx - 5, y: cy - 5, w: 10, h: 10, side: p.side };
    }),
  };
}

export const STENCILS: StencilDef[] = [
  sonicwallTz,
  switchStencil('switch-24-poe', 'Switch 24-port PoE + 4 SFP', 24, 4, true),
  switchStencil('switch-48', 'Switch 48-port + 4 SFP', 48, 4, false),
  switchStencil('switch-8', 'Switch 8-port + 2 SFP', 8, 2, false),
  patchPanel(24),
  icon('internet', 'Internet / ISP', 'WAN', [{ id: 'WAN', label: 'WAN', side: 'bottom' }]),
  icon('modem', 'ISP modem / ONT', 'WAN', [{ id: 'UPLINK', label: 'Uplink', side: 'top' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }]),
  icon('access-point', 'Wireless access point', 'Wireless', [{ id: 'ETH', label: 'PoE uplink', side: 'top', kind: 'rj45' }, { id: 'WIFI', label: 'Wireless', side: 'bottom' }]),
  icon('server', 'Server', 'Servers', [{ id: 'NIC1', label: 'NIC 1', side: 'top', kind: 'rj45' }, { id: 'MGMT', label: 'iDRAC / iLO', side: 'left', kind: 'rj45' }, { id: 'NIC2', label: 'NIC 2', side: 'right', kind: 'rj45' }], undefined, 2),
  icon('nas', 'NAS', 'Servers', [{ id: 'NIC1', label: 'NIC 1', side: 'top', kind: 'rj45' }], undefined, 1),
  icon('workstation', 'Workstation', 'Endpoints', [{ id: 'NIC', label: 'NIC', side: 'top', kind: 'rj45' }]),
  icon('laptop', 'Laptop', 'Endpoints', [{ id: 'NIC', label: 'NIC / Wi-Fi', side: 'top' }]),
  icon('printer', 'Printer / MFP', 'Endpoints', [{ id: 'NIC', label: 'NIC', side: 'top', kind: 'rj45' }]),
  icon('phone', 'VoIP phone', 'Endpoints', [{ id: 'LAN', label: 'LAN', side: 'top', kind: 'rj45' }, { id: 'PC', label: 'PC passthrough', side: 'bottom', kind: 'rj45' }]),
  icon('camera', 'IP camera', 'Endpoints', [{ id: 'ETH', label: 'PoE', side: 'top', kind: 'rj45' }]),
  icon('ups', 'UPS', 'Servers', [{ id: 'NMC', label: 'Network card', side: 'top', kind: 'rj45' }, { id: 'USB', label: 'USB', side: 'right', kind: 'usb' }], undefined, 2),
];

export const STENCIL_MAP: Record<string, StencilDef> = Object.fromEntries(STENCILS.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/*  Artwork                                                            */
/* ------------------------------------------------------------------ */

export type PortState = 'idle' | 'connected' | 'selected';

const PORT_STROKE: Record<PortState, string | undefined> = {
  idle: undefined,
  connected: '#22c55e',
  selected: '#3b82f6',
};

export function PortArt({ port, state }: { port: PortDef; state: PortState }) {
  const { x, y, w, h } = port;
  const stroke = PORT_STROKE[state];
  const ring = stroke ? <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="none" stroke={stroke} strokeWidth={4} rx={3} /> : null;

  if (port.kind === 'rj45' || port.kind === 'console') {
    const m = Math.max(4, w * 0.1);
    const notchW = w * 0.34;
    const notchH = h * 0.1;
    const top = y + h * 0.12;
    const bottom = y + h * 0.82;
    const nx = x + (w - notchW) / 2;
    const d = port.flip
      ? `M${x + m} ${top} H${x + w - m} V${bottom} H${nx + notchW} V${bottom + notchH} H${nx} V${bottom} H${x + m} Z`
      : `M${x + m} ${top + notchH} H${nx} V${top} H${nx + notchW} V${top + notchH} H${x + w - m} V${bottom} H${x + m} Z`;
    const pinY = port.flip ? top + 3 : bottom - 5;
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={port.kind === 'console' ? '#d4d4d4' : '#bfbfbf'} />
        <path d={d} fill="#161616" />
        <rect x={x + m * 2} y={pinY} width={w - m * 4} height={2} fill="#a38b3c" />
        {state === 'connected' && <rect x={x + w - m - 6} y={port.flip ? y + h - 7 : y + 2} width={6} height={4} fill="#22c55e" />}
        {ring}
      </g>
    );
  }
  if (port.kind === 'sfp') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="#c9c9c9" />
        <rect x={x + w * 0.09} y={y + h * 0.14} width={w * 0.82} height={h * 0.72} fill="#151515" />
        <rect x={x + w * 0.3} y={y + h * 0.05} width={w * 0.4} height={h * 0.07} rx={1} fill="#8f8f8f" />
        {state === 'connected' && <rect x={x + w * 0.2} y={y + h * 0.3} width={w * 0.6} height={h * 0.4} fill="#3a3a3a" stroke="#ea580c" strokeWidth={2} />}
        {ring}
      </g>
    );
  }
  if (port.kind === 'power') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={2} fill="#141414" stroke="#5a5a5a" />
        <rect x={x + 6} y={y + 22} width={w - 12} height={48} fill="#202020" stroke="#6a6a6a" />
        <circle cx={x + w / 2} cy={y + 36} r={3} fill="#cfcfcf" />
        <circle cx={x + w / 2} cy={y + 56} r={3} fill="#cfcfcf" />
        {ring}
      </g>
    );
  }
  return null;
}

function SonicWallDecor() {
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      <path d="M300 64 H294 V156 H300" fill="none" stroke="#bdbdbd" strokeWidth={1.5} />
      <text x={338} y={58} fontSize={9} fill="#e0e0e0" textAnchor="middle">CONSOLE</text>
      <rect x={320} y={143} width={36} height={10} rx={5} fill="#111" stroke="#8c8c8c" />
      <rect x={478} y={18} width={278} height={120} fill="#d0d0d0" />
      <g fontSize={9} fill="#e0e0e0" textAnchor="middle">
        <text x={423} y={151}>X8</text><text x={423} y={161}>X9</text>
        <text x={513} y={151}>X6</text><text x={513} y={161}>X7</text>
        <text x={582} y={151}>X4</text><text x={582} y={161}>X5</text>
        <text x={651} y={151}>X2/WAN</text><text x={651} y={161}>X3</text>
        <text x={720} y={151}>X0/LAN</text><text x={720} y={161}>X1/WAN</text>
        <text x={820} y={42}>⏻2</text><text x={879} y={42}>⏻1</text>
        <text x={820} y={155} fontSize={8}>12V ⎓</text><text x={879} y={155} fontSize={8}>12V ⎓</text>
      </g>
      <g fontSize={7} fill="#bdbdbd">
        <text x={760} y={150}>• TOP</text>
        <text x={760} y={160}>• BOTTOM</text>
      </g>
      <circle cx={920} cy={120} r={3} fill="#0d0d0d" stroke="#555" />
      <circle cx={970} cy={142} r={11} fill="#3a3a3a" stroke="#777" />
      <path d="M963 142 H977 M970 135 V149" stroke="#999" strokeWidth={2} />
      <circle cx={995} cy={142} r={7} fill="none" stroke="#cfcfcf" strokeWidth={1.2} />
      <path d="M995 137 V142 M991 142 H999 M992.5 144.5 H997.5 M994 147 H996" stroke="#cfcfcf" strokeWidth={1.1} />
      <text x={40} y={100} fontSize={22} fill="#8d8d90" fontWeight={700} letterSpacing={3}>TZ</text>
    </g>
  );
}

function SwitchDecor({ s }: { s: StencilDef }) {
  const leds = s.ports.filter((p) => p.kind === 'rj45' && p.side === 'top').length;
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      <circle cx={110} cy={30} r={4} fill="#22c55e" />
      <text x={110} y={48} fontSize={8} fill="#cfcfcf" textAnchor="middle">PWR</text>
      <text x={40} y={90} fontSize={9} fill="#cfcfcf">CONSOLE</text>
      <text x={s.width - 20} y={92} fontSize={9} fill="#9a9a9a" textAnchor="end">{leds * 2 > 0 ? `${leds * 2}P` : ''}</text>
      {s.ports.filter((p) => p.kind === 'rj45').map((p) => (
        <text key={p.id} x={p.x + p.w / 2} y={p.side === 'top' ? p.y - 2 : p.y + p.h + 9} fontSize={7} fill="#cfcfcf" textAnchor="middle">{p.label}</text>
      ))}
    </g>
  );
}

function PatchDecor({ s }: { s: StencilDef }) {
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      <rect x={70} y={10} width={s.width - 120} height={18} fill="#f5f5f5" />
      {s.ports.map((p) => (
        <text key={p.id} x={p.x + p.w / 2} y={24} fontSize={9} fill="#333" textAnchor="middle">{p.label}</text>
      ))}
      <circle cx={30} cy={45} r={7} fill="#111" stroke="#666" />
      <circle cx={s.width - 30} cy={45} r={7} fill="#111" stroke="#666" />
    </g>
  );
}

/** Front-panel artwork. `width`/`height` override the diagram size (the rack view draws it to fit a slot). */
export function PanelArt({ stencil, portStates, width, height }: { stencil: StencilDef; portStates: Record<string, PortState>; width?: number; height?: number }) {
  const decor: ReactNode =
    stencil.id === sonicwallTz.id ? <SonicWallDecor /> :
    stencil.id.startsWith('patch') ? <PatchDecor s={stencil} /> :
    <SwitchDecor s={stencil} />;
  const chassis = stencil.id.startsWith('patch') ? '#3b3b3e' : '#2a2a2c';
  return (
    <svg viewBox={`0 0 ${stencil.width} ${stencil.height}`} width={width ?? stencil.width * stencil.scale} height={height ?? stencil.height * stencil.scale} style={{ display: 'block' }}>
      <rect x={0} y={0} width={stencil.width} height={stencil.height} rx={3} fill={chassis} />
      <rect x={0} y={0} width={stencil.width} height={6} rx={2} fill="#4a4a4d" />
      <rect x={0} y={stencil.height - 6} width={stencil.width} height={6} rx={2} fill="#1c1c1e" />
      {decor}
      {stencil.ports.map((p) => <PortArt key={p.id} port={p} state={portStates[p.id] ?? 'idle'} />)}
    </svg>
  );
}

/** Simple line-art symbols, 64×64. */
export function IconArt({ id, size = 64 }: { id: string; size?: number }) {
  const s = { fill: 'none', stroke: '#1f2937', strokeWidth: 2.5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const accent = '#2563eb';
  let body: ReactNode;
  switch (id) {
    case 'internet':
      body = <path {...s} fill="#dbeafe" stroke={accent} d="M18 46 a12 12 0 0 1 0-24 a16 16 0 0 1 30-4 a12 12 0 0 1 2 28 Z" />;
      break;
    case 'modem':
      body = (<g {...s}><rect x={10} y={26} width={44} height={20} rx={4} fill="#f3f4f6" /><circle cx={20} cy={36} r={2} fill="#22c55e" stroke="none" /><circle cx={28} cy={36} r={2} fill="#22c55e" stroke="none" /><path d="M42 26 V14 M48 26 V18" /></g>);
      break;
    case 'access-point':
      body = (<g {...s}><ellipse cx={32} cy={36} rx={22} ry={9} fill="#f3f4f6" /><circle cx={32} cy={36} r={2.5} fill={accent} stroke="none" /><path stroke={accent} d="M22 20 a14 14 0 0 1 20 0 M26 25 a8 8 0 0 1 12 0" /></g>);
      break;
    case 'server':
      body = (<g {...s}><rect x={14} y={10} width={36} height={14} rx={2} fill="#f3f4f6" /><rect x={14} y={25} width={36} height={14} rx={2} fill="#f3f4f6" /><rect x={14} y={40} width={36} height={14} rx={2} fill="#f3f4f6" /><path d="M20 17 H32 M20 32 H32 M20 47 H32" /><circle cx={44} cy={17} r={1.5} fill="#22c55e" stroke="none" /><circle cx={44} cy={32} r={1.5} fill="#22c55e" stroke="none" /><circle cx={44} cy={47} r={1.5} fill="#22c55e" stroke="none" /></g>);
      break;
    case 'nas':
      body = (<g {...s}><rect x={16} y={10} width={32} height={44} rx={3} fill="#f3f4f6" /><path d="M22 20 H42 M22 28 H42 M22 36 H42 M22 44 H42" /></g>);
      break;
    case 'workstation':
      body = (<g {...s}><rect x={10} y={12} width={44} height={30} rx={2} fill="#f3f4f6" /><path d="M26 42 V50 M38 42 V50 M20 52 H44" /></g>);
      break;
    case 'laptop':
      body = (<g {...s}><rect x={14} y={16} width={36} height={24} rx={2} fill="#f3f4f6" /><path d="M8 46 H56 L52 40 H12 Z" fill="#e5e7eb" /></g>);
      break;
    case 'printer':
      body = (<g {...s}><rect x={20} y={10} width={24} height={14} fill="#fff" /><rect x={10} y={24} width={44} height={20} rx={3} fill="#f3f4f6" /><rect x={20} y={38} width={24} height={16} fill="#fff" /></g>);
      break;
    case 'phone':
      body = (<g {...s}><rect x={14} y={22} width={36} height={28} rx={3} fill="#f3f4f6" /><path d="M10 22 q22 -14 44 0 l-4 6 q-18 -8 -36 0 Z" fill="#e5e7eb" /><path d="M22 34 H42 M22 41 H42" /></g>);
      break;
    case 'camera':
      body = (<g {...s}><rect x={10} y={22} width={34} height={18} rx={4} fill="#f3f4f6" /><path d="M44 27 L54 22 V40 L44 35" fill="#e5e7eb" /><path d="M20 40 V50 M14 50 H28" /><circle cx={18} cy={31} r={3} fill={accent} stroke="none" /></g>);
      break;
    case 'ups':
      body = (<g {...s}><rect x={16} y={10} width={32} height={44} rx={3} fill="#f3f4f6" /><path stroke={accent} d="M34 18 L26 32 H34 L30 46" /></g>);
      break;
    default:
      body = <rect {...s} x={12} y={12} width={40} height={40} rx={4} fill="#f3f4f6" />;
  }
  return <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: 'block' }}>{body}</svg>;
}

/** Small thumbnail for the stencil palette. */
export function StencilThumb({ stencil }: { stencil: StencilDef }) {
  if (stencil.style === 'icon') return <IconArt id={stencil.id} size={40} />;
  if (stencil.style === 'image') {
    const w = Math.min(120, stencil.width * stencil.scale);
    // eslint-disable-next-line @next/next/no-img-element -- user artwork as a data URL
    return <img src={stencil.image} alt="" width={w} height={(w * stencil.height) / stencil.width} draggable={false} style={{ display: 'block' }} />;
  }
  return (
    <svg viewBox={`0 0 ${stencil.width} ${stencil.height}`} width={120} height={(120 * stencil.height) / stencil.width} style={{ display: 'block' }}>
      <rect width={stencil.width} height={stencil.height} rx={3} fill={stencil.id.startsWith('patch') ? '#3b3b3e' : '#2a2a2c'} />
      {stencil.ports.map((p) => <PortArt key={p.id} port={p} state="idle" />)}
    </svg>
  );
}
