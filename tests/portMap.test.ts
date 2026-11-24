/** Unit tests for the switch / patch panel port map. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { portFaceSvg, portMap, portMapCsv, portMapDevices, portMapHtml, portMapTsv } from '../src/lib/portMap';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { CableEdge, DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const cable = (id: string, s: string, sh: string | undefined, t: string, th: string | undefined, data: Record<string, unknown> = {}): CableEdge =>
  ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th, type: 'cable', data: { cable: 'Cat6', ...data } }) as CableEdge;

/** Switch port 3 → patch panel 7 (front); panel 7 (back) → desk PC. */
function office(): Project {
  const nodes = [
    dev('sw', 'switch-24-poe', { name: 'Core switch', ports: { P3: { vlan: '20', poe: 'PoE+' }, P5: { status: 'down' }, P6: { status: 'disabled' }, P1: { uplink: true, description: 'ISP router' } } }),
    dev('pp', 'patch-panel-24', { name: 'Panel A' }),
    dev('pc', 'desktop', { name: 'Front desk PC' }),
  ];
  const edges = [cable('c1', 'sw', 'P3', 'pp', 'PP7', { label: 'C-001', length: '3 ft' }), cable('c2', 'pp', 'PP7', 'pc', undefined, { length: '85 ft' })];
  return {
    id: 'p', name: 'Office', activePageId: 'pg', createdAt: 0, updatedAt: 0,
    vlans: [{ id: 'v', vlan: '20', name: 'Staff', color: '#93c5fd' }],
    racks: [{ id: 'r', name: 'Rack A', units: 12, items: [{ id: 'i1', kind: 'device', nodeId: 'sw', u: 10, height: 1, depth: 'full' }, { id: 'i2', kind: 'device', nodeId: 'pp', u: 11, height: 1, depth: 'full' }] }],
    pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges }],
  } as unknown as Project;
}

describe('port map', () => {
  it('lists switches and patch panels, not end devices', () => {
    const ids = portMapDevices(office(), st).map((d) => d.id);
    assert.deepEqual(ids.sort(), ['pp', 'sw']);
  });

  it('follows a switch port through the patch panel to the far end', () => {
    const m = portMap(office(), 'sw', st)!;
    const r = m.rows.find((x) => x.id === 'P3')!;
    assert.equal(r.cabled, true);
    assert.equal(r.to, 'Front desk PC');
    assert.equal(r.via, 'Panel A 7');
    assert.equal(r.vlan, '20');
    assert.equal(r.vlanColor, '#93c5fd');
    assert.equal(r.cableLabel, 'C-001');
    assert.equal(r.length, '88 ft');
    assert.equal(m.where, 'Rack A U10');
  });

  it('shows both ends of a patch panel port', () => {
    const m = portMap(office(), 'pp', st)!;
    assert.equal(m.passThrough, true);
    const r = m.rows.find((x) => x.id === 'PP7')!;
    assert.match(r.to, /Core switch 3/);
    assert.match(r.to, /Front desk PC/);
  });

  it('counts used, free, PoE and uplinks; down and disabled ports', () => {
    const m = portMap(office(), 'sw', st)!;
    assert.equal(m.total, 28); // 24 copper + 4 SFP
    assert.equal(m.used, 2); // P3 cabled, P1 noted
    assert.equal(m.free, 28 - 2 - 1); // a down port with nothing on it can be used; a disabled one can't
    assert.equal(m.poe, 1);
    assert.equal(m.uplinks, 1);
    assert.equal(m.rows.find((x) => x.id === 'P1')!.to, '');
    assert.equal(m.rows.find((x) => x.id === 'P1')!.note, 'ISP router');
  });

  it('draws every port on the face and prints, copies and exports the same columns', () => {
    const m = portMap(office(), 'sw', st)!;
    const svg = portFaceSvg(m);
    assert.equal((svg.match(/data-port=/g) ?? []).length, m.rows.length);
    assert.ok(svg.includes('#93c5fd'), 'VLAN colour used for the cabled port');
    const html = portMapHtml([m], 'Office', true);
    assert.ok(html.includes('Front desk PC') && html.includes('C-001'));
    const tsv = portMapTsv([m]).split('\n');
    assert.equal(tsv.length, 1 + m.rows.length);
    assert.equal(tsv[0].split('\t').length, tsv[1].split('\t').length);
    assert.ok(portMapCsv([m]).startsWith('Device,Port,Connected to'));
  });

  it('builds a map for every switch and panel of every template without errors', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const p = projectFromTemplate(t.project, t.name);
      for (const d of portMapDevices(p, st)) {
        const m = portMap(p, d.id, st)!;
        assert.ok(m.rows.length >= 4, `${t.id} ${d.data.name}`);
        assert.ok(m.used <= m.total && m.free <= m.total);
      }
    }
  });
});
