/** Unit tests for the .rackdraw package format. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { isRackdrawPackage, packRackdraw, RACKDRAW_MIME, RackdrawFileError, unpackRackdraw } from '../src/lib/rackdrawFile';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';

const png = (n: number) => `data:image/png;base64,${Buffer.from(Array.from({ length: n }, (_, i) => (i * 7) % 256)).toString('base64')}`;
const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg">' + '<rect/>'.repeat(200) + '</svg>')}`;

describe('.rackdraw files', () => {
  it('round-trips a client exactly, pictures included', () => {
    const project = { ...projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-net-medium')!.project, 'Acme'), notes: 'rackdraw-media:media/1.png is just text', site: 'rackdraw-text:also text' };
    const payload = {
      format: 'netcraft', version: 3,
      project: { ...project, pages: [{ ...project.pages[0], backdrop: { image: png(5000) } }, ...project.pages.slice(1)] },
      stencils: [{ id: 'x', name: 'Custom', image: png(5000), icon: svg, tiny: 'data:image/png;base64,AAAA' }],
    };
    const bytes = packRackdraw(payload, { name: 'Acme', app: '0.108.0' });
    assert.ok(isRackdrawPackage(bytes));
    const { payload: back, manifest } = unpackRackdraw(bytes);
    assert.deepEqual(back, JSON.parse(JSON.stringify(payload)), 'the same as the JSON file would give');
    assert.equal(manifest.name, 'Acme');
    assert.equal(manifest.media.length, 2, 'the same picture is stored once; tiny ones stay inline');
  });

  it('is a proper package: mimetype first and uncompressed, media as real files, smaller than the JSON', () => {
    const payload = { format: 'netcraft', version: 3, project: projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-net-large')!.project, 'Big'), stencils: [{ id: 's', image: png(20000) }] };
    const bytes = packRackdraw(payload, { name: 'Big' });
    // "mimetype" is the first entry, stored (method 0), so the type can be read from the first bytes.
    assert.equal(Buffer.from(bytes.subarray(30, 38)).toString(), 'mimetype');
    assert.equal(bytes[8] | (bytes[9] << 8), 0, 'stored, not compressed');
    assert.equal(Buffer.from(bytes.subarray(38, 38 + RACKDRAW_MIME.length)).toString(), RACKDRAW_MIME);
    const files = unzipSync(bytes);
    assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'media/1.png', 'mimetype', 'project.json']);
    assert.equal(files['media/1.png'].length, 20000);
    assert.ok(bytes.length < JSON.stringify(payload).length / 2, `${bytes.length} vs ${JSON.stringify(payload).length}`);
  });

  it('refuses damaged, half-copied and foreign files with a clear message', () => {
    const bytes = packRackdraw({ project: { name: 'A' } }, { name: 'A' });
    assert.throws(() => unpackRackdraw(bytes.subarray(0, bytes.length - 40)), RackdrawFileError);
    const files = unzipSync(bytes);
    files['project.json'] = strToU8(JSON.stringify({ project: { name: 'B' } }));
    assert.throws(() => unpackRackdraw(zipSync(files)), /contents don't match/);
    assert.throws(() => unpackRackdraw(zipSync({ 'word/document.xml': strToU8('<x/>') })), /not a RackDraw drawing/);
    const newer = unzipSync(bytes);
    newer['manifest.json'] = strToU8(JSON.stringify({ ...JSON.parse(Buffer.from(newer['manifest.json']).toString()), version: 99 }));
    assert.throws(() => unpackRackdraw(zipSync(newer)), /newer version/);
    assert.equal(isRackdrawPackage(strToU8('{"format":"netcraft"}')), false);
  });
});
