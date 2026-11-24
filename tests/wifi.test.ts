/** Unit tests for the Wi-Fi coverage estimate. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { coverageGrid, coverageStats, rssiAt, suggestAps, wifiModel, type WifiModel } from '../src/lib/wifi';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { AppNode, Page } from '../src/lib/types';

const st = (id: string) => STENCIL_MAP[id];
// 1 px = 0.1 m: a 40 m × 20 m floor is 400 × 200 px.
const scale = { perPx: 0.1, unit: 'm' as const };
const ap = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): AppNode =>
  ({ id, type: 'device', position: { x: x - 20, y: y - 20 }, width: 40, height: 40, data: { stencilId: 'access-point', name: id, ...extra } }) as AppNode;
const wall = (id: string, x: number, y: number, dx: number, dy: number, material?: string): AppNode =>
  ({ id, type: 'measure', position: { x, y }, data: { dx, dy, variant: 'wall', thickness: 4, ...(material ? { material } : {}) } }) as AppNode;
const room = (id: string, x: number, y: number, w: number, h: number): AppNode => ({ id, type: 'zone', position: { x, y }, width: w, height: h, data: { title: id } }) as AppNode;
const page = (nodes: AppNode[]): Page => ({ id: 'p', name: 'Floor', kind: 'floorplan', nodes, edges: [], scale }) as unknown as Page;
const model = (nodes: AppNode[]) => wifiModel(page(nodes), st)!;

describe('Wi-Fi coverage estimate', () => {
  it('needs a drawing scale, and finds the access points, walls, doors and rooms', () => {
    assert.equal(wifiModel({ ...page([]), scale: undefined }, st), null);
    const m = model([ap('a', 100, 100), wall('w', 200, 0, 0, 200, 'brick'), room('r', 0, 0, 400, 200), { id: 'd', type: 'shape', position: { x: 190, y: 90 }, width: 20, height: 20, data: { kind: 'door' } } as AppNode]);
    assert.equal(m.aps.length, 1);
    assert.deepEqual(m.aps[0], { id: 'a', name: 'a', x: 100, y: 100, band: '5', eirp: 20 });
    assert.equal(m.walls[0].material, 'brick');
    assert.equal(m.openings.length, 1);
    assert.equal(m.rooms.length, 1);
    assert.ok(Math.abs(m.metresPerPx - 0.1) < 1e-9);
    assert.ok(Math.abs(wifiModel({ ...page([]), scale: { perPx: 1, unit: 'ft' } }, st)!.metresPerPx - 0.3048) < 1e-9);
    // A device that was never resized: centred on its shape's natural size, whatever it measured on screen.
    const plain = { id: 'p', type: 'device', position: { x: 0, y: 0 }, measured: { width: 894, height: 64 }, data: { stencilId: 'access-point', name: 'p' } } as AppNode;
    const c = model([plain]).aps[0];
    assert.deepEqual([c.x, c.y], [st('access-point').width * st('access-point').scale / 2, st('access-point').height * st('access-point').scale / 2]);
  });

  it('gives plausible levels: about −67 dBm at 21 m in the open at 5 GHz, weaker through walls, less so through a door', () => {
    const open = model([ap('a', 0, 0)]);
    const a = open.aps[0];
    assert.ok(Math.abs(rssiAt(open, a, 210, 0) - -67) < 1, String(rssiAt(open, a, 210, 0)));
    assert.ok(rssiAt(open, a, 50, 0) > rssiAt(open, a, 100, 0), 'weaker further away');
    const walled = model([ap('a', 0, 0), wall('w', 50, -50, 0, 100, 'concrete')]);
    assert.ok(Math.abs(rssiAt(walled, walled.aps[0], 100, 0) - (rssiAt(open, a, 100, 0) - 15)) < 1e-6, 'concrete takes 15 dB at 5 GHz');
    const door = model([ap('a', 0, 0), wall('w', 50, -50, 0, 100, 'concrete'), { id: 'd', type: 'shape', position: { x: 45, y: -10 }, width: 10, height: 20, data: { kind: 'door' } } as AppNode]);
    assert.ok(Math.abs(rssiAt(door, door.aps[0], 100, 0) - (rssiAt(open, a, 100, 0) - 3)) < 1e-6, 'through the doorway: 3 dB');
    const low = model([ap('a', 0, 0, { wifi: { band: '2.4' } })]);
    assert.ok(rssiAt(low, low.aps[0], 300, 0) > rssiAt(open, a, 300, 0), '2.4 GHz reaches further');
  });

  it('measures coverage over the rooms', () => {
    const one = model([ap('a', 200, 100), room('r', 0, 0, 400, 200)]);
    const g = coverageGrid(one, 60)!;
    const s = coverageStats(g);
    assert.ok(s.floorCells > 0);
    assert.ok(s.voice > 0.9, `one AP in the middle of 40 × 20 m open floor: ${s.voice}`);
    const walled = model([ap('a', 50, 100), room('r', 0, 0, 400, 200), wall('w1', 100, 0, 0, 200, 'concrete'), wall('w2', 200, 0, 0, 200, 'concrete'), wall('w3', 300, 0, 0, 200, 'concrete')]);
    assert.ok(coverageStats(coverageGrid(walled, 60)!).voice < 0.5, 'concrete walls block most of the floor');
  });

  it('suggests where to add access points until the floor is covered', () => {
    const big = model([room('r', 0, 0, 1200, 600), wall('w1', 400, 0, 0, 600, 'brick'), wall('w2', 800, 0, 0, 600, 'brick')]);
    const add = suggestAps(big, { goal: 0.95 });
    assert.ok(add.length >= 4 && add.length <= 14, `120 × 60 m with two brick walls: ${add.length}`);
    const after: WifiModel = { ...big, aps: add.map((p, i) => ({ id: `s${i}`, name: '', x: p.x, y: p.y, band: '5', eirp: 20 })) };
    assert.ok(coverageStats(coverageGrid(after, 60)!).voice >= 0.9);
    assert.deepEqual(suggestAps(model([ap('a', 200, 100), room('r', 0, 0, 400, 200)])), [], 'already covered');
    // Suggested spots keep 1.5 m (15 px here) clear of walls.
    for (const p of add) for (const x of [400, 800]) assert.ok(Math.abs(p.x - x) >= 15, `spot ${p.x},${p.y} too close to the wall at x=${x}`);
  });
});
