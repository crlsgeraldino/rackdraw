/** Power cords in a rack: inlets and outlets, plugging in, loads, redundancy, and the bill of materials. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { billOfMaterials } from '../src/lib/bom';
import { inletsOf, plugInAll, powerLoads, powerSources, validCords } from '../src/lib/powerCords';
import { sanitizeProject } from '../src/lib/sanitize';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, PowerCord, Project, Rack, RackItem } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const item = (id: string, u: number, extra: Partial<RackItem> = {}): RackItem => ({ id, kind: 'device', nodeId: id, u, height: 1, depth: 'full', ...extra });

const nodes = [dev('fw', 'sonicwall-tz570-670'), dev('sw', 'switch-24-poe'), dev('srv', 'server'), dev('ups', 'ups', { ups: { capacityW: 1000 } }), dev('pp', 'patch-panel-24')];
const devices = new Map(nodes.map((n) => [n.id, n]));
const rackWith = (power: PowerCord[] = [], extra: RackItem[] = []): Rack => ({
  id: 'r', name: 'Rack A', units: 12, power,
  items: [item('fw', 12), item('pp', 11), item('sw', 10), item('srv', 8, { height: 2 }), item('ups', 2, { height: 2 }),
    { id: 'pduA', kind: 'pdu', label: 'PDU A', u: 1, height: 1, depth: 'rear' }, ...extra],
});

describe('power inlets and outlets', () => {
  it('knows what plugs in and what gives power', () => {
    const r = rackWith();
    const ids = (it: RackItem) => inletsOf(it, devices.get(it.nodeId ?? ''), st(devices.get(it.nodeId ?? '')?.data.stencilId ?? '')).map((i) => i.id);
    const byId = (id: string) => r.items.find((x) => x.id === id)!;
    assert.deepEqual(ids(byId('fw')), ['PSU2', 'PSU1']); // the TZ's own power ports
    assert.deepEqual(ids(byId('sw')), ['PSU']);
    assert.deepEqual(ids(byId('srv')), ['PSU1', 'PSU2']); // servers have two
    assert.deepEqual(ids(byId('ups')), []); // into the wall
    assert.deepEqual(ids(byId('pp')), []); // a patch panel takes no power
    assert.deepEqual(ids(byId('pduA')), ['IN']);
    assert.deepEqual(powerSources(r, devices, st).map((s) => [s.itemId, s.outlets]), [['pduA', 8], ['ups', 6]]);
  });
});

describe('plugging in', () => {
  it('feeds the PDU from the UPS and plugs everything else into PDUs, two supplies on two PDUs', () => {
    const r = rackWith([], [{ id: 'pduB', kind: 'pdu', label: 'PDU B', u: 3, height: 1, depth: 'rear' }]);
    const cords = plugInAll(r, devices, st);
    const on = (from: string) => cords.filter((c) => c.from === from).map((c) => c.to).sort();
    assert.deepEqual(on('pduA'), ['ups']);
    assert.deepEqual(on('pduB'), ['ups']);
    assert.deepEqual(on('srv'), ['pduA', 'pduB']);
    assert.deepEqual(on('fw'), ['pduA', 'pduB']);
    assert.equal(on('sw').length, 1);
    assert.equal(on('pp').length, 0);
    // No outlet used twice.
    assert.equal(new Set(cords.map((c) => `${c.to}|${c.outlet}`)).size, cords.length);
    // Plugging in again changes nothing.
    assert.equal(plugInAll({ ...r, power: cords }, devices, st).length, cords.length);
  });

  it('drops cords that no longer make sense', () => {
    const r = rackWith([
      { id: 'a', from: 'sw', inlet: 'PSU', to: 'pduA', outlet: 1 },
      { id: 'b', from: 'srv', inlet: 'PSU1', to: 'pduA', outlet: 1 }, // outlet taken
      { id: 'c', from: 'gone', inlet: 'PSU', to: 'pduA', outlet: 2 },
      { id: 'd', from: 'sw', inlet: 'NOPE', to: 'pduA', outlet: 3 },
      { id: 'e', from: 'srv', inlet: 'PSU2', to: 'pduA', outlet: 99 },
    ]);
    assert.deepEqual(validCords(r, devices, st).map((c) => c.id), ['a']);
  });
});

describe('loads', () => {
  const watts = (id: string) => ({ fw: 40, sw: 200, srv: 400 } as Record<string, number>)[id] ?? 0;
  it('adds up the load on each PDU and the UPS feeding it, and warns about redundancy', () => {
    const r = rackWith([
      { id: '1', from: 'pduA', inlet: 'IN', to: 'ups', outlet: 1 },
      { id: '2', from: 'srv', inlet: 'PSU1', to: 'pduA', outlet: 1 },
      { id: '3', from: 'srv', inlet: 'PSU2', to: 'pduA', outlet: 2 },
      { id: '4', from: 'sw', inlet: 'PSU', to: 'pduA', outlet: 3 },
    ]);
    const { sources, unplugged, warnings } = powerLoads(r, devices, st, watts);
    const pdu = sources.find((s) => s.itemId === 'pduA')!, ups = sources.find((s) => s.itemId === 'ups')!;
    assert.equal(pdu.loadW, 600);
    assert.equal(ups.loadW, 600);
    assert.equal(ups.capacityW, 1000);
    assert.deepEqual(unplugged, ['fw']);
    assert.ok(warnings.some((w) => /srv: both power supplies are on PDU A/.test(w)));
  });

  it('warns when a PDU or UPS is overloaded, or would be if the other feed failed', () => {
    const big = (id: string) => (id === 'srv' ? 1800 : 0);
    const r = rackWith([
      { id: '2', from: 'srv', inlet: 'PSU1', to: 'pduA', outlet: 1 },
      { id: '3', from: 'srv', inlet: 'PSU2', to: 'ups', outlet: 1 },
    ]);
    const { warnings } = powerLoads(r, devices, st, big);
    assert.ok(warnings.some((w) => /If the other feed fails, PDU A \(U1\) would carry 1800 W of 1440 W/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /If the other feed fails, ups would carry 1800 W of 1000 W/.test(w)), warnings.join('\n'));
    const over = powerLoads(r, devices, st, () => 4000).warnings;
    assert.ok(over.some((w) => /ups is overloaded/.test(w)));
  });
});

describe('power cords in files and the bill of materials', () => {
  const project = (power: PowerCord[]) => ({
    id: 'p', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0,
    pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges: [] }],
    racks: [rackWith(power)],
  }) as unknown as Project;

  it('counts one cord per device supply plugged in (not the PDU input)', () => {
    const p = project([
      { id: '1', from: 'pduA', inlet: 'IN', to: 'ups', outlet: 1 },
      { id: '2', from: 'srv', inlet: 'PSU1', to: 'pduA', outlet: 1 },
      { id: '3', from: 'sw', inlet: 'PSU', to: 'pduA', outlet: 2 },
    ]);
    const row = billOfMaterials(p, st).sections.find((s) => s.title === 'Racks & accessories')!.rows.find((r) => /Power cord/.test(r.item));
    assert.equal(row?.qty, 2);
  });

  it('keeps cords in a saved file and drops broken ones', () => {
    const raw = project([{ id: '2', from: 'srv', inlet: 'PSU1', to: 'pduA', outlet: 1 }]) as unknown as Record<string, unknown>;
    (raw.racks as Rack[])[0].power!.push({ id: 5, from: 'x' } as unknown as PowerCord);
    const { project: clean } = sanitizeProject(raw);
    assert.deepEqual(clean.racks![0].power!.map((c) => c.id), ['2']);
  });
});
