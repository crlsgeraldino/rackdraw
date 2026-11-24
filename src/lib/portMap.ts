import { allDevices } from './project';
import { rackLabel } from './rack';
import { pathLength, tracePath, type TraceHop } from './trace';
import type { DeviceNode, PortDef, PortStatus, Project, StencilDef } from './types';

/*
 * Port map: one sheet per switch, patch panel, firewall or router, the way MSPs hand them over. Every port in the
 * device's own layout, what it reaches (through patch panels, to the real equipment at the far end), and its VLAN,
 * speed, PoE, status and cable label.
 */

type Stencils = (id: string) => StencilDef | undefined;

/** Ports that carry network traffic (not power, not the generic "link" point of an icon). */
const NETWORK_KINDS = new Set(['rj45', 'sfp']);
const MAPPED_KINDS = new Set(['rj45', 'sfp', 'console', 'usb']);

export interface PortMapRow {
  id: string;
  label: string;
  kind: PortDef['kind'];
  cabled: boolean;
  /** Where the port leads in the end ("Front desk PC", "Core switch 14"); both ends for a patch panel port. */
  to: string;
  /** Patch panels / jacks on the way ("Patch panel A 7"). */
  via: string;
  /** What the port notes say is plugged in (used when there is no cable on the drawing). */
  note: string;
  ip: string;
  vlan: string;
  vlanColor?: string;
  speed: string;
  poe: string;
  status?: PortStatus;
  uplink: boolean;
  cable: string;
  cableLabel: string;
  length: string;
  notes: string;
}

export interface PortMap {
  nodeId: string;
  name: string;
  model: string;
  /** "Rack A U31", or the device's location. */
  where: string;
  stencil?: StencilDef;
  passThrough: boolean;
  rows: PortMapRow[];
  /** Network ports, ports with a cable or notes, free network ports, PoE ports in use, uplinks. */
  total: number;
  used: number;
  free: number;
  poe: number;
  uplinks: number;
}

const hopText = (h: TraceHop) => [h.name, h.portLabel].filter(Boolean).join(' ');

/** Devices worth a port map: at least 4 network ports (switches, patch panels, firewalls, routers…). */
export function portMapDevices(p: Project, stencil: Stencils): DeviceNode[] {
  const mounts = new Map<string, string>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) mounts.set(it.nodeId, `${r.name} ${String(1000 - it.u).padStart(4, '0')}`);
  return allDevices(p)
    .filter((n) => (stencil(n.data.stencilId)?.ports ?? []).filter((q) => NETWORK_KINDS.has(q.kind)).length >= 4)
    .sort((a, b) => (mounts.get(a.id) ?? `~${a.data.location ?? ''}`).localeCompare(mounts.get(b.id) ?? `~${b.data.location ?? ''}`) || a.data.name.localeCompare(b.data.name, undefined, { numeric: true }));
}

/** The port map of one device (undefined if it isn't in the client). */
export function portMap(p: Project, nodeId: string, stencil: Stencils): PortMap | undefined {
  const node = allDevices(p).find((n) => n.id === nodeId);
  if (!node) return undefined;
  const st = stencil(node.data.stencilId);
  const vlanColor = new Map((p.vlans ?? []).filter((v) => v.vlan && v.color).map((v) => [v.vlan.trim(), v.color!]));
  let where = node.data.location ?? '';
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId === nodeId) where = `${r.name} ${rackLabel(it)}`;

  let passThrough = false;
  const rows: PortMapRow[] = (st?.ports ?? []).filter((q) => MAPPED_KINDS.has(q.kind)).map((q) => {
    const pd = node.data.ports?.[q.id] ?? {};
    const t = tracePath(p, nodeId, q.id, stencil);
    const i = t.hops.findIndex((h) => h.nodeId === nodeId && h.port === q.id);
    const start = t.hops[i];
    if (start?.passThrough) passThrough = true;
    const before = t.hops.slice(0, i);
    const after = t.hops.slice(i + 1);
    // A patch panel port leads two ways; anything else leads one way, through panels, to the far end.
    const ends = [before[0], after[after.length - 1]].filter((h): h is TraceHop => !!h);
    const middle = [...before.slice(1), ...after.slice(0, -1)];
    const first = t.links[i] ?? t.links[i - 1];
    const vlan = (pd.vlan || first?.data?.vlan || '').trim();
    return {
      id: q.id,
      label: pd.label || q.label || q.id,
      kind: q.kind,
      cabled: t.links.length > 0,
      to: ends.map(hopText).join(' ↔ '),
      via: middle.map(hopText).join(', '),
      note: pd.description ?? '',
      ip: pd.ip ?? '',
      vlan,
      vlanColor: vlanColor.get(vlan),
      speed: pd.speed ?? '',
      poe: pd.poe ?? '',
      status: pd.status,
      uplink: !!pd.uplink,
      cable: first?.data?.cable ?? (t.links.length ? 'Cat6' : ''),
      cableLabel: first?.data?.label ?? '',
      length: pathLength(t),
      notes: pd.notes ?? '',
    };
  });

  const net = rows.filter((r) => NETWORK_KINDS.has(r.kind));
  const inUse = (r: PortMapRow) => r.cabled || !!r.note || r.status === 'up';
  return {
    nodeId, name: node.data.name, model: node.data.model ?? st?.name ?? '', where, stencil: st, passThrough, rows,
    total: net.length,
    used: net.filter(inUse).length,
    free: net.filter((r) => !inUse(r) && r.status !== 'disabled').length,
    poe: net.filter((r) => r.poe && inUse(r)).length,
    uplinks: rows.filter((r) => r.uplink).length,
  };
}

/** How a port is drawn on the map: colour for its state. */
export function portFill(r: PortMapRow): { fill: string; stroke: string; text: string } {
  if (r.status === 'disabled') return { fill: '#d1d5db', stroke: '#6b7280', text: '#374151' };
  if (r.status === 'down') return { fill: '#fee2e2', stroke: '#dc2626', text: '#991b1b' };
  if (r.cabled || r.note || r.status === 'up') return { fill: r.vlanColor ?? '#bbf7d0', stroke: r.uplink ? '#1d4ed8' : '#15803d', text: '#111827' };
  return { fill: '#ffffff', stroke: '#9ca3af', text: '#6b7280' };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The device's face as SVG: its ports where they really are, coloured by state, numbered. */
export function portFaceSvg(m: PortMap, widthPx = 720): string {
  const st = m.stencil;
  const ports = st?.ports.filter((q) => m.rows.some((r) => r.id === q.id)) ?? [];
  if (!st || !ports.length) return '';
  const pad = 4;
  const minX = Math.min(...ports.map((q) => q.x)) - pad;
  const minY = Math.min(...ports.map((q) => q.y)) - pad - 6;
  const maxX = Math.max(...ports.map((q) => q.x + q.w)) + pad;
  const maxY = Math.max(...ports.map((q) => q.y + q.h)) + pad + 6;
  const w = maxX - minX;
  const h = maxY - minY;
  const k = widthPx / w;
  const byId = new Map(m.rows.map((r) => [r.id, r]));
  const body = ports.map((q) => {
    const r = byId.get(q.id)!;
    const c = portFill(r);
    // Fits the port: short numbers as big as the port allows, longer names ("Console") smaller.
    const fs = Math.max(3, Math.min(q.h * 0.5, (q.w * 0.9) / Math.max(1, r.label.length * 0.6)));
    const tip = [r.label, r.to || r.note, r.vlan && `VLAN ${r.vlan}`, r.poe, r.status].filter(Boolean).join(' · ');
    return `<g data-port="${esc(q.id)}" style="cursor:pointer"><title>${esc(tip)}</title><rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="${Math.min(q.w, q.h) * 0.12}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${r.uplink ? 1.6 : 0.8}"/>`
      + (r.poe ? `<circle cx="${q.x + q.w - 2.2}" cy="${q.y + 2.2}" r="1.4" fill="#f59e0b"/>` : '')
      + `<text x="${q.x + q.w / 2}" y="${q.y + q.h / 2}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="${c.text}" font-family="Arial, sans-serif">${esc(r.label)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.round(widthPx)}" height="${Math.round(h * k)}"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" rx="3" fill="#1f2937"/>${body}</svg>`;
}

export const PORT_MAP_COLUMNS = ['Port', 'Connected to', 'Via', 'VLAN', 'IP', 'Speed', 'PoE', 'Status', 'Cable', 'Label', 'Length', 'Notes'];

/** Table cells of a port row (the same columns everywhere: dialog, print, copy, CSV). */
export function portMapCells(r: PortMapRow): string[] {
  return [
    `${r.label}${r.uplink ? ' (uplink)' : ''}`, r.to || r.note, r.via, r.vlan, r.ip, r.speed, r.poe, r.status ?? '',
    r.cable, r.cableLabel, r.length, r.notes,
  ];
}

/** Tab-separated, for pasting into Excel. */
export function portMapTsv(maps: PortMap[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  return [['Device', ...PORT_MAP_COLUMNS], ...maps.flatMap((m) => m.rows.map((r) => [m.name, ...portMapCells(r)]))].map((row) => row.map(clean).join('\t')).join('\n');
}

/** CSV of every port of the given devices. */
export function portMapCsv(maps: PortMap[]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [['Device', ...PORT_MAP_COLUMNS], ...maps.flatMap((m) => m.rows.map((r) => [m.name, ...portMapCells(r)]))].map((row) => row.map(q).join(',')).join('\r\n');
}

export const PORT_MAP_CSS = `
.pm-sheet { font: 10px Arial, sans-serif; color: #111; padding: 0.4in; page-break-after: always; }
.pm-sheet:last-child { page-break-after: auto; }
.pm-sheet h1 { font-size: 16px; margin: 0 0 2px; }
.pm-sheet .pm-sub { color: #555; margin-bottom: 8px; }
.pm-sheet .pm-face { margin: 6px 0 4px; }
.pm-sheet .pm-key { color: #555; margin-bottom: 8px; }
.pm-sheet .pm-key span { display: inline-block; width: 10px; height: 10px; border: 1px solid #555; vertical-align: -1px; margin: 0 3px 0 10px; }
.pm-sheet table { width: 100%; border-collapse: collapse; }
.pm-sheet th, .pm-sheet td { border: 1px solid #bbb; padding: 2px 4px; text-align: left; vertical-align: top; }
.pm-sheet th { background: #eef2f7; }
.pm-sheet td.pm-vlan { white-space: nowrap; }
.pm-sheet td.pm-vlan i { display: inline-block; width: 8px; height: 8px; margin-right: 3px; border: 1px solid #666; }
`;

/** Printable sheets, one per device: title, the face, a colour key and the table. */
export function portMapHtml(maps: PortMap[], client: string, onlyUsed = false): string {
  return maps.map((m) => {
    const rows = onlyUsed ? m.rows.filter((r) => r.cabled || r.note || r.status || r.vlan || r.notes) : m.rows;
    const head = PORT_MAP_COLUMNS.map((c) => `<th>${c}</th>`).join('');
    const body = rows.map((r) => {
      const cells = portMapCells(r).map((c, i) => (i === 3 && c
        ? `<td class="pm-vlan">${r.vlanColor ? `<i style="background:${esc(r.vlanColor)}"></i>` : ''}${esc(c)}</td>`
        : `<td>${esc(c)}</td>`));
      return `<tr>${cells.join('')}</tr>`;
    }).join('');
    return `<section class="pm-sheet"><h1>${esc(m.name)}</h1>`
      + `<div class="pm-sub">${esc([client, m.model, m.where].filter(Boolean).join(' · '))} · ${m.used} of ${m.total} ports in use, ${m.free} free${m.poe ? `, ${m.poe} PoE` : ''}${m.uplinks ? `, ${m.uplinks} uplink${m.uplinks === 1 ? '' : 's'}` : ''}</div>`
      + `<div class="pm-face">${portFaceSvg(m, 680)}</div>`
      + `<div class="pm-key"><span style="background:#bbf7d0"></span>in use (VLAN colour when the IP plan has one)<span style="background:#fff"></span>free<span style="background:#fee2e2;border-color:#dc2626"></span>down<span style="background:#d1d5db"></span>disabled · blue outline = uplink · orange dot = PoE</div>`
      + `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${PORT_MAP_COLUMNS.length}">No ports in use.</td></tr>`}</tbody></table></section>`;
  }).join('');
}
