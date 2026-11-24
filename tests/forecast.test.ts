/** Unit tests for the replacement budget forecast. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { billOfMaterials, equipmentKey } from '../src/lib/bom';
import { dueDate, forecastRows, replacementForecast } from '../src/lib/forecast';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const proj = (nodes: AppNode[]): Project =>
  ({ id: 'p', name: 'C', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges: [] }] }) as unknown as Project;
const TODAY = new Date('2026-11-24T12:00:00');

describe('replacement forecast', () => {
  it('takes End of life, else purchase + typical life, else warranty end', () => {
    assert.deepEqual(dueDate(dev('a', 'switch-24', { endOfLife: '2028-03-01', purchaseDate: '2020-01-01' }), st('switch-24')), { due: '2028-03-01', basis: 'End of life' });
    assert.deepEqual(dueDate(dev('b', 'workstation', { purchaseDate: '2023-05-10' }), st('workstation')), { due: '2027-05-10', basis: 'Typical life', years: 4 });
    assert.deepEqual(dueDate(dev('c', 'switch-24', { purchaseDate: '2022-02-01' }), st('switch-24')), { due: '2029-02-01', basis: 'Typical life', years: 7 });
    assert.deepEqual(dueDate(dev('d', 'server', { warrantyEnd: '2027-01-31' }), st('server')), { due: '2027-01-31', basis: 'Warranty ends' });
    assert.equal(dueDate(dev('e', 'server'), st('server')), undefined);
    assert.equal(dueDate(dev('f', 'server', { endOfLife: 'soon' }), st('server')), undefined, 'a date that is not YYYY-MM-DD is ignored');
  });

  it('buckets by year with overdue first, prices from the price book, circuits as a yearly cost', () => {
    const p = proj([
      dev('old-pc', 'workstation', { purchaseDate: '2020-01-01' }),
      dev('pc', 'workstation', { purchaseDate: '2023-06-01', model: 'OptiPlex 7010' }),
      dev('pc2', 'workstation', { purchaseDate: '2023-07-01', model: 'OptiPlex 7010' }),
      dev('sw', 'switch-24', { endOfLife: '2029-12-31' }),
      dev('far', 'switch-24', { endOfLife: '2040-01-01' }),
      dev('nodate', 'server'),
      dev('panel', 'patch-panel-24', { purchaseDate: '2010-01-01' }),
      dev('isp', 'internet', { circuit: { carrier: 'FiberCo', monthlyCost: 100 } }),
    ]);
    const key = equipmentKey(p.pages[0].nodes[1] as DeviceNode, st('workstation'))!;
    const f = replacementForecast(p, st, { [key]: 900 }, TODAY);
    assert.deepEqual(f.years.map((y) => y.year), [0, 2026, 2027, 2028, 2029, 2030]);
    assert.deepEqual(f.years[0].items.map((i) => i.deviceId), ['old-pc']);
    const y2027 = f.years.find((y) => y.year === 2027)!;
    assert.deepEqual(y2027.items.map((i) => i.deviceId), ['pc', 'pc2']);
    assert.equal(y2027.equipment, 1800);
    assert.equal(y2027.recurring, 1200);
    assert.equal(y2027.total, 3000);
    assert.equal(f.years[0].recurring, 0, 'overdue has no circuits');
    assert.equal(f.years.find((y) => y.year === 2029)!.unpriced, 1);
    assert.ok(!f.items.some((i) => i.deviceId === 'far'), 'beyond the forecast');
    assert.ok(!f.items.some((i) => i.deviceId === 'panel' || i.deviceId === 'isp'), 'passive cabling and services are not replaced on a schedule');
    assert.deepEqual(f.undated.map((u) => u.deviceId), ['nodate']);
    assert.equal(forecastRows(f)[0][1], 'Overdue');
  });

  it('uses the same price keys as the Bill of Materials', () => {
    const t = BUILT_IN_TEMPLATES.find((x) => x.id === 'tpl-net-medium')!;
    const p = projectFromTemplate(t.project, 'x');
    const bomKeys = new Set(billOfMaterials(p, st).sections.flatMap((s) => s.rows.map((r) => r.key)));
    const f = replacementForecast(p, st, {}, TODAY);
    for (const i of [...f.items, ...f.undated]) assert.ok(bomKeys.has(i.key), `${i.device}: ${i.key}`);
    assert.ok(f.items.length > 0, 'the medium template has dated equipment');
  });
});
