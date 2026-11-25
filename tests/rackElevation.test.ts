/** Rack front: where imported faceplates and their ports are drawn, and the names on the back. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { artBox, INNER_W, rearName, U_H } from '../src/components/RackElevation';
import { STENCIL_MAP } from '../src/lib/stencils';
import type { StencilDef } from '../src/lib/types';

const picture = (width: number, height: number) => ({ id: 'c', name: 'Switch', custom: true, style: 'image', image: '', width, height, scale: 1, ports: [] }) as unknown as StencilDef;

describe('rack faceplates', () => {
  it('stretches a picture of a 19 in faceplate from post to post', () => {
    for (const [w, h] of [[1824, 168], [1200, 110], [2000, 160]]) {
      const a = artBox(picture(w, h), 0, 0, INNER_W, U_H);
      assert.equal(a.stretch, true);
      assert.equal(a.w, INNER_W - 6);
    }
  });
  it('keeps a desktop unit and built-in panels in proportion', () => {
    assert.equal(artBox(picture(600, 170), 0, 0, INNER_W, U_H).stretch, false);
    const tz = artBox(STENCIL_MAP['sonicwall-tz570-670'], 0, 0, INNER_W, U_H);
    assert.equal(tz.stretch, false);
    assert.ok(tz.w < INNER_W / 2);
    assert.equal(artBox(STENCIL_MAP['switch-24-poe'], 0, 0, INNER_W, U_H).kx, artBox(STENCIL_MAP['switch-24-poe'], 0, 0, INNER_W, U_H).ky);
  });
  it('drops "- Front" from the name on the back', () => {
    assert.equal(rearName('USW-Pro-24-PoE (400W) - Front'), 'USW-Pro-24-PoE (400W)');
    assert.equal(rearName('Core switch (front view)'), 'Core switch');
    assert.equal(rearName('Front'), 'Front');
    assert.equal(rearName('Frontdesk switch'), 'Frontdesk switch');
  });
});
