/** Unit tests for device lifecycle dates and circuit records. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { circuitName, daysUntil, lifecycleProblems, lifecycleRows, stateOf, whenText } from '../src/lib/lifecycle';
import { billOfMaterials } from '../src/lib/bom';
import { priceQuote } from '../src/lib/quote';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, Project } from '../src/lib/types';

const today = new Date(2026, 10, 24); // 24 Nov 2026
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const proj = (nodes: DeviceNode[]): Project =>
  ({ id: 'p', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges: [] }] }) as unknown as Project;

describe('lifecycle dates', () => {
  it('counts days and states', () => {
    assert.equal(daysUntil('2026-11-24', today), 0);
    assert.equal(daysUntil('2026-12-24', today), 30);
    assert.equal(daysUntil('2026-11-20', today), -4);
    assert.equal(daysUntil('', today), undefined);
    assert.equal(daysUntil('soon', today), undefined);
    assert.equal(stateOf(-1), 'expired');
    assert.equal(stateOf(90), 'soon');
    assert.equal(stateOf(91), 'ok');
    assert.equal(stateOf(undefined), 'unknown');
    assert.equal(whenText(-3), '3 days ago');
    assert.equal(whenText(1), 'in 1 day');
  });
  it('takes the more urgent of warranty and end of life', () => {
    const [r] = lifecycleRows(proj([dev('fw', 'firewall', { warrantyEnd: '2028-01-01', endOfLife: '2026-12-01' })]), today);
    assert.equal(r.state, 'soon');
  });
  it('flags what Check Diagram should show', () => {
    const p = proj([
      dev('old', 'server', { warrantyEnd: '2026-01-01', endOfLife: '2026-06-01' }),
      dev('soon', 'switch-24', { warrantyEnd: '2027-01-10' }),
      dev('fine', 'nas', { warrantyEnd: '2030-01-01' }),
      dev('isp', 'internet', { circuit: { carrier: 'ISP', contractEnd: '2026-12-15' } }),
    ]);
    const rules = lifecycleProblems(p, today).map((x) => `${x.deviceId}:${x.rule}:${x.severity}`).sort();
    assert.deepEqual(rules, ['isp:Circuit contract:info', 'old:End of life:warning', 'old:Out of warranty:warning', 'soon:Warranty ending:info']);
  });
});

describe('circuits in the quote', () => {
  it('lists each recorded circuit with its own monthly cost, replacing the generic Internet line', () => {
    const p = proj([
      dev('isp1', 'internet', { circuit: { carrier: 'Fiber ISP', bandwidth: '1 Gbps', kind: 'DIA (dedicated Internet)', circuitId: 'C1', monthlyCost: 650 } }),
      dev('isp2', 'internet'),
      dev('lte', 'lte-router', { circuit: { carrier: 'Mobile', kind: 'LTE / 5G', monthlyCost: 40 } }),
    ]);
    const { sections, work } = billOfMaterials(p, (id) => STENCIL_MAP[id]);
    const svc = sections.find((s) => s.title === 'Circuits & services')!.rows;
    assert.deepEqual(svc.map((r) => r.item), ['Fiber ISP 1 Gbps DIA (C1)', 'Mobile LTE / 5G']);
    const q = priceQuote(sections, work, {});
    assert.equal(q.monthly, 690);
  });
  it('names circuits sensibly', () => {
    assert.equal(circuitName({}, 'ISP 1'), 'ISP 1');
    assert.equal(circuitName({ carrier: 'X', circuitId: '9' }, 'n'), 'X (9)');
  });
});
