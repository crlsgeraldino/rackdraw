/** Unit tests for cable lanes and line jumps (shared lookup tables vs. the per-call form). */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { findJumps, jumpsFor, LANE, laneIndex, publishDrawn, publishRoute, separateParallel } from '../src/lib/jumps';

type P = { x: number; y: number }[];
const bus = (i: number): [string, P] => [`b${i}`, [{ x: i * 40, y: 300 }, { x: i * 40, y: 280 }, { x: i * 40, y: 200 }, { x: 600 + i * 10, y: 200 }, { x: 600 + i * 10, y: 120 }, { x: 600 + i * 10, y: 100 }]];

describe('cable lanes and line jumps', () => {
  it('spreads cables sharing a run into lanes, the same through the shared table as per call', () => {
    const all = [bus(0), bus(1), bus(2)];
    for (const [id, p] of all) publishRoute(id, p);
    const idx = laneIndex();
    const laned = all.map(([id, p]) => separateParallel(id, p, idx));
    // The shared horizontal run at y = 200 becomes three lanes, LANE apart, centred on the line.
    assert.deepEqual(laned.map((p) => p[2].y).sort((a, b) => a - b), [200 - LANE, 200, 200 + LANE]);
    all.forEach(([id, p], k) => assert.deepEqual(laned[k], separateParallel(id, p, all.filter(([o]) => o !== id))));
    // The ends at the ports never move.
    laned.forEach((p, k) => { assert.deepEqual(p[0], all[k][1][0]); assert.deepEqual(p[p.length - 1], all[k][1][all[k][1].length - 1]); });
    for (const [id] of all) publishRoute(id, null);
  });

  it('hops where a horizontal run crosses another cable, not over itself', () => {
    const h: P = [{ x: 0, y: 100 }, { x: 0, y: 110 }, { x: 0, y: 150 }, { x: 400, y: 150 }, { x: 400, y: 110 }, { x: 400, y: 100 }];
    const v: P = [{ x: 200, y: 0 }, { x: 200, y: 20 }, { x: 200, y: 300 }];
    publishDrawn('h', h);
    publishDrawn('v', v);
    assert.deepEqual([...jumpsFor('h', h)], [[3, [200]]], 'one hop at x = 200 on the long horizontal segment');
    assert.deepEqual([...jumpsFor('v', v)], [], 'a vertical cable has nothing to hop');
    assert.deepEqual([...jumpsFor('h', h)], [...findJumps(h, [v])]);
    publishDrawn('h', null);
    publishDrawn('v', null);
  });

  it('works out a thousand cables quickly', () => {
    const all = Array.from({ length: 1000 }, (_, i) => bus(i));
    for (const [id, p] of all) publishRoute(id, p);
    const t = performance.now();
    const idx = laneIndex();
    const laned = all.map(([id, p]) => [id, separateParallel(id, p, idx)] as [string, P]);
    for (const [id, p] of laned) publishDrawn(id, p);
    for (const [id, p] of laned) jumpsFor(id, p);
    const ms = performance.now() - t;
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
    for (const [id] of all) { publishRoute(id, null); publishDrawn(id, null); }
  });
});
