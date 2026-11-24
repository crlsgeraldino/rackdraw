/** Alt text: descriptions of pages, racks and items for screen readers and accessible Word / PowerPoint exports. */
import type { AppNode, Page, Project, Rack } from './types';

const list = (names: string[], max = 8) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);

/** An item's own alt text, or a plain description of it. */
export function itemAlt(n: AppNode): string {
  if (n.type === 'backdrop') return 'Background picture';
  if (n.data.alt?.trim()) return n.data.alt.trim();
  switch (n.type) {
    case 'device': return [n.data.name, n.data.model, n.data.ip].filter(Boolean).join(', ') || 'Device';
    case 'zone': return `Area: ${n.data.title}`;
    case 'note': return `Note: ${n.data.text}`;
    case 'shape': return n.data.kind === 'image' ? 'Picture' : n.data.text?.trim() || `${n.data.kind} shape`;
    default: return '';
  }
}

/** A sentence describing a page picture, e.g. for a Word or PowerPoint export. */
export function pageAlt(p: Project, pg: Page): string {
  const devices = pg.nodes.filter((n) => n.type === 'device').map((n) => (n.type === 'device' && n.data.alt?.trim()) || (n.type === 'device' ? n.data.name : '')).filter(Boolean);
  const areas = pg.nodes.filter((n) => n.type === 'zone').map((n) => (n.type === 'zone' ? n.data.title : '')).filter(Boolean);
  const kind = pg.kind === 'floorplan' ? 'Floor plan' : 'Network diagram';
  const parts = [`${kind} of ${p.name}${p.site ? ` (${p.site})` : ''}, page "${pg.name}"`];
  if (devices.length) parts.push(`${devices.length} device${devices.length === 1 ? '' : 's'}: ${list(devices)}`);
  if (areas.length) parts.push(`areas: ${list(areas, 6)}`);
  if (pg.edges.length) parts.push(`${pg.edges.length} cable${pg.edges.length === 1 ? '' : 's'}`);
  return `${parts.join('; ')}.`;
}

/** A sentence describing a rack elevation picture. */
export function rackAlt(p: Project, rack: Rack): string {
  const byId = new Map(p.pages.flatMap((pg) => pg.nodes).map((n) => [n.id, n]));
  const names = [...rack.items].sort((a, b) => b.u - a.u).map((i) => {
    const n = i.nodeId ? byId.get(i.nodeId) : undefined;
    return n?.type === 'device' ? n.data.name : i.label || i.kind.replace('-', ' ');
  }).filter(Boolean);
  return `Rack elevation of ${rack.name}${rack.location ? ` (${rack.location})` : ''} at ${p.name}, ${rack.units}U: ${names.length ? list(names) : 'empty'}.`;
}
