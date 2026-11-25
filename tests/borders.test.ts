/* Borders & Titles designs, and device outlines from Home → Line / Weight. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BORDER_DESIGNS, borderHasTitle, borderLayout, borderSvg, borderText, pageBorderText, tint } from '../src/lib/borders';
import { activePage } from '../src/lib/project';
import type { AppNode, DeviceData, Project } from '../src/lib/types';
import { useDiagram } from '../src/store/useDiagramStore';

const text = { title: 'Network & <Core>', client: 'Acme · HQ', date: '1/5/2027', page: 'Page 2 of 3' };

describe('border designs', () => {
  for (const { id } of BORDER_DESIGNS) {
    it(`${id}: stays on the page and shows its text`, () => {
      for (const [W, H] of [[792, 612], [612, 792], [1056, 816]]) {
        const { parts, inset } = borderLayout(id, W, H, '#1e3a8a', text);
        if (id === 'none') { assert.equal(parts.length, 0); continue; }
        assert.ok(parts.length > 0);
        for (const p of parts) {
          const xs = p.t === 'rect' ? [p.x, p.x + p.w] : p.t === 'line' ? [p.x1, p.x2] : [p.x];
          const ys = p.t === 'rect' ? [p.y, p.y + p.h] : p.t === 'line' ? [p.y1, p.y2] : [p.y];
          for (const v of [...xs, ...ys]) assert.ok(Number.isFinite(v));
          assert.ok(Math.min(...xs) >= -0.01 && Math.max(...xs) <= W + 0.01, `${id} x out of page`);
          assert.ok(Math.min(...ys) >= -0.01 && Math.max(...ys) <= H + 0.01, `${id} y out of page`);
        }
        const words = parts.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text).join(' | ');
        if (borderHasTitle(id)) {
          assert.match(words, /Network & <Core>/);
          assert.match(words, /Acme/);
          assert.match(words, /2 of 3/);
        }
        assert.ok(inset.top >= 0 && inset.bottom >= 0 && inset.top + inset.bottom < H / 3);
      }
    });
  }
  it('SVG escapes the text', () => {
    const svg = borderSvg(borderLayout('classic', 792, 612, '#1e3a8a', text), 792, 612);
    assert.match(svg, /Network &amp; &lt;Core&gt;/);
    assert.doesNotMatch(svg, /<Core>/);
  });
  it('the date and page number can be turned off', () => {
    const p = { name: 'Acme', site: 'HQ', pages: [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two', background: true }, { id: 'c', name: 'Three' }], display: {} } as unknown as Project;
    assert.equal(pageBorderText(p, 'c').page, 'Page 2 of 2');
    assert.equal(pageBorderText({ ...p, display: { framePage: false, frameDate: false } } as Project, 'c').page, '');
    assert.equal(pageBorderText({ ...p, display: { frameDate: false } } as Project, 'c').date, '');
    assert.equal(borderText({ title: 't', client: 'c', date: '2027-01-05' }).date, '2027-01-05');
  });
  it('tints colours', () => {
    assert.equal(tint('#000000', 0.5), '#808080');
    assert.equal(tint('#1e3a8a', 0), '#1e3a8a');
    assert.equal(tint('red', 0.5), '#e5e7eb');
  });
});

describe('device outlines', () => {
  const S = () => useDiagram.getState();
  const dev = (): AppNode => ({ id: 'd', type: 'device', position: { x: 0, y: 0 }, selected: true, data: { stencilId: 'server', name: 'D' } }) as AppNode;
  const load = () => {
    const p = { id: 'p1', name: 'T', activePageId: 'pg', createdAt: 0, updatedAt: 0, racks: [], pages: [{ id: 'pg', name: 'N', kind: 'network', nodes: [dev()], edges: [] }] } as unknown as Project;
    useDiagram.setState({ projects: { p1: p }, currentId: 'p1', past: [], future: [] });
  };
  const border = () => (activePage(S().projects.p1).nodes[0].data as DeviceData).border;
  it('Line adds an outline, Weight and dashes change it, No line removes it', () => {
    load();
    S().styleSelection({ line: '#ff0000' });
    assert.deepEqual(border(), { color: '#ff0000' });
    S().styleSelection({ weight: 3 });
    S().styleSelection({ format: { linePattern: 'dash' } });
    assert.deepEqual(border(), { color: '#ff0000', width: 3, pattern: 'dash' });
    S().styleSelection({ line: 'transparent' });
    assert.equal(border(), undefined);
  });
  it('Weight alone adds a grey outline; Automatic removes it', () => {
    load();
    S().styleSelection({ weight: 2 });
    assert.deepEqual(border(), { color: '#334155', width: 2 });
    S().styleSelection({ line: null });
    assert.equal(border(), undefined);
    S().undo();
    assert.deepEqual(border(), { color: '#334155', width: 2 });
  });
});
