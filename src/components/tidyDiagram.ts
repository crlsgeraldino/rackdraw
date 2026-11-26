'use client';

import { useReactFlow } from '@xyflow/react';
import { activePage } from '@/lib/project';
import { drawsAsSymbol } from '@/lib/logicalIcon';
import { INFO_GAP, overlaySize } from '@/lib/overlays';
import { DEFAULT_SETUP, sheetSize } from '@/lib/pageSetup';
import { placeZones, tidyDevices, tidyLayout, tidyPrepare, type TidyItem, type TidyOptions } from '@/lib/tidy';
import { safeFitView } from '@/lib/fit';
import type { AppNode } from '@/lib/types';
import { getStencil, useDiagram } from '@/store/useDiagramStore';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Design → Tidy Diagram on the active page, as one undo step: shows / adds what the options ask for and sets the
 * device look, waits for the page to be redrawn so every device, label and info box has its real size, then lays
 * the devices out on the page's sheets and boxes each rack. Returns a line saying what it did.
 */
export function useTidyDiagram() {
  const rf = useReactFlow<AppNode>();
  return async (o: TidyOptions & { icons: boolean }): Promise<string> => {
    const s = useDiagram.getState();
    const page0 = activePage(s.projects[s.currentId]);
    const prep = tidyPrepare(page0, getStencil, o, o.icons);
    s.editPage((pg) => ({ ...pg, nodes: prep.nodes, edges: prep.edges, look: o.icons ? 'icons' : undefined }));
    // Redrawn (new look, shown devices) and measured by React Flow and the label / info box observers.
    for (let i = 0; i < 4; i++) await nextFrame();
    await new Promise((r) => setTimeout(r, 120));

    const st = useDiagram.getState();
    const project = st.projects[st.currentId];
    const page = activePage(project);
    const devices = tidyDevices(page);
    if (devices.length < 2) return 'Add at least two devices to tidy.';
    const items: TidyItem[] = devices.map((n) => {
      const m = rf.getInternalNode(n.id)?.measured;
      const w0 = m?.width ?? 80, h0 = m?.height ?? 60;
      const stc = getStencil(n.data.stencilId);
      // An icon's / symbol's name sits beside it on the left (set in pass 1); a faceplate's sits below, left-aligned.
      const beside = n.data.labelSide === 'left' && (stc?.style === 'icon' || drawsAsSymbol(page.look, stc));
      const label = overlaySize(`${n.id}|label`);
      const lw = label?.w ?? 0;
      // How far the drawing reaches left of the device's box (its name) and right of its x (name below, info box).
      const left = beside && label ? lw + 8 : 0;
      const info = n.data.infoBox?.show ? overlaySize(`${n.id}|info`) : undefined;
      const right = Math.max(beside ? w0 : Math.max(w0, lw), info ? w0 + INFO_GAP + info.w : 0);
      const h = beside ? Math.max(h0, label?.h ?? 0) : h0 + (label ? label.h + 6 : 0);
      return {
        id: n.id,
        w: Math.round(left + right),
        h: Math.round(Math.max(h, info?.h ?? 0)),
        left: Math.round(left),
        category: n.data.stencilId === 'internet' ? 'Internet' : stc?.category ?? 'Custom',
        name: n.data.name,
      };
    });
    const plan = tidyLayout(page, items, project.racks ?? [], sheetSize(page.setup ?? DEFAULT_SETUP), getStencil, o);
    st.editPage((pg) => ({
      ...pg,
      nodes: placeZones(pg.nodes.map((n) => (plan.positions.has(n.id) ? { ...n, position: plan.positions.get(n.id)! } : n)), plan.zones),
    }), false);
    setTimeout(() => safeFitView(rf, { padding: 0.1, duration: 300 }), 80);
    const done = [`Arranged ${plan.positions.size} devices`];
    if (plan.zones.length) done.push(`boxed ${plan.zones.map((z) => z.title).join(', ')}`);
    if (prep.shown.length) done.push(`showed ${prep.shown.join(', ')} (they were in the rack only)`);
    if (prep.internet) done.push('added the Internet above the modem');
    return `${done.join('; ')}. Undo with Ctrl+Z.`;
  };
}
