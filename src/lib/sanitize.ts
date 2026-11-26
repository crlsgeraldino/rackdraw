/**
 * Checks and repairs a client read from a file or a backup before it is opened: a damaged or hand-edited file must
 * not crash the app (and keep crashing it on every start, since the open client is saved).
 */
import { cleanChangeLog } from './changeLog';
import { migrateProject } from './project';
import { cleanDeep, num } from './safe';
import type { VlanDef } from './ipam';
import type { AppNode, CableEdge, Page, Project, StencilDef } from './types';

/** Newest project file version this build understands. */
export const PROJECT_FILE_VERSION = 3;

const uid = () => Math.random().toString(36).slice(2, 10);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

export interface SanitizeReport {
  droppedNodes: number;
  droppedEdges: number;
}

/**
 * Text fields must be text: a number or yes/no becomes text, anything else (a list, an object, null) is removed.
 * Features read these with .trim() / .match(), so a hand-edited or damaged file must not crash them.
 */
function texts(o: Record<string, unknown>, keys: readonly string[]) {
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || typeof v === 'string') continue;
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') o[k] = String(v);
    else delete o[k];
  }
  return o;
}

const DEVICE_TEXT = ['model', 'ip', 'mac', 'serial', 'location', 'notes', 'assetTag', 'purchaseDate', 'warrantyEnd', 'endOfLife', 'status', 'layer', 'labelSide'] as const;
const PORT_TEXT = ['label', 'description', 'ip', 'vlan', 'notes', 'speed', 'poe', 'status'] as const;
const CABLE_TEXT = ['label', 'vlan', 'layer', 'route', 'arrows', 'color', 'length', 'role', 'tag'] as const;
const VLAN_TEXT = ['name', 'vlan', 'subnet', 'gateway', 'dhcpStart', 'dhcpEnd', 'color', 'notes'] as const;

/** A device's ports: an object of port objects with text fields. */
function cleanPorts(ports: unknown) {
  if (!isObj(ports)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(ports)) {
    if (!isObj(q)) continue;
    const port = texts({ ...q }, PORT_TEXT);
    if (port.uplink !== undefined) port.uplink = port.uplink === true;
    out[id] = port;
  }
  return out;
}

/** A cable's data with the right types. */
function cleanCable(d: unknown) {
  if (!isObj(d)) return { cable: 'Cat6' };
  const out = texts({ ...d }, CABLE_TEXT);
  out.cable = typeof out.cable === 'string' && out.cable ? out.cable : 'Cat6';
  for (const k of ['labelAt', 'weight']) if (out[k] !== undefined && !finite(out[k])) delete out[k];
  if (out.showLength !== undefined) out.showLength = out.showLength === true;
  delete out.via; // worked out when drawn
  return out;
}

/** A device's fields must have the right types (a hand-edited file may say "heavy" for a weight, or 5 for a name). */
function cleanDevice(d: Record<string, unknown>) {
  const out = texts({ ...d }, DEVICE_TEXT);
  out.name = typeof out.name === 'string' ? out.name : finite(out.name) ? String(out.name) : '';
  out.stencilId = typeof out.stencilId === 'string' ? out.stencilId : '';
  if (out.ports !== undefined) out.ports = cleanPorts(out.ports);
  if (out.extraFields !== undefined) {
    out.extraFields = Array.isArray(out.extraFields)
      ? out.extraFields.filter(isObj).map((f) => texts({ label: f.label ?? '', value: f.value ?? '' }, ['label', 'value'])).filter((f) => typeof f.label === 'string')
      : undefined;
  }
  if (out.labelFields !== undefined && !(Array.isArray(out.labelFields) && out.labelFields.every((f) => typeof f === 'string'))) delete out.labelFields;
  if (out.labelOffset !== undefined && !(isObj(out.labelOffset) && finite(out.labelOffset.x) && finite(out.labelOffset.y))) delete out.labelOffset;
  if (out.rotation !== undefined && !finite(out.rotation)) delete out.rotation;
  for (const k of ['powerW', 'weightLb']) if (out[k] !== undefined && !finite(out[k])) delete out[k];
  if (isObj(out.ups)) { const u = { ...out.ups }; for (const k of ['capacityW', 'runtimeHalfMin']) if (u[k] !== undefined && !finite(u[k])) delete u[k]; out.ups = u; }
  if (isObj(out.circuit) && out.circuit.monthlyCost !== undefined && !finite(out.circuit.monthlyCost)) out.circuit = { ...out.circuit, monthlyCost: undefined };
  if (out.showOn !== undefined && out.showOn !== 'rack') delete out.showOn;
  if (out.view !== undefined && out.view !== 'back') delete out.view;
  if (out.psus !== undefined && !(finite(out.psus) && (out.psus as number) >= 1 && (out.psus as number) <= 2)) delete out.psus;
  return out;
}

/** Returns a safe copy of `raw` as a Project, or throws with a readable reason. */
export function sanitizeProject(raw: unknown, fallbackName = 'Imported client'): { project: Project; report: SanitizeReport } {
  if (!isObj(raw)) throw new Error('Not a RackDraw diagram file.');
  const hasPages = Array.isArray(raw.pages);
  if (!hasPages && !(Array.isArray(raw.nodes) && Array.isArray(raw.edges))) throw new Error('Not a RackDraw diagram file.');
  const report: SanitizeReport = { droppedNodes: 0, droppedEdges: 0 };
  // Style values that could break out of markup, and absurdly deep nesting, are removed first.
  const cleaned = cleanDeep(raw) as Record<string, unknown>;
  if (Array.isArray(cleaned.pages)) cleaned.pages = cleaned.pages.filter(isObj);
  const p = migrateProject({ name: fallbackName, createdAt: Date.now(), ...cleaned } as unknown as Project);

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
      nodes: unique.map((n) => ({ ...n, selected: false, ...(n.type === 'device' ? { data: cleanDevice(n.data as unknown as Record<string, unknown>) } : {}) }) as AppNode),
      edges: edges.map((e) => ({ ...e, data: cleanCable(e.data), selected: false })) as CableEdge[],
    };
  });
  if (!pages.length) throw new Error('This file has no pages.');

  const ids = new Set(pages.flatMap((pg) => pg.nodes.map((n) => n.id)));
  const racks = (Array.isArray(p.racks) ? p.racks : []).filter(isObj).map((r) => ({
    ...r,
    feedVolts: finite(r.feedVolts) ? r.feedVolts : undefined,
    feedAmps: finite(r.feedAmps) ? r.feedAmps : undefined,
    units: finite(r.units) && r.units > 0 ? Math.min(60, Math.round(r.units)) : 42,
    items: (Array.isArray(r.items) ? r.items : [])
      .filter((it) => isObj(it) && finite(it.u) && finite(it.height) && (!it.nodeId || ids.has(it.nodeId)))
      .map((it) => (it.shelf !== undefined && !(isObj(it.shelf) && typeof it.shelf.id === 'string' && finite(it.shelf.x)) ? { ...it, shelf: undefined } : it))
      .map((it) => (it.outlets !== undefined && !(finite(it.outlets) && it.outlets >= 1 && it.outlets <= 48) ? { ...it, outlets: undefined } : it)),
    power: Array.isArray(r.power)
      ? r.power.filter((c: unknown) => isObj(c) && typeof c.id === 'string' && typeof c.from === 'string' && typeof c.inlet === 'string' && typeof c.to === 'string' && finite(c.outlet))
      : undefined,
  }));
  const project: Project = {
    ...p,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : fallbackName,
    pages,
    racks,
    activePageId: pages.some((pg) => pg.id === p.activePageId) ? p.activePageId : pages[0].id,
    changeLog: cleanChangeLog(p.changeLog),
    vlans: Array.isArray(p.vlans)
      ? p.vlans.filter((v) => isObj(v) && typeof v.name === 'string')
        .map((v) => ({ ...texts({ ...v }, VLAN_TEXT), id: typeof v.id === 'string' ? v.id : `v-${uid()}`, vlan: typeof v.vlan === 'string' ? v.vlan : finite(v.vlan) ? String(v.vlan) : '' }) as VlanDef)
      : undefined,
    createdAt: finite(p.createdAt) ? p.createdAt : Date.now(),
    updatedAt: finite(p.updatedAt) ? p.updatedAt : Date.now(),
  };
  return { project, report };
}

const STENCIL_CATEGORIES = new Set(['Firewalls', 'Switching', 'Wireless', 'Servers', 'Endpoints', 'WAN', 'Layout', 'Custom', 'Personal', 'Carrier', 'Cabling', 'Infrastructure', 'Security']);

/**
 * A custom (imported) stencil checked before it is kept: the palette draws every stored stencil on every start, so a
 * broken one from a file must be repaired or refused here, never stored. null = not usable.
 */
export function sanitizeStencil(raw: unknown): StencilDef | null {
  const s = cleanDeep(raw);
  if (!isObj(s) || typeof s.id !== 'string' || !s.id || s.id.length > 200) return null;
  if (typeof s.image !== 'string' || !/^data:image\//i.test(s.image)) return null;
  const size = (v: unknown, d: number) => { const n = num(v, d); return n > 0 && n < 100_000 ? n : d; };
  const ports = (Array.isArray(s.ports) ? s.ports : []).filter(isObj).filter((q) => typeof q.id === 'string').map((q) => ({
    ...q,
    label: typeof q.label === 'string' ? q.label : String(q.id),
    x: num(q.x), y: num(q.y), w: size(q.w, 10), h: size(q.h, 10),
  }));
  return {
    ...(s as unknown as StencilDef),
    name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 300) : 'Imported shape',
    category: (typeof s.category === 'string' && STENCIL_CATEGORIES.has(s.category) ? s.category : 'Custom') as StencilDef['category'],
    width: size(s.width, 100),
    height: size(s.height, 100),
    scale: size(s.scale, 1),
    ports: ports as unknown as StencilDef['ports'],
    style: 'image',
    library: typeof s.library === 'string' ? s.library.slice(0, 200) : undefined,
    rackUnits: s.rackUnits === undefined ? undefined : Math.max(1, Math.min(60, Math.round(num(s.rackUnits, 1)))),
    desktop: typeof s.desktop === 'boolean' ? s.desktop : undefined,
    rear: typeof s.rear === 'string' ? s.rear.slice(0, 200) : undefined,
    back: undefined,
    rackKit: typeof s.rackKit === 'string' && s.rackKit.trim() ? s.rackKit.slice(0, 200) : undefined,
    defaults: isObj(s.defaults) ? (cleanDevice(s.defaults) as StencilDef['defaults']) : undefined,
    custom: true,
  };
}

/** The usable stencils of a list (from a library file, a client file or stored data); broken ones are left out. */
export function sanitizeStencils(list: unknown): StencilDef[] {
  return (Array.isArray(list) ? list : []).map(sanitizeStencil).filter((x): x is StencilDef => !!x);
}
