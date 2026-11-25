/**
 * Unit tests for RackDraw's planning logic: lengths, prices, pass-through detection, auto-racking, the Bill of
 * Materials, templates. Run with `npm test` (Node's built-in test runner; TypeScript is loaded by jiti, which comes
 * with Tailwind).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseLength, lengthFt, totalLength } from '../src/lib/length';
import { parsePrice, priceQuote } from '../src/lib/quote';
import { isPassThrough, allPaths, pathLength } from '../src/lib/trace';
import { planRack, planRacks, rackRole, MAX_RACK_U } from '../src/lib/autoRack';
import { billOfMaterials } from '../src/lib/bom';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import { sanitizeProject } from '../src/lib/sanitize';
import type { AppNode, CableEdge, DeviceNode, Project, StencilDef } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
let n = 0;
const dev = (stencilId: string, name: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id: `d${++n}`, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name, ...extra } }) as DeviceNode;
const cable = (a: DeviceNode, ah: string, b: DeviceNode, bh: string, data: Record<string, unknown> = {}): CableEdge =>
  ({ id: `e${++n}`, type: 'cable', source: a.id, sourceHandle: ah, target: b.id, targetHandle: bh, data: { cable: 'Cat6', ...data } }) as CableEdge;
const project = (nodes: AppNode[], edges: CableEdge[] = []): Project =>
  ({ id: 'p', name: 'Test', pages: [{ id: 'pg', name: 'Network', kind: 'network', nodes, edges }], activePageId: 'pg', racks: [], createdAt: 0, updatedAt: 0 }) as unknown as Project;

describe('lengths', () => {
  it('reads the ways people type cable lengths', () => {
    assert.equal(lengthFt('85 ft'), 85);
    assert.equal(lengthFt('1,200 ft'), 1200);
    assert.equal(lengthFt('10 ft.'), 10);
    assert.equal(lengthFt("10'"), 10);
    assert.equal(lengthFt(`10' 6"`), 10.5);
    assert.equal(lengthFt('6 in'), 0.5);
    assert.ok(Math.abs(lengthFt('3m')! - 9.84252) < 1e-3);
    assert.ok(Math.abs(lengthFt('150 cm')! - 4.92126) < 1e-3);
    assert.equal(lengthFt('long'), undefined);
    assert.equal(lengthFt(''), undefined);
  });
  it('adds up paths, in metres only when all are metric', () => {
    assert.equal(totalLength(['85 ft', '3 ft']), '88 ft');
    assert.equal(totalLength(['2 m', '3 m']), '5 m');
    assert.equal(totalLength(['3 m', '10 ft']), '19.8 ft');
    assert.equal(totalLength(['3 m', undefined]), '');
    assert.equal(parseLength('3 M')?.metric, true);
  });
});

describe('prices', () => {
  it('parses typed prices and refuses what is not one', () => {
    assert.equal(parsePrice('$8,500'), 8500);
    assert.equal(parsePrice('12.99'), 12.99);
    assert.equal(parsePrice('1.200,50'), 1200.5);
    assert.equal(parsePrice('45,5'), 45.5);
    assert.equal(parsePrice('1.200'), 1200);
    assert.equal(parsePrice('€ 1.234'), 1234);
    assert.equal(parsePrice('1.234.567'), 1234567);
    assert.equal(parsePrice('1,234,567.89'), 1234567.89);
    assert.equal(parsePrice('1,234'), 1234);
    assert.equal(parsePrice('0.125'), 0.13);
    assert.equal(parsePrice('199.5'), 199.5);
    assert.equal(parsePrice('0'), 0);
    assert.equal(parsePrice('abc'), undefined);
    assert.equal(parsePrice('-5'), undefined);
    assert.equal(parsePrice(''), undefined);
  });
  it('counts a price of 0 as priced', () => {
    const q = priceQuote([{ title: 'Equipment', rows: [{ key: 'k', item: 'Free thing', detail: '', qty: 2, unit: 'each' }] }],
      { copperRuns: 0, fiberRuns: 0, rackDevices: 0, endpoints: 0, racks: 0, cords: 0 }, { k: 0 });
    assert.equal(q.unpriced, 0);
    assert.equal(q.materials, 0);
  });
});

describe('pass-through devices', () => {
  it('is decided by the stencil, not the device name', () => {
    assert.equal(isPassThrough(dev('workstation', 'Patch Panel Room PC'), st('workstation')), false);
    assert.equal(isPassThrough(dev('workstation', 'Keystone Dental reception'), st('workstation')), false);
    assert.equal(isPassThrough(dev('patch-panel-24', 'PP-A'), st('patch-panel-24')), true);
    assert.equal(isPassThrough(dev('patch-panel-fiber-24', 'FP'), st('patch-panel-fiber-24')), true);
    assert.equal(isPassThrough(dev('wall-jack', 'Jack 1-01'), st('wall-jack')), true);
    assert.equal(isPassThrough(dev('splice-closure', 'Splice'), st('splice-closure')), true);
  });
  it('reads an imported stencil by its name', () => {
    const custom = { id: 'c1', name: 'CAT6 Patch Panel 48', custom: true, ports: [] } as unknown as StencilDef;
    assert.equal(isPassThrough(dev('c1', 'Anything'), custom), true);
    const pc = { id: 'c2', name: 'Dell OptiPlex', custom: true, ports: [] } as unknown as StencilDef;
    assert.equal(isPassThrough(dev('c2', 'Patch panel room PC'), pc), false);
  });
});

describe('auto-rack', () => {
  it('gives built-in equipment its real role', () => {
    assert.equal(rackRole(dev('server', 'Knowledge base server'), st('server')), 'server');
    assert.equal(rackRole(dev('server', 'Ledger DB host'), st('server')), 'server');
    assert.equal(rackRole(dev('kvm', 'KVM'), st('kvm')), 'other');
    assert.equal(rackRole(dev('pdu-network', 'PDU'), st('pdu-network')), 'other');
    assert.equal(rackRole(dev('firewall', 'FW'), st('firewall')), 'edge');
    assert.equal(rackRole(dev('sonicwall-tz570-670', 'FW'), st('sonicwall-tz570-670')), 'edge');
    assert.equal(rackRole(dev('patch-panel-48', 'PP'), st('patch-panel-48')), 'panel');
    assert.equal(rackRole(dev('switch-48-poe', 'SW'), st('switch-48-poe')), 'switch');
  });
  it('matches whole words for imported stencils', () => {
    const custom = { id: 'x', name: 'Appliance', custom: true, ports: [], rackUnits: 1 } as unknown as StencilDef;
    assert.equal(rackRole(dev('x', 'Knowledge base server'), custom), 'server');
    assert.equal(rackRole(dev('x', 'Edge router'), custom), 'edge');
  });
  it('puts each patch panel above its switch', () => {
    const sw = dev('switch-48-poe', 'SW1'), pp = dev('patch-panel-48', 'PP1'), fw = dev('firewall', 'FW');
    const cables = [{ a: pp.id, b: sw.id }, { a: pp.id, b: sw.id }];
    const { rack } = planRack('R', [sw, pp, fw], st, cables);
    const order = [...rack.items].sort((a, b) => b.u - a.u).map((it) => it.nodeId ?? it.kind);
    assert.deepEqual(order.slice(0, 4), [fw.id, pp.id, 'cable-manager', sw.id]);
  });
  it('never plans a rack taller than 48U', () => {
    const servers = Array.from({ length: 30 }, (_, i) => dev('server', `Host ${i}`, { location: 'DC' }));
    const { racks, mounted } = planRacks('Rack', servers, st, []);
    assert.equal(mounted, 30);
    assert.ok(racks.length >= 2);
    for (const r of racks) assert.ok(r.units <= MAX_RACK_U, `${r.name} is ${r.units}U`);
    assert.equal(racks.reduce((s, r) => s + r.items.filter((it) => it.kind === 'device').length, 0), 30);
  });
  it('makes one rack per location', () => {
    const a = dev('switch-24-poe', 'A', { location: 'IDF-1' }), b = dev('switch-24-poe', 'B', { location: 'IDF-2' });
    const { racks } = planRacks('Rack', [a, b], st, []);
    assert.deepEqual(racks.map((r) => r.location).sort(), ['IDF-1', 'IDF-2']);
  });
});

describe('bill of materials', () => {
  it('counts a drawn SFP module once', () => {
    const sw = dev('switch-48-poe', 'SW'), mod = dev('sfp-module', 'SFP'), fp = dev('patch-panel-fiber-24', 'FP');
    const p = project([sw, mod, fp], [cable(sw, 'SFP1', mod, 'HOST'), cable(mod, 'LINE', fp, 'PP1', { cable: 'Fiber SM', length: '3 ft' })]);
    const { sections } = billOfMaterials(p, st);
    const rows = sections.flatMap((s) => s.rows);
    assert.equal(rows.filter((r) => /SFP \/ SFP\+ transceiver/.test(r.item)).reduce((t, r) => t + r.qty, 0), 1);
    assert.equal(sections.find((s) => s.title === 'Transceivers'), undefined);
    assert.equal(rows.filter((r) => /length not set/.test(r.detail)).length, 0);
  });
  it('keeps runs typed as 1,200 ft in the cable total and the labor', () => {
    const pp = dev('patch-panel-24', 'PP'), pc = dev('workstation', 'PC');
    const { sections, work } = billOfMaterials(project([pp, pc], [cable(pp, 'PP1', pc, 'NIC', { length: '1,200 ft' })]), st);
    const bulk = sections.find((s) => s.title === 'Cabling')!.rows.find((r) => r.key.startsWith('bulk|'))!;
    assert.equal(bulk.qty, 1320);
    assert.equal(work.copperRuns, 1);
  });
  it('does not bill Wi-Fi, Bluetooth or VPN links, nor MPLS twice', () => {
    const mpls = dev('mpls-cloud', 'MPLS'), a = dev('sdwan', 'A'), b = dev('sdwan', 'B'), ap = dev('access-point', 'AP'), lap = dev('laptop', 'L');
    const p = project([mpls, a, b, ap, lap], [
      cable(mpls, 'A', a, 'WAN1', { cable: 'MPLS' }), cable(mpls, 'B', b, 'WAN1', { cable: 'MPLS' }), cable(ap, 'WIFI', lap, 'NIC', { cable: 'Wireless' }),
    ]);
    const svc = billOfMaterials(p, st).sections.find((s) => s.title === 'Circuits & services')!.rows.map((r) => r.item);
    assert.deepEqual(svc, ['MPLS / private WAN service']);
  });
  it('a PC whose name mentions a patch panel still gets its keystone and labor', () => {
    const pp = dev('patch-panel-24', 'PP'), pc = dev('workstation', 'Patch Panel Room PC');
    const { sections, work } = billOfMaterials(project([pp, pc], [cable(pp, 'PP1', pc, 'NIC', { length: '90 ft' })]), st);
    assert.equal(work.endpoints, 1);
    assert.equal(sections.find((s) => s.title === 'Terminations')?.rows[0].qty, 1);
  });
});

describe('templates', () => {
  it('every built-in template is consistent', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const p = projectFromTemplate(t.project, 'x');
      const ids = new Set(p.pages.flatMap((pg) => pg.nodes.map((nd) => nd.id)));
      assert.equal(ids.size, p.pages.reduce((s, pg) => s + pg.nodes.length, 0), `${t.id}: duplicate ids`);
      for (const pg of p.pages) for (const e of pg.edges) {
        assert.ok(ids.has(e.source) && ids.has(e.target), `${t.id}: dangling cable`);
        for (const [nid, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
          const node = pg.nodes.find((x) => x.id === nid) as DeviceNode | undefined;
          const s = node?.type === 'device' ? st(node.data.stencilId) : undefined;
          if (s && h) assert.ok(s.ports.some((q) => q.id === h), `${t.id}: ${node!.data.name} has no port ${h}`);
        }
      }
      for (const r of p.racks ?? []) {
        assert.ok(r.units <= MAX_RACK_U, `${t.id}: ${r.name} too tall`);
        for (const it of r.items) if (it.nodeId) assert.ok(ids.has(it.nodeId), `${t.id}: rack item without device`);
      }
    }
  });
  it('page links and off-page pairs follow the new ids', () => {
    const pageA = { id: 'pa', name: 'A', kind: 'network', nodes: [
      { id: 'o1', type: 'shape', position: { x: 0, y: 0 }, data: { kind: 'offpage', text: 'To B', pair: 'o2', link: 'page:pb' } },
    ], edges: [] };
    const pageB = { id: 'pb', name: 'B', kind: 'network', nodes: [
      { id: 'o2', type: 'shape', position: { x: 0, y: 0 }, data: { kind: 'offpage', text: 'To A', pair: 'o1', link: 'page:pa', moreLinks: [{ address: 'page:pa' }] } },
    ], edges: [] };
    const p = projectFromTemplate({ pages: [pageA, pageB], activePageId: 'pa' } as never, 'x');
    const [a, b] = p.pages;
    const oa = a.nodes[0].data as { pair: string; link: string }, ob = b.nodes[0].data as { pair: string; link: string; moreLinks: { address: string }[] };
    assert.equal(oa.pair, b.nodes[0].id);
    assert.equal(ob.pair, a.nodes[0].id);
    assert.equal(oa.link, `page:${b.id}`);
    assert.equal(ob.link, `page:${a.id}`);
    assert.equal(ob.moreLinks[0].address, `page:${a.id}`);
  });
  it('the large campus traces drops through two panels with a total length', () => {
    const p = projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-net-large')!.project, 'x');
    const paths = allPaths(p, st);
    assert.ok(paths.length > 10);
    assert.ok(paths.some((t) => t.hops.filter((h) => h.passThrough).length >= 2 && pathLength(t)));
  });
});

describe('opening files', () => {
  it('drops broken items instead of crashing', () => {
    const { project: p, report } = sanitizeProject({ name: 'X', pages: [{ id: 'p', name: 'P', nodes: [
      { id: 'a', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'server', name: 'A' } },
      { id: 'b', type: 'device', position: { x: 'no' }, data: {} }, null,
    ], edges: [{ id: 'e', source: 'a', target: 'missing' }] }] });
    assert.equal(p.pages[0].nodes.length, 1);
    assert.equal(p.pages[0].edges.length, 0);
    assert.equal(report.droppedNodes, 2);
  });
  it('refuses something that is not a diagram', () => {
    assert.throws(() => sanitizeProject({ hello: 1 }));
    assert.throws(() => sanitizeProject(null));
  });
});
