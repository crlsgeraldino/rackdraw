/** Unit tests for the Sites summary. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { deviceSites, NO_SITE, siteSummaries, siteTableRows } from '../src/lib/sites';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, CableEdge, DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const cable = (id: string, s: string, t: string, cableType = 'Cat6'): CableEdge => ({ id, source: s, target: t, type: 'cable', data: { cable: cableType } }) as CableEdge;
const proj = (nodes: AppNode[], edges: CableEdge[], extra: Partial<Project> = {}): Project =>
  ({ id: 'p', name: 'C', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges }], ...extra }) as unknown as Project;

describe('sites', () => {
  it('takes the device location, else its rack, else what it is cabled to', () => {
    const p = proj(
      [dev('fw', 'firewall', { location: 'HQ' }), dev('sw', 'switch-24-poe'), dev('pc', 'workstation'), dev('br', 'router', { location: 'Branch' }), dev('lap', 'laptop'), dev('lost', 'printer')],
      [cable('1', 'fw', 'sw'), cable('2', 'sw', 'pc'), cable('3', 'br', 'lap'), cable('4', 'fw', 'br', 'MPLS')],
      { racks: [{ id: 'r', name: 'Rack A', units: 12, location: 'HQ server room', items: [{ id: 'i', kind: 'device', nodeId: 'sw', u: 5, height: 1, depth: 'full' }] }] },
    );
    const s = deviceSites(p);
    assert.equal(s.get('fw'), 'HQ');
    assert.equal(s.get('sw'), 'HQ server room');
    assert.equal(s.get('pc'), 'HQ server room', 'nearest located device by cables');
    assert.equal(s.get('lap'), 'Branch');
    assert.equal(s.get('lost'), NO_SITE);
  });

  it('sums each site and lists the links between sites', () => {
    const p = proj(
      [
        dev('fw', 'firewall', { location: 'HQ', circuit: { carrier: 'FiberCo', bandwidth: '1G', monthlyCost: 450 } }),
        dev('sw', 'switch-24-poe', { location: 'HQ', warrantyEnd: '2001-01-01', ports: { P1: { poe: 'PoE+', description: 'AP' } } }),
        dev('br', 'router', { location: 'Branch', circuit: { carrier: 'Cable', monthlyCost: 89.5 } }),
      ],
      [cable('1', 'fw', 'sw'), cable('2', 'fw', 'br', 'MPLS'), cable('3', 'fw', 'br', 'MPLS')],
    );
    const { sites, links } = siteSummaries(p, st, new Date('2026-11-24'));
    const hq = sites.find((x) => x.site === 'HQ')!;
    assert.equal(hq.devices, 2);
    assert.equal(hq.groups.network, 2);
    assert.equal(hq.monthlyCost, 450);
    assert.equal(hq.warranty.expired, 1);
    assert.equal(hq.ports.total, 28);
    assert.equal(hq.ports.poe, 1);
    assert.deepEqual(links, [{ a: 'Branch', b: 'HQ', cables: 2, types: 'MPLS ×2' }]);
    const row = siteTableRows(sites).find((r) => r[0] === 'Branch')!;
    assert.equal(row[10], '$89.50');
  });

  it('places every device of the medium and large templates at a real site', () => {
    for (const id of ['tpl-net-medium', 'tpl-net-large']) {
      const t = BUILT_IN_TEMPLATES.find((x) => x.id === id)!;
      const { sites, links } = siteSummaries(projectFromTemplate(t.project, 'x'), st);
      assert.ok(!sites.some((s) => s.site === NO_SITE), `${id}: nothing left without a site`);
      assert.ok(sites.length >= 3 && links.length >= 2, id);
    }
  });
});
