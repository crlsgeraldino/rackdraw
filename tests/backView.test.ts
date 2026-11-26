/** Front and back of one device: pairing shapes, the combined ports, and folding a placed back into its front. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { backKey, backOf, frontKey, sideOf } from '../src/lib/backView';
import { inletsOf } from '../src/lib/powerCords';
import { activePage } from '../src/lib/project';
import { sanitizeStencil } from '../src/lib/sanitize';
import type { AppNode, CableEdge, DeviceNode, PortDef, Project, StencilDef } from '../src/lib/types';
import { findStencil, storedStencil, useDiagram } from '../src/store/useDiagramStore';

const port = (id: string, kind: PortDef['kind'] = 'rj45'): PortDef => ({ id, label: id, kind, x: 10, y: 10, w: 10, h: 10, side: 'top' });
const shape = (id: string, name: string, ports: PortDef[], extra: Partial<StencilDef> = {}): StencilDef =>
  ({ id, name, custom: true, style: 'image', image: 'data:image/png;base64,AA==', category: 'Servers', library: 'Dell', width: 1824, height: 336, scale: 0.3, rackUnits: 2, ports, ...extra }) as StencilDef;
const front = shape('f', 'Dell PowerEdge R760 - Front', [port('USB')]);
const rear = shape('r', 'Dell PowerEdge R760 - Rear', [port('NIC1'), port('IDRAC'), port('PSU1', 'power'), port('PSU2', 'power')]);
const custom = { f: front, r: rear, x: shape('x', 'Other - Rear', []) };

describe('pairing front and back', () => {
  it('reads the names vendors use', () => {
    for (const n of ['R760 - Front', 'R760 (Front)', 'R760 Front', 'R760_Front', 'R760 – front view']) assert.equal(frontKey(n), 'r760', n);
    for (const n of ['R760 - Rear', 'R760 (Back)', 'R760 rear view']) assert.equal(backKey(n), 'r760', n);
    assert.equal(frontKey('Frontdesk switch'), '');
    assert.equal(backKey('Backup NAS'), '');
  });
  it('pairs "… Front" with "… Rear" in the same library, or the one chosen', () => {
    assert.equal(backOf(front, custom)?.id, 'r');
    assert.equal(backOf({ ...front, library: 'Other' }, custom), undefined);
    assert.equal(backOf({ ...front, rear: 'x' }, custom)?.id, 'x');
    assert.equal(backOf({ ...front, rear: '' }, custom), undefined);
    assert.equal(backOf({ ...front, rear: 'f' }, custom), undefined); // not itself
  });
  it('keeps the choice in a library file, never the worked-out back', () => {
    const s = sanitizeStencil({ ...front, rear: 'r', back: rear })!;
    assert.equal(s.rear, 'r');
    assert.equal(s.back, undefined);
  });
});

describe('one device with both sides', () => {
  const both = findStencil('f', custom)!;
  it('has the ports of both sides, the back ones as "R:…"', () => {
    assert.deepEqual(both.ports.map((p) => p.id), ['USB', 'R:NIC1', 'R:IDRAC', 'R:PSU1', 'R:PSU2']);
    assert.equal(both.back?.id, 'r');
    assert.equal(findStencil('f', custom), both); // the same object every time (React depends on it)
    assert.equal(storedStencil('f', custom), front);
  });
  it('splits into sides for drawing', () => {
    assert.deepEqual(sideOf(both, 'front').ports.map((p) => p.id), ['USB']);
    const b = sideOf(both, 'back');
    assert.equal(b.image, rear.image);
    assert.deepEqual(b.ports.map((p) => p.id), ['R:NIC1', 'R:IDRAC', 'R:PSU1', 'R:PSU2']);
  });
  it('plugs in by the back picture\'s power supplies', () => {
    const d = { id: 'd', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'f', name: 'Host' } } as DeviceNode;
    assert.deepEqual(inletsOf({ id: 'i', kind: 'device', nodeId: 'd', u: 1, height: 2, depth: 'full' }, d, both).map((i) => i.id), ['R:PSU1', 'R:PSU2']);
  });
});

describe('a back placed as its own device', () => {
  const dev = (id: string, stencilId: string, x = 0): AppNode => ({ id, type: 'device', position: { x, y: 0 }, data: { stencilId, name: id, ports: stencilId === 'r' ? { NIC1: { description: 'LAN' } } : undefined } }) as AppNode;
  const cable = (id: string, a: string, ah: string, b: string, bh: string): CableEdge => ({ id, type: 'cable', source: a, sourceHandle: ah, target: b, targetHandle: bh, data: { cable: 'Cat6' } }) as CableEdge;
  it('folds into its front: cables move to the back ports, the copy goes', () => {
    const p = {
      id: 'p1', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0,
      racks: [{ id: 'r1', name: 'R', units: 12, items: [{ id: 'a', kind: 'device', nodeId: 'host', u: 5, height: 2, depth: 'full' }, { id: 'b', kind: 'device', nodeId: 'hostRear', u: 7, height: 2, depth: 'full' }] }],
      pages: [{ id: 'pg', name: 'N', kind: 'network', nodes: [dev('host', 'f'), dev('hostRear', 'r', 300), dev('sw', 'switch-24-poe', 600)], edges: [cable('e1', 'hostRear', 'NIC1', 'sw', 'P1')] }],
    } as unknown as Project;
    useDiagram.setState({ projects: { p1: p }, currentId: 'p1', past: [], future: [], customStencils: custom });
    assert.equal(useDiagram.getState().combineWithFront('hostRear'), 'host');
    const pg = activePage(useDiagram.getState().projects.p1);
    assert.deepEqual(pg.nodes.map((n) => n.id), ['host', 'sw']);
    assert.deepEqual([pg.edges[0].source, pg.edges[0].sourceHandle], ['host', 'R:NIC1']);
    assert.equal((pg.nodes[0] as DeviceNode).data.ports?.['R:NIC1']?.description, 'LAN');
    assert.deepEqual(useDiagram.getState().projects.p1.racks![0].items.map((it) => it.nodeId), ['host']);
    // Undo brings it back.
    useDiagram.getState().undo();
    assert.equal(activePage(useDiagram.getState().projects.p1).nodes.length, 3);
  });
});

describe('power inlets of a vendor back', () => {
  it('plugs the AC inlet into a PDU, not the redundant-power (RPS) connector', () => {
    const r = shape('r2', 'USW - Rear', [port('USP RPS', 'power'), port('AC Power', 'power')]);
    const f = shape('f2', 'USW - Front', [port('1')]);
    const both = findStencil('f2', { f2: f, r2: r })!;
    const d = { id: 'd', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'f2', name: 'USW' } } as DeviceNode;
    assert.deepEqual(inletsOf({ id: 'i', kind: 'device', nodeId: 'd', u: 1, height: 1, depth: 'full' }, d, both).map((i) => i.label), ['AC Power']);
  });
});

describe('names of two-sided devices', () => {
  it('drops "- Front" when the shape is the whole device', async () => {
    const { deviceName } = await import('../src/lib/backView');
    assert.equal(deviceName(findStencil('f', custom)!), 'Dell PowerEdge R760');
    assert.equal(deviceName(front), 'Dell PowerEdge R760 - Front'); // no back: the name as it is
  });
  it('renames a front still named after its shape when its back is combined into it', () => {
    const p = {
      id: 'p1', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, racks: [],
      pages: [{ id: 'pg', name: 'N', kind: 'network', edges: [], nodes: [
        { id: 'a', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'f', name: 'Dell PowerEdge R760 - Front 2' } },
        { id: 'b', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'r', name: 'Dell PowerEdge R760 - Rear' } },
      ] }],
    } as unknown as Project;
    useDiagram.setState({ projects: { p1: p }, currentId: 'p1', past: [], future: [], customStencils: custom });
    useDiagram.getState().combineWithFront('b');
    assert.equal((activePage(useDiagram.getState().projects.p1).nodes[0] as DeviceNode).data.name, 'Dell PowerEdge R760 2');
  });
});
