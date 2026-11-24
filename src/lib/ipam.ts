/**
 * VLAN / IP plan (IP address management) for a client: VLANs with their subnet, gateway and DHCP range, which device
 * IPs fall in which subnet, how full each subnet is, the next free address, and the mistakes worth flagging.
 * IPv4 only. Pure functions, so they're easy to test.
 */
import { allDevices } from './project';
import type { DeviceNode, Project } from './types';

export interface VlanDef {
  id: string;
  /** VLAN number as typed ("10"); a subnet without a VLAN (e.g. a routed link) may leave it empty. */
  vlan: string;
  name: string;
  /** CIDR, e.g. "10.10.10.0/24". */
  subnet?: string;
  gateway?: string;
  dhcpStart?: string;
  dhcpEnd?: string;
  /** Colour for cables on this VLAN (Design → Cables by VLAN). */
  color?: string;
  notes?: string;
}

/** The IPv4 address in a field, if any ("https://10.0.0.1:8443/" → "10.0.0.1"). */
export function ipOf(v?: string) {
  const m = v?.match(/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/);
  return m?.[0];
}

export function ipToInt(ip?: string): number | undefined {
  const m = ip?.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((x) => x > 255)) return undefined;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

export interface Subnet {
  network: number;
  broadcast: number;
  prefix: number;
  /** Usable host addresses (a /31 and /32 count their own addresses). */
  hosts: number;
}

/** "10.10.10.0/24" (or "10.10.10.5/24": the network is worked out) → its range; undefined when not a CIDR. */
export function parseCidr(cidr?: string): Subnet | undefined {
  const m = cidr?.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/);
  if (!m) return undefined;
  const ip = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (ip === undefined || prefix > 32) return undefined;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = broadcast - network + 1;
  return { network, broadcast, prefix, hosts: prefix >= 31 ? size : size - 2 };
}

export const inSubnet = (ip: number, s: Subnet) => ip >= s.network && ip <= s.broadcast;

/** The VLAN whose subnet holds this IP (the most specific one when subnets nest). */
export function vlanOfIp(ip: string | undefined, vlans: VlanDef[]): VlanDef | undefined {
  const n = ipToInt(ipOf(ip));
  if (n === undefined) return undefined;
  let best: { v: VlanDef; prefix: number } | undefined;
  for (const v of vlans) {
    const s = parseCidr(v.subnet);
    if (s && inSubnet(n, s) && (!best || s.prefix > best.prefix)) best = { v, prefix: s.prefix };
  }
  return best?.v;
}

const inDhcp = (n: number, v: VlanDef) => {
  const a = ipToInt(v.dhcpStart), b = ipToInt(v.dhcpEnd);
  return a !== undefined && b !== undefined && n >= Math.min(a, b) && n <= Math.max(a, b);
};

/** Device IPs in the client, as numbers (devices with an IP only). */
export function deviceIps(p: Project): { ip: string; n: number; device: DeviceNode }[] {
  return allDevices(p)
    .map((device) => ({ device, ip: ipOf(device.data.ip) }))
    .filter((x): x is { device: DeviceNode; ip: string } => !!x.ip)
    .map((x) => ({ ...x, n: ipToInt(x.ip)! }));
}

export interface SubnetUsage {
  vlan: VlanDef;
  subnet?: Subnet;
  /** Static addresses in use: devices, plus the gateway. */
  used: number;
  /** Addresses in the DHCP pool. */
  dhcp: number;
  free: number;
  next?: string;
}

/**
 * The first address that is free for a new static device: not the network / broadcast address, not the gateway,
 * not in the DHCP pool, and not used by any device.
 */
export function nextFreeIp(v: VlanDef, taken: Set<number>): string | undefined {
  const s = parseCidr(v.subnet);
  if (!s) return undefined;
  const gw = ipToInt(v.gateway);
  const a = ipToInt(v.dhcpStart), b = ipToInt(v.dhcpEnd);
  const lo = a !== undefined && b !== undefined ? Math.min(a, b) : undefined, hi = a !== undefined && b !== undefined ? Math.max(a, b) : undefined;
  const first = s.prefix >= 31 ? s.network : s.network + 1;
  const last = s.prefix >= 31 ? s.broadcast : s.broadcast - 1;
  for (let n = first; n <= last; n++) {
    if (lo !== undefined && hi !== undefined && n >= lo && n <= hi) { n = hi; continue; } // skip the whole pool
    if (n === gw || taken.has(n)) continue;
    return intToIp(n);
  }
  return undefined;
}

export function subnetUsage(p: Project): SubnetUsage[] {
  const vlans = p.vlans ?? [];
  const ips = deviceIps(p);
  const taken = new Set(ips.map((x) => x.n));
  return vlans.map((v) => {
    const s = parseCidr(v.subnet);
    if (!s) return { vlan: v, used: 0, dhcp: 0, free: 0 };
    const gw = ipToInt(v.gateway);
    const inside = new Set(ips.filter((x) => inSubnet(x.n, s) && vlanOfIp(x.ip, vlans) === v).map((x) => x.n));
    if (gw !== undefined && inSubnet(gw, s)) inside.add(gw);
    // The pool's usable addresses, less any static address already counted inside it.
    const a = ipToInt(v.dhcpStart), b = ipToInt(v.dhcpEnd);
    let dhcp = 0;
    if (a !== undefined && b !== undefined) {
      const lo = Math.max(Math.min(a, b), s.prefix >= 31 ? s.network : s.network + 1);
      const hi = Math.min(Math.max(a, b), s.prefix >= 31 ? s.broadcast : s.broadcast - 1);
      if (hi >= lo) dhcp = hi - lo + 1 - [...inside].filter((n) => n >= lo && n <= hi).length;
    }
    return { vlan: v, subnet: s, used: inside.size, dhcp, free: Math.max(0, s.hosts - inside.size - dhcp), next: nextFreeIp(v, taken) };
  });
}

export interface IpProblem {
  /** Device the problem is about, if any. */
  deviceId?: string;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

/** IP-plan mistakes: IPs outside every subnet, in a DHCP pool, on the network / broadcast address; subnet clashes. */
export function ipPlanProblems(p: Project): IpProblem[] {
  const vlans = (p.vlans ?? []).filter((v) => parseCidr(v.subnet));
  if (!vlans.length) return [];
  const out: IpProblem[] = [];
  for (const { device, ip, n } of deviceIps(p)) {
    const v = vlanOfIp(ip, vlans);
    const name = device.data.name;
    if (!v) {
      out.push({ deviceId: device.id, severity: 'warning', rule: 'IP outside plan', message: `${name}: ${ip} is not in any subnet of the IP plan` });
      continue;
    }
    const s = parseCidr(v.subnet)!;
    const label = `VLAN ${v.vlan || '–'} ${v.name}`.trim();
    if (s.prefix < 31 && (n === s.network || n === s.broadcast)) out.push({ deviceId: device.id, severity: 'error', rule: 'Network / broadcast IP', message: `${name}: ${ip} is the ${n === s.network ? 'network' : 'broadcast'} address of ${v.subnet} (${label})` });
    else if (inDhcp(n, v)) out.push({ deviceId: device.id, severity: 'warning', rule: 'IP in DHCP range', message: `${name}: static IP ${ip} is inside the DHCP range ${v.dhcpStart}–${v.dhcpEnd} of ${label}` });
    else if (ipToInt(v.gateway) === n && !/firewall|router|gateway|core|sonicwall|sdwan/i.test(`${device.data.stencilId} ${name} ${device.data.model ?? ''}`)) {
      out.push({ deviceId: device.id, severity: 'warning', rule: 'Gateway IP', message: `${name}: ${ip} is the gateway of ${label}` });
    }
  }
  // Subnets that overlap (other than one nested in another on purpose? still worth a look).
  for (let i = 0; i < vlans.length; i++) for (let j = i + 1; j < vlans.length; j++) {
    const a = parseCidr(vlans[i].subnet)!, b = parseCidr(vlans[j].subnet)!;
    if (a.network <= b.broadcast && b.network <= a.broadcast) {
      out.push({ severity: 'warning', rule: 'Overlapping subnets', message: `${vlans[i].subnet} (VLAN ${vlans[i].vlan} ${vlans[i].name}) overlaps ${vlans[j].subnet} (VLAN ${vlans[j].vlan} ${vlans[j].name})` });
    }
  }
  // Gateway or DHCP range outside its own subnet.
  for (const v of vlans) {
    const s = parseCidr(v.subnet)!;
    for (const [what, ip] of [['Gateway', v.gateway], ['DHCP start', v.dhcpStart], ['DHCP end', v.dhcpEnd]] as const) {
      const n = ipToInt(ip);
      if (ip?.trim() && (n === undefined || !inSubnet(n, s))) out.push({ severity: 'warning', rule: 'IP plan', message: `VLAN ${v.vlan} ${v.name}: ${what} ${ip} is not in ${v.subnet}` });
    }
  }
  return out;
}

/** VLAN numbers used on cables and ports that the plan doesn't define. */
export function undefinedVlans(p: Project): string[] {
  const defined = new Set((p.vlans ?? []).map((v) => v.vlan.trim()).filter(Boolean));
  if (!defined.size) return [];
  const used = new Set<string>();
  const add = (s?: string) => s?.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^\d+(-\d+)?$/.test(x)).forEach((x) => used.add(x));
  for (const pg of p.pages) {
    for (const e of pg.edges) add(e.data?.vlan);
    for (const n of pg.nodes) if (n.type === 'device') for (const pd of Object.values(n.data.ports ?? {})) add(pd.vlan);
  }
  return [...used].filter((x) => !x.includes('-') && !defined.has(x)).sort((a, b) => Number(a) - Number(b));
}

/** VLAN numbers used on cables and ports, for "add the VLANs the diagram already uses". */
export function vlansInUse(p: Project): string[] {
  const used = new Set<string>();
  for (const pg of p.pages) {
    for (const e of pg.edges) e.data?.vlan?.split(/[,;\s]+/).forEach((x) => /^\d+$/.test(x.trim()) && used.add(x.trim()));
    for (const n of pg.nodes) if (n.type === 'device') for (const pd of Object.values(n.data.ports ?? {})) pd.vlan?.split(/[,;\s]+/).forEach((x) => /^\d+$/.test(x.trim()) && used.add(x.trim()));
  }
  return [...used].sort((a, b) => Number(a) - Number(b));
}
