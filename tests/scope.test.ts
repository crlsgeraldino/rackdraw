/** Unit tests for the job's scope: what the client already has is listed, not quoted, and needs no labor. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { billOfMaterials, ON_SITE_SECTION, quotedBom } from '../src/lib/bom';
import { priceQuote } from '../src/lib/quote';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id } }) as DeviceNode;
const proj = (nodes: DeviceNode[], extra: Partial<Project> = {}): Project =>
  ({ id: 'p', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges: [] }], ...extra }) as unknown as Project;

const p = proj([dev('sw', 'switch-24'), dev('fw', 'firewall'), dev('pc1', 'workstation'), dev('pc2', 'workstation')], {
  racks: [{ id: 'r', name: 'Rack A', units: 12, items: [] }],
} as Partial<Project>);
const keyOf = (item: RegExp) => billOfMaterials(p, st).sections.flatMap((s) => s.rows).find((r) => item.test(r.item))!.key;

describe('job scope', () => {
  it('quotes everything when nothing is marked', () => {
    const { sections, work } = billOfMaterials(p, st);
    const q = priceQuote(sections, work, {}, {});
    assert.deepEqual(q.onSite, []);
    assert.deepEqual(q.work, work);
  });

  it('leaves out what the client has, with its labor', () => {
    const { sections, work } = billOfMaterials(p, st);
    const all = Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.key, 'all' as const]));
    const sw = keyOf(/switch/i);
    delete all[sw]; // replacing the switch only
    const prices = { [sw]: 1000, [keyOf(/workstation/i)]: 800 };
    const q = priceQuote(sections, work, prices, { onSite: all });
    assert.deepEqual(q.lines.map((l) => l.key), [sw]);
    assert.equal(q.materials, 1000);
    assert.equal(q.work.rackDevices, 1); // the switch only, not the firewall
    assert.equal(q.work.endpoints, 0);
    assert.equal(q.work.racks, 0); // their rack
    assert.ok(q.onSite.some((r) => /rack/i.test(r.item)));
  });

  it('quotes part of a line', () => {
    const { sections, work } = billOfMaterials(p, st);
    const pc = keyOf(/workstation/i);
    const q = priceQuote(sections, work, { [pc]: 800 }, { onSite: { [pc]: 1 } });
    const line = q.lines.find((l) => l.key === pc)!;
    assert.equal(line.qty, 1);
    assert.equal(line.amount, 800);
    assert.equal(q.onSite.find((r) => r.key === pc)!.qty, 1);
    assert.equal(q.work.endpoints, work.endpoints - 1);
  });

  it('ignores counts that make no sense', () => {
    const { sections, work } = billOfMaterials(p, st);
    const pc = keyOf(/workstation/i);
    const q = priceQuote(sections, work, {}, { onSite: { [pc]: -3, nope: 'all', [keyOf(/switch/i)]: Number.NaN } });
    assert.deepEqual(q.onSite, []);
    const q2 = priceQuote(sections, work, {}, { onSite: { [pc]: 99 } });
    assert.equal(q2.onSite.find((r) => r.key === pc)!.qty, 2);
    assert.ok(!q2.lines.some((l) => l.key === pc));
  });

  it('reports list what is already on site in its own section', () => {
    const fw = keyOf(/firewall/i);
    const b = quotedBom({ ...p, quote: { onSite: { [fw]: 'all' } } }, st);
    const titles = b.sections.map((s) => s.title);
    assert.equal(titles.at(-1), ON_SITE_SECTION);
    assert.ok(!b.sections[0].rows.some((r) => r.key === fw));
  });
});
