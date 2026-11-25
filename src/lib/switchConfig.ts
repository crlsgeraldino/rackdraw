import { vlanOfIp, parseCidr, type VlanDef } from './ipam';
import { portMap, type PortMapRow } from './portMap';
import { allDevices } from './project';
import { isPassThrough, tracePath } from './trace';
import type { DeviceNode, PortDef, Project, StencilDef } from './types';

/*
 * Switch configuration starter: the parts of a switch's configuration RackDraw knows from the documentation —
 * VLANs (from the IP plan), port descriptions (where each port leads), access / trunk ports, PoE, ports turned off,
 * and the management address. Text to review and paste, never sent to a switch; no passwords or other secrets.
 */

type Stencils = (id: string) => StencilDef | undefined;
export type ConfigStyle = 'ios' | 'aoscx' | 'table';
export const CONFIG_STYLES: { value: ConfigStyle; label: string }[] = [
  { value: 'ios', label: 'Cisco IOS / IOS-XE' },
  { value: 'aoscx', label: 'Aruba AOS-CX' },
  { value: 'table', label: 'Port table (UniFi and other web-managed switches)' },
];

export interface ConfigOptions {
  style: ConfigStyle;
  /** Turn off ports with nothing documented on them. */
  shutUnused?: boolean;
  /** Printed in the header. */
  date?: string;
}

/** Switches RackDraw can write a starter for (not patch panels). */
export function configurableSwitches(p: Project, stencil: Stencils): DeviceNode[] {
  return allDevices(p).filter((d) => {
    const st = stencil(d.data.stencilId);
    if (!st || isPassThrough(d, st)) return false;
    const isSwitch = st.category === 'Switching' || (!!st.custom && /\bswitch\b/i.test(`${st.name} ${d.data.model ?? ''}`));
    return isSwitch && st.ports.filter((q) => q.kind === 'rj45' || q.kind === 'sfp').length >= 4;
  }).sort((a, b) => a.data.name.localeCompare(b.data.name, undefined, { numeric: true }));
}

const looksLikeInterface = (s: string) => /^[a-z][a-z-]*\s*\d+(\/\d+)+$/i.test(s.trim()) || /^\d+\/\d+\/\d+$/.test(s.trim());

/** The interface name of each data port, by style (a port named like an interface in Shape Data keeps that name). */
export function interfaceNames(d: DeviceNode, st: StencilDef, style: ConfigStyle): Map<string, string> {
  const data = st.ports.filter((q) => q.kind === 'rj45' || q.kind === 'sfp');
  const out = new Map<string, string>();
  let slot = 0, qsfp = 0;
  data.forEach((q: PortDef, i) => {
    const own = d.data.ports?.[q.id]?.label?.trim();
    if (own && looksLikeInterface(own)) { out.set(q.id, own); return; }
    const n = /^\d+$/.test(q.label.trim()) ? Number(q.label) : null;
    if (style === 'aoscx') { out.set(q.id, `1/1/${i + 1}`); return; }
    if (style === 'table') { out.set(q.id, q.label); return; }
    if (n !== null) out.set(q.id, `${q.kind === 'sfp' ? 'TenGigabitEthernet' : 'GigabitEthernet'}1/0/${n}`);
    else if (/^q/i.test(q.label)) out.set(q.id, `HundredGigE1/1/${++qsfp}`);
    else out.set(q.id, `TenGigabitEthernet1/1/${++slot}`);
  });
  return out;
}

/** VLAN numbers in a field ("10", "VLAN 20", "10,20,30", "10-12"). */
export function vlanNumbers(text?: string): number[] {
  const out: number[] = [];
  for (const part of (text ?? '').replace(/vlan/gi, '').split(/[,;\s]+/)) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let v = Math.min(a, b); v <= Math.max(a, b) && v <= 4094; v++) if (v >= 1) out.push(v);
  }
  return [...new Set(out)];
}

/** Text that is safe in a description line: plain characters, no quotes, at most 60 long. */
const describe = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["'!?#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const hostname = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'switch';
const used = (r: PortMapRow) => r.cabled || !!r.note || !!r.vlan || r.status === 'up';

const NETWORK_IDS = new Set(['firewall', 'router', 'sdwan', 'vpn-concentrator', 'lte-router', 'wifi-router', 'load-balancer', 'wlc']);
/** Whether the port leads (through patch panels) to another switch, a firewall or a router: then it carries VLANs tagged. */
function leadsToNetwork(p: Project, nodeId: string, port: string, stencil: Stencils): boolean {
  const t = tracePath(p, nodeId, port, stencil);
  const i = t.hops.findIndex((h) => h.nodeId === nodeId && h.port === port);
  const ends = [t.hops[0], t.hops[t.hops.length - 1]].filter((h, k) => h && (k === 0 ? i > 0 : i < t.hops.length - 1));
  const devices = new Map(allDevices(p).map((n) => [n.id, n]));
  return ends.some((h) => {
    const n = devices.get(h.nodeId);
    const st = n ? stencil(n.data.stencilId) : undefined;
    if (!n || !st || isPassThrough(n, st)) return false;
    return st.category === 'Switching' || st.category === 'Firewalls' || NETWORK_IDS.has(n.data.stencilId);
  });
}

export interface PortPlan {
  id: string;
  name: string;
  label: string;
  description: string;
  mode: 'access' | 'trunk' | 'unknown' | 'off' | 'unused';
  vlans: number[];
  poe: boolean;
}

/** What each data port of the switch should be, from the documentation. */
export function portPlans(p: Project, d: DeviceNode, stencil: Stencils, style: ConfigStyle, shutUnused = false): PortPlan[] {
  const st = stencil(d.data.stencilId);
  const map = portMap(p, d.id, stencil);
  if (!st || !map) return [];
  const names = interfaceNames(d, st, style);
  const access = new Set<number>();
  const rows = map.rows.filter((r) => r.kind === 'rj45' || r.kind === 'sfp');
  for (const r of rows) if (!r.uplink) { const v = vlanNumbers(r.vlan); if (v.length === 1) access.add(v[0]); }
  // A switch with no access ports of its own (a core) trunks every VLAN of the IP plan.
  const planVlans = [...new Set((p.vlans ?? []).flatMap((v) => vlanNumbers(v.vlan)))].sort((a, b) => a - b);
  const trunkDefault = access.size ? [...access].sort((a, b) => a - b) : planVlans;
  return rows.map((r) => {
    const v = vlanNumbers(r.vlan);
    const trunk = r.uplink || v.length > 1 || (r.cabled && leadsToNetwork(p, d.id, r.id, stencil));
    const mode: PortPlan['mode'] = r.status === 'disabled' ? 'off'
      : trunk ? 'trunk'
      : v.length === 1 ? 'access'
      : used(r) ? 'unknown'
      : shutUnused ? 'off' : 'unused';
    return {
      id: r.id, name: names.get(r.id) ?? r.label, label: r.label,
      description: describe([r.to || r.note, r.via && `via ${r.via}`].filter(Boolean).join(' ')),
      mode,
      // A trunk carries the VLANs written on it, else this switch's access VLANs, else the IP plan's.
      vlans: mode === 'trunk' ? (v.length ? v : trunkDefault) : v,
      poe: !!r.poe,
    };
  });
}

/** The switch's management address and its subnet (from the IP plan), if known. */
function management(p: Project, d: DeviceNode) {
  const ip = /(\d+\.\d+\.\d+\.\d+)/.exec(d.data.ip ?? '')?.[1];
  if (!ip) return null;
  const v = vlanOfIp(ip, p.vlans ?? []);
  const net = parseCidr(v?.subnet);
  return { ip, vlan: v?.vlan ? Number(v.vlan) || undefined : undefined, prefix: net?.prefix, gateway: v?.gateway };
}

// A shift by 32 is a shift by 0 in JavaScript, so /0 is spelled out.
const maskOf = (prefix: number) => (prefix <= 0 ? '0.0.0.0' : [24, 16, 8, 0].map((s) => ((0xffffffff << (32 - prefix)) >>> s) & 255).join('.'));

/** The starter configuration of one switch, as text. */
export function switchConfig(p: Project, d: DeviceNode, stencil: Stencils, o: ConfigOptions): string {
  const st = stencil(d.data.stencilId);
  const plans = portPlans(p, d, stencil, o.style, o.shutUnused);
  const mgmt = management(p, d);
  const vlanIds = [...new Set([...plans.flatMap((x) => x.vlans), ...(mgmt?.vlan ? [mgmt.vlan] : [])])].sort((a, b) => a - b);
  const vlanName = (n: number) => describe((p.vlans ?? []).find((v: VlanDef) => Number(v.vlan) === n)?.name ?? '').replace(/\s+/g, '_');
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  const head = [
    `RackDraw configuration starter for ${d.data.name}${d.data.model ? ` (${d.data.model})` : st ? ` (${st.name})` : ''}, ${p.name}, ${date}.`,
    'Covers what the documentation says: VLANs, port descriptions, access / trunk ports, PoE, ports turned off and the',
    'management address. Review it, add the rest (passwords, SNMP, NTP, logging, spanning tree) and test before applying.',
  ];
  const unknown = plans.filter((x) => x.mode === 'unknown').map((x) => x.label);
  if (unknown.length) head.push(`No VLAN documented for port${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}: left as ${unknown.length === 1 ? 'it is' : 'they are'}.`);

  if (o.style === 'table') {
    const lines = ['Port\tDescription\tMode\tVLAN(s)\tPoE\tEnabled'];
    for (const x of plans) {
      if (x.mode === 'unused') continue;
      lines.push([x.label, x.description, x.mode === 'off' ? 'Off' : x.mode === 'trunk' ? 'Trunk (tagged)' : x.mode === 'access' ? 'Access (untagged)' : 'Not documented', x.vlans.join(','), x.poe ? 'Yes' : '', x.mode === 'off' ? 'No' : 'Yes'].join('\t'));
    }
    return [...head.map((h) => `# ${h}`), '', `VLANs: ${vlanIds.map((n) => `${n}${vlanName(n) ? ` ${vlanName(n)}` : ''}`).join(', ') || 'none documented'}`,
      ...(mgmt ? [`Management: ${mgmt.ip}${mgmt.prefix !== undefined ? `/${mgmt.prefix}` : ''}${mgmt.vlan ? ` on VLAN ${mgmt.vlan}` : ''}${mgmt.gateway ? `, gateway ${mgmt.gateway}` : ''}`] : []), '', ...lines].join('\n') + '\n';
  }

  const out: string[] = [];
  if (o.style === 'ios') {
    out.push(...head.map((h) => `! ${h}`), '!', `hostname ${hostname(d.data.name)}`, '!');
    for (const n of vlanIds) out.push(`vlan ${n}`, ...(vlanName(n) ? [` name ${vlanName(n)}`] : []), '!');
    for (const x of plans) {
      if (x.mode === 'unused') continue;
      out.push(`interface ${x.name}`);
      if (x.description) out.push(` description ${x.description}`);
      if (x.mode === 'access') out.push(' switchport mode access', ` switchport access vlan ${x.vlans[0]}`, ' spanning-tree portfast');
      if (x.mode === 'trunk') out.push(' switchport mode trunk', ...(x.vlans.length ? [` switchport trunk allowed vlan ${x.vlans.join(',')}`] : []));
      if (x.mode === 'unknown') out.push(' ! VLAN not documented');
      if (x.poe && x.mode !== 'off') out.push(' power inline auto');
      out.push(x.mode === 'off' ? ' shutdown' : ' no shutdown', '!');
    }
    if (mgmt?.vlan && mgmt.prefix !== undefined) out.push(`interface Vlan${mgmt.vlan}`, ` ip address ${mgmt.ip} ${maskOf(mgmt.prefix)}`, ' no shutdown', '!');
    else if (mgmt) out.push(`! Management address ${mgmt.ip}: put it on its VLAN (the IP plan has no subnet for it).`, '!');
    if (mgmt?.gateway) out.push(`ip default-gateway ${mgmt.gateway}`, '!');
    out.push('end');
  } else {
    out.push(...head.map((h) => `! ${h}`), `hostname ${hostname(d.data.name)}`);
    for (const n of vlanIds) out.push(`vlan ${n}`, ...(vlanName(n) ? [`    name ${vlanName(n)}`] : []));
    for (const x of plans) {
      if (x.mode === 'unused') continue;
      out.push(`interface ${x.name}`);
      if (x.description) out.push(`    description ${x.description}`);
      out.push(x.mode === 'off' ? '    shutdown' : '    no shutdown');
      if (x.mode !== 'off') out.push('    no routing');
      if (x.mode === 'access') out.push(`    vlan access ${x.vlans[0]}`, '    spanning-tree port-type admin-edge');
      if (x.mode === 'trunk') out.push('    vlan trunk native 1', `    vlan trunk allowed ${x.vlans.length ? x.vlans.join(',') : 'all'}`);
      if (x.mode === 'unknown') out.push('    ! VLAN not documented');
      if (x.poe && x.mode !== 'off') out.push('    power-over-ethernet');
    }
    if (mgmt?.vlan && mgmt.prefix !== undefined) out.push(`interface vlan ${mgmt.vlan}`, `    ip address ${mgmt.ip}/${mgmt.prefix}`);
    else if (mgmt) out.push(`! Management address ${mgmt.ip}: put it on its VLAN (the IP plan has no subnet for it).`);
    if (mgmt?.gateway) out.push(`ip route 0.0.0.0/0 ${mgmt.gateway}`);
  }
  return out.join('\n') + '\n';
}

/** A file name for a switch's config. */
export const configFileName = (d: DeviceNode, style: ConfigStyle) => `${hostname(d.data.name)}-${style === 'table' ? 'ports.txt' : `${style}.txt`}`;
