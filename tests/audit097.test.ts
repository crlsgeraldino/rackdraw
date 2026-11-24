/** Regression tests for the problems found in the 0.97 audit. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assetLabels, labelledCables } from '../src/lib/labels';
import { nextFreeIp, subnetUsage, type VlanDef } from '../src/lib/ipam';
import { normalizeCell, deviceListRows } from '../src/lib/dataImport';
import { deviceFieldValue, reportFields } from '../src/lib/report';
import { templateFromProject, projectFromTemplate } from '../src/lib/templates';
import { sanitizeProject } from '../src/lib/sanitize';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { CableEdge, DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, extra: Record<string, unknown> = {}, stencilId = 'server'): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const cab = (id: string, a: string, b: string, label?: string): CableEdge =>
  ({ id, type: 'cable', source: a, target: b, sourceHandle: 'NIC1', targetHandle: 'NIC1', data: { cable: 'Cat6', ...(label ? { label } : {}) } }) as CableEdge;
const proj = (pages: { id: string; nodes: DeviceNode[]; edges: CableEdge[] }[], extra: Partial<Project> = {}): Project =>
  ({ id: 'p', name: 'Client', activePageId: pages[0].id, createdAt: 0, updatedAt: 0, pages: pages.map((p) => ({ ...p, name: p.id, kind: 'network' })), ...extra }) as unknown as Project;

describe('0.97 audit fixes', () => {
  it('cable numbers never repeat a label already in use, and are the same for one page or all', () => {
    const a = dev('a'), b = dev('b');
    const p = proj([{ id: 'p1', nodes: [a, b], edges: [cab('e1', 'a', 'b', 'C-001'), cab('e2', 'a', 'b')] }, { id: 'p2', nodes: [a, b], edges: [cab('e3', 'a', 'b')] }]);
    const all = labelledCables(p).map((c) => c.id);
    assert.equal(new Set(all).size, all.length, `duplicates in ${all}`);
    assert.deepEqual(labelledCables(p, 'p2').map((c) => c.id), [all[2]]);
  });
  it('a link too long for a QR code falls back to the details', () => {
    const p = proj([{ id: 'p1', nodes: [dev('srv', { link: 'https://example.sharepoint.com/' + 'x'.repeat(300) })], edges: [] }]);
    const [l] = assetLabels(p, st, { qr: 'link' });
    assert.ok(l.qr && !l.qr.startsWith('https://') && new TextEncoder().encode(l.qr).length <= 213);
  });
  it('next free IP is instant even when a huge DHCP range fills the subnet', () => {
    const v: VlanDef = { id: 'v', vlan: '1', name: 'big', subnet: '10.0.0.0/8', gateway: '10.0.0.1', dhcpStart: '10.0.0.2', dhcpEnd: '10.255.255.200' };
    const t0 = Date.now();
    assert.equal(nextFreeIp(v, new Set()), '10.255.255.201');
    assert.ok(Date.now() - t0 < 200, 'too slow');
  });
  it('subnet usage never counts an address twice', () => {
    const v: VlanDef = { id: 'v', vlan: '1', name: 'x', subnet: '10.0.0.0/24', gateway: '10.0.0.1', dhcpStart: '10.0.0.1', dhcpEnd: '10.0.0.254' };
    const [u] = subnetUsage(proj([{ id: 'p1', nodes: [dev('a', { ip: '10.0.0.50' })], edges: [] }], { vlans: [v] }));
    assert.equal(u.used, 2);
    assert.equal(u.dhcp, 252);
    assert.equal(u.used + u.dhcp + u.free, 254);
  });
  it('spreadsheet cells are read as the fields want them', () => {
    assert.equal(normalizeCell('warrantyEnd', '2027-03-01'), '2027-03-01');
    assert.match(normalizeCell('warrantyEnd', 'March 1, 2027'), /^2027-03-0[12]$/);
    assert.equal(normalizeCell('status', 'Planned'), 'planned');
    assert.equal(normalizeCell('status', 'nonsense'), '');
    assert.equal(normalizeCell('weightLb', '12,5'), '12.5');
    const rows = deviceListRows(proj([{ id: 'p1', nodes: [dev('a', { warrantyEnd: '2027-01-01', weightLb: 9 })], edges: [] }]), () => 'Server');
    assert.ok(rows[0].includes('Warranty ends') && rows[1].includes('2027-01-01') && rows[1].includes('9'));
  });
  it('reports can show circuit details as text', () => {
    const p = proj([{ id: 'p1', nodes: [dev('isp', { circuit: { carrier: 'Fiber Co', circuitId: 'CKT-1' } }, 'internet')], edges: [] }]);
    assert.ok(reportFields(p).some((f) => f.key === 'circuit.circuitId'));
    assert.equal(deviceFieldValue(p.pages[0].nodes[0].data as never, 'circuit.circuitId'), 'CKT-1');
    assert.equal(deviceFieldValue(p.pages[0].nodes[0].data as never, 'circuit'), '');
  });
  it('a template keeps the design but not the client paperwork', () => {
    const p = proj([{ id: 'p1', nodes: [dev('isp', { serial: 'S1', assetTag: 'A1', warrantyEnd: '2027-01-01', circuit: { carrier: 'Fiber Co', circuitId: 'CKT-1', accountNumber: '999', bandwidth: '1G' } }, 'internet')], edges: [] }], { notes: 'secret', quote: { markupPct: 30 } });
    const t = templateFromProject(p, 'T', '');
    const d = t.project.pages[0].nodes[0].data as Record<string, unknown>;
    assert.equal(d.serial, undefined); assert.equal(d.assetTag, undefined); assert.equal(d.warrantyEnd, undefined);
    assert.deepEqual(d.circuit, { carrier: 'Fiber Co', kind: undefined, bandwidth: '1G' });
    assert.equal((t.project as Record<string, unknown>).notes, undefined);
    assert.equal((t.project as Record<string, unknown>).quote, undefined);
    assert.ok(projectFromTemplate(t.project, 'x').pages[0].nodes.length === 1);
  });
  it('a hand-edited file with words in number fields opens without them', () => {
    const { project } = sanitizeProject({ name: 'x', pages: [{ id: 'p', name: 'P', nodes: [{ id: 'a', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'server', name: 'A', weightLb: 'heavy', powerW: 300, ups: { capacityW: 'big' } } }], edges: [] }], racks: [{ id: 'r', name: 'R', units: 42, items: [], feedAmps: 'lots' }] });
    const d = project.pages[0].nodes[0].data as Record<string, unknown>;
    assert.equal(d.weightLb, undefined); assert.equal(d.powerW, 300); assert.equal((d.ups as Record<string, unknown>).capacityW, undefined);
    assert.equal(project.racks![0].feedAmps, undefined);
  });
});
