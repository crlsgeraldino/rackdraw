/** Unit tests for the VLAN / IP plan (Data → IP Plan). */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { intToIp, ipPlanProblems, ipToInt, nextFreeIp, parseCidr, subnetUsage, undefinedVlans, vlanOfIp, type VlanDef } from '../src/lib/ipam';
import { checkProject } from '../src/lib/check';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, Project } from '../src/lib/types';

const v = (vlan: string, subnet: string, extra: Partial<VlanDef> = {}): VlanDef => ({ id: `v${vlan}`, vlan, name: `V${vlan}`, subnet, ...extra });
const dev = (id: string, ip: string, name = id): DeviceNode => ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'server', name, ip } }) as DeviceNode;
const proj = (devices: DeviceNode[], vlans: VlanDef[], vlanOnCable?: string): Project => ({
  id: 'p', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, vlans,
  pages: [{ id: 'pg', name: 'N', kind: 'network', nodes: devices, edges: vlanOnCable && devices.length > 1 ? [{ id: 'e', type: 'cable', source: devices[0].id, target: devices[1].id, sourceHandle: 'NIC1', targetHandle: 'NIC1', data: { cable: 'Cat6', vlan: vlanOnCable } }] : [] }],
}) as unknown as Project;

describe('IP math', () => {
  it('parses addresses and subnets', () => {
    assert.equal(intToIp(ipToInt('10.1.2.3')!), '10.1.2.3');
    assert.equal(ipToInt('300.1.1.1'), undefined);
    const s = parseCidr('10.0.10.77/24')!;
    assert.equal(intToIp(s.network), '10.0.10.0');
    assert.equal(intToIp(s.broadcast), '10.0.10.255');
    assert.equal(s.hosts, 254);
    assert.equal(parseCidr('10.0.0.0/31')!.hosts, 2);
    assert.equal(parseCidr('10.0.0.0'), undefined);
    assert.equal(parseCidr('10.0.0.0/33'), undefined);
  });
  it('finds the most specific VLAN for an IP', () => {
    const vlans = [v('1', '10.0.0.0/16'), v('10', '10.0.10.0/24')];
    assert.equal(vlanOfIp('10.0.10.5', vlans)?.vlan, '10');
    assert.equal(vlanOfIp('10.0.5.5', vlans)?.vlan, '1');
    assert.equal(vlanOfIp('192.168.1.1', vlans), undefined);
  });
  it('gives the next free static address', () => {
    const plan = v('10', '10.0.10.0/24', { gateway: '10.0.10.1', dhcpStart: '10.0.10.3', dhcpEnd: '10.0.10.9' });
    assert.equal(nextFreeIp(plan, new Set([ipToInt('10.0.10.2')!])), '10.0.10.10');
    assert.equal(nextFreeIp(v('x', '10.0.0.0/30'), new Set([ipToInt('10.0.0.1')!, ipToInt('10.0.0.2')!])), undefined);
  });
  it('counts how full a subnet is', () => {
    const p = proj([dev('a', '10.0.10.2'), dev('b', '10.0.10.3')], [v('10', '10.0.10.0/24', { gateway: '10.0.10.1', dhcpStart: '10.0.10.100', dhcpEnd: '10.0.10.199' })]);
    const [u] = subnetUsage(p);
    assert.equal(u.used, 3);
    assert.equal(u.dhcp, 100);
    assert.equal(u.free, 254 - 3 - 100);
    assert.equal(u.next, '10.0.10.4');
  });
});

describe('IP plan checks', () => {
  it('flags IPs outside the plan, in the DHCP pool, and on the broadcast address', () => {
    const plan = [v('10', '10.0.10.0/24', { gateway: '10.0.10.1', dhcpStart: '10.0.10.100', dhcpEnd: '10.0.10.199' })];
    const p = proj([dev('a', '192.168.1.5'), dev('b', '10.0.10.150'), dev('c', '10.0.10.255'), dev('d', '10.0.10.20')], plan);
    const rules = ipPlanProblems(p).map((x) => `${x.deviceId}:${x.rule}`);
    assert.deepEqual(rules.sort(), ['a:IP outside plan', 'b:IP in DHCP range', 'c:Network / broadcast IP']);
  });
  it('flags overlapping subnets and a gateway outside its subnet', () => {
    const p = proj([], [v('1', '10.0.0.0/16'), v('10', '10.0.10.0/24', { gateway: '10.9.9.1' })]);
    const rules = ipPlanProblems(p).map((x) => x.rule).sort();
    assert.deepEqual(rules, ['IP plan', 'Overlapping subnets']);
  });
  it('flags cables on a VLAN the plan does not define (in Check Diagram too)', () => {
    const p = proj([dev('a', '10.0.10.5'), dev('b', '10.0.10.6')], [v('10', '10.0.10.0/24')], '30');
    assert.deepEqual(undefinedVlans(p), ['30']);
    assert.ok(checkProject(p, (id) => STENCIL_MAP[id]).some((i) => i.rule === 'VLAN not in plan'));
  });
  it('says nothing when the client has no plan', () => {
    assert.deepEqual(ipPlanProblems(proj([dev('a', '1.2.3.4')], [])), []);
  });
  it('the templates with an IP plan have no IP mistakes', () => {
    for (const t of BUILT_IN_TEMPLATES.filter((x) => x.project.vlans?.length)) {
      const p = projectFromTemplate(t.project, 'x');
      assert.deepEqual(ipPlanProblems(p).map((x) => x.message), [], t.id);
      assert.deepEqual(undefinedVlans(p), [], t.id);
    }
  });
});
