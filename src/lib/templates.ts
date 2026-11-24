/**
 * File → New templates (Visio's template gallery): starter drawings built from the default stencils only, and the
 * user's own templates saved from a client. Creating a client from a template copies it with fresh ids.
 */
import { planRack } from './autoRack';
import { newPage } from './project';
import { STENCIL_MAP } from './stencils';
import type { AppNode, CableEdge, DeviceNode, Page, Project, Rack } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

export interface Template {
  id: string;
  name: string;
  description: string;
  /** The template's drawing: pages, racks, layers, field definitions… (name and ids are replaced on use). */
  project: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
}

type Dev = { id: string; stencil: string; name: string; x: number; y: number; extra?: Record<string, unknown> };
const dev = (d: Dev): AppNode => ({ id: d.id, type: 'device', position: { x: d.x, y: d.y }, data: { stencilId: d.stencil, name: d.name, ...d.extra } }) as AppNode;
const cable = (a: string, ah: string, b: string, bh: string, extra: Record<string, unknown> = {}): CableEdge =>
  ({ id: `e-${uid()}`, type: 'cable', source: a, sourceHandle: ah, target: b, targetHandle: bh, data: { cable: 'Cat6', ...extra } }) as CableEdge;

function smallOffice(): Template['project'] {
  const nodes = [
    dev({ id: 'n-isp', stencil: 'internet', name: 'Internet', x: 494, y: -260 }),
    dev({ id: 'n-ont', stencil: 'modem', name: 'ISP modem', x: 494, y: -120 }),
    dev({ id: 'n-fw', stencil: 'sonicwall-tz570-670', name: 'Firewall', x: 200, y: 20 }),
    dev({ id: 'n-sw', stencil: 'switch-24-poe', name: 'Core switch', x: 441, y: 220 }),
    dev({ id: 'n-ap1', stencil: 'access-point', name: 'AP-1', x: 300, y: 440 }),
    dev({ id: 'n-ap2', stencil: 'access-point', name: 'AP-2', x: 440, y: 440 }),
    dev({ id: 'n-ws1', stencil: 'workstation', name: 'Workstation 1', x: 580, y: 440 }),
    dev({ id: 'n-ws2', stencil: 'workstation', name: 'Workstation 2', x: 720, y: 440 }),
    dev({ id: 'n-prn', stencil: 'printer', name: 'Printer', x: 860, y: 440 }),
    dev({ id: 'n-nas', stencil: 'nas', name: 'NAS', x: 1000, y: 440 }),
  ];
  const edges = [
    cable('n-isp', 'WAN', 'n-ont', 'UPLINK', { cable: 'Fiber' }),
    // X2 (top) faces the modem above and X3 (bottom) the switch below, so both runs are straight.
    cable('n-ont', 'LAN', 'n-fw', 'X2', { label: 'WAN' }),
    cable('n-fw', 'X3', 'n-sw', 'P1', { label: 'LAN' }),
    cable('n-sw', 'P2', 'n-ap1', 'ETH'),
    cable('n-sw', 'P4', 'n-ap2', 'ETH'),
    cable('n-sw', 'P6', 'n-ws1', 'NIC'),
    cable('n-sw', 'P8', 'n-ws2', 'NIC'),
    cable('n-sw', 'P10', 'n-prn', 'NIC'),
    cable('n-sw', 'P12', 'n-nas', 'NIC1'),
  ];
  const page = newPage('Network', 'network', nodes, edges);
  return { pages: [page], activePageId: page.id };
}

function rackRoom(): Template['project'] {
  const nodes = [
    dev({ id: 'n-fw', stencil: 'sonicwall-tz570-670', name: 'Firewall', x: 100, y: 0 }),
    dev({ id: 'n-sw', stencil: 'switch-48', name: 'Core switch', x: 60, y: 180 }),
    dev({ id: 'n-srv', stencil: 'server', name: 'Server 1', x: 120, y: 380 }),
    dev({ id: 'n-nas', stencil: 'nas', name: 'NAS', x: 300, y: 380 }),
    dev({ id: 'n-ups', stencil: 'ups', name: 'UPS', x: 480, y: 380 }),
  ];
  const edges = [
    cable('n-fw', 'X0', 'n-sw', 'P1'),
    cable('n-sw', 'P2', 'n-srv', 'NIC1'),
    cable('n-sw', 'P4', 'n-nas', 'NIC1'),
    cable('n-sw', 'P6', 'n-ups', 'NMC'),
  ];
  const page = newPage('Network', 'network', nodes, edges);
  const rack: Rack = {
    id: `r-${uid()}`, name: 'Rack A', units: 24, location: 'Server room',
    items: [
      { id: `ri-${uid()}`, kind: 'device', u: 23, height: 1, depth: 'full', nodeId: 'n-fw' },
      { id: `ri-${uid()}`, kind: 'cable-manager', u: 22, height: 1, depth: 'full', label: 'Cable manager' },
      { id: `ri-${uid()}`, kind: 'device', u: 21, height: 1, depth: 'full', nodeId: 'n-sw' },
      { id: `ri-${uid()}`, kind: 'cable-manager', u: 20, height: 1, depth: 'full', label: 'Cable manager' },
      { id: `ri-${uid()}`, kind: 'device', u: 14, height: 2, depth: 'full', nodeId: 'n-srv' },
      { id: `ri-${uid()}`, kind: 'device', u: 12, height: 1, depth: 'full', nodeId: 'n-nas' },
      { id: `ri-${uid()}`, kind: 'device', u: 1, height: 2, depth: 'full', nodeId: 'n-ups' },
      { id: `ri-${uid()}`, kind: 'pdu', u: 3, height: 1, depth: 'rear', label: 'PDU' },
    ],
  };
  return { pages: [page], activePageId: page.id, racks: [rack] };
}

function floorPlan(): Template['project'] {
  // A 40 × 30 ft office at 10 px per foot: four walls, a door, a window, an AP and a printer.
  const wall = (id: string, x: number, y: number, dx: number, dy: number): AppNode => ({ id, type: 'measure', position: { x, y }, data: { dx, dy, variant: 'wall', thickness: 8 } }) as AppNode;
  const nodes: AppNode[] = [
    wall('m-w1', 0, 0, 400, 0), wall('m-w2', 400, 0, 0, 300), wall('m-w3', 400, 300, -400, 0), wall('m-w4', 0, 300, 0, -300),
    { id: 's-door', type: 'shape', position: { x: 40, y: 220 }, width: 80, height: 80, data: { kind: 'door', text: '', fill: 'transparent', stroke: '#374151', textColor: '#111827', fontSize: 14, rotation: 0 } } as AppNode,
    { id: 's-win', type: 'shape', position: { x: 180, y: -7 }, width: 120, height: 14, data: { kind: 'window', text: '', fill: '#e0f2fe', stroke: '#374151', textColor: '#111827', fontSize: 14, rotation: 0 } } as AppNode,
    dev({ id: 'n-ap', stencil: 'access-point', name: 'AP-1', x: 168, y: 118 }),
    dev({ id: 'n-prn', stencil: 'printer', name: 'Printer', x: 320, y: 220 }),
  ];
  const page: Page = { ...newPage('Floor plan', 'floorplan', nodes), scale: { unit: 'ft', perPx: 0.1 } };
  return { pages: [page], activePageId: page.id };
}

/**
 * An office network as an MSP documents it, and the same equipment in its rack: the diagram shows ISP → firewall →
 * core switch, the switch patched to patch panel A, and the panel's back runs to each desk / AP / camera / phone
 * (wall jack numbers, lengths, VLANs, port speed and PoE noted). The rack is planned from the diagram exactly as
 * "Rack from Diagram" does, so its patch cords match the diagram's cables.
 */
function officeWithRack(): Template['project'] {
  const port = (speed: string, extra: Record<string, unknown> = {}) => ({ speed, status: 'up', ...extra });
  const swPorts: Record<string, unknown> = { P1: port('1G', { uplink: true, description: 'Firewall X3 (LAN)' }) };
  const drops = [
    { id: 'n-ap1', stencil: 'access-point', name: 'AP-1 Lobby', nic: 'ETH', vlan: '1', poe: 'PoE+', len: '95 ft', x: 0 },
    { id: 'n-ap2', stencil: 'access-point', name: 'AP-2 Office', nic: 'ETH', vlan: '1', poe: 'PoE+', len: '120 ft', x: 130 },
    { id: 'n-pc1', stencil: 'workstation', name: 'Front desk PC', nic: 'NIC', vlan: '10', len: '85 ft', x: 260 },
    { id: 'n-pc2', stencil: 'workstation', name: 'Office PC 1', nic: 'NIC', vlan: '10', len: '110 ft', x: 390 },
    { id: 'n-pc3', stencil: 'workstation', name: 'Office PC 2', nic: 'NIC', vlan: '10', len: '115 ft', x: 520 },
    { id: 'n-prn', stencil: 'printer', name: 'Printer', nic: 'NIC', vlan: '10', len: '60 ft', x: 650 },
    { id: 'n-cam', stencil: 'camera', name: 'Camera Entrance', nic: 'ETH', vlan: '30', poe: 'PoE', len: '140 ft', x: 780 },
    { id: 'n-ph1', stencil: 'phone', name: 'Reception phone', nic: 'LAN', vlan: '20', poe: 'PoE', len: '80 ft', x: 910 },
  ];
  const ppPorts: Record<string, unknown> = {};
  drops.forEach((d, i) => {
    ppPorts[`PP${i + 1}`] = { description: `Wall jack 1-${String(i + 1).padStart(2, '0')}` };
    swPorts[`P${(i + 1) * 2}`] = port('1G', { vlan: d.vlan, ...(d.poe ? { poe: d.poe } : {}) });
  });
  Object.assign(swPorts, { P18: port('10G', { description: 'Server 1' }), P20: port('1G'), P22: port('1G') });
  const nodes = [
    dev({ id: 'n-isp', stencil: 'internet', name: 'Internet', x: 410, y: -470 }),
    dev({ id: 'n-ont', stencil: 'modem', name: 'ISP modem', x: 410, y: -350, extra: { model: 'Fiber ONT' } }),
    dev({ id: 'n-fw', stencil: 'sonicwall-tz570-670', name: 'Firewall', x: 180, y: -220, extra: { ip: '10.0.0.1' } }),
    dev({ id: 'n-sw', stencil: 'switch-24-poe', name: 'Core switch', x: 140, y: -40, extra: { ip: '10.0.0.2', ports: swPorts } }),
    // The panel's name sits to its right, clear of the runs leaving its ports.
    dev({ id: 'n-pp', stencil: 'patch-panel-24', name: 'Patch panel A', x: 200, y: 200, extra: { ports: ppPorts, labelOffset: { x: 560, y: -44 } } }),
    ...drops.map((d) => dev({ id: d.id, stencil: d.stencil, name: d.name, x: d.x, y: 500 })),
    dev({ id: 'n-srv', stencil: 'server', name: 'Server 1', x: 1060, y: -60, extra: { ip: '10.0.0.10', model: 'Hyper-V host' } }),
    dev({ id: 'n-nas', stencil: 'nas', name: 'NAS', x: 1060, y: 80, extra: { ip: '10.0.0.20' } }),
    dev({ id: 'n-ups', stencil: 'ups', name: 'UPS', x: 1060, y: 220, extra: { ip: '10.0.0.30' } }),
  ];
  const edges = [
    cable('n-isp', 'WAN', 'n-ont', 'UPLINK', { cable: 'Fiber' }),
    // X2 (top) faces the modem above and X3 (bottom) the switch below, so both runs are straight.
    cable('n-ont', 'LAN', 'n-fw', 'X2', { label: 'WAN' }),
    cable('n-fw', 'X3', 'n-sw', 'P1', { label: 'LAN', length: '3 ft' }),
    // Front: short patch cords from the switch to the panel. Back: the permanent runs to each wall jack.
    // (The cords' colour shows their VLAN: blue data, yellow voice, red cameras.)
    ...drops.map((d, i) => cable('n-sw', `P${(i + 1) * 2}`, 'n-pp', `PP${i + 1}`, { length: '1 ft', color: d.vlan === '20' ? '#eab308' : d.vlan === '30' ? '#dc2626' : '#2563eb' })),
    ...drops.map((d, i) => cable('n-pp', `PP${i + 1}`, d.id, d.nic, { vlan: d.vlan, length: d.len })),
    cable('n-sw', 'P18', 'n-srv', 'NIC1', { length: '3 ft' }),
    cable('n-sw', 'P20', 'n-nas', 'NIC1', { length: '3 ft' }),
    cable('n-sw', 'P22', 'n-ups', 'NMC', { length: '3 ft' }),
  ];
  const page = newPage('Network', 'network', nodes, edges);
  const { rack } = planRack('Rack A', nodes.filter((n): n is DeviceNode => n.type === 'device'), (id) => STENCIL_MAP[id], edges.map((e) => ({ a: e.source, b: e.target })), { spare: 6 });
  rack.location = 'Server closet';
  return { pages: [page], activePageId: page.id, racks: [rack] };
}

export const BUILT_IN_TEMPLATES: Template[] = [
  { id: 'tpl-office', name: 'Small office network', description: 'ISP → firewall → PoE switch → access points, workstations, printer and NAS, all cabled.', project: smallOffice() },
  { id: 'tpl-office-rack', name: 'Office network + rack', description: 'A full office network (firewall, PoE switch, patch panel, desks, APs, camera, phone, server, NAS, UPS) and the same equipment in its rack, patch cords included.', project: officeWithRack() },
  { id: 'tpl-rack', name: 'Server rack', description: 'Firewall, 48-port switch, server, NAS and UPS cabled, and mounted in a 24U rack with cable managers and a PDU.', project: rackRoom() },
  { id: 'tpl-floor', name: 'Office floor plan', description: 'A 40 × 30 ft room drawn to scale: walls, door, window, an access point and a printer.', project: floorPlan() },
];

/** A copy of a template as a new client: every page, item, cable, rack and layer gets a fresh id. */
export function projectFromTemplate(t: Template['project'], name: string): Project {
  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    if (!ids.has(old)) ids.set(old, `${old.split('-')[0] || 'x'}-${uid()}`);
    return ids.get(old)!;
  };
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const src = clone(t);
  for (const pg of src.pages) for (const n of pg.nodes) fresh(n.id);
  const pages: Page[] = src.pages.map((pg) => {
    const pid = fresh(pg.id);
    return {
      ...pg,
      id: pid,
      backgroundId: pg.backgroundId ? fresh(pg.backgroundId) : undefined,
      nodes: pg.nodes.map((n) => {
        const out = { ...n, id: fresh(n.id), selected: false } as AppNode;
        if (out.type === 'shape' && out.data.target) out.data = { ...out.data, target: fresh(out.data.target) };
        return out;
      }),
      edges: pg.edges.map((e) => ({ ...e, id: `e-${uid()}`, source: fresh(e.source), target: fresh(e.target), selected: false })),
    };
  });
  const layerIds = new Map((src.layers ?? []).map((l) => [l.id, `l-${uid()}`]));
  const relayer = <T extends { data?: Record<string, unknown> }>(x: T): T => {
    const l = x.data?.layer as string | undefined;
    return l && layerIds.has(l) ? { ...x, data: { ...x.data, layer: layerIds.get(l) } } : x;
  };
  for (const pg of pages) {
    pg.nodes = pg.nodes.map((n) => relayer(n));
    pg.edges = pg.edges.map((e) => relayer(e));
  }
  const now = Date.now();
  return {
    ...src,
    id: uid(),
    name,
    pages,
    activePageId: ids.get(src.activePageId) ?? pages[0].id,
    layers: src.layers?.map((l) => ({ ...l, id: layerIds.get(l.id)! })),
    racks: src.racks?.map((r) => ({ ...r, id: `r-${uid()}`, items: r.items.map((it) => ({ ...it, id: `ri-${uid()}`, nodeId: it.nodeId ? ids.get(it.nodeId) : undefined })) })),
    reports: src.reports?.map((r) => ({ ...r, pageId: r.pageId ? ids.get(r.pageId) : undefined, layer: r.layer && r.layer !== '-' ? layerIds.get(r.layer) : r.layer })),
    createdAt: now,
    updatedAt: now,
  };
}

/** What a client becomes as a template: its drawing without the client's own details. */
export function templateFromProject(p: Project, name: string, description: string): Template {
  const { id: _id, name: _n, createdAt: _c, updatedAt: _u, site: _s, address: _a, contact: _ct, dataLink: _d, ...rest } = p;
  void _id; void _n; void _c; void _u; void _s; void _a; void _ct; void _d;
  return { id: `tpl-${uid()}`, name, description, project: JSON.parse(JSON.stringify(rest)) };
}
