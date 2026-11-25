/*
 * Editing commands on the real store (the bugs the pre-public audit reproduced): hidden and locked layers are out of
 * reach of Select All / Delete / nudge, one keyboard delete is one undo step, deleting a layer can be undone, copied
 * callouts follow their copied item, and opening a file never replaces your own stencils.
 */
import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { activePage } from '../src/lib/project';
import type { AppNode, CableEdge, Project, StencilDef } from '../src/lib/types';
import { useDiagram } from '../src/store/useDiagramStore';

const S = () => useDiagram.getState();
const page = () => activePage(S().projects[S().currentId]);
const dev = (id: string, layer?: string, x = 0): AppNode =>
  ({ id, type: 'device', position: { x, y: 0 }, data: { stencilId: 'server', name: id, ...(layer ? { layer } : {}) } }) as AppNode;
const cable = (id: string, a: string, b: string): CableEdge => ({ id, source: a, target: b, data: { cable: 'Cat6' } }) as CableEdge;

function load(nodes: AppNode[], edges: CableEdge[] = [], layers: Project['layers'] = []) {
  const p = { id: 'p1', name: 'Test', activePageId: 'pg', createdAt: 0, updatedAt: 0, layers, racks: [], pages: [{ id: 'pg', name: 'N', kind: 'network', nodes, edges }] } as unknown as Project;
  useDiagram.setState({ projects: { p1: p }, currentId: 'p1', past: [], future: [] });
}

/** React Flow's change sets, enough for the store's handlers. */
const changes = <T extends { id: string }>(ids: string[]) => ({
  toArray: () => ids.map((id) => ({ type: 'remove' as const, id })),
  applyTo: (list: T[]) => list.filter((x) => !ids.includes(x.id)),
});

describe('layers that are hidden or locked', () => {
  beforeEach(() => load([dev('a'), dev('b', 'hid', 100), dev('c', 'lock', 200)], [], [
    { id: 'hid', name: 'Hidden', visible: false },
    { id: 'lock', name: 'Locked', visible: true, locked: true },
  ]));
  it('Select All skips them', () => {
    S().selectAll();
    assert.deepEqual(page().nodes.filter((n) => n.selected).map((n) => n.id), ['a']);
  });
  it('Delete and nudge never reach them, even if they were selected', () => {
    useDiagram.setState((st) => {
      const p = st.projects.p1;
      return { projects: { p1: { ...p, pages: p.pages.map((pg) => ({ ...pg, nodes: pg.nodes.map((n) => ({ ...n, selected: true })) })) } } };
    });
    S().nudgeSelection(10, 0);
    assert.deepEqual(page().nodes.map((n) => n.position.x), [10, 100, 200]);
    S().deleteSelected();
    assert.deepEqual(page().nodes.map((n) => n.id), ['b', 'c']);
  });
  it('hiding a layer deselects its items', () => {
    load([dev('a', 'L')], [], [{ id: 'L', name: 'L', visible: true }]);
    S().selectAll();
    S().toggleLayer('L');
    assert.equal(page().nodes[0].selected, false);
  });
});

describe('undo', () => {
  it('a keyboard delete (cables, then the device) is one undo step', () => {
    load([dev('a'), dev('b', undefined, 100)], [cable('e', 'a', 'b')]);
    // React Flow removes the cables first, then the device, as two separate changes.
    S().onEdgesChange(changes<CableEdge>(['e']) as never);
    S().onNodesChange(changes<AppNode>(['a']) as never);
    assert.equal(page().nodes.length, 1);
    S().undo();
    assert.equal(page().nodes.length, 2);
    assert.equal(page().edges.length, 1);
  });
  it('deleting a layer is undone with its layer', () => {
    load([dev('a', 'L')], [], [{ id: 'L', name: 'Layer', visible: true }]);
    S().deleteLayer('L');
    assert.equal(S().projects.p1.layers?.length, 0);
    S().undo();
    assert.deepEqual(S().projects.p1.layers?.map((l) => l.id), ['L']);
    assert.equal((page().nodes[0].data as { layer?: string }).layer, 'L');
  });
});

describe('callouts', () => {
  const callout = (target: string): AppNode => ({ id: 'co', type: 'shape', position: { x: 0, y: 50 }, data: { kind: 'callout', text: 'note', target } }) as unknown as AppNode;
  it('a duplicated callout points at the duplicated item', () => {
    load([{ ...dev('a'), selected: true }, { ...callout('a'), selected: true }]);
    S().duplicateSelected();
    const copies = page().nodes.slice(2);
    const devCopy = copies.find((n) => n.type === 'device')!;
    const coCopy = copies.find((n) => n.type === 'shape')!;
    assert.equal((coCopy.data as { target?: string }).target, devCopy.id);
  });
  it('a duplicated page keeps its callouts attached', () => {
    load([dev('a'), callout('a')]);
    S().duplicatePage('pg');
    const nodes = page().nodes;
    const d = nodes.find((n) => n.type === 'device')!;
    assert.notEqual(d.id, 'a');
    assert.equal((nodes.find((n) => n.type === 'shape')!.data as { target?: string }).target, d.id);
  });
});

describe('stencils from a file', () => {
  const st = (id: string, image: string, name = 'Mine'): StencilDef =>
    ({ id, name, category: 'Custom', style: 'image', image, width: 100, height: 50, ports: [] }) as unknown as StencilDef;
  it('never replace a different stencil of yours with the same id', () => {
    useDiagram.setState({ customStencils: { 'custom-x': { ...st('custom-x', 'data:image/png;base64,AAAA'), custom: true } } });
    const p = { name: 'Other', pages: [{ id: 'q', name: 'N', kind: 'network', nodes: [{ id: 'd', type: 'device', position: { x: 0, y: 0 }, data: { stencilId: 'custom-x', name: 'D' } }], edges: [] }] } as unknown as Project;
    S().importProject(p, [st('custom-x', 'data:image/png;base64,BBBB', 'Theirs')]);
    assert.equal(S().customStencils['custom-x'].image, 'data:image/png;base64,AAAA');
    const theirs = Object.values(S().customStencils).find((s) => s.name === 'Theirs')!;
    assert.ok(theirs && theirs.id !== 'custom-x');
    assert.equal((page().nodes[0].data as { stencilId: string }).stencilId, theirs.id);
  });
  it('the same stencil again is not duplicated', () => {
    useDiagram.setState({ customStencils: { 'custom-y': { ...st('custom-y', 'data:image/png;base64,CCCC'), custom: true } } });
    assert.equal(S().importStencils([st('custom-y', 'data:image/png;base64,CCCC')]), 0);
    assert.equal(Object.keys(S().customStencils).length, 1);
  });
});
