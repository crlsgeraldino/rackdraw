/** Unit tests for rack power, heat, weight and UPS runtime. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { rackPower, runtimeAt, upsRating } from '../src/lib/rackPower';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, Project, Rack } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const setup = (devices: DeviceNode[], rack: Partial<Rack> = {}) => {
  const r: Rack = { id: 'r', name: 'R', units: 42, items: devices.map((d, i) => ({ id: `i${i}`, kind: 'device', nodeId: d.id, u: i + 1, height: 1, depth: 'full' })), ...rack } as Rack;
  const p = { id: 'p', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, racks: [r], pages: [{ id: 'pg', name: 'N', kind: 'network', nodes: devices, edges: [] }] } as unknown as Project;
  return { p, r };
};

describe('rack power', () => {
  it('uses typical figures, the device own figures, and PoE', () => {
    const { p, r } = setup([dev('s', 'server'), dev('n', 'nas', { powerW: 50, weightLb: 12 }), dev('sw', 'switch-24-poe', { ports: { P1: { poe: 'PoE+' }, P2: { poe: 'PoE' } } })]);
    const pw = rackPower(p, r, st);
    assert.equal(pw.poeW, Math.round((30 + 15.4) / 0.9));
    assert.equal(pw.totalW, 400 + 50 + 45 + pw.poeW);
    assert.equal(pw.btu, Math.round(pw.totalW * 3.412));
    assert.equal(pw.weightLb, 50 + 12 + 8);
  });
  it('loads the circuit against its 80% continuous rating', () => {
    const { p, r } = setup([dev('a', 'server'), dev('b', 'server'), dev('c', 'server'), dev('d', 'server'), dev('e', 'server')], { feedVolts: 120, feedAmps: 20 });
    const pw = rackPower(p, r, st);
    assert.equal(pw.circuit!.continuousW, 1920);
    assert.ok(pw.circuit!.pct > 1);
    assert.ok(pw.warnings.some((w) => /over the 1920 W continuous rating/.test(w)));
  });
  it('reads a UPS rating from its model and estimates runtime', () => {
    assert.equal(upsRating(dev('u', 'ups', { model: '1500VA rack UPS' })).capacityW, 990);
    assert.equal(upsRating(dev('u', 'ups', { model: '5kVA rack UPS' })).capacityW, 4500);
    assert.equal(upsRating(dev('u', 'ups', { ups: { capacityW: 1200, runtimeHalfMin: 20 } })).assumed, false);
    assert.equal(Math.round(runtimeAt(500, 1000, 15)), 15);
    assert.ok(runtimeAt(1000, 1000, 15) < 15);
    const { p, r } = setup([dev('u', 'ups', { model: '1500VA' }), dev('a', 'server'), dev('b', 'server'), dev('c', 'server')]);
    assert.ok(rackPower(p, r, st).warnings.some((w) => /overloaded/.test(w)));
  });
  it('the templates racks are within their circuits and UPSes', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const p = projectFromTemplate(t.project, 'x');
      for (const r of p.racks ?? []) {
        const pw = rackPower(p, r, st);
        assert.deepEqual(pw.warnings.filter((w) => /over the|overloaded/.test(w)), [], `${t.id} ${r.name}`);
      }
    }
  });
});
