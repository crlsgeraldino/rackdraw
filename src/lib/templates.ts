/**
 * File → New templates (Visio's template gallery): starter drawings built from the default stencils only, and the
 * user's own templates saved from a client. Creating a client from a template copies it with fresh ids.
 */
import { planRack, planRacks } from './autoRack';
import { PAGE_LINK } from './links';
import { newPage } from './project';
import { STENCIL_MAP } from './stencils';
import type { VlanDef } from './ipam';
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
  const vlans = [
    vl('1', 'Management', '10.0.0.0/24', '10.0.0.1', '#64748b', ['10.0.0.100', '10.0.0.199'], 'Network gear, servers, APs'),
    vl('10', 'Data', '10.0.10.0/24', '10.0.10.1', '#2563eb', ['10.0.10.50', '10.0.10.250']),
    vl('20', 'Voice', '10.0.20.0/24', '10.0.20.1', '#eab308', ['10.0.20.50', '10.0.20.250']),
    vl('30', 'Cameras', '10.0.30.0/24', '10.0.30.1', '#dc2626', undefined, 'Static addresses'),
  ];
  return { pages: [page], activePageId: page.id, racks: [rack], vlans };
}


/** A date `days` from today (YYYY-MM-DD): template lifecycle dates stay meaningful whenever a client is created. */
const dateIn = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** A VLAN of a template's IP plan. */
const vl = (vlan: string, name: string, subnet: string, gateway: string, color: string, dhcp?: [string, string], notes?: string): VlanDef =>
  ({ id: `v-${vlan}`, vlan, name, subnet, gateway, color, ...(dhcp ? { dhcpStart: dhcp[0], dhcpEnd: dhcp[1] } : {}), ...(notes ? { notes } : {}) });

/* ------------------------------------------------------------------ */
/*  Medium and large networks                                          */
/* ------------------------------------------------------------------ */

const zone = (id: string, title: string, x: number, y: number, w: number, h: number, color: string): AppNode =>
  ({ id, type: 'zone', position: { x, y }, zIndex: -1, style: { width: w, height: h }, data: { title, color, style: 'header' } }) as AppNode;

type DropKind = 'ap' | 'pc' | 'printer' | 'phone' | 'camera';
const DROP: Record<DropKind, { stencil: string; nic: string; vlan: string; poe?: string }> = {
  ap: { stencil: 'access-point', nic: 'ETH', vlan: '1', poe: 'PoE+' },
  pc: { stencil: 'workstation', nic: 'NIC', vlan: '10' },
  printer: { stencil: 'printer', nic: 'NIC', vlan: '10' },
  phone: { stencil: 'phone', nic: 'LAN', vlan: '20', poe: 'PoE' },
  camera: { stencil: 'camera', nic: 'ETH', vlan: '30', poe: 'PoE' },
};
const vlanColor = (v: string) => (v === '20' ? '#eab308' : v === '30' ? '#dc2626' : '#2563eb');

/**
 * One wiring closet (MDF / IDF) in a zone: an optional fiber panel for the backbone, then each copper patch panel
 * above its access switch (front cords straight up to the switch's top row), the drops below, and a UPS.
 * Returns its nodes, cables, and the ids the caller wires uplinks to.
 */
function closet(o: {
  key: string; title: string; short: string; location: string; x: number; y: number; color: string; ipBase: string; jackPrefix: string;
  fiber?: boolean; stacks: { name: string; drops: [DropKind, string, string][] }[]; zoneH: number; endpointsY: number;
}) {
  const nodes: AppNode[] = [];
  const edges: CableEdge[] = [];
  const at = (dx: number, dy: number) => ({ x: o.x + dx, y: o.y + dy });
  const loc = { location: o.location };
  nodes.push(zone(`z-${o.key}`, o.title, o.x, o.y - 50, 870, o.zoneH, o.color));
  const fp = o.fiber ? `n-${o.key}-fp` : undefined;
  if (fp) nodes.push(dev({ id: fp, stencil: 'patch-panel-fiber-24', name: `${o.short} fiber panel`, ...at(40, 0), extra: { ...loc, ports: { PP1: { description: 'Backbone to MDF / core' }, PP2: { description: 'Backbone to MDF / core' } } } }));
  nodes.push(dev({ id: `n-${o.key}-ups`, stencil: 'ups', name: `${o.short} UPS`, ...at(770, 0), extra: { ...loc, model: '1500VA rack UPS' } }));
  const switches: string[] = [];
  let y = fp ? 100 : 0;
  let col = 0;
  o.stacks.forEach((st, si) => {
    const pp = `n-${o.key}-pp${si + 1}`, sw = `n-${o.key}-sw${si + 1}`;
    switches.push(sw);
    const swPorts: Record<string, unknown> = { SFP1: { speed: '10G', status: 'up', uplink: true, description: 'Uplink to core' } };
    const ppPorts: Record<string, unknown> = {};
    st.drops.forEach(([kind, name, len], i) => {
      const d = DROP[kind];
      const eid = `n-${o.key}-d${si + 1}-${i + 1}`;
      ppPorts[`PP${i + 1}`] = { description: `Wall jack ${o.jackPrefix}-${String(si * 48 + i + 1).padStart(2, '0')}` };
      swPorts[`P${i * 2 + 1}`] = { speed: '1G', status: 'up', vlan: d.vlan, ...(d.poe ? { poe: d.poe } : {}) };
      nodes.push(dev({ id: eid, stencil: d.stencil, name, x: o.x + 20 + col * 135, y: o.endpointsY }));
      col++;
      edges.push(cable(pp, `PP${i + 1}`, sw, `P${i * 2 + 1}`, { length: '1 ft', color: vlanColor(d.vlan) }));
      edges.push(cable(pp, `PP${i + 1}`, eid, d.nic, { vlan: d.vlan, length: len }));
    });
    nodes.push(dev({ id: pp, stencil: 'patch-panel-48', name: `${st.name} panel`, ...at(40, y), extra: { ...loc, ports: ppPorts } }));
    nodes.push(dev({ id: sw, stencil: 'switch-48-poe', name: st.name, ...at(40, y + 120), extra: { ...loc, ip: `${o.ipBase}${si + 1}`, ports: swPorts } }));
    y += 210;
  });
  if (o.stacks.length > 1) edges.push(cable(switches[0], 'SFP4', switches[1], 'SFP3', { cable: 'DAC', label: 'Stack', length: '1.6 ft' }));
  edges.push(cable(switches[switches.length - 1], 'P48', `n-${o.key}-ups`, 'NMC', { length: '3 ft' }));
  return { nodes, edges, fp, switches };
}

/**
 * Medium network (25–150 users, one building, three floors): dual-WAN firewall, a 10G core switch in the MDF with the
 * servers, NAS and UPS, and an IDF on each upper floor fed by an OM4 fiber backbone. Each room gets its own rack.
 */
function mediumNetwork(): Template['project'] {
  const nodes: AppNode[] = [];
  const edges: CableEdge[] = [];
  const loc = { location: 'MDF' };
  nodes.push(
    dev({ id: 'n-isp1', stencil: 'internet', name: 'ISP 1 (fiber 1 Gbps)', x: 220, y: -620, extra: { circuit: { carrier: 'Fiber ISP', circuitId: 'DIA-0001', kind: 'DIA (dedicated Internet)', bandwidth: '1 Gbps', staticIps: '203.0.113.8/29', contractEnd: dateIn(400) } } }),
    dev({ id: 'n-isp2', stencil: 'internet', name: 'ISP 2 (cable, backup)', x: 560, y: -620, extra: { circuit: { carrier: 'Cable ISP', circuitId: 'BB-0002', kind: 'Broadband', bandwidth: '500 / 50 Mbps', contractEnd: dateIn(45) } } }),
    dev({ id: 'n-ont', stencil: 'modem', name: 'Fiber ONT', x: 220, y: -500 }),
    dev({ id: 'n-cm', stencil: 'modem', name: 'Cable modem', x: 560, y: -500, extra: { model: 'DOCSIS 3.1 cable modem' } }),
    dev({ id: 'n-fw', stencil: 'sonicwall-tz570-670', name: 'Firewall', x: 140, y: -370, extra: { ...loc, ip: '10.10.0.1', purchaseDate: dateIn(-1400), warrantyEnd: dateIn(60), endOfLife: dateIn(700) } }),
  );
  edges.push(
    cable('n-isp1', 'WAN', 'n-ont', 'UPLINK', { cable: 'Fiber' }),
    cable('n-isp2', 'WAN', 'n-cm', 'UPLINK', { cable: 'WAN', label: 'Coax' }),
    cable('n-ont', 'LAN', 'n-fw', 'X2', { label: 'WAN 1' }),
    cable('n-cm', 'LAN', 'n-fw', 'X4', { label: 'WAN 2' }),
  );
  // MDF (floor 1): core switch, its fiber panel, floor 1's closet, and the servers.
  const mdf = closet({
    key: 'mdf', title: 'MDF (Floor 1)', short: 'MDF', location: 'MDF', x: 0, y: -100, color: '#2563eb', ipBase: '10.10.1.1', jackPrefix: '1', fiber: true,
    zoneH: 760, endpointsY: 520,
    stacks: [{ name: 'MDF-SW1', drops: [['ap', 'AP-1 Lobby', '90 ft'], ['pc', 'Reception PC', '70 ft'], ['pc', 'Accounting PC', '120 ft'], ['printer', 'Floor 1 MFP', '60 ft'], ['phone', 'Reception phone', '70 ft'], ['camera', 'Camera Entrance', '150 ft']] }],
  });
  nodes.push(...mdf.nodes);
  // The MDF also powers the servers and the core: a bigger UPS than the floor closets' 1500 VA units.
  const mdfUps = mdf.nodes.find((n) => n.id === 'n-mdf-ups');
  if (mdfUps?.type === 'device') mdfUps.data = { ...mdfUps.data, model: '3000VA rack UPS', ups: { capacityW: 2700, runtimeHalfMin: 18 } };
  edges.push(...mdf.edges);
  // The MDF zone is wider: core switch and servers sit to the right of the closet.
  (nodes.find((n) => n.id === 'z-mdf') as { style: { width: number } }).style.width = 1420;
  nodes.push(
    dev({ id: 'n-core', stencil: 'switch-core-24sfp', name: 'Core switch', x: 880, y: 0, extra: { ...loc, ip: '10.10.0.2', model: '24× 10G SFP+ L3 core switch', purchaseDate: dateIn(-300), warrantyEnd: dateIn(1525) } }),
    dev({ id: 'n-h1', stencil: 'server', name: 'Host-1', x: 900, y: 200, extra: { ...loc, ip: '10.10.0.21', model: 'Hyper-V host', purchaseDate: dateIn(-1900), warrantyEnd: dateIn(-75), endOfLife: dateIn(500) } }),
    dev({ id: 'n-h2', stencil: 'server', name: 'Host-2', x: 1040, y: 200, extra: { ...loc, ip: '10.10.0.22', model: 'Hyper-V host', purchaseDate: dateIn(-700), warrantyEnd: dateIn(1125) } }),
    dev({ id: 'n-nas', stencil: 'nas', name: 'Backup NAS', x: 1180, y: 200, extra: { ...loc, ip: '10.10.0.30' } }),
  );
  edges.push(
    cable('n-fw', 'X3', 'n-core', 'X1', { label: 'LAN', length: '3 ft' }),
    cable('n-core', 'X3', 'n-mdf-sw1', 'SFP1', { cable: 'DAC', label: '10G', length: '3 ft' }),
    cable('n-core', 'X2', 'n-h1', 'NIC1', { cable: 'DAC', length: '6 ft' }),
    cable('n-core', 'X4', 'n-h2', 'NIC1', { cable: 'DAC', length: '6 ft' }),
    cable('n-core', 'X6', 'n-nas', 'NIC1', { cable: 'DAC', length: '6 ft' }),
  );
  // IDFs on floors 2 and 3, each on a pair of backbone fibers from the MDF.
  const idfs = [
    closet({
      key: 'idf1', title: 'IDF-1 (Floor 2)', short: 'IDF-1', location: 'IDF-1 (Floor 2)', x: 1520, y: -100, color: '#16a34a', ipBase: '10.10.2.1', jackPrefix: '2', fiber: true, zoneH: 760, endpointsY: 520,
      stacks: [{ name: 'IDF1-SW1', drops: [['ap', 'AP-2 Floor 2', '110 ft'], ['ap', 'AP-3 Conference', '140 ft'], ['pc', 'Sales PC 1', '95 ft'], ['pc', 'Sales PC 2', '100 ft'], ['printer', 'Floor 2 MFP', '65 ft'], ['phone', 'Sales phone', '95 ft']] }],
    }),
    closet({
      key: 'idf2', title: 'IDF-2 (Floor 3)', short: 'IDF-2', location: 'IDF-2 (Floor 3)', x: 2440, y: -100, color: '#9333ea', ipBase: '10.10.3.1', jackPrefix: '3', fiber: true, zoneH: 760, endpointsY: 520,
      stacks: [{ name: 'IDF2-SW1', drops: [['ap', 'AP-4 Floor 3', '105 ft'], ['pc', 'Engineering PC 1', '85 ft'], ['pc', 'Engineering PC 2', '90 ft'], ['phone', 'Engineering phone', '85 ft'], ['camera', 'Camera Stairwell', '130 ft'], ['printer', 'Plotter', '70 ft']] }],
    }),
  ];
  idfs.forEach((c, i) => {
    nodes.push(...c.nodes);
    edges.push(
      ...c.edges,
      cable('n-core', `X${5 + i * 2}`, mdf.fp!, `PP${i + 1}`, { cable: 'Fiber MM', length: '3 ft' }),
      cable(mdf.fp!, `PP${i + 1}`, c.fp!, 'PP1', { cable: 'Fiber MM', label: 'OM4 backbone', length: `${180 + i * 40} ft` }),
      cable(c.fp!, 'PP1', c.switches[0], 'SFP1', { cable: 'Fiber MM', length: '3 ft' }),
    );
  });
  const page = newPage('Network', 'network', nodes, edges);
  const { racks } = planRacks('Rack A', nodes.filter((n): n is DeviceNode => n.type === 'device'), (id) => STENCIL_MAP[id], edges.map((e) => ({ a: e.source, b: e.target })), { spare: 6 });
  const vlans = [
    vl('1', 'Management', '10.10.0.0/22', '10.10.0.1', '#64748b', undefined, 'Firewall, core, servers (10.10.0.x); closet switches 10.10.1-3.x'),
    vl('10', 'Data', '10.10.10.0/23', '10.10.10.1', '#2563eb', ['10.10.10.50', '10.10.11.250']),
    vl('20', 'Voice', '10.10.20.0/24', '10.10.20.1', '#eab308', ['10.10.20.50', '10.10.20.250']),
    vl('30', 'Cameras', '10.10.30.0/24', '10.10.30.1', '#dc2626', undefined, 'Static addresses'),
    vl('40', 'Guest Wi-Fi', '10.10.40.0/24', '10.10.40.1', '#16a34a', ['10.10.40.20', '10.10.40.250'], 'Internet only'),
  ];
  for (const r of racks) { r.feedVolts = 120; r.feedAmps = r.location === 'MDF' ? 20 : 15; }
  return { pages: [page], activePageId: page.id, racks, vlans };
}

/**
 * Large network (150+ users, campus): two ISPs on an HA firewall pair, a redundant core pair in the data center with
 * the virtualization hosts, SAN, backup and an out-of-band management switch, and three buildings each with a
 * two-switch access stack, dual-homed to both cores over single-mode fiber. One rack per room.
 */
function largeNetwork(): Template['project'] {
  const nodes: AppNode[] = [];
  const edges: CableEdge[] = [];
  const dc = { location: 'Data center' };
  nodes.push(
    zone('z-dc', 'Data center', 0, -700, 2660, 560, '#0f766e'),
    dev({ id: 'n-isp1', stencil: 'internet', name: 'ISP 1 (10 Gbps DIA)', x: 900, y: -1020 }),
    dev({ id: 'n-isp2', stencil: 'internet', name: 'ISP 2 (1 Gbps DIA)', x: 1560, y: -1020 }),
    dev({ id: 'n-fw1', stencil: 'firewall', name: 'FW-1 (active)', x: 900, y: -860, extra: { ...dc, ip: '10.0.0.2' } }),
    dev({ id: 'n-fw2', stencil: 'firewall', name: 'FW-2 (standby)', x: 1560, y: -860, extra: { ...dc, ip: '10.0.0.3' } }),
    dev({ id: 'n-core1', stencil: 'switch-core-24sfp', name: 'CORE-1', x: 640, y: -640, extra: { ...dc, ip: '10.0.0.11' } }),
    dev({ id: 'n-core2', stencil: 'switch-core-24sfp', name: 'CORE-2', x: 1300, y: -640, extra: { ...dc, ip: '10.0.0.12' } }),
    dev({ id: 'n-dcfp', stencil: 'patch-panel-fiber-24', name: 'DC fiber panel', x: 900, y: -500, extra: { ...dc } }),
    dev({ id: 'n-oob', stencil: 'switch-24-poe', name: 'OOB mgmt switch', x: 1900, y: -420, extra: { ...dc, ip: '10.0.99.2', model: '24-port management switch' } }),
    dev({ id: 'n-upsa', stencil: 'ups', name: 'UPS-A', x: 2420, y: -620, extra: { ...dc, ip: '10.0.99.41', model: '5kVA rack UPS' } }),
    dev({ id: 'n-upsb', stencil: 'ups', name: 'UPS-B', x: 2540, y: -620, extra: { ...dc, ip: '10.0.99.42', model: '5kVA rack UPS' } }),
  );
  edges.push(
    cable('n-isp1', 'WAN', 'n-fw1', 'WAN', { cable: 'Fiber', label: 'ISP 1' }),
    cable('n-isp2', 'WAN', 'n-fw2', 'WAN', { cable: 'Fiber', label: 'ISP 2' }),
    cable('n-fw1', 'HA', 'n-fw2', 'MGMT', { label: 'HA sync', length: '3 ft' }),
    cable('n-fw1', 'LAN', 'n-core1', 'X1', { cable: 'DAC', length: '3 ft' }),
    cable('n-fw2', 'LAN', 'n-core2', 'X1', { cable: 'DAC', length: '3 ft' }),
    cable('n-core1', 'Q1', 'n-core2', 'Q1', { cable: 'DAC', label: '100G ISL', length: '3 ft' }),
    cable('n-core1', 'X24', 'n-oob', 'SFP1', { cable: 'Fiber', label: 'Mgmt', length: '6 ft' }),
    cable('n-oob', 'P2', 'n-upsa', 'NMC', { length: '6 ft' }),
    cable('n-oob', 'P4', 'n-upsb', 'NMC', { length: '6 ft' }),
  );
  // Servers and storage: every host dual-homed to both cores, iDRAC/iLO on the OOB switch.
  const hosts = ['HV-01', 'HV-02', 'HV-03', 'HV-04'];
  hosts.forEach((h, i) => {
    const id = `n-hv${i + 1}`;
    nodes.push(dev({ id, stencil: 'server', name: h, x: 60 + i * 130, y: -400, extra: { ...dc, ip: `10.0.10.${21 + i}`, model: 'Virtualization host' } }));
    edges.push(
      cable('n-core1', `X${10 + i * 2}`, id, 'NIC1', { cable: 'DAC', length: '6 ft' }),
      cable('n-core2', `X${10 + i * 2}`, id, 'NIC2', { cable: 'DAC', length: '6 ft' }),
      cable('n-oob', `P${6 + i * 2}`, id, 'MGMT', { length: '6 ft' }),
    );
  });
  nodes.push(
    dev({ id: 'n-san', stencil: 'san', name: 'SAN-01', x: 60, y: -600, extra: { ...dc, ip: '10.0.20.10' } }),
    dev({ id: 'n-bk', stencil: 'nas', name: 'Backup NAS', x: 220, y: -600, extra: { ...dc, ip: '10.0.20.30' } }),
  );
  edges.push(
    cable('n-core1', 'X18', 'n-san', 'CTRL-A', { cable: 'DAC', length: '6 ft' }),
    cable('n-core2', 'X18', 'n-san', 'CTRL-B', { cable: 'DAC', length: '6 ft' }),
    cable('n-oob', 'P14', 'n-san', 'MGMT', { length: '6 ft' }),
    cable('n-core1', 'X20', 'n-bk', 'NIC1', { cable: 'DAC', length: '6 ft' }),
  );
  // Three buildings, each with a two-switch access stack: switch 1 homes to CORE-1, switch 2 to CORE-2.
  const buildings: { key: string; name: string; color: string; len: number; stacks: { name: string; drops: [DropKind, string, string][] }[] }[] = [
    { key: 'ba', name: 'Building A', color: '#2563eb', len: 420, stacks: [
      { name: 'BA-SW1', drops: [['ap', 'A AP-1', '120 ft'], ['pc', 'A Desk 101', '90 ft'], ['printer', 'A MFP', '70 ft']] },
      { name: 'BA-SW2', drops: [['pc', 'A Desk 102', '95 ft'], ['phone', 'A Phone 101', '90 ft'], ['camera', 'A Camera Lobby', '160 ft']] }] },
    { key: 'bb', name: 'Building B', color: '#16a34a', len: 650, stacks: [
      { name: 'BB-SW1', drops: [['ap', 'B AP-1', '110 ft'], ['pc', 'B Desk 201', '85 ft'], ['printer', 'B MFP', '60 ft']] },
      { name: 'BB-SW2', drops: [['pc', 'B Desk 202', '100 ft'], ['phone', 'B Phone 201', '85 ft'], ['camera', 'B Camera Dock', '180 ft']] }] },
    { key: 'bc', name: 'Building C', color: '#9333ea', len: 900, stacks: [
      { name: 'BC-SW1', drops: [['ap', 'C AP-1', '130 ft'], ['pc', 'C Lab PC 1', '75 ft'], ['pc', 'C Lab PC 2', '80 ft']] },
      { name: 'BC-SW2', drops: [['ap', 'C AP-2', '140 ft'], ['phone', 'C Phone 301', '75 ft'], ['camera', 'C Camera Yard', '190 ft']] }] },
  ];
  buildings.forEach((b, bi) => {
    const c = closet({
      key: b.key, title: `${b.name} IDF`, short: `${b.key.toUpperCase()}-IDF`, location: `${b.name} IDF`, x: bi * 930, y: 0, color: b.color, ipBase: `10.0.${100 + bi}.`, jackPrefix: b.name.slice(-1),
      fiber: true, stacks: b.stacks, zoneH: 860, endpointsY: 680,
    });
    nodes.push(...c.nodes);
    edges.push(...c.edges);
    c.switches.forEach((sw, si) => {
      const dcPort = `PP${bi * 2 + si + 1}`;
      edges.push(
        cable(si ? 'n-core2' : 'n-core1', `X${3 + bi * 2}`, 'n-dcfp', dcPort, { cable: 'Fiber SM', length: '3 ft' }),
        cable('n-dcfp', dcPort, c.fp!, `PP${si + 1}`, { cable: 'Fiber SM', ...(si ? {} : { label: `OS2 to ${b.name}` }), length: `${b.len} ft` }),
        cable(c.fp!, `PP${si + 1}`, sw, 'SFP1', { cable: 'Fiber SM', length: '3 ft' }),
      );
    });
  });
  const page = newPage('Campus network', 'network', nodes, edges);
  const { racks } = planRacks('Rack A', nodes.filter((n): n is DeviceNode => n.type === 'device'), (id) => STENCIL_MAP[id], edges.map((e) => ({ a: e.source, b: e.target })), { spare: 6 });
  const vlans = [
    vl('1', 'Network management', '10.0.0.0/24', '10.0.0.1', '#64748b', undefined, 'Firewalls (.2/.3), cores (.11/.12); gateway is the firewall VIP'),
    vl('10', 'Data', '10.1.0.0/22', '10.1.0.1', '#2563eb', ['10.1.0.50', '10.1.3.250']),
    vl('20', 'Voice', '10.1.20.0/24', '10.1.20.1', '#eab308', ['10.1.20.50', '10.1.20.250']),
    vl('30', 'Cameras', '10.1.30.0/24', '10.1.30.1', '#dc2626', undefined, 'Static addresses'),
    vl('99', 'Out-of-band management', '10.0.99.0/24', '10.0.99.1', '#0f766e', undefined, 'iDRAC / iLO, UPS cards'),
    vl('100', 'Switch management', '10.0.100.0/22', '10.0.100.254', '#7c3aed', undefined, 'One /24 per building'),
    vl('110', 'Servers', '10.0.10.0/24', '10.0.10.1', '#0891b2'),
    vl('120', 'Storage', '10.0.20.0/24', '10.0.20.1', '#9333ea'),
  ];
  for (const r of racks) Object.assign(r, r.location === 'Data center' ? { feedVolts: 208, feedAmps: 30, redundantFeeds: true } : { feedVolts: 120, feedAmps: 20 });
  return { pages: [page], activePageId: page.id, racks, vlans };
}

/**
 * One page per kind of network, PAN to WAN, each drawn with the equipment it uses: a reference for techs and a
 * starting point for each kind of job.
 */
function networkTypes(): Template['project'] {
  const D = (id: string, stencil: string, name: string, x: number, y: number, extra?: Record<string, unknown>) => dev({ id, stencil, name, x, y, extra });
  const C = cable;
  const note = (id: string, text: string, x: number, y: number): AppNode =>
    ({ id, type: 'note', position: { x, y }, style: { width: 520, height: 64 }, data: { text } }) as AppNode;

  const pan = newPage('PAN', 'network', [
    note('t-pan', 'PAN: personal area network. Bluetooth and USB devices around one person.', 0, -120),
    D('n-lap', 'laptop', 'Laptop', 220, 0),
    D('n-dock', 'usb-hub', 'USB-C dock', 220, 150),
    D('n-bta', 'bt-adapter', 'Bluetooth adapter', 60, 300),
    D('n-hs', 'headset', 'Headset', -120, 300),
    D('n-kb', 'keyboard-mouse', 'Keyboard / mouse', 380, 300),
    D('n-ph', 'smartphone', 'Smartphone', 620, 0),
    D('n-wt', 'smartwatch', 'Smartwatch', 800, 0),
    D('n-tab', 'tablet', 'Tablet', 620, 300),
    D('n-hot', 'hotspot', 'Mobile hotspot', 620, 150),
  ], [
    C('n-lap', 'NIC', 'n-dock', 'HOST', { cable: 'USB' }),
    C('n-dock', 'U1', 'n-bta', 'USB', { cable: 'USB' }),
    C('n-bta', 'BT', 'n-hs', 'BT', { cable: 'Bluetooth' }),
    C('n-dock', 'U2', 'n-kb', 'BT', { cable: 'USB', label: '2.4 GHz receiver' }),
    C('n-ph', 'BT', 'n-wt', 'BT', { cable: 'Bluetooth' }),
    C('n-ph', 'WIFI', 'n-hot', 'CELL', { cable: 'Cellular', label: 'Tethering' }),
    C('n-hot', 'WIFI', 'n-tab', 'WIFI', { cable: 'Wireless' }),
  ]);

  const wlan = newPage('WLAN', 'network', [
    note('t-wlan', 'WLAN: wireless LAN. PoE switch, controller, indoor / outdoor / mesh APs, a point-to-point bridge, clients.', 0, -160),
    D('n-wsw', 'switch-24-poe', 'PoE switch', 200, 0, { ip: '10.20.0.2' }),
    D('n-wlc', 'wlc', 'WLAN controller', 300, -110, { ip: '10.20.0.5' }),
    D('n-ap1', 'access-point', 'AP-1 Office', 0, 220, { ip: '10.20.0.11' }),
    D('n-ap2', 'access-point', 'AP-2 Lobby', 180, 220, { ip: '10.20.0.12' }),
    D('n-apo', 'ap-outdoor', 'AP-3 Patio (outdoor)', 360, 220),
    D('n-inj', 'poe-injector', 'PoE injector', 560, 220),
    D('n-brA', 'wireless-bridge', 'Bridge A (roof)', 760, 220),
    D('n-brB', 'wireless-bridge', 'Bridge B (annex)', 980, 220),
    D('n-mesh', 'mesh-node', 'Mesh root (annex)', 980, 400),
    D('n-ext', 'range-extender', 'Range extender', 1160, 400),
    D('n-c1', 'laptop', 'Laptop', 0, 420),
    D('n-c2', 'smartphone', 'Phone', 180, 420),
    D('n-c3', 'tablet', 'Tablet', 980, 580),
  ], [
    C('n-wlc', 'UPLINK', 'n-wsw', 'SFP1', { cable: 'DAC' }),
    C('n-wsw', 'P2', 'n-ap1', 'ETH', { label: 'PoE+' }),
    C('n-wsw', 'P4', 'n-ap2', 'ETH', { label: 'PoE+' }),
    C('n-wsw', 'P6', 'n-apo', 'ETH', { label: 'PoE+' }),
    C('n-wsw', 'P8', 'n-inj', 'DATA'),
    C('n-inj', 'POE', 'n-brA', 'ETH'),
    C('n-brA', 'AIR', 'n-brB', 'AIR', { cable: 'Wireless', label: '60 GHz, 450 ft' }),
    C('n-brB', 'ETH', 'n-mesh', 'ETH'),
    C('n-mesh', 'MESH', 'n-ext', 'WIFI', { cable: 'Wireless', label: 'Mesh' }),
    C('n-mesh', 'WIFI', 'n-c3', 'WIFI', { cable: 'Wireless' }),
    C('n-ap1', 'WIFI', 'n-c1', 'NIC', { cable: 'Wireless' }),
    C('n-ap2', 'WIFI', 'n-c2', 'WIFI', { cable: 'Wireless' }),
  ]);

  const lanEnd: [string, string, string, string][] = [
    ['n-lws', 'workstation', 'Desk PC (via wall jack)', 'NIC'], ['n-lph', 'phone', 'IP phone', 'LAN'], ['n-lpr', 'printer', 'Printer', 'NIC'],
    ['n-lnvr', 'nvr', 'NVR', 'NIC1'], ['n-ldsp', 'display', 'Lobby display', 'ETH'], ['n-lac', 'access-control', 'Door controller', 'ETH'],
    ['n-lcf', 'conference', 'Conference room', 'ETH'], ['n-lpos', 'pos-terminal', 'POS terminal', 'ETH'], ['n-liot', 'iot-device', 'IoT gateway', 'ETH'],
    ['n-lsrv', 'server', 'Server', 'NIC1'], ['n-lcs', 'console-server', 'Console server', 'NET'], ['n-lkvm', 'kvm', 'KVM', 'NET'],
  ];
  const lan = newPage('LAN', 'network', [
    note('t-lan', 'LAN: one building. Firewall, access switch, patch panel and wall jack, and what plugs into the network.', 0, -280),
    D('n-lfw', 'firewall', 'Firewall', 300, -200, { ip: '10.30.0.1' }),
    D('n-lsw', 'switch-24-poe', 'Access switch', 140, -60, { ip: '10.30.0.2' }),
    D('n-lpp', 'patch-panel-24', 'Patch panel', 140, 80),
    D('n-ljk', 'wall-jack', 'Wall jack 1-01', -60, 300),
    ...lanEnd.map(([id, st, name], i) => D(id, st, name, -60 + i * 130, i === 0 ? 460 : 300)),
    D('n-lcam', 'camera', 'Camera', 330, 460),
    D('n-lbr', 'badge-reader', 'Badge reader', 590, 460),
    D('n-lups', 'ups', 'UPS', 700, -200),
  ], [
    C('n-lfw', 'LAN', 'n-lsw', 'SFP1', { cable: 'DAC' }),
    C('n-lsw', 'P2', 'n-lpp', 'PP1', { length: '1 ft' }),
    C('n-lpp', 'PP1', 'n-ljk', 'JACK', { length: '120 ft', label: 'Horizontal run' }),
    C('n-ljk', 'JACK', 'n-lws', 'NIC', { length: '7 ft' }),
    ...lanEnd.slice(1).map(([id, , , port], i) => C('n-lsw', `P${(i + 2) * 2}`, id, port)),
    C('n-lnvr', 'CAMS', 'n-lcam', 'ETH', { label: 'PoE' }),
    C('n-lac', 'READER', 'n-lbr', 'WIEGAND', { cable: 'Line' }),
    C('n-lcs', 'SERIAL', 'n-lsw', 'CONSOLE', { cable: 'Console' }),
    C('n-lups', 'NMC', 'n-lsw', 'P1'),
  ]);

  const z = (id: string, title: string, x: number, y: number, w: number, h: number, color: string): AppNode =>
    ({ id, type: 'zone', position: { x, y }, zIndex: -1, style: { width: w, height: h }, data: { title, color, style: 'header' } }) as AppNode;
  const can = newPage('CAN', 'network', [
    note('t-can', 'CAN: campus. Buildings joined by single-mode fiber (through a splice closure), a media converter to the gate house, and a wireless bridge to the parking lot.', 0, -260),
    z('z-ca', 'Building A (main)', -20, -140, 620, 360, '#2563eb'),
    z('z-cb', 'Building B', 860, -140, 620, 360, '#16a34a'),
    z('z-cg', 'Gate house', -20, 330, 360, 260, '#d97706'),
    z('z-cp', 'Parking lot', 420, 330, 560, 260, '#7c3aed'),
    D('n-ccore', 'switch-core-24sfp', 'Core switch', 20, -60, { ip: '10.40.0.1' }),
    D('n-cfpa', 'patch-panel-fiber-24', 'Fiber panel A', 20, 60),
    D('n-csp', 'splice-closure', 'Splice closure (manhole 3)', 680, 80),
    D('n-cfpb', 'patch-panel-fiber-24', 'Fiber panel B', 900, 60),
    D('n-cswb', 'switch-48-poe', 'Building B switch', 880, -60, { ip: '10.40.1.1' }),
    D('n-cmc', 'media-converter', 'Media converter', 40, 420),
    D('n-cgate', 'access-control', 'Gate controller', 220, 420),
    D('n-cbra', 'wireless-bridge', 'Bridge (Bldg A roof)', 480, 420),
    D('n-cbrb', 'wireless-bridge', 'Bridge (light pole)', 680, 420),
    D('n-cap', 'ap-outdoor', 'Parking AP', 860, 420),
  ], [
    C('n-ccore', 'X2', 'n-cfpa', 'PP1', { cable: 'Fiber SM', length: '3 ft' }),
    C('n-cfpa', 'PP1', 'n-csp', 'F1', { cable: 'Fiber SM', length: '900 ft', label: 'OS2 12-strand' }),
    C('n-csp', 'F1', 'n-cfpb', 'PP1', { cable: 'Fiber SM', length: '650 ft' }),
    C('n-cfpb', 'PP1', 'n-cswb', 'SFP1', { cable: 'Fiber SM', length: '3 ft' }),
    C('n-ccore', 'X4', 'n-cmc', 'SFP', { cable: 'Fiber MM', length: '400 ft' }),
    C('n-cmc', 'RJ45', 'n-cgate', 'ETH'),
    C('n-ccore', 'X6', 'n-cbra', 'ETH', { length: '90 ft' }),
    C('n-cbra', 'AIR', 'n-cbrb', 'AIR', { cable: 'Wireless', label: '5 GHz PtP, 800 ft' }),
    C('n-cbrb', 'ETH', 'n-cap', 'ETH'),
  ]);

  const man = newPage('MAN', 'network', [
    note('t-man', 'MAN: across a city. Metro Ethernet through the carrier, dark fiber with CWDM, licensed microwave, and a GPON fiber-to-the-building network.', 0, -300),
    D('n-mhq', 'router', 'HQ router', 0, 0, { ip: '10.50.0.1' }),
    D('n-mcore', 'switch-core-24sfp', 'HQ core', -60, 160, { ip: '10.50.0.2' }),
    D('n-mntu1', 'metro-ntu', 'Metro NTU (HQ)', 0, -170),
    D('n-mcar', 'carrier-cloud', 'Metro Ethernet carrier', 400, -200),
    D('n-mntu2', 'metro-ntu', 'Metro NTU (Branch 1)', 800, -170),
    D('n-mb1', 'router', 'Branch 1 router', 800, 0),
    D('n-mdw1', 'dwdm', 'CWDM mux (HQ)', 160, 340),
    D('n-mdw2', 'dwdm', 'CWDM mux (Branch 2)', 560, 340),
    D('n-mb2', 'switch-48', 'Branch 2 switch', 760, 320),
    D('n-mmw1', 'microwave', 'Microwave (HQ roof)', -60, 340),
    D('n-mmw2', 'microwave', 'Microwave (warehouse)', -60, 560),
    D('n-mwh', 'switch-8', 'Warehouse switch', 100, 580),
    D('n-molt', 'olt', 'Municipal OLT', 400, -40),
    D('n-mspl', 'optical-splitter', 'Splitter 1:8', 400, 100),
    D('n-mont1', 'modem', 'ONT (library)', 300, 220, { model: 'GPON ONT' }),
    D('n-mont2', 'modem', 'ONT (city hall)', 500, 220, { model: 'GPON ONT' }),
  ], [
    C('n-mhq', 'WAN', 'n-mntu1', 'UNI'),
    C('n-mntu1', 'NETWORK', 'n-mcar', 'C', { cable: 'Fiber SM' }),
    C('n-mcar', 'D', 'n-mntu2', 'NETWORK', { cable: 'Fiber SM', label: 'E-Line 1 Gbps' }),
    C('n-mntu2', 'UNI', 'n-mb1', 'WAN'),
    C('n-mhq', 'LAN', 'n-mcore', 'X1'),
    C('n-mcore', 'X2', 'n-mdw1', 'CH1', { cable: 'Fiber SM' }),
    C('n-mdw1', 'LINE', 'n-mdw2', 'LINE', { cable: 'Fiber SM', label: 'Dark fiber 6.2 mi' }),
    C('n-mdw2', 'CH1', 'n-mb2', 'SFP1', { cable: 'Fiber SM' }),
    C('n-mcore', 'X3', 'n-mmw1', 'IDU'),
    C('n-mmw1', 'RF', 'n-mmw2', 'RF', { cable: 'Microwave', label: '18 GHz, 3.5 mi' }),
    C('n-mmw2', 'IDU', 'n-mwh', 'SFP1'),
    C('n-mcar', 'B', 'n-molt', 'UPLINK', { cable: 'Fiber SM' }),
    C('n-molt', 'PON', 'n-mspl', 'IN', { cable: 'Fiber SM' }),
    C('n-mspl', 'OUT2', 'n-mont1', 'UPLINK', { cable: 'Fiber SM' }),
    C('n-mspl', 'OUT3', 'n-mont2', 'UPLINK', { cable: 'Fiber SM' }),
  ]);

  const wan = newPage('WAN', 'network', [
    note('t-wan', 'WAN: sites far apart. SD-WAN over Internet + MPLS, LTE backup, a legacy T1, a satellite site, the cloud over site-to-site VPN, and remote users.', 0, -340),
    D('n-wnet', 'internet', 'Internet', 0, -240),
    D('n-wmpls', 'mpls-cloud', 'MPLS (carrier)', 480, -240),
    D('n-wcloud', 'cloud-service', 'Cloud (Azure / AWS)', -320, -40),
    D('n-whq', 'sdwan', 'HQ SD-WAN edge', 160, -80),
    D('n-wopt', 'wan-optimizer', 'WAN optimizer', 160, 60),
    D('n-wcore', 'switch-24-poe', 'HQ core', 80, 200),
    D('n-wvpn', 'vpn-concentrator', 'VPN gateway', -160, 120),
    D('n-wb1', 'sdwan', 'Branch 1 SD-WAN edge', 760, -80),
    D('n-wlte', 'lte-router', 'LTE backup', 960, -80),
    D('n-wb2r', 'router', 'Branch 2 router', 520, 140),
    D('n-wcsu', 'csu-dsu', 'CSU/DSU', 520, 0),
    D('n-wnet2', 'internet', 'Internet (rural)', 1200, -240),
    D('n-wsat', 'satellite', 'Satellite terminal', 1200, -80),
    D('n-wsoho', 'wifi-router', 'Site office Wi-Fi router', 1200, 80),
    D('n-wnet3', 'internet', 'Internet', -320, 300),
    D('n-wru', 'remote-user', 'Remote user', -320, 440),
  ], [
    C('n-wnet', 'WAN', 'n-whq', 'WAN1', { cable: 'WAN', label: 'DIA 1 Gbps' }),
    C('n-wmpls', 'C', 'n-whq', 'WAN2', { cable: 'MPLS' }),
    C('n-whq', 'LAN', 'n-wopt', 'WAN'),
    C('n-wopt', 'LAN', 'n-wcore', 'SFP1'),
    C('n-wmpls', 'D', 'n-wb1', 'WAN1', { cable: 'MPLS' }),
    C('n-wlte', 'LAN', 'n-wb1', 'WAN2', { label: 'Backup' }),
    C('n-wmpls', 'B', 'n-wcsu', 'LINE', { cable: 'WAN', label: 'T1' }),
    C('n-wcsu', 'SERIAL', 'n-wb2r', 'WAN', { cable: 'Serial' }),
    C('n-wnet2', 'WAN', 'n-wsat', 'SKY', { cable: 'Satellite' }),
    C('n-wsat', 'LAN', 'n-wsoho', 'WAN'),
    C('n-wcloud', 'VPN', 'n-wvpn', 'OUTSIDE', { cable: 'VPN', label: 'Site-to-site IPsec' }),
    C('n-wvpn', 'INSIDE', 'n-wcore', 'P2'),
    C('n-wnet3', 'WAN', 'n-wru', 'VPN', { cable: 'VPN', label: 'Client VPN' }),
  ]);

  const pages = [pan, wlan, lan, can, man, wan];
  return { pages, activePageId: pages[0].id };
}

export const BUILT_IN_TEMPLATES: Template[] = [
  { id: 'tpl-office', name: 'Basic office diagram (no rack)', description: 'ISP → firewall → PoE switch → access points, workstations, printer and NAS, all cabled: a quick one-page sketch.', project: smallOffice() },
  { id: 'tpl-office-rack', name: 'Small network + rack (up to 25 users)', description: 'One wiring closet: firewall, PoE switch, patch panel, desks, APs, camera, phone, server, NAS and UPS, and the same equipment in its rack, patch cords included.', project: officeWithRack() },
  { id: 'tpl-net-medium', name: 'Medium network (25–150 users)', description: 'Three floors: dual-WAN firewall, 10G core switch, servers and NAS in the MDF, an IDF per floor on an OM4 fiber backbone, PoE access switches and patch panels. One rack per room.', project: mediumNetwork() },
  { id: 'tpl-net-large', name: 'Large network (150+ users, campus)', description: 'HA firewall pair on two ISPs, redundant core pair, virtualization hosts, SAN, backup and OOB management in the data center, and three buildings with dual-homed access stacks over single-mode fiber. One rack per room.', project: largeNetwork() },
  { id: 'tpl-net-types', name: 'Network types: PAN, WLAN, LAN, CAN, MAN, WAN', description: 'One page per kind of network, each drawn with the equipment it uses: Bluetooth devices, wireless controllers and bridges, wall jacks and PoE, campus fiber and splices, metro Ethernet, CWDM, microwave and GPON, SD-WAN, MPLS, LTE, T1, satellite, cloud VPN.', project: networkTypes() },
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
  for (const pg of src.pages) fresh(pg.id);
  const relink = (address: string) => (address.startsWith(PAGE_LINK) && ids.has(address.slice(PAGE_LINK.length)) ? PAGE_LINK + ids.get(address.slice(PAGE_LINK.length)) : address);
  const pages: Page[] = src.pages.map((pg) => {
    const pid = fresh(pg.id);
    return {
      ...pg,
      id: pid,
      backgroundId: pg.backgroundId ? fresh(pg.backgroundId) : undefined,
      nodes: pg.nodes.map((n) => {
        const out = { ...n, id: fresh(n.id), selected: false } as AppNode;
        if (out.type === 'shape' && out.data.target) out.data = { ...out.data, target: fresh(out.data.target) };
        // Off-page reference pairs and "go to page" links point at ids that change too.
        const data = out.data as { pair?: string; link?: string; moreLinks?: { address: string }[] };
        if (data.pair || data.link?.startsWith(PAGE_LINK) || data.moreLinks?.length) {
          out.data = {
            ...out.data,
            ...(data.pair ? { pair: fresh(data.pair) } : {}),
            ...(data.link ? { link: relink(data.link) } : {}),
            ...(data.moreLinks ? { moreLinks: data.moreLinks.map((l) => ({ ...l, address: relink(l.address) })) } : {}),
          } as typeof out.data;
        }
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
  const { id: _id, name: _n, createdAt: _c, updatedAt: _u, site: _s, address: _a, contact: _ct, dataLink: _d, notes: _no, quote: _q, ...rest } = p;
  void _id; void _n; void _c; void _u; void _s; void _a; void _ct; void _d; void _no; void _q;
  const project = JSON.parse(JSON.stringify(rest)) as Template['project'];
  // The client's own paperwork stays with the client: serials, asset tags, MACs, purchase / warranty dates, and the
  // circuit's account number, circuit ID, static IPs and support phone.
  for (const pg of project.pages) {
    pg.nodes = pg.nodes.map((n) => {
      if (n.type !== 'device') return n;
      const { serial: _1, assetTag: _2, mac: _3, purchaseDate: _4, warrantyEnd: _5, endOfLife: _6, circuit, ...data } = n.data;
      void _1; void _2; void _3; void _4; void _5; void _6;
      const c = circuit ? { carrier: circuit.carrier, kind: circuit.kind, bandwidth: circuit.bandwidth } : undefined;
      return { ...n, data: { ...data, ...(c && Object.values(c).some(Boolean) ? { circuit: c } : {}) } } as AppNode;
    });
  }
  return { id: `tpl-${uid()}`, name, description, project };
}
