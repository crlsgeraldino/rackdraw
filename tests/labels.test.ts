/** Unit tests for label printing (Data → Labels). */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assetLabels, cableLabels, LABEL_SHEETS, labelledCables, labelSheetsHtml, panelStrips } from '../src/lib/labels';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';

const st = (id: string) => STENCIL_MAP[id];
const office = () => projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-office-rack')!.project, 'Client');

describe('labels', () => {
  it('numbers unlabelled cables and skips wireless links', () => {
    const p = office();
    const cables = labelledCables(p);
    const physical = p.pages[0].edges.filter((e) => !['Wireless', 'Bluetooth', 'VPN', 'MPLS', 'Line', 'Cellular', 'Microwave', 'Satellite'].includes(e.data?.cable ?? 'Cat6'));
    assert.equal(cables.length, physical.length);
    assert.ok(cables.some((c) => /^C-\d{3}$/.test(c.id)));
    assert.equal(new Set(cables.map((c) => c.id)).size, cables.length, 'numbers are unique');
  });
  it('makes one label per end, each naming its own end first', () => {
    const p = office();
    const per = cableLabels(p, st, { perEnd: true });
    const one = cableLabels(p, st, { perEnd: false });
    assert.equal(per.length, one.length * 2);
    assert.ok(per[0].lines[0].startsWith('▶'));
    assert.ok(per[1].lines[0].startsWith('▶'));
    assert.notEqual(per[0].lines[0], per[1].lines[0]);
  });
  it('asset labels skip clouds and carry a QR code', () => {
    const labels = assetLabels(office(), st, { qr: 'details' });
    assert.ok(!labels.some((l) => l.title === 'Internet'));
    assert.ok(labels.length > 5);
    assert.ok(labels.every((l) => l.qr && new TextEncoder().encode(l.qr).length <= 213));
    assert.ok(assetLabels(office(), st, { qr: 'none' }).every((l) => !l.qr));
  });
  it('patch panel strips show the wall jack of each port', () => {
    const [strip] = panelStrips(office(), st);
    assert.equal(strip.rows.length, 1);
    assert.equal(strip.rows[0].length, 24);
    assert.equal(strip.rows[0][0].text, '1-01');
  });
  it('fills sheets, leaving skipped labels empty', () => {
    const sheet = LABEL_SHEETS.find((s) => s.id === '5160')!;
    const labels = Array.from({ length: 35 }, (_, i) => ({ title: `L${i}`, lines: [] }));
    const html = labelSheetsHtml(labels, sheet, { skip: 2 });
    assert.equal(html.split('class="lsheet"').length - 1, 2);
    assert.equal(html.split('class="lb').length - 1, 35);
  });
});
