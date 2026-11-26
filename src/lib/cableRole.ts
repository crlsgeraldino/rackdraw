import { isPassThrough } from './trace';
import type { AppNode, CableData, DeviceNode, StencilDef } from './types';

/*
 * What a cable is for — WAN uplink, uplink, access, patch, HA… — and the text it shows. The function is worked out
 * from what it connects (the kinds of device and the ports at its ends) unless one is chosen for the cable; the text
 * can be the typed label, the function, the cable type, or function and type ("WAN uplink · Cat6").
 */

export type CableRole = 'wan' | 'uplink' | 'backbone' | 'access' | 'server' | 'storage' | 'patch' | 'stack' | 'ha' | 'mgmt' | 'console';

export const CABLE_ROLES: { value: CableRole; label: string }[] = [
  { value: 'wan', label: 'WAN uplink' },
  { value: 'uplink', label: 'Uplink' },
  { value: 'backbone', label: 'Backbone' },
  { value: 'access', label: 'Access' },
  { value: 'server', label: 'Server link' },
  { value: 'storage', label: 'Storage' },
  { value: 'patch', label: 'Patch' },
  { value: 'stack', label: 'Stacking' },
  { value: 'ha', label: 'HA / sync' },
  { value: 'mgmt', label: 'Management' },
  { value: 'console', label: 'Console' },
];
export const roleLabel = (r?: CableRole) => CABLE_ROLES.find((x) => x.value === r)?.label;

/** The text on a cable: typed label only, function, type, or function and type. */
export type CableTag = 'label' | 'role' | 'type' | 'role-type';
export const CABLE_TAGS: { value: CableTag; label: string }[] = [
  { value: 'label', label: 'Label only' },
  { value: 'role', label: 'Function' },
  { value: 'type', label: 'Cable type' },
  { value: 'role-type', label: 'Function + type' },
];

/** Carrier side of the network: whatever comes from the provider. */
const WAN_SIDE = new Set(['internet', 'modem', 'metro-ntu', 'carrier-cloud', 'mpls-cloud', 'csu-dsu', 'satellite', 'cloud-service', 'optical-splitter', 'olt', 'dwdm', 'microwave', 'remote-user']);
/** The network's edge: firewalls and routers. */
const EDGE = new Set(['firewall', 'router', 'sdwan', 'vpn-concentrator', 'lte-router', 'wifi-router', 'wan-optimizer', 'load-balancer']);
const STORAGE = new Set(['san', 'nas', 'tape-library']);
/** Gear whose network port is for managing it: UPS and PDU cards, KVMs, console servers. */
const MANAGED = new Set(['ups', 'pdu-network', 'kvm', 'console-server']);
const CORE = /core|aggregation|spine|distribution/i;

type Kind = 'wan' | 'edge' | 'switch' | 'core' | 'passive' | 'storage' | 'server' | 'managed' | 'ap' | 'endpoint' | 'other';

function kindOf(n: DeviceNode | undefined, st: StencilDef | undefined): Kind {
  if (!n) return 'other';
  const id = n.data.stencilId;
  const text = `${st?.name ?? ''} ${n.data.model ?? ''}`;
  if (WAN_SIDE.has(id)) return 'wan';
  if (isPassThrough(n, st)) return 'passive';
  if (EDGE.has(id) || st?.category === 'Firewalls' || (st?.custom && /firewall|sonicwall|fortigate|palo alto|watchguard|meraki mx|router/i.test(text))) return 'edge';
  if (STORAGE.has(id)) return 'storage';
  if (MANAGED.has(id) || (st?.custom && /\bups\b|\bpdu\b|\bkvm\b/i.test(text))) return 'managed';
  if (st?.category === 'Switching') return CORE.test(text) ? 'core' : 'switch';
  if (st?.custom && /\bswitch\b/i.test(text)) return CORE.test(text) ? 'core' : 'switch';
  if (st?.category === 'Servers') return 'server';
  if (st?.category === 'Wireless') return 'ap';
  if (st?.category === 'Endpoints' || st?.category === 'Personal' || st?.category === 'Security' || st?.category === 'Infrastructure') return 'endpoint';
  return 'other';
}

/** What a port's name says it is for. */
function portHint(n: DeviceNode | undefined, st: StencilDef | undefined, port?: string | null): CableRole | undefined {
  if (!n || !port) return undefined;
  const def = st?.ports.find((q) => q.id === port);
  if (def?.kind === 'console') return 'console';
  const text = `${port} ${def?.label ?? ''} ${def?.role ?? ''} ${n.data.ports?.[port]?.label ?? ''}`;
  if (/\bconsole\b/i.test(text)) return 'console';
  if (/\bha\b|\bsync\b|heartbeat/i.test(text)) return 'ha';
  if (/\bmgmt\b|management|\bipmi\b|\bidrac\b|\bilo\b|\boob\b/i.test(text)) return 'mgmt';
  if (/\bstack/i.test(text)) return 'stack';
  if (/\bwan\s*\d*\b/i.test(text)) return 'wan';
  return undefined;
}

/** The function of a cable between two devices (undefined when nothing says). */
export function inferRole(
  a: { node?: DeviceNode; stencil?: StencilDef; port?: string | null },
  b: { node?: DeviceNode; stencil?: StencilDef; port?: string | null },
  data?: CableData,
): CableRole | undefined {
  const ka = kindOf(a.node, a.stencil), kb = kindOf(b.node, b.stencil);
  const has = (k: Kind) => ka === k || kb === k;
  const both = (k: Kind) => ka === k && kb === k;
  if (data?.cable === 'Console') return 'console';
  // A named port says what it is for (WAN, HA, management, stacking, console).
  const hint = portHint(a.node, a.stencil, a.port) ?? portHint(b.node, b.stencil, b.port);
  if (hint) return hint;
  if (has('wan') || data?.cable === 'WAN' || data?.cable === 'MPLS') return 'wan';
  // Through a patch panel / jack: the cord to the switch is a patch cord, the run to the desk is access cabling,
  // panel to panel (between closets) is backbone.
  if (has('passive')) {
    const other = ka === 'passive' ? kb : ka;
    if (other === 'passive') return 'backbone';
    if (other === 'switch' || other === 'core' || other === 'edge') return 'patch';
    if (other === 'server' || other === 'storage') return 'server';
    return 'access';
  }
  if (both('edge')) return 'ha';
  if (has('edge') && (has('switch') || has('core'))) return 'uplink';
  const sw = (k: Kind) => k === 'switch' || k === 'core';
  if (both('core')) return 'backbone';
  if (sw(ka) && sw(kb)) return 'uplink';
  if (has('managed')) return 'mgmt';
  if (has('storage')) return 'storage';
  if (has('server')) return 'server';
  if (has('ap') && (has('switch') || has('core') || has('edge'))) return 'access';
  if ((has('switch') || has('core') || has('edge')) && has('endpoint')) return 'access';
  return undefined;
}

/** The cable's function: the one chosen for it, else the worked-out one ('none' = none). */
export function cableRole(data: CableData | undefined, auto: () => CableRole | undefined): CableRole | undefined {
  const r = data?.role as CableRole | 'none' | undefined;
  if (r === 'none') return undefined;
  return r ?? auto();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The text a cable shows: the parts the tag asks for, the typed label (unless it says the same), VLAN, length. */
export function cableText(data: CableData | undefined, role: CableRole | undefined, tag: CableTag): string {
  const parts: string[] = [];
  if (tag === 'role' || tag === 'role-type') { const r = roleLabel(role); if (r) parts.push(r); }
  if (tag === 'type' || tag === 'role-type') parts.push(data?.cable ?? 'Cat6');
  const label = data?.label?.trim();
  // A typed label that only repeats what is shown ("WAN" next to "WAN uplink", "Cat 6" next to "Cat6") is left out.
  if (label && !parts.some((p) => norm(p).includes(norm(label)) || norm(label).includes(norm(p)))) parts.push(label);
  if (data?.vlan) parts.push(`VLAN ${data.vlan}`);
  if (data?.showLength && data.length) parts.push(data.length);
  if (data?.via) parts.push(`via ${data.via}`);
  return parts.join(' · ');
}

/**
 * The printed name of the port a cable end plugs into ("X1", "24", "SFP 1"): the device's own name for the port,
 * else its stencil's; '' when the cable is attached to the device itself rather than a port.
 */
export function endPortName(n: DeviceNode | undefined, st: StencilDef | undefined, handle?: string | null): string {
  if (!n || !handle) return '';
  const def = st?.ports.find((q) => q.id === handle);
  if (!def) return '';
  return n.data.ports?.[handle]?.label?.trim() || def.label || handle;
}

/* Per-page index for working out roles on the canvas without searching the nodes for every cable. */
const byPage = new WeakMap<AppNode[], Map<string, DeviceNode>>();
export function deviceIndex(nodes: AppNode[]): Map<string, DeviceNode> {
  let m = byPage.get(nodes);
  if (!m) {
    m = new Map(nodes.filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n]));
    byPage.set(nodes, m);
  }
  return m;
}

/** A cable's function on a page: chosen, or worked out from the devices and ports at its ends. */
export function edgeRole(
  nodes: AppNode[],
  e: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: CableData },
  stencil: (id: string) => StencilDef | undefined,
): CableRole | undefined {
  return cableRole(e.data, () => {
    const ix = deviceIndex(nodes);
    const a = ix.get(e.source), b = ix.get(e.target);
    return inferRole(
      { node: a, stencil: a ? stencil(a.data.stencilId) : undefined, port: e.sourceHandle },
      { node: b, stencil: b ? stencil(b.data.stencilId) : undefined, port: e.targetHandle },
      e.data,
    );
  });
}
