import { resolveLink } from './links';
import { isPassThrough } from './trace';
import { isDocumented, type AppNode, type DeviceNode, type Project, type StencilDef } from './types';

/**
 * "Check diagram" (like Visio's Check Diagram): finds mistakes and gaps in a client's documentation.
 * Pure function over the project, so it is easy to test and cheap enough to run on every change.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  message: string;
  /** Short name of the rule, for grouping. */
  rule: string;
  pageId: string;
  kind: 'node' | 'edge';
  id: string;
}

const MANAGED = new Set(['Firewalls', 'Switching', 'Wireless', 'Servers', 'WAN']);

/** The IPv4 address in a field, if any ("https://10.0.0.1:8443/" → "10.0.0.1"). */
export function ipOf(v?: string) {
  const m = v?.match(/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/);
  return m?.[0];
}

/** Rough box of a node on the diagram (devices from their stencil size, others from their set size). */
function rect(n: AppNode, stencilOf: (id: string) => StencilDef | undefined) {
  let w = n.width ?? n.measured?.width ?? 0, h = n.height ?? n.measured?.height ?? 0;
  if (n.type === 'device' && !n.width) {
    const s = stencilOf(n.data.stencilId);
    if (s) {
      const k = s.style === 'icon' ? 1 : s.scale;
      w = s.width * k;
      h = s.height * k;
    }
  }
  return { x: n.position.x, y: n.position.y, w, h };
}

export function checkProject(p: Project, stencilOf: (id: string) => StencilDef | undefined): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, rule: string, message: string, pageId: string, kind: 'node' | 'edge', id: string) =>
    issues.push({ severity, rule, message, pageId, kind, id });
  const pageIds = new Set(p.pages.map((pg) => pg.id));

  // Project-wide: duplicate device IPs, duplicate names, duplicate port IPs.
  const devices = p.pages.flatMap((pg) => pg.nodes.filter((n): n is DeviceNode => n.type === 'device').map((n) => ({ n, pg })));
  const group = <T,>(items: T[], key: (t: T) => string | undefined) => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = key(it);
      if (k) m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].filter(([, v]) => v.length > 1);
  };
  for (const [ip, list] of group(devices, ({ n }) => ipOf(n.data.ip))) {
    for (const { n, pg } of list) add('error', 'Duplicate IP', `${n.data.name}: IP ${ip} is also used by ${list.filter((x) => x.n !== n).map((x) => x.n.data.name).join(', ')}`, pg.id, 'node', n.id);
  }
  for (const [, list] of group(devices, ({ n }) => n.data.name?.trim().toLowerCase() || undefined)) {
    for (const { n, pg } of list) add('warning', 'Duplicate name', `"${n.data.name}" is used by ${list.length} devices`, pg.id, 'node', n.id);
  }
  const portIps = devices.flatMap(({ n, pg }) => Object.entries(n.data.ports ?? {}).map(([pid, pd]) => ({ n, pg, pid, label: pd.label || stencilOf(n.data.stencilId)?.ports.find((x) => x.id === pid)?.label || pid, ip: ipOf(pd.ip) })));
  for (const [ip, list] of group(portIps, (x) => x.ip)) {
    for (const x of list) add('warning', 'Duplicate IP', `${x.n.data.name} port ${x.label}: IP ${ip} is noted on ${list.length} ports`, x.pg.id, 'node', x.n.id);
  }

  for (const pg of p.pages) {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    const portName = (n: AppNode | undefined, pid?: string | null) =>
      n?.type === 'device' && pid ? n.data.ports?.[pid]?.label || stencilOf(n.data.stencilId)?.ports.find((x) => x.id === pid)?.label || pid : pid ?? '';

    // Cables per port.
    const perPort = new Map<string, string[]>();
    for (const e of pg.edges) {
      for (const [nid, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
        if (!h || byId.get(nid)?.type !== 'device') continue;
        const k = `${nid}|${h}`;
        perPort.set(k, [...(perPort.get(k) ?? []), e.id]);
      }
    }
    for (const [k, ids] of perPort) {
      if (ids.length < 2) continue;
      const [nid, h] = k.split('|');
      const n = byId.get(nid) as DeviceNode;
      // A patch panel port takes two: the patch cord on its front and the run on its back.
      const through = isPassThrough(n, stencilOf(n.data.stencilId));
      if (through && ids.length === 2) continue;
      add('error', 'Port used twice', `${n.data.name} port ${portName(n, h)} has ${ids.length} cables${through ? ' (a patch panel port takes two: front patch cord and back run)' : ''}`, pg.id, 'node', nid);
    }

    // VLAN on a cable that disagrees with the VLAN noted on either port.
    for (const e of pg.edges) {
      const v = e.data?.vlan?.trim();
      if (!v) continue;
      for (const [nid, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
        const n = byId.get(nid);
        const pv = n?.type === 'device' && h ? n.data.ports?.[h]?.vlan?.trim() : undefined;
        if (pv && pv !== v) add('warning', 'VLAN mismatch', `Cable says VLAN ${v} but ${(n as DeviceNode).data.name} port ${portName(n, h)} says VLAN ${pv}`, pg.id, 'edge', e.id);
      }
    }

    const cabled = new Set(pg.edges.flatMap((e) => [e.source, e.target]));
    const devs = pg.nodes.filter((n): n is DeviceNode => n.type === 'device');
    for (const n of devs) {
      const s = stencilOf(n.data.stencilId);
      if (!s) {
        add('error', 'Missing stencil', `${n.data.name}: its stencil isn't in this computer's libraries`, pg.id, 'node', n.id);
        continue;
      }
      // Uplinks with nothing on them.
      for (const [pid, pd] of Object.entries(n.data.ports ?? {})) {
        if (pd.uplink && !perPort.has(`${n.id}|${pid}`) && !pd.description) add('warning', 'Uplink not connected', `${n.data.name} port ${portName(n, pid)} is marked uplink but has no cable or "connected to"`, pg.id, 'node', n.id);
      }
      if (pg.edges.length && !cabled.has(n.id) && !Object.values(n.data.ports ?? {}).some(isDocumented)) {
        add('info', 'Not connected', `${n.data.name} has no cables or port notes`, pg.id, 'node', n.id);
      }
      // Patch panels are passive: no management IP to note.
      if (MANAGED.has(s.category) && s.id !== 'internet' && !isPassThrough(n, s) && !ipOf(n.data.ip)) add('info', 'No IP', `${n.data.name} has no management IP`, pg.id, 'node', n.id);
      if (MANAGED.has(s.category) && s.id !== 'internet' && !n.data.serial) add('info', 'No serial', `${n.data.name} has no serial number`, pg.id, 'node', n.id);
    }

    // Devices drawn on top of each other.
    const boxes = devs.map((n) => ({ n, ...rect(n, stencilOf) })).filter((b) => b.w && b.h);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ow > 0 && oh > 0 && ow * oh > 0.2 * Math.min(a.w * a.h, b.w * b.h)) {
          add('warning', 'Overlapping', `${a.n.data.name} and ${b.n.data.name} overlap`, pg.id, 'node', a.n.id);
        }
      }
    }

    // Define Shape Data: required fields left empty.
    const required = (p.fieldDefs ?? []).filter((d) => d.required && d.label.trim());
    if (required.length) for (const n of pg.nodes) {
      if (n.type !== 'device') continue;
      const cat = stencilOf(n.data.stencilId)?.category;
      for (const d of required) {
        if (d.category && d.category !== cat) continue;
        const v = n.data.extraFields?.find((f) => f.label.trim().toLowerCase() === d.label.trim().toLowerCase())?.value;
        if (!v?.trim()) add('info', 'Required field', `${n.data.name}: ${d.label} is empty`, pg.id, 'node', n.id);
      }
    }

    // Links to pages that were deleted.
    for (const n of pg.nodes) {
      if (n.type === 'backdrop') continue;
      const t = resolveLink(n.data.link);
      if (t?.kind === 'page' && !pageIds.has(t.pageId)) add('warning', 'Broken link', `${n.type === 'device' ? n.data.name : 'An item'} links to a page that no longer exists`, pg.id, 'node', n.id);
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
