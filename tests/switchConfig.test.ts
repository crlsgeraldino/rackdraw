/** Unit tests for the switch configuration starter. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { configurableSwitches, interfaceNames, portPlans, switchConfig, vlanNumbers } from '../src/lib/switchConfig';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, CableEdge, DeviceNode, Project } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id, ...extra } }) as DeviceNode;
const cable = (id: string, s: string, sh: string, t: string, th?: string): CableEdge => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th, type: 'cable', data: { cable: 'Cat6' } }) as CableEdge;

function office(): Project {
  const nodes: AppNode[] = [
    dev('sw', 'switch-24-poe', { name: 'Office SW', ip: '10.0.99.5', ports: { P3: { vlan: '10', poe: 'PoE+' }, P5: { vlan: '20' }, P7: { status: 'disabled' }, P9: { description: 'Printer' }, P11: { label: 'Gi1/0/11', vlan: '10' } } }),
    dev('pp', 'patch-panel-24', { name: 'Panel A' }),
    dev('pc', 'workstation', { name: 'Front desk PC' }),
    dev('core', 'switch-core-24sfp', { name: 'Core' }),
  ];
  const edges = [cable('c1', 'sw', 'P3', 'pp', 'PP7'), cable('c2', 'pp', 'PP7', 'pc'), cable('c3', 'sw', 'SFP1', 'pp', 'PP20'), cable('c4', 'pp', 'PP20', 'core', 'X1')];
  return {
    id: 'p', name: 'Acme', activePageId: 'pg', createdAt: 0, updatedAt: 0,
    vlans: [{ id: 'a', vlan: '10', name: 'Staff data', subnet: '10.0.10.0/24' }, { id: 'b', vlan: '20', name: 'Voice' }, { id: 'c', vlan: '99', name: 'Mgmt', subnet: '10.0.99.0/24', gateway: '10.0.99.1' }],
    pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges }],
  } as unknown as Project;
}

describe('switch configuration starter', () => {
  it('reads VLAN fields', () => {
    assert.deepEqual(vlanNumbers('10'), [10]);
    assert.deepEqual(vlanNumbers('VLAN 20'), [20]);
    assert.deepEqual(vlanNumbers('10,20; 30-32'), [10, 20, 30, 31, 32]);
    assert.deepEqual(vlanNumbers('staff'), []);
    assert.deepEqual(vlanNumbers('0, 5000'), []);
  });

  it('names interfaces by style; a port named like an interface keeps its name', () => {
    const p = office();
    const sw = p.pages[0].nodes[0] as DeviceNode;
    const ios = interfaceNames(sw, st('switch-24-poe'), 'ios');
    assert.equal(ios.get('P1'), 'GigabitEthernet1/0/1');
    assert.equal(ios.get('SFP1'), 'TenGigabitEthernet1/1/1');
    assert.equal(ios.get('P11'), 'Gi1/0/11');
    const cx = interfaceNames(sw, st('switch-24-poe'), 'aoscx');
    assert.equal(cx.get('P24'), '1/1/24');
    assert.equal(cx.get('SFP1'), '1/1/25');
    const core = interfaceNames(p.pages[0].nodes[3] as DeviceNode, st('switch-core-24sfp'), 'ios');
    assert.equal(core.get('X1'), 'TenGigabitEthernet1/0/1');
    assert.equal(core.get('Q1'), 'HundredGigE1/1/1');
  });

  it('works out access, trunk (through a patch panel to another switch), off, and undocumented ports', () => {
    const p = office();
    const plans = new Map(portPlans(p, p.pages[0].nodes[0] as DeviceNode, st, 'ios').map((x) => [x.id, x]));
    assert.deepEqual([plans.get('P3')!.mode, plans.get('P3')!.vlans, plans.get('P3')!.poe], ['access', [10], true]);
    assert.equal(plans.get('P3')!.description, 'Front desk PC via Panel A 7');
    assert.equal(plans.get('SFP1')!.mode, 'trunk');
    assert.deepEqual(plans.get('SFP1')!.vlans, [10, 20], 'carries the access VLANs of the switch');
    assert.equal(plans.get('P7')!.mode, 'off');
    assert.equal(plans.get('P9')!.mode, 'unknown', 'in use, no VLAN: left alone');
    assert.equal(plans.get('P13')!.mode, 'unused');
    assert.equal(new Map(portPlans(p, p.pages[0].nodes[0] as DeviceNode, st, 'ios', true).map((x) => [x.id, x])).get('P13')!.mode, 'off', 'shut unused ports when asked');
  });

  it('writes Cisco IOS and Aruba CX starters with VLANs, ports and the management address, and nothing secret', () => {
    const p = office();
    const sw = p.pages[0].nodes[0] as DeviceNode;
    const ios = switchConfig(p, sw, st, { style: 'ios', date: '2026-11-24' });
    for (const line of ['hostname Office-SW', 'vlan 10', ' name Staff_data', 'interface GigabitEthernet1/0/3', ' switchport access vlan 10', ' power inline auto',
      'interface TenGigabitEthernet1/1/1', ' switchport trunk allowed vlan 10,20', 'interface Gi1/0/11', 'interface Vlan99', ' ip address 10.0.99.5 255.255.255.0', 'ip default-gateway 10.0.99.1']) {
      assert.ok(ios.split('\n').includes(line), `IOS: ${line}`);
    }
    assert.ok(/interface GigabitEthernet1\/0\/7\n description [^\n]*\n? shutdown|interface GigabitEthernet1\/0\/7\n shutdown/.test(ios), 'disabled port shut down');
    assert.ok(ios.includes('No VLAN documented for port 9: left as it is.'));
    const cx = switchConfig(p, sw, st, { style: 'aoscx', date: '2026-11-24' });
    for (const line of ['interface 1/1/3', '    vlan access 10', '    vlan trunk allowed 10,20', 'interface vlan 99', '    ip address 10.0.99.5/24', 'ip route 0.0.0.0/0 10.0.99.1']) assert.ok(cx.split('\n').includes(line), `CX: ${line}`);
    const table = switchConfig(p, sw, st, { style: 'table' });
    assert.ok(table.includes('3\tFront desk PC via Panel A 7\tAccess (untagged)\t10\tYes\tYes'));
    for (const t of [ios, cx, table]) assert.ok(!/password|secret|community|key /i.test(t.replace(/passwords, SNMP/g, '')), 'no secrets');
  });

  it('only offers switches, and writes a starter for every switch of the medium template', () => {
    const p = projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-net-medium')!.project, 'x');
    const sw = configurableSwitches(p, st);
    assert.deepEqual(sw.map((d) => d.data.name), ['Core switch', 'IDF1-SW1', 'IDF2-SW1', 'MDF-SW1']);
    for (const d of sw) for (const style of ['ios', 'aoscx', 'table'] as const) assert.ok(switchConfig(p, d, st, { style }).length > 200);
    const core = switchConfig(p, sw[0], st, { style: 'ios' });
    assert.ok(/switchport trunk allowed vlan 1,10,20,30/.test(core), 'a core switch trunks the IP plan\'s VLANs');
  });
});
