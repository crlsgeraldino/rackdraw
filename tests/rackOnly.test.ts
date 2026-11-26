/** Rack-only devices (hidden on the diagram, cables drawn "via" them) and small devices on rack shelves. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isShelfDevice } from '../src/lib/autoRack';
import { fits } from '../src/lib/rack';
import { drawingCables } from '../src/lib/rackOnly';
import { INNER_PX, placeOnShelf, SHELF_PAD, shelfWidth } from '../src/lib/rackShelf';
import { sanitizeProject } from '../src/lib/sanitize';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, CableEdge, Rack, RackItem, StencilDef } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): AppNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as AppNode;
const cable = (id: string, a: string, ah: string, b: string, bh: string, cableType = 'Cat6'): CableEdge =>
  ({ id, type: 'cable', source: a, sourceHandle: ah, target: b, targetHandle: bh, data: { cable: cableType, label: `L-${id}`, length: '20 ft' } }) as CableEdge;
const portOf = (stencilId: string, i: number) => st(stencilId).ports[i].id;

describe('rack-only devices on the diagram', () => {
  const sw = 'switch-24-poe', pp = 'patch-panel-24';
  const nodes = [dev('sw', sw), dev('pp', pp, { showOn: 'rack' }), dev('jack', 'wall-jack'), dev('pc', 'workstation')];
  const P = portOf(pp, 2);
  const edges = [
    cable('cord', 'sw', portOf(sw, 2), 'pp', P),
    cable('run', 'pp', P, 'jack', portOf('wall-jack', 0)),
    cable('desk', 'jack', portOf('wall-jack', 0), 'pc', portOf('workstation', 0)),
  ];

  it('draws a run through a rack-only patch panel as one line, via the panel', () => {
    const { hidden, via } = drawingCables(nodes, edges, st);
    assert.deepEqual([...hidden].sort(), ['cord', 'run']);
    assert.equal(via.length, 1);
    const v = via[0];
    assert.deepEqual([v.source, v.target].sort(), ['jack', 'sw']);
    assert.match(v.data!.via!, /^pp /);
    // The line looks like the cable but not its own label or length; it can't be selected.
    assert.equal(v.data!.cable, 'Cat6');
    assert.equal(v.data!.label, undefined);
    assert.equal(v.data!.length, undefined);
    assert.equal(v.selectable, false);
  });

  it('follows a run through two panels', () => {
    const ns = [...nodes, dev('pp2', pp, { showOn: 'rack' })];
    const P2 = portOf(pp, 5);
    const es = [cable('a', 'sw', portOf(sw, 0), 'pp', P), cable('b', 'pp', P, 'pp2', P2), cable('c', 'pp2', P2, 'jack', portOf('wall-jack', 0))];
    const { hidden, via } = drawingCables(ns, es, st);
    assert.equal(hidden.size, 3);
    assert.equal(via.length, 1);
    assert.equal(via[0].data!.via!.split(', ').length, 2);
  });

  it('draws nothing for a cable that ends in the rack-only device', () => {
    const { hidden, via } = drawingCables(nodes, [cable('cord', 'sw', portOf(sw, 2), 'pp', P)], st);
    assert.deepEqual([...hidden], ['cord']);
    assert.deepEqual(via, []);
  });

  it('changes nothing when nothing is rack-only', () => {
    const { hidden, via } = drawingCables(nodes.map((n) => (n.id === 'pp' ? dev('pp', pp) : n)), edges, st);
    assert.equal(hidden.size, 0);
    assert.equal(via.length, 0);
  });

  it('keeps "rack only" in a saved file, and drops anything else there', () => {
    const raw = { name: 'x', pages: [{ id: 'p', name: 'P', kind: 'network', nodes: [dev('a', sw, { showOn: 'rack' }), dev('b', sw, { showOn: 'nowhere' })], edges: [] }] };
    const { project } = sanitizeProject(raw);
    const [a, b] = project.pages[0].nodes;
    assert.equal(a.data.showOn, 'rack');
    assert.equal(b.data.showOn, undefined);
  });
});

describe('shelves', () => {
  it('knows which equipment is small', () => {
    assert.equal(isShelfDevice(st('sonicwall-tz570-670')), true);
    assert.equal(isShelfDevice(st('switch-8')), true);
    assert.equal(isShelfDevice(st('modem')), true);
    assert.equal(isShelfDevice(st('switch-24-poe')), false);
    assert.equal(isShelfDevice(st('workstation')), false);
    const picture = (name: string, w: number, h: number, rackUnits?: number) => ({ id: 'c', name, custom: true, style: 'image', width: w, height: h, scale: 1, ports: [], rackUnits }) as unknown as StencilDef;
    assert.equal(isShelfDevice(picture('USW Flex Mini 5-port switch', 400, 120)), true);
    assert.equal(isShelfDevice(picture('USW-Pro-24-PoE', 1824, 168, 1)), false);
    assert.equal(isShelfDevice(picture('Laptop', 300, 200)), false);
  });

  it('stands devices side by side, and adds a shelf when there is none', () => {
    let r: Rack = { id: 'r', name: 'R', units: 6, items: [] };
    const widthOf = (it: RackItem) => shelfWidth(st(it.nodeId === 'm' ? 'modem' : 'sonicwall-tz570-670'), it.height);
    r = placeOnShelf(r, 'tz', shelfWidth(st('sonicwall-tz570-670'), 1), widthOf)!;
    const shelf = r.items.find((it) => it.kind === 'shelf')!;
    assert.equal(shelf.u, 6);
    r = placeOnShelf(r, 'm', shelfWidth(st('modem'), 1), widthOf, 6)!;
    const [a, b] = r.items.filter((it) => it.shelf).sort((x, y) => x.shelf!.x - y.shelf!.x);
    assert.equal(a.shelf!.x, SHELF_PAD);
    assert.ok(b.shelf!.x >= a.shelf!.x + widthOf(a));
    assert.ok(r.items.filter((it) => it.shelf).every((it) => it.shelf!.id === shelf.id && it.u === 6));
    // The shelf takes the unit; the devices on it don't block it twice.
    assert.equal(fits(r, 6, 1, 'full'), false);
    assert.equal(fits(r, 5, 1, 'full'), true);
  });

  it('says no when the shelf under the pointer is full', () => {
    const shelf: RackItem = { id: 's', kind: 'shelf', u: 3, height: 1, depth: 'full' };
    const wide = INNER_PX - SHELF_PAD * 2;
    const r: Rack = { id: 'r', name: 'R', units: 6, items: [shelf, { id: 'd', kind: 'device', nodeId: 'big', u: 3, height: 1, depth: 'full', shelf: { id: 's', x: SHELF_PAD } }] };
    assert.equal(placeOnShelf(r, 'x', 60, () => wide, 3), null);
    // Without a place: a new shelf in a free unit.
    const r2 = placeOnShelf(r, 'x', 60, () => wide)!;
    assert.equal(r2.items.filter((it) => it.kind === 'shelf').length, 2);
  });

  it('moves a device to another shelf', () => {
    const r: Rack = { id: 'r', name: 'R', units: 6, items: [{ id: 's1', kind: 'shelf', u: 5, height: 1, depth: 'full' }, { id: 's2', kind: 'shelf', u: 2, height: 1, depth: 'full' }, { id: 'd', kind: 'device', nodeId: 'n', u: 5, height: 1, depth: 'full', shelf: { id: 's1', x: SHELF_PAD } }] };
    const moved = placeOnShelf(r, 'n', 80, () => 80, 2, r.items[2])!;
    const d = moved.items.find((it) => it.nodeId === 'n')!;
    assert.equal(d.id, 'd');
    assert.deepEqual([d.u, d.shelf!.id], [2, 's2']);
    assert.equal(moved.items.filter((it) => it.nodeId === 'n').length, 1);
  });
});
