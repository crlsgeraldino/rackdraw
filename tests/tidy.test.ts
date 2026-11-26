/** Design → Tidy Diagram and Device Look "Icons": the layout plan, the symbols, and where cables leave a symbol. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { logicalKind, logicalPorts, logicalSvg, LOGICAL_SIZE, symbolStencil } from '../src/lib/logicalIcon';
import { placeZones, tidyLayout, tidyPrepare, TIDY_DEFAULTS, type TidyItem } from '../src/lib/tidy';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, CableEdge, Page, Rack, StencilDef } from '../src/lib/types';

const stencil = (id: string): StencilDef | undefined => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): AppNode => ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as AppNode;
const cable = (id: string, a: string, ah: string, b: string, bh: string): CableEdge => ({ id, type: 'cable', source: a, sourceHandle: ah, target: b, targetHandle: bh, data: { cable: 'Cat6' } }) as CableEdge;

test('shapes map to network symbols', () => {
  assert.equal(logicalKind({ name: 'Ubiquiti ECS-48-PoE (2150W)', category: 'Switching' }), 'switch');
  assert.equal(logicalKind({ name: 'Patch panel 24-port', category: 'Switching' }), 'patch');
  assert.equal(logicalKind({ name: 'SonicWall TZ570 / TZ670', category: 'Firewalls' }), 'firewall');
  assert.equal(logicalKind({ name: 'Dell PowerEdge R760', category: 'Custom' }), 'server');
  assert.equal(logicalKind({ name: 'Synology RS1221+', category: 'Servers' }), 'storage');
  assert.equal(logicalKind({ name: 'APC Smart-UPS 1500', category: 'Infrastructure' }), 'ups');
  assert.equal(logicalKind({ name: 'Switched PDU (metered)', category: 'Infrastructure' }), 'pdu');
  for (const k of Object.keys(LOGICAL_SIZE) as (keyof typeof LOGICAL_SIZE)[]) assert.match(logicalSvg(k, LOGICAL_SIZE[k].w, LOGICAL_SIZE[k].h), /^<svg [^>]*>.*<\/svg>$/);
  // As a plain shape (exports): the symbol's size, the shape's ports.
  const sw = symbolStencil(STENCIL_MAP['switch-48-poe']);
  assert.deepEqual([sw.width, sw.height, sw.style], [LOGICAL_SIZE.switch.w, LOGICAL_SIZE.switch.h, 'image']);
  assert.equal(sw.ports.length, STENCIL_MAP['switch-48-poe'].ports.length);
});

test('a symbol\'s cables leave from the side facing their other end, spread in order', () => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    sw: { x: 400, y: 300, w: 120, h: 40 }, fw: { x: 420, y: 100, w: 96, h: 52 },
    a: { x: 100, y: 600, w: 50, h: 60 }, b: { x: 700, y: 600, w: 50, h: 60 }, peer: { x: 800, y: 300, w: 120, h: 40 },
  };
  const edges = [cable('1', 'fw', 'X9', 'sw', 'SFP1'), cable('2', 'sw', 'P2', 'b', 'NIC1'), cable('3', 'sw', 'P1', 'a', 'NIC1'), cable('4', 'sw', 'P3', 'peer', 'P1')];
  const spots = logicalPorts('sw', ['P1', 'P2', 'P3', 'P4', 'SFP1'], 120, 40, edges, (id) => boxes[id]);
  assert.equal(spots.SFP1.side, 'top');
  assert.deepEqual([spots.P1.side, spots.P2.side], ['bottom', 'bottom']);
  assert.ok(spots.P1.x < spots.P2.x, 'the cable to the device on the left leaves left of the one going right');
  assert.equal(spots.P3.side, 'right');
  assert.deepEqual(spots.P4, { x: 60, y: 40, side: 'bottom' }); // unused: bottom middle
});

test('prepare: shows rack-only gear with network cables (not patch panels), adds the Internet, names beside icons', () => {
  const page: Page = {
    id: 'pg', name: 'N', kind: 'network',
    nodes: [dev('modem', 'modem'), dev('fw', 'sonicwall-tz570-670'), dev('sw', 'switch-48-poe'), dev('ups', 'ups', { showOn: 'rack' }), dev('pp', 'patch-panel-24', { showOn: 'rack' }), dev('ups2', 'ups', { showOn: 'rack' })],
    edges: [cable('1', 'modem', 'LAN', 'fw', 'X1'), cable('2', 'fw', 'X9', 'sw', 'SFP1'), cable('3', 'sw', 'P1', 'ups', 'NMC'), cable('4', 'sw', 'P2', 'pp', 'PP1')],
  };
  const r = tidyPrepare(page, stencil, TIDY_DEFAULTS, true);
  const byId = new Map(r.nodes.map((n) => [n.id, n]));
  assert.deepEqual(r.shown, ['ups']);
  assert.equal((byId.get('ups')!.data as { showOn?: string }).showOn, undefined);
  assert.equal((byId.get('pp')!.data as { showOn?: string }).showOn, 'rack');
  assert.equal((byId.get('ups2')!.data as { showOn?: string }).showOn, 'rack'); // no cable: stays in the rack
  assert.ok(r.internet);
  assert.ok(r.edges.some((e) => e.source === r.internet && e.target === 'modem' && e.targetHandle === 'UPLINK'));
  assert.equal((byId.get('fw')!.data as { labelSide?: string }).labelSide, 'left');
  // A second run adds no second Internet.
  assert.equal(tidyPrepare({ ...page, nodes: r.nodes, edges: r.edges }, stencil, TIDY_DEFAULTS, true).internet, null);
});

test('layout: top-down, rows fit the sheet and never straddle a page break, each rack boxed', () => {
  const ids = ['isp', 'fw', 'sw', ...Array.from({ length: 14 }, (_, i) => `h${i}`)];
  const page: Page = {
    id: 'pg', name: 'N', kind: 'network',
    nodes: ids.map((id) => dev(id, id === 'isp' ? 'internet' : id === 'fw' ? 'sonicwall-tz570-670' : id === 'sw' ? 'switch-48-poe' : 'server')),
    edges: [cable('a', 'isp', 'WAN', 'fw', 'X1'), cable('b', 'fw', 'X9', 'sw', 'SFP1'), ...ids.slice(3).map((h, i) => cable(`c${i}`, 'sw', `P${i + 1}`, h, 'NIC1'))],
  };
  const items: TidyItem[] = ids.map((id) => ({ id, w: id === 'sw' ? 300 : 120, h: id === 'sw' ? 200 : 90, category: id === 'isp' ? 'Internet' : id === 'fw' ? 'Firewalls' : id === 'sw' ? 'Switching' : 'Servers', name: id }));
  const sheet = { w: 1056, h: 816 };
  const racks = [{ id: 'r', name: 'Rack A', units: 42, items: ['fw', 'sw'].map((n, i) => ({ id: `i${i}`, kind: 'device', nodeId: n, u: 40 - i, height: 1, depth: 'full' })) }] as Rack[];
  const { positions, zones } = tidyLayout(page, items, racks, sheet, stencil, TIDY_DEFAULTS);
  const at = (id: string) => positions.get(id)!;
  assert.ok(at('isp').y < at('fw').y && at('fw').y < at('sw').y && at('sw').y < at('h0').y);
  for (const it of items) {
    const p = at(it.id);
    assert.ok(p.x >= 0 && p.x + it.w <= sheet.w, `${it.id} fits across one sheet`);
    assert.equal(Math.floor(p.y / sheet.h), Math.floor((p.y + it.h) / sheet.h), `${it.id} doesn't straddle a page break`);
  }
  assert.equal(zones.length, 1);
  assert.equal(zones[0].title, 'Rack A');
  const withZone = placeZones(page.nodes, zones);
  assert.equal(withZone.filter((n) => n.type === 'zone').length, 1);
  // Tidying again moves the same box instead of adding another.
  assert.equal(placeZones(withZone, zones).filter((n) => n.type === 'zone').length, 1);
});
