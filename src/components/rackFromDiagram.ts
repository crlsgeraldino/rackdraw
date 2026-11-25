'use client';

/*
 * Data → Rack from Diagram (and the Racks view's "Build rack from diagram"): mounts the page's rack equipment that
 * isn't in a rack yet. When the client already has a rack, asks whether to add it there or build new racks, and says
 * which devices look like rack equipment but were left out because their shape has no rack size.
 */
import { mountableGear, unsizedGear } from '@/lib/autoRack';
import { activePage } from '@/lib/project';
import type { DeviceNode } from '@/lib/types';
import { getStencil, useDiagram } from '@/store/useDiagramStore';
import { askChoice } from './ChoiceHost';

/** Runs it; returns a message to show ('' when there is nothing to say). */
export async function rackFromDiagram(): Promise<string> {
  const s = useDiagram.getState();
  const p = s.projects[s.currentId];
  const racks = p.racks ?? [];
  const inRack = new Set(racks.flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
  const free = activePage(p).nodes.filter((n): n is DeviceNode => n.type === 'device' && !inRack.has(n.id));
  const unsized = unsizedGear(free, getStencil);
  const names = (ds: DeviceNode[]) => ds.slice(0, 6).map((d) => `"${d.data.name}"`).join(', ') + (ds.length > 6 ? ` and ${ds.length - 6} more` : '');
  const skipped = unsized.length
    ? `Left out, because their shape has no rack size: ${names(unsized)}. Select the shape, open Edit shape & ports and set Rack units, then run Rack from Diagram again.`
    : '';
  if (!mountableGear(free, getStencil).length) {
    return skipped || "Nothing to mount: this page has no rack-mountable devices that aren't already in a rack.";
  }
  let into: string | undefined;
  if (racks.length) {
    const target = racks.find((r) => r.id === s.activeRackId) ?? racks[0];
    const choice = await askChoice({
      title: 'Rack from Diagram',
      message: `This client already has ${racks.length === 1 ? 'a rack' : `${racks.length} racks`}. Add this page's equipment that isn't mounted yet to "${target.name}" (it grows if it needs to), or build new racks for it?`,
      choices: [
        { label: 'Build new racks', value: 'new' },
        { label: `Add to "${target.name}"`, value: 'add', primary: true },
      ],
    });
    if (!choice) return '';
    if (choice === 'add') into = target.id;
  }
  useDiagram.getState().buildRackFromDiagram(undefined, into);
  return skipped;
}
