/** Rack from Diagram with imported shapes: rack size worked out, existing racks filled, unsized gear reported. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mountInto, mountableGear, planRacks, rackUnitsOf, unsizedGear } from '../src/lib/autoRack';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { DeviceNode, Rack, StencilDef } from '../src/lib/types';

const custom = (id: string, name: string, width: number, height: number, extra: Partial<StencilDef> = {}): StencilDef =>
  ({ id, name, custom: true, style: 'image', category: 'Imported', width, height, scale: 1, ports: [], ...extra }) as StencilDef;
const CUSTOM: Record<string, StencilDef> = {
  // A picture of a faceplate (image import) or a vendor stencil drawn at another scale: no rack size saved.
  promax: custom('promax', 'Pro Max 24 PoE', 1824, 168),
  usw48: custom('usw48', 'Ubiquiti USW-Pro-48-PoE (600W) - Front', 1200, 110),
  usw24: custom('usw24', 'USW-Pro-24-PoE (400W) - Front', 1824, 168, { rackUnits: 1 }),
  server2u: custom('server2u', 'Dell R740', 1824, 336),
  laptop: custom('laptop', 'Laptop', 300, 200),
  // A wide logo of a firewall that isn't a faceplate: small equipment, on a shelf.
  fwIcon: custom('fwIcon', 'Firewall', 200, 100),
  // A patch panel drawn as a square icon: rack equipment, but no size to mount it with.
  ppIcon: custom('ppIcon', 'Patch panel', 100, 100),
};
const st = (id: string) => CUSTOM[id] ?? STENCIL_MAP[id];
let n = 0;
const dev = (stencilId: string, name = stencilId, extra: Record<string, unknown> = {}): DeviceNode =>
  ({ id: `d${n++}`, type: 'device', position: { x: 0, y: 0 }, data: { stencilId, name, ...extra } }) as DeviceNode;

describe('rack size of imported shapes', () => {
  it('works it out from a faceplate', () => {
    assert.equal(rackUnitsOf(CUSTOM.promax), 1);
    assert.equal(rackUnitsOf(CUSTOM.usw48), 1);
    assert.equal(rackUnitsOf(CUSTOM.server2u), 2);
    assert.equal(rackUnitsOf(CUSTOM.usw24), 1);
  });
  it('leaves icons and pictures that are not faceplates alone', () => {
    assert.equal(rackUnitsOf(CUSTOM.laptop), 0);
    assert.equal(rackUnitsOf(STENCIL_MAP['workstation']), 0);
    assert.equal(rackUnitsOf(CUSTOM.fwIcon), 0);
  });
});

describe('Rack from Diagram', () => {
  const page = () => [dev('sonicwall-tz570-670', 'TZ570'), dev('usw24'), dev('usw24', 'USW 2'), dev('usw48'), dev('promax'), dev('switch-24-poe'), dev('workstation'), dev('fwIcon', 'Firewall logo')];

  it('puts every switch and the firewall of the page in one rack, small ones on a shelf at the top', () => {
    const devices = page();
    const { racks, mounted } = planRacks('Rack A', devices, st, []);
    assert.equal(racks.length, 1);
    assert.equal(mounted, 7);
    const items = racks[0].items;
    const shelf = items.find((it) => it.kind === 'shelf')!;
    assert.equal(shelf.u, Math.max(...items.map((it) => it.u + it.height - 1)));
    const onIt = items.filter((it) => it.shelf?.id === shelf.id).map((it) => devices.find((d) => d.id === it.nodeId)?.data.name).sort();
    assert.deepEqual(onIt, ['Firewall logo']);
    // The TZ has a rack-mount kit: mounted in its own unit, right under the shelf.
    const tz = items.find((it) => devices.find((d) => d.id === it.nodeId)?.data.name === 'TZ570')!;
    assert.equal(tz.shelf, undefined);
    assert.equal(tz.u, shelf.u - 1);
    assert.ok(items.filter((it) => it.shelf).every((it) => it.u === shelf.u));
  });

  it('adds to an existing rack, growing it, and keeps what is mounted where it is', () => {
    const rack: Rack = { id: 'r', name: 'Rack A', units: 6, items: [{ id: 'x', kind: 'device', nodeId: 'old', u: 6, height: 1, depth: 'full' }] };
    const devices = page();
    const res = mountInto(rack, devices, st);
    assert.equal(res.mounted, 7);
    assert.deepEqual(res.left, []);
    assert.ok(res.rack.units >= 7);
    assert.deepEqual(res.rack.items.find((it) => it.id === 'x'), rack.items[0]);
    // No two items overlap (devices on a shelf stand within the shelf's unit).
    const taken = new Set<number>();
    for (const it of res.rack.items.filter((x) => !x.shelf)) for (let u = it.u; u < it.u + it.height; u++) { assert.ok(!taken.has(u), `U${u} twice`); taken.add(u); }
    const shelves = new Set(res.rack.items.filter((x) => x.kind === 'shelf').map((x) => x.id));
    assert.ok(res.rack.items.filter((x) => x.shelf).every((x) => shelves.has(x.shelf!.id)));
  });

  it('says which rack-looking devices were left out', () => {
    const devices = [...page(), dev('ppIcon', 'PP-A')];
    assert.deepEqual(unsizedGear(devices, st).map((d) => d.data.name), ['PP-A']);
    assert.equal(mountableGear(devices, st).length, 7);
  });
});
