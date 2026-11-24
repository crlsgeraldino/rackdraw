/**
 * Checks and repairs a client read from a file or a backup before it is opened: a damaged or hand-edited file must
 * not crash the app (and keep crashing it on every start, since the open client is saved).
 */
import { migrateProject } from './project';
import type { AppNode, CableEdge, Page, Project } from './types';

/** Newest project file version this build understands. */
export const PROJECT_FILE_VERSION = 3;

const uid = () => Math.random().toString(36).slice(2, 10);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

export interface SanitizeReport {
  droppedNodes: number;
  droppedEdges: number;
}

/** Returns a safe copy of `raw` as a Project, or throws with a readable reason. */
export function sanitizeProject(raw: unknown, fallbackName = 'Imported client'): { project: Project; report: SanitizeReport } {
  if (!isObj(raw)) throw new Error('Not a RackDraw diagram file.');
  const hasPages = Array.isArray(raw.pages);
  if (!hasPages && !(Array.isArray(raw.nodes) && Array.isArray(raw.edges))) throw new Error('Not a RackDraw diagram file.');
  const report: SanitizeReport = { droppedNodes: 0, droppedEdges: 0 };
  const p = migrateProject({ name: fallbackName, createdAt: Date.now(), ...(raw as object) } as Project);

  const pages: Page[] = (p.pages as unknown[]).filter(isObj).map((pg) => {
    const nodes = (Array.isArray(pg.nodes) ? pg.nodes : []).filter((n: unknown): n is AppNode => {
      const ok = isObj(n) && typeof n.id === 'string' && !!n.id && typeof n.type === 'string'
        && isObj(n.position) && finite(n.position.x) && finite(n.position.y) && isObj(n.data);
      if (!ok) report.droppedNodes++;
      return ok;
    });
    // Duplicate ids would confuse the canvas: keep the first.
    const seen = new Set<string>();
    const unique = nodes.filter((n) => (seen.has(n.id) ? (report.droppedNodes++, false) : (seen.add(n.id), true)));
    const edges = (Array.isArray(pg.edges) ? pg.edges : []).filter((e: unknown): e is CableEdge => {
      const ok = isObj(e) && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string' && seen.has(e.source) && seen.has(e.target);
      if (!ok) report.droppedEdges++;
      return ok;
    });
    return {
      ...(pg as unknown as Page),
      id: typeof pg.id === 'string' && pg.id ? pg.id : `p-${uid()}`,
      name: typeof pg.name === 'string' ? pg.name : 'Page',
      nodes: unique.map((n) => ({ ...n, selected: false })),
      edges: edges.map((e) => ({ ...e, data: isObj(e.data) ? e.data : { cable: 'Cat6' }, selected: false })) as CableEdge[],
    };
  });
  if (!pages.length) throw new Error('This file has no pages.');

  const ids = new Set(pages.flatMap((pg) => pg.nodes.map((n) => n.id)));
  const racks = (Array.isArray(p.racks) ? p.racks : []).filter(isObj).map((r) => ({
    ...r,
    units: finite(r.units) && r.units > 0 ? Math.min(60, Math.round(r.units)) : 42,
    items: (Array.isArray(r.items) ? r.items : []).filter((it) => isObj(it) && finite(it.u) && finite(it.height) && (!it.nodeId || ids.has(it.nodeId))),
  }));
  const project: Project = {
    ...p,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : fallbackName,
    pages,
    racks,
    activePageId: pages.some((pg) => pg.id === p.activePageId) ? p.activePageId : pages[0].id,
    createdAt: finite(p.createdAt) ? p.createdAt : Date.now(),
    updatedAt: finite(p.updatedAt) ? p.updatedAt : Date.now(),
  };
  return { project, report };
}
