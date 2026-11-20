'use client';

import { fmtLen, useUnits } from '@/lib/measure';
import { useReactFlow, useViewport } from '@xyflow/react';
import { setPref, usePref } from '@/lib/prefs';
import { realLength } from '@/lib/units';
import type { AppNode } from '@/lib/types';
import { useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { Icon } from './ribbon/icons';

const MIN = 0.1, MAX = 4;
/** Slider position (0–100) ↔ zoom, logarithmic so 100% sits in the middle like Office. */
const toSlider = (z: number) => Math.round(((Math.log(z) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN))) * 100);
const fromSlider = (v: number) => Math.exp(Math.log(MIN) + (v / 100) * (Math.log(MAX) - Math.log(MIN)));

/** Visio's status bar: page number, what is selected and its size, and zoom controls. */
export function StatusBar() {
  const rf = useReactFlow<AppNode>();
  const { zoom } = useViewport();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const view = useDiagram((s) => s.view);
  const minimap = usePref('minimap');
  const selNodes = page.nodes.filter((n) => n.selected && n.type !== 'backdrop');
  const selEdges = page.edges.filter((e) => e.selected);
  const index = project.pages.findIndex((p) => p.id === page.id) + 1;

  const units = useUnits(page);
  let selection = '';
  if (selNodes.length + selEdges.length > 1) selection = `${selNodes.length + selEdges.length} items selected`;
  else if (selNodes.length === 1) {
    const n = rf.getInternalNode(selNodes[0].id);
    const w = n?.measured.width ?? 0, h = n?.measured.height ?? 0;
    const size = (v: number) => (page.scale ? realLength(v, page.scale) : fmtLen(v, units));
    selection = n ? `Width: ${size(w)}   Height: ${size(h)}   X: ${fmtLen(n.internals.positionAbsolute.x, units)}   Y: ${fmtLen(n.internals.positionAbsolute.y, units)}` : '';
  } else if (selEdges.length === 1) selection = '1 cable selected';

  const btn = 'flex h-5 w-5 items-center justify-center rounded text-gray-600 hover:bg-gray-200 disabled:opacity-40';
  const diagram = view === 'diagram';
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-gray-300 bg-[#f3f3f3] px-3 text-[11px] text-gray-700">
      <span>Page {index} of {project.pages.length}</span>
      <span className="truncate whitespace-pre text-gray-500">{diagram ? selection : 'Racks view'}</span>
      {page.scale && diagram && <span className="text-gray-500">Scale 100 = {realLength(100, page.scale)}</span>}
      <div className="ml-auto flex items-center gap-1.5">
        <button className={btn} onClick={() => setPref('minimap', !minimap)} title="Pan & Zoom window" aria-label="Pan & Zoom window" aria-pressed={minimap} disabled={!diagram}>
          <Icon name="minimap" size={14} />
        </button>
        <button className={btn} onClick={() => rf.zoomOut({ duration: 120 })} title="Zoom out" aria-label="Zoom out" disabled={!diagram}>−</button>
        <input
          type="range" min={0} max={100} value={toSlider(zoom)} disabled={!diagram}
          onChange={(e) => rf.zoomTo(fromSlider(Number(e.target.value)))}
          className="h-1 w-28 accent-[#3955a3]" aria-label="Zoom"
        />
        <button className={btn} onClick={() => rf.zoomIn({ duration: 120 })} title="Zoom in" aria-label="Zoom in" disabled={!diagram}>+</button>
        <button className="w-10 rounded text-right hover:bg-gray-200" onClick={() => rf.zoomTo(1, { duration: 120 })} title="Zoom to 100%" disabled={!diagram}>{Math.round(zoom * 100)}%</button>
        <button className={btn} onClick={() => rf.fitView({ padding: 0.2, duration: 200 })} title="Fit page to current window" aria-label="Fit page" disabled={!diagram}>
          <Icon name="fit" size={14} />
        </button>
      </div>
    </footer>
  );
}
