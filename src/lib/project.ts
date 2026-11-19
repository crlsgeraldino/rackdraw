import type { AppNode, CableEdge, DeviceNode, Page, PageKind, Project } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

export function newPage(name: string, kind: PageKind = 'network', nodes: AppNode[] = [], edges: CableEdge[] = []): Page {
  return { id: `p-${uid()}`, name, kind, nodes, edges };
}

/** Upgrades a project from the single-diagram format (v0.2 and earlier) to pages. Safe to call on any project. */
export function migrateProject(p: Project): Project {
  if (Array.isArray(p.pages) && p.pages.length) {
    return p.pages.some((pg) => pg.id === p.activePageId) ? p : { ...p, activePageId: p.pages[0].id };
  }
  const page = newPage('Network', 'network', p.nodes ?? [], p.edges ?? []);
  const rest = { ...p };
  delete rest.nodes;
  delete rest.edges;
  return { ...rest, pages: [page], activePageId: page.id };
}

export function activePage(p: Project): Page {
  return p.pages.find((pg) => pg.id === p.activePageId) ?? p.pages[0];
}

export function allNodes(p: Project): AppNode[] {
  return p.pages.flatMap((pg) => pg.nodes);
}

export function allDevices(p: Project): DeviceNode[] {
  return allNodes(p).filter((n): n is DeviceNode => n.type === 'device');
}

/** The page a node lives on. */
export function pageOf(p: Project, nodeId: string): Page | undefined {
  return p.pages.find((pg) => pg.nodes.some((n) => n.id === nodeId));
}
