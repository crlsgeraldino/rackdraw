/** Unit tests for importing a network scan. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyScanRows, guessStencil, normMac, notInScan, parseScan, planScan } from '../src/lib/scanImport';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, DeviceNode, Project } from '../src/lib/types';

const NMAP = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<nmaprun scanner="nmap" args="nmap -O -sV -oX scan.xml 192.168.1.0/24">
<host><status state="up" reason="arp-response"/>
<address addr="192.168.1.1" addrtype="ipv4"/><address addr="00:17:C5:AA:BB:01" addrtype="mac" vendor="SonicWall"/>
<hostnames><hostname name="fw01.corp.local" type="PTR"/></hostnames>
<ports><port protocol="tcp" portid="443"><state state="open"/></port></ports></host>
<host><status state="up"/>
<address addr="192.168.1.30" addrtype="ipv4"/><address addr="3C:2A:F4:00:00:30" addrtype="mac" vendor="Brother Industries"/>
<ports><port protocol="tcp" portid="9100"><state state="open"/></port><port protocol="tcp" portid="80"><state state="closed"/></port></ports></host>
<host><status state="up"/>
<address addr="192.168.1.40" addrtype="ipv4"/><address addr="44:19:B6:00:00:40" addrtype="mac" vendor="Hangzhou Hikvision Digital Technology"/>
<ports><port protocol="tcp" portid="554"><state state="open"/></port></ports></host>
<host><status state="down"/><address addr="192.168.1.99" addrtype="ipv4"/></host>
<host><status state="up"/>
<address addr="192.168.1.50" addrtype="ipv4"/><address addr="AA:BB:CC:00:00:50" addrtype="mac" vendor="Dell"/>
<hostnames><hostname name="FRONT-PC" type="PTR"/></hostnames>
<ports><port protocol="tcp" portid="3389"><state state="open"/></port></ports>
<os><osmatch name="Microsoft Windows 11" accuracy="96"/></os></host>
</nmaprun>`;

const dev = (id: string, name: string, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'workstation', name, ...extra } }) as DeviceNode;
const proj = (nodes: AppNode[]): Project =>
  ({ id: 'p', name: 'C', activePageId: 'pg', createdAt: 0, updatedAt: 0, pages: [{ id: 'pg', name: 'Network', kind: 'network', nodes, edges: [] }] }) as unknown as Project;
const st = (id: string) => STENCIL_MAP[id];

describe('network scan import', () => {
  it('reads nmap XML: up hosts only, MAC vendor, name, OS and open ports', () => {
    const r = parseScan(NMAP);
    assert.equal(r.format, 'nmap');
    assert.deepEqual(r.hosts.map((h) => h.ip), ['192.168.1.1', '192.168.1.30', '192.168.1.40', '192.168.1.50']);
    assert.equal(r.skipped, 1);
    const pc = r.hosts.find((h) => h.ip === '192.168.1.50')!;
    assert.equal(pc.name, 'FRONT-PC');
    assert.equal(pc.os, 'Microsoft Windows 11');
    assert.deepEqual(r.hosts.find((h) => h.ip === '192.168.1.30')!.ports, [9100]);
  });

  it('reads scanner CSVs with ; or , and odd values, and lists without a header', () => {
    const adv = '"Status";"Name";"IP";"Manufacturer";"MAC address";"Comments"\n"On";"NAS01";"10.0.0.5";"Synology Incorporated";"00-11-32-AA-BB-CC";""\n"On";"";"10.0.0.7";"";"";""';
    const a = parseScan(adv);
    assert.deepEqual(a.hosts.map((h) => [h.ip, h.name, h.mac, h.vendor]), [['10.0.0.5', 'NAS01', '00:11:32:AA:BB:CC', 'Synology Incorporated'], ['10.0.0.7', undefined, undefined, undefined]]);
    const angry = 'IP,Ping,Hostname,Ports,MAC Address,MAC Vendor\n10.0.0.9,2 ms,printer1,9100,[n/a],[n/a]\n10.0.0.10,[n/a],[n/s],[n/s],[n/a],[n/a]';
    const g = parseScan(angry);
    assert.deepEqual(g.hosts[0].ports, [9100]);
    assert.equal(g.hosts[1].name, undefined);
    const bare = '192.168.5.10\tlaptop-7\n192.168.5.11\tcam-lobby\nnot an ip\tx';
    const b = parseScan(bare);
    assert.deepEqual(b.hosts.map((h) => h.ip), ['192.168.5.10', '192.168.5.11']);
    assert.equal(b.skipped, 1);
  });

  it('guesses the kind of device', () => {
    const kinds = Object.fromEntries(parseScan(NMAP).hosts.map((h) => [h.ip, guessStencil(h).stencilId]));
    assert.deepEqual(kinds, { '192.168.1.1': 'firewall', '192.168.1.30': 'printer', '192.168.1.40': 'camera', '192.168.1.50': 'workstation' });
    assert.equal(guessStencil({ ip: '10.0.0.5', vendor: 'Synology', ports: [] }).stencilId, 'nas');
    assert.equal(guessStencil({ ip: '10.0.0.6', name: 'DC01', ports: [389, 88] }).stencilId, 'server');
    assert.equal(guessStencil({ ip: '10.0.0.1', ports: [80, 443] }).stencilId, 'router');
    for (const id of ['firewall', 'printer', 'camera', 'nas', 'server', 'router', 'workstation', 'access-point', 'switch-24', 'ups', 'phone', 'laptop', 'nvr', 'ip-pbx', 'smartphone', 'tablet', 'display', 'iot-device']) assert.ok(st(id), `stencil ${id} exists`);
  });

  it('matches devices by MAC, then IP, then name; lists the ones that did not answer', () => {
    const p = proj([
      dev('a', 'Front desk', { mac: 'aabb.cc00.0050', ip: '192.168.1.77' }),
      dev('b', 'Printer', { ip: '192.168.1.30' }),
      dev('c', 'fw01'),
      dev('d', 'Old server', { ip: '192.168.1.200' }),
    ]);
    const hosts = parseScan(NMAP).hosts;
    const rows = planScan(p, hosts);
    const by = Object.fromEntries(rows.map((r) => [r.host.ip, r.match ? `${r.match.node.id}:${r.match.by}` : 'new']));
    assert.deepEqual(by, { '192.168.1.1': 'c:name', '192.168.1.30': 'b:IP', '192.168.1.40': 'new', '192.168.1.50': 'a:MAC' });
    assert.deepEqual(notInScan(p, hosts, rows).map((n) => n.id), ['d']);
    assert.equal(normMac('AA-BB-CC-00-00-50'), 'aabbcc000050');
  });

  it('adds new hosts on a new page and updates matched devices', () => {
    const p = proj([dev('a', 'Front desk', { mac: 'AA:BB:CC:00:00:50', ip: '192.168.1.77' })]);
    const rows = planScan(p, parseScan(NMAP).hosts);
    let n = 0;
    const r = applyScanRows(p, rows, { target: 'new-page', pageName: 'Scan', date: '2026-11-24', id: () => `x${n++}` }, st);
    assert.equal(r.created, 3);
    assert.equal(r.updated, 1);
    assert.equal(r.pages.length, 2);
    assert.equal(r.activePageId, r.pages[1].id);
    const a = r.pages[0].nodes[0] as DeviceNode;
    assert.equal(a.data.ip, '192.168.1.50', 'found by MAC at a new address');
    assert.deepEqual(a.data.extraFields?.map((f) => `${f.label}=${f.value}`), ['Last seen=2026-11-24', 'OS=Microsoft Windows 11']);
    const added = r.pages[1].nodes as DeviceNode[];
    assert.deepEqual(added.map((d) => [d.data.stencilId, d.data.name]), [['firewall', 'fw01'], ['printer', '192.168.1.30'], ['camera', '192.168.1.40']]);
    assert.equal(added[1].data.notes, 'Open ports: 9100');
    // Nothing overlaps.
    const pos = new Set(added.map((d) => `${d.position.x},${d.position.y}`));
    assert.equal(pos.size, added.length);
  });
});
