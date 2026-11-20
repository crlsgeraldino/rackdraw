import { isDocumented, type AppNode, type DeviceNode, type Page, type StencilDef } from './types';

/** One port of a device as it reads in an info box or quick-info card. */
export interface PortLine {
  id: string;
  label: string;
  uplink: boolean;
  /** "Connected to" as written and/or where its cable goes on this page. */
  to: string;
  ip: string;
  vlan: string;
  notes: string;
}

/**
 * Ports of a device that have a cable or notes: uplinks first, then in panel order.
 * `onlyUplinks` keeps just the uplinks.
 */
export function portLines(node: DeviceNode, page: Page, stencilOf: (id: string) => StencilDef | undefined, onlyUplinks = false): PortLine[] {
  const stencil = stencilOf(node.data.stencilId);
  if (!stencil) return [];
  const byId = new Map(page.nodes.map((n) => [n.id, n]));
  const name = (n?: AppNode) => (n?.type === 'device' ? n.data.name : n?.type === 'shape' ? n.data.text || 'shape' : n?.type === 'zone' ? n.data.title : '?');
  const portName = (n: AppNode | undefined, pid?: string | null) => {
    if (!n || n.type !== 'device' || !pid) return '';
    return n.data.ports?.[pid]?.label || stencilOf(n.data.stencilId)?.ports.find((p) => p.id === pid)?.label || pid;
  };
  const cable = new Map<string, string>();
  for (const e of page.edges) {
    if (e.source === node.id && e.sourceHandle) cable.set(e.sourceHandle, `${name(byId.get(e.target))} ${portName(byId.get(e.target), e.targetHandle)}`.trim());
    if (e.target === node.id && e.targetHandle) cable.set(e.targetHandle, `${name(byId.get(e.source))} ${portName(byId.get(e.source), e.sourceHandle)}`.trim());
  }
  const lines = stencil.ports
    .map((p) => {
      const pd = node.data.ports?.[p.id];
      if (!isDocumented(pd) && !cable.has(p.id)) return null;
      return {
        id: p.id,
        label: pd?.label || p.label,
        uplink: !!pd?.uplink,
        // What was written, plus where the cable goes when that says something different.
        to: [pd?.description, cable.get(p.id)].filter(Boolean).filter((v, i, all) => i === 0 || !all[0]!.includes(v!)).map((v, i) => (i ? `(${v})` : v)).join(' '),
        ip: pd?.ip ?? '',
        vlan: pd?.vlan ?? '',
        notes: pd?.notes ?? '',
      };
    })
    .filter((l): l is PortLine => !!l && (!onlyUplinks || l.uplink));
  return [...lines.filter((l) => l.uplink), ...lines.filter((l) => !l.uplink)];
}
