import type { AppNode, CableEdge, Page, Project } from './types';

/** One text field that matched a search. */
export interface FindHit {
  pageId: string;
  pageName: string;
  kind: 'node' | 'edge';
  id: string;
  /** What the item is called, for the results list. */
  item: string;
  /** Path of the field inside the item's data, e.g. ['ip'] or ['ports', 'P1', 'description']. */
  path: string[];
  label: string;
  value: string;
}

const DEVICE_FIELDS: [string, string][] = [
  ['name', 'Name'], ['model', 'Model'], ['ip', 'IP'], ['mac', 'MAC'], ['serial', 'Serial'],
  ['assetTag', 'Asset tag'], ['location', 'Location'], ['notes', 'Notes'], ['link', 'Link'],
];

/** Every searchable text field of a node, with its path in `data` and a label. */
function nodeFields(n: AppNode): { item: string; fields: { path: string[]; label: string; value: string }[] } {
  const f = (path: string[], label: string, value: unknown) => (typeof value === 'string' && value ? [{ path, label, value }] : []);
  switch (n.type) {
    case 'device': {
      const d = n.data;
      const ports = Object.entries(d.ports ?? {}).flatMap(([pid, pd]) => [
        ...f(['ports', pid, 'description'], `Port ${pd.label || pid} description`, pd.description),
        ...f(['ports', pid, 'vlan'], `Port ${pd.label || pid} VLAN`, pd.vlan),
      ]);
      return { item: d.name || 'Device', fields: [...DEVICE_FIELDS.flatMap(([k, l]) => f([k], l, d[k])), ...ports] };
    }
    case 'zone':
      return { item: n.data.title || 'Zone', fields: [...f(['title'], 'Zone title', n.data.title), ...f(['link'], 'Link', n.data.link)] };
    case 'note':
      return { item: 'Note', fields: f(['text'], 'Note', n.data.text) };
    case 'shape':
      return { item: n.data.text?.split('\n')[0] || `Shape (${n.data.kind})`, fields: [...f(['text'], 'Text', n.data.text), ...f(['link'], 'Link', n.data.link)] };
    default:
      return { item: '', fields: [] };
  }
}

function edgeFields(e: CableEdge, byId: Map<string, AppNode>) {
  const name = (id: string) => {
    const n = byId.get(id);
    return n?.type === 'device' ? n.data.name : n?.type === 'shape' ? n.data.text || 'shape' : '?';
  };
  const d = e.data;
  const fields = [
    ...(d?.label ? [{ path: ['label'], label: 'Cable label', value: d.label }] : []),
    ...(d?.vlan ? [{ path: ['vlan'], label: 'Cable VLAN', value: d.vlan }] : []),
  ];
  return { item: `${name(e.source)} → ${name(e.target)}`, fields };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const matcher = (term: string, matchCase: boolean) => new RegExp(escape(term), matchCase ? 'g' : 'gi');

/** Finds `term` in every text field of every page (devices, ports, zones, notes, shapes, cables). */
export function findInProject(p: Project, term: string, matchCase: boolean): FindHit[] {
  if (!term) return [];
  const re = matcher(term, matchCase);
  const hits: FindHit[] = [];
  const test = (v: string) => {
    re.lastIndex = 0;
    return re.test(v);
  };
  for (const pg of p.pages) {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    for (const n of pg.nodes) {
      const { item, fields } = nodeFields(n);
      for (const fl of fields) if (test(fl.value)) hits.push({ pageId: pg.id, pageName: pg.name, kind: 'node', id: n.id, item, ...fl });
    }
    for (const e of pg.edges) {
      const { item, fields } = edgeFields(e, byId);
      for (const fl of fields) if (test(fl.value)) hits.push({ pageId: pg.id, pageName: pg.name, kind: 'edge', id: e.id, item, ...fl });
    }
  }
  return hits;
}

/** Sets a value at `path` inside a data object, copying each level. */
function setPath(data: Record<string, unknown>, path: string[], value: string): Record<string, unknown> {
  const [k, ...rest] = path;
  if (!rest.length) return { ...data, [k]: value };
  const child = (data[k] as Record<string, unknown> | undefined) ?? {};
  return { ...data, [k]: setPath(child, rest, value) };
}

/** Applies replacements to the given hits (all hits from `findInProject`, or just one). Returns new pages. */
export function replaceHits(pages: Page[], hits: FindHit[], term: string, replacement: string, matchCase: boolean): Page[] {
  const re = matcher(term, matchCase);
  const byItem = new Map<string, FindHit[]>();
  for (const h of hits) byItem.set(`${h.pageId}|${h.kind}|${h.id}`, [...(byItem.get(`${h.pageId}|${h.kind}|${h.id}`) ?? []), h]);
  const apply = (pageId: string, kind: 'node' | 'edge', id: string, data: Record<string, unknown>) => {
    for (const h of byItem.get(`${pageId}|${kind}|${id}`) ?? []) {
      let cur: unknown = data;
      for (const k of h.path) cur = (cur as Record<string, unknown> | undefined)?.[k];
      if (typeof cur === 'string') data = setPath(data, h.path, cur.replace(re, () => replacement));
    }
    return data;
  };
  return pages.map((pg) => {
    if (!hits.some((h) => h.pageId === pg.id)) return pg;
    return {
      ...pg,
      nodes: pg.nodes.map((n) => (byItem.has(`${pg.id}|node|${n.id}`) ? ({ ...n, data: apply(pg.id, 'node', n.id, n.data) } as AppNode) : n)),
      edges: pg.edges.map((e) => (byItem.has(`${pg.id}|edge|${e.id}`) ? ({ ...e, data: apply(pg.id, 'edge', e.id, (e.data ?? {}) as Record<string, unknown>) } as CableEdge) : e)),
    };
  });
}
