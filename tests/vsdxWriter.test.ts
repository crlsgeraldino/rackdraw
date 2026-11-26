/** The .vsdx package RackDraw writes: the parts real Visio needs before it will open the file at all. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { writeVsdx } from '../src/lib/visio/vsdxWriter';

const pkg = () => unzipSync(writeVsdx({
  title: 'T',
  media: {},
  pages: [
    { name: 'Background', width: 11, height: 8.5, background: true, shapes: [] },
    { name: 'Network', width: 11, height: 8.5, backPage: 0, shapes: [{ kind: 'rect', box: { x: 1, y: 1, w: 1, h: 1 }, fill: '#FFFFFF' }] },
  ],
}));

test('has the windows part Visio requires (without it Visio says "some parts are missing or invalid")', () => {
  const f = pkg();
  const win = strFromU8(f['visio/windows.xml']);
  assert.match(win, /<Window ID="0" WindowType="Drawing" ContainerType="Page" Page="1"/); // the first foreground page
  assert.match(strFromU8(f['visio/_rels/document.xml.rels']), /relationships\/windows" Target="windows.xml"/);
  assert.match(strFromU8(f['[Content_Types].xml']), /PartName="\/visio\/windows.xml" ContentType="application\/vnd.ms-visio.windows\+xml"/);
});

test('every part a relationship points at is in the package', () => {
  const f = pkg();
  for (const [name, bytes] of Object.entries(f)) {
    if (!name.endsWith('.rels')) continue;
    const base = name.replace(/_rels\/[^/]*\.rels$/, '');
    for (const [, target] of strFromU8(bytes).matchAll(/Target="([^"]+)"/g)) {
      const parts = (base + target).split('/');
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === '..') resolved.pop();
        else resolved.push(p);
      }
      assert.ok(f[resolved.join('/')], `${name} points at ${target}, which is missing`);
    }
  }
});
