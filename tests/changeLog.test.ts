/** Unit tests for the change log. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { appendEntries, changeLogCsv, cleanChangeLog, deviceHistory, diffProjects, type ChangeEntry } from '../src/lib/changeLog';
import { sanitizeProject } from '../src/lib/sanitize';
import { BUILT_IN_TEMPLATES, projectFromTemplate, templateFromProject } from '../src/lib/templates';
import type { AppNode, CableEdge, DeviceNode, Project } from '../src/lib/types';

const dev = (id: string, name: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'switch-24-poe', name, ...extra } }) as DeviceNode;
const proj = (nodes: AppNode[], edges: CableEdge[] = [], extra: Partial<Project> = {}): Project =>
  ({ id: 'p', name: 'Client', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'Network', kind: 'network', nodes, edges }], ...extra }) as unknown as Project;
const details = (e: ChangeEntry[]) => e.map((x) => `${x.kind}|${x.target}|${x.detail}`);

describe('change log', () => {
  it('records added, removed and changed devices', () => {
    const a = proj([dev('a', 'Core', { ip: '10.0.0.1' }), dev('b', 'Old switch')]);
    const b = proj([dev('a', 'Core', { ip: '10.0.0.2', serial: 'SN1' }), dev('c', 'New AP', { model: 'U6' })]);
    const d = details(diffProjects(a, b, 1));
    assert.ok(d.includes('device|Core|IP: 10.0.0.1 → 10.0.0.2'));
    assert.ok(d.includes('device|Core|Serial: — → SN1'));
    assert.ok(d.includes('device|New AP|Added · U6'));
    assert.ok(d.includes('device|Old switch|Deleted'));
  });

  it('ignores moves, selection and other drawing-only changes', () => {
    const a = proj([dev('a', 'Core')]);
    const moved = { ...a.pages[0].nodes[0], position: { x: 50, y: 80 }, selected: true } as DeviceNode;
    assert.deepEqual(diffProjects(a, proj([moved])), []);
  });

  it('records cables, ports, racks and the IP plan', () => {
    const c = (data: Record<string, unknown> = {}) => ({ id: 'c1', source: 'a', sourceHandle: 'P3', target: 'b', targetHandle: 'P1', type: 'cable', data: { cable: 'Cat6', ...data } }) as CableEdge;
    const a = proj([dev('a', 'Core'), dev('b', 'IDF')], [], { vlans: [{ id: 'v', vlan: '10', name: 'Staff', subnet: '10.0.10.0/24' }] });
    const b = proj([dev('a', 'Core', { ports: { P3: { vlan: '20' } } }), dev('b', 'IDF')], [c()], {
      vlans: [{ id: 'v', vlan: '10', name: 'Staff', subnet: '10.0.20.0/24' }],
      racks: [{ id: 'r', name: 'Rack A', units: 12, items: [{ id: 'i', kind: 'device', nodeId: 'a', u: 5, height: 1, depth: 'full' }] }],
    });
    const d = details(diffProjects(a, b));
    assert.ok(d.includes('cable|Core 3 ↔ IDF 1|Connected (Cat6)'), d.join('\n'));
    assert.ok(d.includes('port|Core 3|Port VLAN: — → 20'));
    assert.ok(d.includes('rack|Rack A|Rack added (12U)'));
    assert.ok(d.includes('rack|Core|Mounted in Rack A U5'));
    assert.ok(d.includes('vlan|VLAN 10 Staff|Subnet: 10.0.10.0/24 → 10.0.20.0/24'));
    const d2 = details(diffProjects(b, proj(b.pages[0].nodes, [c({ cable: 'Fiber', label: 'C-001' })], { vlans: b.vlans, racks: b.racks })));
    assert.ok(d2.includes('cable|Core 3 ↔ IDF 1|Cable type: Cat6 → Fiber'));
    assert.ok(d2.includes('cable|Core 3 ↔ IDF 1|Cable label: — → C-001'));
    const d3 = details(diffProjects(b, proj(b.pages[0].nodes, [], { vlans: b.vlans, racks: b.racks })));
    assert.ok(d3.includes('cable|Core 3 ↔ IDF 1|Disconnected'));
  });

  it('merges a field typed in several goes, and drops a change undone', () => {
    const e = (at: number, detail: string, target = 'Core'): ChangeEntry => ({ at, kind: 'device', action: 'changed', target, detail });
    let log = appendEntries([], [e(0, 'IP: 10.0.0.1 → 10.0.0.')]);
    log = appendEntries(log, [e(5000, 'IP: 10.0.0. → 10.0.0.25')]);
    assert.deepEqual(log.map((x) => x.detail), ['IP: 10.0.0.1 → 10.0.0.25']);
    log = appendEntries(log, [e(9000, 'IP: 10.0.0.25 → 10.0.0.1')]);
    assert.deepEqual(log, []);
    // Renames chain even though the device's name (the target) changes each time.
    log = appendEntries([], [e(0, 'Name: Core → Core sw', 'Core')]);
    log = appendEntries(log, [e(4000, 'Name: Core sw → Core switch', 'Core sw')]);
    assert.deepEqual(log.map((x) => `${x.target}|${x.detail}`), ['Core|Name: Core → Core switch']);
    // Long after: a new entry.
    log = appendEntries(log, [e(10 * 60_000, 'Name: Core switch → Core 1', 'Core switch')]);
    assert.equal(log.length, 2);
  });

  it('keeps only valid entries from files, travels in backups, and stays out of templates', () => {
    const good: ChangeEntry = { at: 5, kind: 'note', action: 'note', target: 'Note', detail: 'Ticket 1' };
    assert.deepEqual(cleanChangeLog([good, { at: 'x' }, null, { ...good, kind: 'evil' }]), [good]);
    const t = BUILT_IN_TEMPLATES[0];
    const p = { ...projectFromTemplate(t.project, 'C'), changeLog: [good] };
    assert.deepEqual(sanitizeProject(JSON.parse(JSON.stringify(p))).project.changeLog, [good]);
    assert.equal((templateFromProject(p, 'T', '').project as Project).changeLog, undefined);
    assert.ok(changeLogCsv([good]).includes('Ticket 1'));
  });
  it('ties entries to devices, so a device keeps its history through a rename', () => {
    const c = { id: 'c1', source: 'a', sourceHandle: 'P1', target: 'b', targetHandle: 'P2', type: 'cable', data: { cable: 'Cat6' } } as CableEdge;
    const a = proj([dev('a', 'Core', { ip: '10.0.0.1' }), dev('b', 'IDF')]);
    const b = proj([dev('a', 'Core', { ip: '10.0.0.2' }), dev('b', 'IDF')], [c]);
    const r = proj([dev('a', 'Core 1', { ip: '10.0.0.2' }), dev('b', 'IDF')], [c]);
    let log = appendEntries([], diffProjects(a, b, 1));
    log = appendEntries(log, diffProjects(b, r, 10 * 60_000));
    const h = deviceHistory(log, 'a', 'Core 1').map((e) => e.detail);
    assert.deepEqual(h, ['Name: Core → Core 1', 'Connected (Cat6)', 'IP: 10.0.0.1 → 10.0.0.2']);
    assert.deepEqual(deviceHistory(log, 'b', 'IDF').map((e) => e.detail), ['Connected (Cat6)']);
    // Entries from before ids were recorded are found by name.
    assert.equal(deviceHistory([{ at: 1, kind: 'device', action: 'changed', target: 'IDF', detail: 'IP: — → 1' }], 'b', 'IDF').length, 1);
    // ids survive a file round trip; junk ids are dropped.
    assert.deepEqual(cleanChangeLog(JSON.parse(JSON.stringify(log)))?.[0].ids, ['a']);
    assert.equal(cleanChangeLog([{ at: 1, kind: 'note', action: 'note', target: 'N', detail: 'x', ids: [5] }])?.[0].ids, undefined);
  });
});
