/** Cords in the rack view: routes (worked out or set by hand), re-plugging patch and power cords, swapping. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { INNER_W, laneX, RAIL, resolveRoutes, routeAt, U_H } from '../src/components/RackElevation';
import { activePage } from '../src/lib/project';
import type { AppNode, CableEdge, PowerCord, Project } from '../src/lib/types';
import { useDiagram } from '../src/store/useDiagramStore';

describe('cord routes', () => {
  const L = RAIL + 60, R = RAIL + INNER_W - 60;
  it('hangs neighbours straight and gives every longer cord its own lane by the nearer post', () => {
    const routes = resolveRoutes([
      { key: 'near', a: [L, 100], b: [L + 40, 100 + U_H] },
      { key: 'l1', a: [L, 100], b: [L, 100 + 5 * U_H] },
      { key: 'l2', a: [L, 140], b: [L, 140 + 3 * U_H] },
      { key: 'r1', a: [R, 100], b: [R, 100 + 6 * U_H] },
    ]);
    assert.equal(routes.get('near')!.side, 'straight');
    assert.deepEqual([routes.get('l2'), routes.get('l1')].map((r) => [r!.side, r!.lane]), [['left', 0], ['left', 1]]); // shorter run inside
    assert.deepEqual(routes.get('r1'), { side: 'right', lane: 0 });
  });
  it('keeps a route set by hand, and works the others round it', () => {
    const routes = resolveRoutes([
      { key: 'hand', a: [L, 100], b: [L, 400], route: { side: 'left', lane: 0 } },
      { key: 'auto', a: [L, 100], b: [L, 300] },
      { key: 'flat', a: [L, 100], b: [R, 500], route: { side: 'straight' } },
    ]);
    assert.deepEqual(routes.get('hand'), { side: 'left', lane: 0 });
    assert.deepEqual(routes.get('auto'), { side: 'left', lane: 1 });
    assert.equal(routes.get('flat')!.side, 'straight');
  });
  it('reads a dropped middle handle as a post and lane, or straight across', () => {
    assert.deepEqual(routeAt(laneX('left', 3)), { side: 'left', lane: 3 });
    assert.deepEqual(routeAt(laneX('right', 0)), { side: 'right', lane: 0 });
    assert.deepEqual(routeAt(RAIL + INNER_W / 2), { side: 'straight' });
    assert.equal(routeAt(-500).lane, 0); // past the post: the lane nearest it
  });
});

const S = () => useDiagram.getState();
const dev = (id: string, stencilId: string): AppNode => ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id } }) as AppNode;
const cable = (id: string, a: string, ah: string, b: string, bh: string): CableEdge => ({ id, type: 'cable', source: a, sourceHandle: ah, target: b, targetHandle: bh, data: { cable: 'Cat6' } }) as CableEdge;
function load(edges: CableEdge[], power: PowerCord[] = []) {
  const p = {
    id: 'p1', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0,
    racks: [{ id: 'r', name: 'R', units: 12, power, items: [
      { id: 'i-sw', kind: 'device', nodeId: 'sw', u: 10, height: 1, depth: 'full' },
      { id: 'i-pp', kind: 'device', nodeId: 'pp', u: 11, height: 1, depth: 'full' },
      { id: 'i-srv', kind: 'device', nodeId: 'srv', u: 6, height: 2, depth: 'full' },
      { id: 'pduA', kind: 'pdu', label: 'PDU A', u: 1, height: 1, depth: 'rear' },
      { id: 'pduB', kind: 'pdu', label: 'PDU B', u: 2, height: 1, depth: 'rear' },
    ] }],
    pages: [{ id: 'pg', name: 'N', kind: 'network', nodes: [dev('sw', 'switch-24-poe'), dev('pp', 'patch-panel-24'), dev('srv', 'server'), dev('fw', 'firewall')], edges }],
  } as unknown as Project;
  useDiagram.setState({ projects: { p1: p }, currentId: 'p1', past: [], future: [] });
}
const edgesNow = () => activePage(S().projects.p1).edges;

describe('re-plugging a patch cord', () => {
  it('moves the end to the port it was dropped on (the diagram cable follows)', () => {
    load([cable('e1', 'sw', 'P1', 'pp', 'PP1')]);
    assert.equal(S().replugCable('e1', { nodeId: 'sw', port: 'P1' }, { nodeId: 'sw', port: 'P5' }), true);
    assert.deepEqual([edgesNow()[0].source, edgesNow()[0].sourceHandle], ['sw', 'P5']);
    S().undo();
    assert.equal(edgesNow()[0].sourceHandle, 'P1');
  });
  it('swaps with the cable already on that port', () => {
    load([cable('e1', 'sw', 'P1', 'fw', 'LAN'), cable('e2', 'sw', 'P2', 'srv', 'NIC1')]);
    S().replugCable('e1', { nodeId: 'sw', port: 'P1' }, { nodeId: 'sw', port: 'P2' });
    const [e1, e2] = edgesNow();
    assert.equal(e1.sourceHandle, 'P2');
    assert.equal(e2.sourceHandle, 'P1');
  });
  it('refuses to plug a cable into itself', () => {
    load([cable('e1', 'sw', 'P1', 'sw', 'P2')]);
    assert.equal(S().replugCable('e1', { nodeId: 'sw', port: 'P1' }, { nodeId: 'sw', port: 'P2' }), false);
  });
  it('keeps a route set by hand with the cable', () => {
    load([cable('e1', 'sw', 'P1', 'pp', 'PP1')]);
    S().setCableRackRoute('e1', { side: 'left', lane: 2 });
    assert.deepEqual(edgesNow()[0].data?.rackRoute, { side: 'left', lane: 2 });
    S().setCableRackRoute('e1', undefined);
    assert.equal(edgesNow()[0].data?.rackRoute, undefined);
  });
});

describe('re-plugging a power cord', () => {
  const rackNow = () => S().projects.p1.racks![0];
  it('moves it to another outlet, swapping with the cord already there', () => {
    load([], [
      { id: 'c1', from: 'i-sw', inlet: 'PSU', to: 'pduA', outlet: 1 },
      { id: 'c2', from: 'i-srv', inlet: 'PSU1', to: 'pduB', outlet: 1 },
    ]);
    assert.equal(S().movePowerCordEnd('r', 'c1', 'to', { item: 'pduB', slot: 1 }), true);
    const [c1, c2] = rackNow().power!;
    assert.deepEqual([c1.to, c1.outlet], ['pduB', 1]);
    assert.deepEqual([c2.to, c2.outlet], ['pduA', 1]);
  });
  it('moves the other end to another power supply', () => {
    load([], [{ id: 'c1', from: 'i-srv', inlet: 'PSU1', to: 'pduA', outlet: 3 }]);
    S().movePowerCordEnd('r', 'c1', 'from', { item: 'i-srv', slot: 'PSU2' });
    assert.equal(rackNow().power![0].inlet, 'PSU2');
    S().setPowerCordRoute('r', 'c1', { side: 'right', lane: 1 });
    assert.deepEqual(rackNow().power![0].route, { side: 'right', lane: 1 });
  });
});
