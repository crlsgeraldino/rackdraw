/** Unit tests for cable functions and the text on cables. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cableText, edgeRole, roleLabel } from '../src/lib/cableRole';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, CableData, CableEdge, DeviceNode } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
const dev = (id: string, stencilId: string): DeviceNode => ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name: id } }) as DeviceNode;
const NODES: AppNode[] = [
  dev('isp', 'internet'), dev('fw', 'firewall'), dev('fw2', 'firewall'), dev('core', 'switch-core-24sfp'), dev('core2', 'switch-core-24sfp'),
  dev('sw', 'switch-24-poe'), dev('pp', 'patch-panel-24'), dev('pp2', 'patch-panel-24'), dev('pc', 'workstation'), dev('ap', 'access-point'),
  dev('srv', 'server'), dev('nas', 'nas'), dev('ups', 'ups'),
];
const role = (s: string, t: string, data: Partial<CableData> = {}, sh?: string, th?: string) =>
  roleLabel(edgeRole(NODES, { source: s, target: t, sourceHandle: sh, targetHandle: th, data: { cable: 'Cat6', ...data } as CableData }, st));

describe('cable function', () => {
  it('works out the function from what the cable connects', () => {
    assert.equal(role('fw', 'isp'), 'WAN uplink');
    assert.equal(role('fw', 'core', { cable: 'DAC' }), 'Uplink');
    assert.equal(role('core', 'sw', { cable: 'Fiber SM' }), 'Uplink');
    assert.equal(role('core', 'core2'), 'Backbone');
    assert.equal(role('sw', 'pp'), 'Patch');
    assert.equal(role('pp', 'pc'), 'Access');
    assert.equal(role('pp', 'pp2'), 'Backbone');
    assert.equal(role('sw', 'pc'), 'Access');
    assert.equal(role('sw', 'ap'), 'Access');
    assert.equal(role('core', 'srv'), 'Server link');
    assert.equal(role('core', 'nas'), 'Storage');
    assert.equal(role('sw', 'ups'), 'Management');
    assert.equal(role('fw', 'fw2'), 'HA / sync');
    assert.equal(role('pc', 'srv', {}), 'Server link');
  });

  it('reads the ports: WAN, HA, management, console', () => {
    assert.equal(role('fw', 'sw', {}, 'WAN'), 'WAN uplink', 'a switch on the firewall WAN port carries the WAN');
    assert.equal(role('fw', 'fw2', {}, 'HA', 'HA'), 'HA / sync');
    assert.equal(role('fw', 'sw', {}, 'MGMT'), 'Management');
    assert.equal(role('sw', 'pc', { cable: 'Console' }), 'Console');
  });

  it('a chosen function wins; None hides it', () => {
    assert.equal(role('sw', 'pc', { role: 'mgmt' }), 'Management');
    assert.equal(role('fw', 'isp', { role: 'none' }), undefined);
  });

  it('builds the text on the cable', () => {
    const d = { cable: 'Cat6', label: 'Cat 6', vlan: '10' } as CableData;
    assert.equal(cableText(d, 'wan', 'label'), 'Cat 6 · VLAN 10', 'label only: as before');
    assert.equal(cableText(d, 'wan', 'role'), 'WAN uplink · Cat 6 · VLAN 10');
    assert.equal(cableText(d, 'wan', 'role-type'), 'WAN uplink · Cat6 · VLAN 10', 'a label saying the type is not repeated');
    assert.equal(cableText({ cable: 'DAC' } as CableData, 'uplink', 'role-type'), 'Uplink · DAC');
    assert.equal(cableText({ cable: 'Cat6', label: 'WAN' } as CableData, 'wan', 'role-type'), 'WAN uplink · Cat6', 'a label inside the function is not repeated');
    assert.equal(cableText({ cable: 'Cat6', label: 'LAN' } as CableData, 'uplink', 'role-type'), 'Uplink · Cat6 · LAN');
    assert.equal(cableText({ cable: 'Fiber SM' } as CableData, undefined, 'role-type'), 'Fiber SM', 'no function found: just the type');
    assert.equal(cableText({ cable: 'Cat6' } as CableData, 'access', 'label'), '', 'nothing typed: no tag, as before');
  });

  it('finds a function for the cables of the medium template (WAN, uplinks, patch, access, backbone)', () => {
    const p = projectFromTemplate(BUILT_IN_TEMPLATES.find((x) => x.id === 'tpl-net-medium')!.project, 'x');
    const pg = p.pages[0];
    const found = new Set(pg.edges.map((e: CableEdge) => roleLabel(edgeRole(pg.nodes, e, st))));
    for (const r of ['WAN uplink', 'Uplink', 'Patch', 'Access', 'Backbone', 'Server link', 'Storage', 'Management']) assert.ok(found.has(r), r);
    assert.ok(!found.has(undefined), 'every cable has a function');
  });
});
