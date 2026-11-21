'use client';

import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { ImportPlan } from '@/lib/dataImport';
import { DEFAULT_DISPLAY } from '@/lib/display';
import { DEFAULT_LIBRARY, libraryOf, resolveLibrary, sameLibrary } from '@/lib/libraries';
import { STENCIL_MAP, STENCILS } from '@/lib/stencils';
import { activePage, migrateProject, newPage } from '@/lib/project';
import { findFreeU, fits } from '@/lib/rack';
import { alignPositions, distributePositions, isLocked, movable, orderZ, type AlignMode, type DistributeAxis } from '@/lib/arrange';
import { replaceHits, type FindHit } from '@/lib/find';
import { themeById } from '@/lib/themes';
import { projectFromTemplate, templateFromProject, type Template } from '@/lib/templates';
import { guideZoom, snapToGuides, SNAP_PX, useGuides } from '@/lib/guides';
import { getPref } from '@/lib/prefs';
import { normDeg, turnedBox } from '@/lib/rotation';
import { mapPorts } from '@/lib/changeShape';
import type { AppNode, BackdropData, CableData, CableEdge, DataLink, DeviceData, DisplaySettings, Layer, Page, PageKind, PortData, Project, Rack, RackItem, PageScale, ShapeFormat, ShapeKind, StencilDef, TextFormat, TitleBlock } from '@/lib/types';

/**
 * IndexedDB-backed storage: imported stencil images can be megabytes, well past localStorage's ~5 MB cap.
 * Reads fall back to localStorage once so data saved by earlier versions carries over.
 */
const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? localStorage.getItem(name),
  setItem: async (name, value) => {
    await idbSet(name, value);
    localStorage.removeItem(name);
  },
  removeItem: (name) => del(name),
};

interface Snapshot {
  pages: Page[];
  racks: Rack[];
  activePageId: string;
}

/** What a change may touch: the active page's nodes/edges, or project-level pages/racks. */
type Patch = Partial<{ nodes: AppNode[]; edges: CableEdge[]; racks: Rack[]; pages: Page[]; activePageId: string }>;

interface DiagramState {
  projects: Record<string, Project>;
  currentId: string;
  customStencils: Record<string, StencilDef>;
  /**
   * Version History (File → Version History): saved copies of each client, newest first. Named ones are kept;
   * automatic ones (one a day, and one before every restore) are trimmed to the latest 20.
   */
  versions: Record<string, ProjectVersion[]>;
  /** Saves the current client as a version. */
  saveVersion: (name?: string, auto?: boolean) => void;
  /** Saves an automatic version of a client if it has changed and the last one is more than a day old. */
  autoVersion: (projectId: string) => void;
  /** Puts a version back as the current client (saving the current state as a version first). */
  restoreVersion: (versionId: string) => void;
  /** Opens a version as a new, separate client. */
  versionAsCopy: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;
  /** Reads the saved versions (kept apart from the diagrams, so everyday saves stay small). */
  loadVersions: () => Promise<void>;
  /** My templates (File → Save as template), shown in File → New. */
  templates: Record<string, Template>;
  /** New client from a template (built-in or saved). */
  newFromTemplate: (name: string, template: Template) => void;
  /** Saves the current client as a template. */
  saveAsTemplate: (name: string, description: string) => void;
  deleteTemplate: (id: string) => void;
  past: Snapshot[];
  future: Snapshot[];

  // canvas
  onNodesChange: (changes: NodeChangeset<AppNode>) => void;
  onEdgesChange: (changes: EdgeChangeset<CableEdge>) => void;
  onConnect: (c: Connection) => void;
  /** Drag a cable's end to another port (Visio: move a connector's glued end). Refused onto a port already cabled. */
  reconnectEdge: (id: string, c: Connection) => void;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  // elements
  addStencil: (stencilId: string, position: { x: number; y: number }) => void;
  addZone: (position: { x: number; y: number }) => void;
  addNote: (position: { x: number; y: number }) => void;
  addShape: (kind: ShapeKind, position: { x: number; y: number }) => void;
  /** Adds a dimension line (or a floor-plan wall) starting at `position`. */
  addMeasure: (position: { x: number; y: number }, variant?: 'dimension' | 'wall') => void;
  /** Turns a device to any angle (its box grows to fit the turned drawing). No undo step. */
  setDeviceRotation: (id: string, rotation: number) => void;
  /** Rotate Left / Right 90° for the selection: devices and drawing shapes (undoable). */
  rotateSelection: (delta: 90 | -90) => void;
  /** Moves and resizes one node (rotated-shape resize handles). No undo step: the drag takes one at its start. */
  setNodeBox: (id: string, position: { x: number; y: number }, width: number, height: number) => void;
  /** AutoConnect (Visio's blue arrows): adds a copy of the item next to it in that direction, connected to it. */
  autoConnect: (id: string, dir: 'top' | 'right' | 'bottom' | 'left') => void;
  /** Line tool: a straight line from a to b. */
  addLine: (a: { x: number; y: number }, b: { x: number; y: number }) => void;
  /** Pencil tool: a freeform shape through these diagram points. */
  addFreeform: (points: { x: number; y: number }[]) => void;
  /** Adds a review comment to an item on the active page. */
  addComment: (nodeId: string, text: string, author?: string) => void;
  /** Adds a reply to a comment's thread (on any page of the client). */
  replyToComment: (nodeId: string, commentId: string, text: string, author?: string) => void;
  /** Changes or removes a comment (on any page of the client). */
  updateComment: (nodeId: string, commentId: string, patch: { resolved?: boolean; text?: string } | null) => void;
  /** Moves one end of a dimension line to a diagram point (no undo step; the drag takes one at its start). */
  moveMeasureEnd: (id: string, end: 'a' | 'b', point: { x: number; y: number }) => void;
  /** Paper size / orientation of the active page (Design → Page Setup). */
  setPageSetup: (setup: NonNullable<Page['setup']>) => void;
  /** Sets or clears the active page's drawing scale (undoable). */
  setPageScale: (scale: PageScale | null) => void;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  updatePort: (nodeId: string, portId: string, patch: PortData) => void;
  updateEdgeData: (id: string, patch: Partial<CableData>) => void;
  /** Applies one change to several devices on the active page (undoable). */
  updateDevicesData: (ids: string[], patch: Partial<DeviceData>) => void;
  /** Changes several devices on the active page, each from its own data (one undo step). */
  mapDevices: (ids: string[], fn: (d: DeviceData) => Partial<DeviceData>) => void;
  /** Changes every device on every page of the client (one undo step). */
  mapAllDevices: (fn: (d: DeviceData) => Partial<DeviceData>) => void;
  /** Applies one change to several cables on the active page (undoable). */
  updateEdgesData: (ids: string[], patch: Partial<CableData>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;

  // clipboard and Arrange (active page selection)
  /** Copies the selected items (and cables between them); returns what was copied, or null if nothing was selected. */
  copySelected: () => Clipboard | null;
  /** Copies, then deletes the selection (locked items are copied but stay). */
  cutSelected: () => Clipboard | null;
  /** Pastes items onto the active page, offset a little each time; `clip` defaults to the last copy. Returns how many. */
  paste: (clip?: Clipboard | null) => number;
  alignSelected: (mode: AlignMode) => void;
  distributeSelected: (axis: DistributeAxis) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  orderSelected: (to: 'front' | 'back') => void;
  setSelectionLocked: (locked: boolean) => void;
  /** Selects every visible item on the active page (Ctrl+A). */
  selectAll: () => void;
  /**
   * Change Shape (Visio): the selected devices take another stencil, keeping their details; cables and port notes move
   * to matching ports. Returns how many cables had no matching port and were removed.
   */
  changeShape: (stencilId: string) => number;
  /** Change Shape for drawing shapes: rectangle, ellipse, diamond… */
  changeShapeKind: (kind: ShapeKind) => void;
  /** Arrow keys: move the selection by dx, dy (locked items stay). */
  nudgeSelection: (dx: number, dy: number) => void;
  /** Drag a page tab: put the page at this position. */
  movePageTo: (id: string, index: number) => void;
  /** Select by Type (Home → Editing → Select): what to select on the active page. */
  /** Adds a picture shape (Insert → Picture, paste or drop an image) centred on `position`, at most 360px wide/high. */
  addPicture: (position: { x: number; y: number }, src: string, width: number, height: number) => void;
  /** Center Drawing: moves everything on the active page (locked items too) by dx, dy in one undo step. */
  moveDrawing: (dx: number, dy: number) => void;
  /** Picture → Crop: sets how much of each side is cut off; the box shrinks or grows so the picture keeps its scale. */
  cropPicture: (id: string, crop: { l: number; t: number; r: number; b: number } | null) => void;
  /** Lasso Select: selects these items (and the cables between selected items); `add` keeps the current selection. */
  selectIds: (ids: string[], add?: boolean) => void;
  /** Adds a table (Insert → Table) centred on `position`. */
  addTable: (position: { x: number; y: number }, cells: string[][]) => void;
  /** Renames items on the active page in one undo step: devices get a new name, drawing shapes new text. */
  renameItems: (names: Map<string, string>) => void;
  selectWhere: (what: 'devices' | 'cables' | 'shapes' | 'text' | 'zones' | 'same' | `layer:${string}`) => number;
  /** Sets (or clears) the ScreenTip of the selected items. */
  setTipOnSelection: (tip: string) => void;
  /**
   * Fill / line colour for the selection (ribbon Shape Style): shapes get fill and border, cables and zones the line
   * colour. `line: null` puts cables back to automatic colouring.
   */
  styleSelection: (style: { fill?: string; line?: string | null; text?: TextFormat; weight?: number | null; shadow?: boolean; textColor?: string; format?: ShapeFormat }) => void;
  /** Adds a callout; with `target` its leader line points at that item and it moves with it. */
  addCallout: (position: { x: number; y: number }, target?: string) => void;
  /** Moves nodes on the active page to new positions (one undo step). */
  setPositions: (positions: Map<string, { x: number; y: number }>) => void;
  /** Remembers the formatting of the selected cable, shape or device; returns what kind was copied. */
  copyFormat: () => 'cable' | 'shape' | 'device' | null;
  /** Applies the copied formatting to selected items of the same kind; returns how many changed. */
  pasteFormat: () => number;
  /** What `copyFormat` holds, for menus. */
  formatKind: () => 'cable' | 'shape' | 'device' | null;
  /** Shows a page and selects one node or cable on it (used by Find). */
  selectItem: (pageId: string, kind: 'node' | 'edge', id: string) => void;
  /** Replaces `term` in the given Find hits (undoable). Returns how many fields changed. */
  replaceInHits: (hits: FindHit[], term: string, replacement: string, matchCase: boolean) => number;
  updateTitleBlock: (patch: Partial<TitleBlock>) => void;

  // projects
  newProject: (name: string) => void;
  openProject: (id: string) => void;
  updateProject: (patch: Partial<Pick<Project, 'name' | 'site' | 'address' | 'contact' | 'notes'>>) => void;
  deleteProject: (id: string) => void;
  importProject: (p: Project, stencils?: StencilDef[]) => void;

  /**
   * Applies a spreadsheet import: updates matched devices on any page and creates new ones on the active page
   * (stencil picked from the row's Type when it names one, else `defaultStencilId`). Returns counts.
   */
  applyImport: (plan: ImportPlan, defaultStencilId: string, link: DataLink) => { updated: number; created: number };

  // layers and data colors (current project)
  addLayer: (name: string) => string;
  renameLayer: (id: string, name: string) => void;
  deleteLayer: (id: string) => void;
  toggleLayer: (id: string) => void;
  /** Layer Properties: visible / print / lock / name. */
  updateLayer: (id: string, patch: Partial<Omit<Layer, 'id'>>) => void;
  /** Makes a layer the active one (new items go on it), or none. */
  setActiveLayer: (id: string | null) => void;
  /** Resizes a zone (container) around the items inside it. */
  fitZoneToContents: (id: string) => void;
  /** Puts the selected devices/cables on the active page onto a layer (null = no layer). Returns how many moved. */
  assignSelectionToLayer: (layerId: string | null) => number;
  setDisplay: (patch: Partial<DisplaySettings>) => void;
  /** Design → Themes: recolours drawing shapes, callouts and zones (this page, or every page) and uses the theme for new ones. */
  applyTheme: (themeId: string, allPages: boolean) => void;
  /** Define Shape Data: replaces the client's field definitions; a renamed field is renamed on every device. */
  setFieldDefs: (defs: import('@/lib/types').FieldDef[], renamed?: { from: string; to: string }) => void;
  /** Print / PDF header and footer. */
  setHeaderFooter: (hf: import('@/lib/types').HeaderFooter | null) => void;
  /** Replaces the client's saved report definitions. */
  saveReports: (reports: NonNullable<Project['reports']>) => void;

  // pages (current project)
  setActivePage: (id: string) => void;
  addPage: (name: string, kind: PageKind) => void;
  renamePage: (id: string, name: string) => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  movePage: (id: string, dir: -1 | 1) => void;
  /** Makes a page a background page (or a normal one again). */
  setPageBackground: (id: string, background: boolean) => void;
  /** Sets the background page shown behind a page (null = none). */
  setBackgroundOf: (pageId: string, backgroundId: string | null) => void;
  /** Adds a background page and uses it behind every page that has none. */
  addBackgroundPage: () => void;
  /** Puts a floor plan / photo behind the active page (replacing any existing one). */
  setBackdrop: (image: string, naturalWidth: number, naturalHeight: number) => void;
  updateBackdrop: (patch: Partial<Pick<BackdropData, 'opacity' | 'locked'>> | null) => void;

  // racks (current project)
  view: 'diagram' | 'racks';
  activeRackId: string | null;
  selectedRackItemId: string | null;
  setView: (v: 'diagram' | 'racks') => void;
  /** Selects one diagram node and clears every other selection. */
  selectOnlyNode: (id: string) => void;
  /** Sets a device's diagram size, or restores its stencil's default size when `size` is null. */
  setNodeSize: (id: string, size: { width: number; height: number } | null) => void;
  selectRack: (id: string | null) => void;
  selectRackItem: (id: string | null) => void;
  addRack: (name: string, units: number) => string;
  updateRack: (id: string, patch: Partial<Pick<Rack, 'name' | 'units' | 'location' | 'notes'>>) => boolean;
  deleteRack: (id: string) => void;
  /** Places an item if it fits; returns false otherwise. */
  placeRackItem: (rackId: string, item: Omit<RackItem, 'id'>) => boolean;
  /** Moves/resizes an item if the new spot fits; returns false otherwise. */
  updateRackItem: (rackId: string, itemId: string, patch: Partial<Omit<RackItem, 'id'>>) => boolean;
  removeRackItem: (rackId: string, itemId: string) => void;
  /** Creates a new diagram device from a stencil and mounts it at `u` (or the first free slot). */
  addDeviceToRack: (rackId: string, stencilId: string, u?: number) => boolean;

  // custom stencils
  saveCustomStencil: (s: StencilDef) => void;
  deleteCustomStencil: (id: string) => void;
  /**
   * Adds stencils from a library or project file; returns how many were new.
   * Stencils without their own library go into `library` (default "My stencils").
   */
  importStencils: (list: StencilDef[], library?: string) => number;
  /** Renames a stencil library; renaming onto an existing library merges the two. */
  renameLibrary: (from: string, to: string) => void;
  /** Deletes every stencil in a library. */
  deleteLibrary: (name: string) => void;
}

/** Looks up a built-in or user-imported stencil. */
export function findStencil(id: string, custom: Record<string, StencilDef>): StencilDef | undefined {
  return STENCIL_MAP[id] ?? custom[id];
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Drops rack slots whose diagram device no longer exists. */
function pruneRacks(racks: Rack[] | undefined, nodes: AppNode[]): Rack[] {
  const ids = new Set(nodes.map((n) => n.id));
  return (racks ?? []).map((r) => {
    const items = r.items.filter((it) => it.kind !== 'device' || (it.nodeId && ids.has(it.nodeId)));
    return items.length === r.items.length ? r : { ...r, items };
  });
}

function blankProject(name: string): Project {
  const now = Date.now();
  const page = newPage('Network');
  return { id: uid(), name, pages: [page], activePageId: page.id, createdAt: now, updatedAt: now };
}

/** Gives a copied node a fresh id (keeping its id prefix). */
const reId = (id: string) => `${id.split('-')[0]}-${uid()}`;

/** Copied diagram items. Also put on the system clipboard, so it can be pasted into another NetCraft window. */
export interface Clipboard {
  format: 'netcraft-clip';
  nodes: AppNode[];
  edges: CableEdge[];
}
export const CLIP_MIME = 'application/x-netcraft-clip';

/** Formatting copied with Copy format (format painter). */
let formatClip: { kind: 'cable' | 'shape' | 'device'; patch: Record<string, unknown> } | null = null;

/** Last copy, and how many times it has been pasted (each paste lands a little further down-right). */
let clipboard: { clip: Clipboard; pasted: number } | null = null;

/** Data fields shared by all node kinds (group, lock, link). */
const extras = (n: AppNode) => n.data as { group?: string; locked?: boolean; link?: string };

/** React Flow flags for a locked item: it can be selected (to edit or unlock) but not dragged or deleted. */
const lockFlags = (locked: boolean) => ({ draggable: !locked, deletable: !locked });

const HISTORY_LIMIT = 100;
const first = blankProject('New client');

/** Size of a node on the canvas: as measured by React Flow, else its set size. */
function nodeSize(n: AppNode) {
  const st = n.style as { width?: number; height?: number } | undefined;
  return { w: n.measured?.width ?? n.width ?? st?.width ?? 0, h: n.measured?.height ?? n.height ?? st?.height ?? 0 };
}

/** Items whose centre lies inside a zone: the zone's contents, as in a Visio container. */
function zoneMembers(z: AppNode, nodes: AppNode[]) {
  const s = nodeSize(z);
  return nodes.filter((n) => {
    if (n.id === z.id || n.type === 'backdrop') return false;
    const m = nodeSize(n);
    if (n.type === 'zone' && m.w * m.h >= s.w * s.h) return false;
    const cx = n.position.x + m.w / 2, cy = n.position.y + m.h / 2;
    return cx > z.position.x && cx < z.position.x + s.w && cy > z.position.y && cy < z.position.y + s.h;
  });
}

/** A device turned to `rotation` (quarter turns): a set size swaps width and height on a quarter turn, around the same centre. */
function turnDevice(n: AppNode, rotation: number, stencil?: StencilDef): AppNode {
  if (n.type !== 'device') return n;
  const r = normDeg(rotation);
  const out: AppNode = { ...n, data: { ...n.data, rotation: r || undefined } };
  // Icons turn inside their square; other devices' boxes become the box around the turned drawing.
  if (!stencil || stencil.style === 'icon') return out;
  const bw = stencil.width * stencil.scale, bh = stencil.height * stencil.scale;
  const old = turnedBox(bw, bh, n.data.rotation ?? 0);
  const zoom = n.width ? n.width / old.w : 1;
  const now = turnedBox(bw * zoom, bh * zoom, r);
  const cur = n.measured?.width ? { w: n.measured.width, h: n.measured.height ?? 0 } : { w: old.w * zoom, h: old.h * zoom };
  // Same centre.
  const position = { x: n.position.x + cur.w / 2 - now.w / 2, y: n.position.y + cur.h / 2 - now.h / 2 };
  return { ...out, position, ...(n.width ? { width: now.w, height: now.h, style: { ...n.style, width: now.w, height: now.h } } : {}), measured: undefined };
}

/** Is this device port already cabled on the page? (Ports of drawing shapes never count as taken.) */
export function portTaken(pg: Page, nodeId: string, handle?: string | null) {
  if (!handle || pg.nodes.find((n) => n.id === nodeId)?.type !== 'device') return false;
  return pg.edges.some((e) => (e.source === nodeId && e.sourceHandle === handle) || (e.target === nodeId && e.targetHandle === handle));
}

/** A saved copy of a client (File → Version History). */
export interface ProjectVersion {
  id: string;
  name: string;
  at: number;
  /** Saved automatically (daily, or before a restore). */
  auto?: boolean;
  project: Project;
}

/** Version History lives under its own key, written only when the versions change (not on every edit). */
const VERSIONS_KEY = 'netcraft-versions';
let versionsLoaded = false;

/** Contents of the zones being dragged, captured when each drag starts. */
const zoneDrag = new Map<string, string[]>();

/** The active layer's id, for new items. */
function activeLayer(p: Project) {
  return p.layers?.find((l) => l.active)?.id;
}

export const useDiagram = create<DiagramState>()(
  persist(
    (set, get) => {
      const cur = () => get().projects[get().currentId];
      const page = () => activePage(cur());
      const theme = () => themeById(cur().theme);

      /** Applies a change: nodes/edges go to the active page, pages/racks to the project. */
      const commit = (patch: Patch) => {
        const p = cur();
        const pgId = activePage(p).id;
        let pages = patch.pages ?? p.pages;
        if (patch.nodes || patch.edges) {
          pages = pages.map((x) => (x.id === pgId ? { ...x, nodes: patch.nodes ?? x.nodes, edges: patch.edges ?? x.edges } : x));
        }
        set({
          projects: {
            ...get().projects,
            [p.id]: { ...p, pages, racks: patch.racks ?? p.racks, activePageId: patch.activePageId ?? p.activePageId, updatedAt: Date.now() },
          },
        });
      };
      const snap = (): Snapshot => {
        const p = cur();
        return { pages: p.pages, racks: p.racks ?? [], activePageId: p.activePageId };
      };
      /** Every node in the project if the active page's nodes were `nodes` (for rack pruning). */
      const allWith = (nodes: AppNode[]) => cur().pages.flatMap((pg) => (pg.id === page().id ? nodes : pg.nodes));

      return {
        projects: { [first.id]: first },
        currentId: first.id,
        customStencils: {},
        templates: {},
        versions: {},
        saveVersion: (name, auto) => {
          const p = cur();
          const list = get().versions[p.id] ?? [];
          const v: ProjectVersion = { id: `v-${uid()}`, name: name?.trim() || 'Version', at: Date.now(), auto: auto || undefined, project: JSON.parse(JSON.stringify(p)) };
          // Keep every named version; trim automatic ones to the latest 20.
          let next = [v, ...list];
          const autos = next.filter((x) => x.auto);
          if (autos.length > 20) {
            const drop = new Set(autos.slice(20).map((x) => x.id));
            next = next.filter((x) => !drop.has(x.id));
          }
          set({ versions: { ...get().versions, [p.id]: next } });
        },
        autoVersion: (projectId) => {
          const p = get().projects[projectId];
          if (!p) return;
          const last = (get().versions[projectId] ?? [])[0];
          if (last && (Date.now() - last.at < 24 * 3600 * 1000 || last.project.updatedAt === p.updatedAt)) return;
          if (!p.pages.some((pg) => pg.nodes.length)) return; // nothing worth keeping yet
          const id = get().currentId;
          set({ currentId: projectId });
          get().saveVersion(`Automatic · ${new Date().toLocaleDateString()}`, true);
          set({ currentId: id });
        },
        restoreVersion: (versionId) => {
          const p = cur();
          const v = (get().versions[p.id] ?? []).find((x) => x.id === versionId);
          if (!v) return;
          get().saveVersion(`Before restoring "${v.name}"`, true);
          const restored: Project = { ...JSON.parse(JSON.stringify(v.project)), id: p.id, updatedAt: Date.now() };
          set({ projects: { ...get().projects, [p.id]: restored }, past: [], future: [], activeRackId: restored.racks?.[0]?.id ?? null, selectedRackItemId: null });
        },
        versionAsCopy: (versionId) => {
          const v = (get().versions[cur().id] ?? []).find((x) => x.id === versionId);
          if (!v) return;
          const copy: Project = { ...JSON.parse(JSON.stringify(v.project)), id: uid(), name: `${v.project.name} (${v.name})`, createdAt: Date.now(), updatedAt: Date.now() };
          set({ projects: { ...get().projects, [copy.id]: copy }, currentId: copy.id, past: [], future: [] });
        },
        loadVersions: async () => {
          if (versionsLoaded) return;
          const saved = await idbGet<Record<string, ProjectVersion[]>>(VERSIONS_KEY).catch(() => undefined);
          versionsLoaded = true;
          // Versions saved before loading finished (none normally) are kept on top.
          const now = get().versions;
          const merged: Record<string, ProjectVersion[]> = { ...(saved ?? {}) };
          for (const [k, list] of Object.entries(now)) merged[k] = [...list, ...(merged[k] ?? [])];
          set({ versions: merged });
        },
        deleteVersion: (versionId) => {
          const id = cur().id;
          set({ versions: { ...get().versions, [id]: (get().versions[id] ?? []).filter((x) => x.id !== versionId) } });
        },
        newFromTemplate: (name, template) => {
          const p = projectFromTemplate(template.project, name);
          set({ projects: { ...get().projects, [p.id]: p }, currentId: p.id, past: [], future: [], activeRackId: p.racks?.[0]?.id ?? null, selectedRackItemId: null });
        },
        saveAsTemplate: (name, description) => {
          const t = templateFromProject(cur(), name, description);
          set({ templates: { ...get().templates, [t.id]: t } });
        },
        deleteTemplate: (id) => {
          const rest = { ...get().templates };
          delete rest[id];
          set({ templates: rest });
        },
        past: [],
        future: [],

        snapshot: () => {
          set({ past: [...get().past.slice(-HISTORY_LIMIT + 1), snap()], future: [] });
        },
        undo: () => {
          const { past, future } = get();
          if (!past.length) return;
          const prev = past[past.length - 1];
          set({ past: past.slice(0, -1), future: [snap(), ...future] });
          commit(prev);
        },
        redo: () => {
          const { past, future } = get();
          if (!future.length) return;
          const next = future[0];
          set({ past: [...past, snap()], future: future.slice(1) });
          commit(next);
        },

        onNodesChange: (changes) => {
          let arr = changes.toArray();
          if (arr.some((c) => c.type === 'remove')) get().snapshot();
          const before = page().nodes;
          let nodes = changes.applyTo(before);
          // Dynamic grid: snap what is being dragged into line with other items, and show guides.
          const dragging = arr.flatMap((c) => (c.type === 'position' && c.position && c.dragging ? [{ id: c.id, position: c.position }] : []));
          if (dragging.length && getPref('dynamicGrid')) {
            const ids = new Set(dragging.map((c) => c.id));
            const byId = new Map(before.map((n) => [n.id, n]));
            const groups = new Set([...ids].map((i) => byId.get(i)).filter((n): n is AppNode => !!n && n.type !== 'backdrop').map((n) => extras(n).group).filter(Boolean));
            const carried = new Set(before.filter((z) => z.type === 'zone' && ids.has(z.id)).flatMap((z) => zoneMembers(z, before).map((m) => m.id)));
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const c of dragging) {
              const n = byId.get(c.id);
              if (!n) continue;
              const s = nodeSize(n);
              x0 = Math.min(x0, c.position.x); y0 = Math.min(y0, c.position.y); x1 = Math.max(x1, c.position.x + s.w); y1 = Math.max(y1, c.position.y + s.h);
            }
            const others = before
              .filter((n) => !ids.has(n.id) && !carried.has(n.id) && n.type !== 'backdrop' && n.type !== 'measure' && !(extras(n).group && groups.has(extras(n).group)))
              .map((n) => ({ x: n.position.x, y: n.position.y, ...(({ w, h }) => ({ w, h }))(nodeSize(n)) }))
              .filter((b) => b.w > 0 && b.h > 0);
            const snap = x0 < Infinity ? snapToGuides({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, others, SNAP_PX / guideZoom.value) : null;
            if (snap && (snap.dx || snap.dy)) {
              arr = arr.map((c) => (c.type === 'position' && c.position && c.dragging ? { ...c, position: { x: c.position.x + snap.dx, y: c.position.y + snap.dy } } : c));
              const moved = new Map(arr.flatMap((c) => (c.type === 'position' && c.position && c.dragging ? [[c.id, c.position] as const] : [])));
              nodes = nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n));
            }
            useGuides.setState({ x: snap?.gx ?? [], y: snap?.gy ?? [] });
          } else if (arr.some((c) => c.type === 'position' && !c.dragging)) {
            useGuides.setState({ x: [], y: [] });
          }
          // Groups: moving or selecting one member moves/selects the whole group.
          const groupOf = new Map(before.filter((n) => n.type !== 'backdrop' && extras(n).group).map((n) => [n.id, extras(n).group!]));
          if (groupOf.size) {
            const moved = new Map<string, { dx: number; dy: number }>();
            const touched = new Set(arr.flatMap((c) => (c.type === 'position' ? [c.id] : [])));
            for (const c of arr) {
              // Only drags move the group; a resize handle also sends position changes for the resized item.
              if (c.type !== 'position' || !c.position || !c.dragging) continue;
              const g = groupOf.get(c.id);
              const old = g ? before.find((n) => n.id === c.id) : undefined;
              if (g && old && !moved.has(g)) moved.set(g, { dx: c.position.x - old.position.x, dy: c.position.y - old.position.y });
            }
            const selected = new Map<string, boolean>();
            // Clicking a member of an already-selected group deselects the others; "selected" wins.
            for (const c of arr) if (c.type === 'select' && groupOf.has(c.id)) selected.set(groupOf.get(c.id)!, c.selected || !!selected.get(groupOf.get(c.id)!));
            if (moved.size || selected.size) {
              nodes = nodes.map((n) => {
                const g = groupOf.get(n.id);
                if (!g) return n;
                const d = moved.get(g);
                let next = n;
                if (d && !touched.has(n.id) && (d.dx || d.dy)) next = { ...next, position: { x: n.position.x + d.dx, y: n.position.y + d.dy } };
                if (selected.has(g) && n.selected !== selected.get(g)) next = { ...next, selected: selected.get(g) };
                return next;
              });
            }
          }
          for (const c of arr) if (c.type === 'position' && !c.dragging) zoneDrag.delete(c.id);
          // Callouts follow the item they point to (unless they are being dragged themselves).
          const dragged = new Map<string, { dx: number; dy: number }>();
          for (const c of arr) {
            if (c.type !== 'position' || !c.position || !c.dragging) continue;
            const old = before.find((n) => n.id === c.id);
            if (old) dragged.set(c.id, { dx: c.position.x - old.position.x, dy: c.position.y - old.position.y });
          }
          if (dragged.size) {
            // Zones are containers (like Visio's): dragging one moves what sits inside it.
            // Membership is fixed when the drag starts, so a zone doesn't pick up what it passes over.
            const follow = new Map(dragged);
            for (const z of before) {
              const d = z.type === 'zone' ? dragged.get(z.id) : undefined;
              if (!d) continue;
              let members = zoneDrag.get(z.id);
              if (!members) zoneDrag.set(z.id, (members = zoneMembers(z, before).map((m) => m.id)));
              if (d.dx || d.dy) for (const m of members) if (!dragged.has(m) && !follow.has(m)) follow.set(m, d);
            }
            nodes = nodes.map((n) => {
              if (dragged.has(n.id)) return n;
              const t = n.type === 'shape' && n.data.kind === 'callout' ? n.data.target : undefined;
              const d = follow.get(n.id) ?? (t ? follow.get(t) : undefined);
              return d && (d.dx || d.dy) ? { ...n, position: { x: n.position.x + d.dx, y: n.position.y + d.dy } } : n;
            });
          }
          // Removing a device removes its cables too.
          const ids = new Set(nodes.map((n) => n.id));
          const edges = page().edges.filter((e) => ids.has(e.source) && ids.has(e.target));
          const removed = arr.some((c) => c.type === 'remove');
          commit(removed ? { nodes, edges, racks: pruneRacks(cur().racks, allWith(nodes)) } : { nodes, edges });
        },
        onEdgesChange: (changes) => {
          if (changes.toArray().some((c) => c.type === 'remove')) get().snapshot();
          commit({ edges: changes.applyTo(page().edges) });
        },
        onConnect: (c) => {
          if (c.source === c.target && c.sourceHandle === c.targetHandle) return;
          // A device port takes one cable (drawing shapes' sides take any number of lines).
          if (portTaken(page(), c.source, c.sourceHandle) || portTaken(page(), c.target, c.targetHandle)) return;
          get().snapshot();
          // Device-to-device links are network cables; anything touching a drawing shape is a plain arrow line.
          const isDevice = (id: string) => page().nodes.find((n) => n.id === id)?.type === 'device';
          const cable = isDevice(c.source) && isDevice(c.target);
          const edge: CableEdge = {
            ...c,
            id: `e-${uid()}`,
            type: 'cable',
            data: { ...(cable ? { cable: 'Cat6' } : { cable: 'Line', arrows: 'end', route: 'step' }), layer: activeLayer(cur()) },
          } as CableEdge;
          commit({ edges: addEdge(edge, page().edges) });
        },

        reconnectEdge: (id, c) => {
          const pg = page();
          const old = pg.edges.find((e) => e.id === id);
          if (!old) return;
          const others = { ...pg, edges: pg.edges.filter((e) => e.id !== id) };
          if (portTaken(others, c.source, c.sourceHandle) || portTaken(others, c.target, c.targetHandle)) return;
          get().snapshot();
          commit({ edges: pg.edges.map((e) => (e.id === id ? { ...e, source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle } : e)) });
        },
        addStencil: (stencilId, position) => {
          const s = findStencil(stencilId, get().customStencils);
          if (!s) return;
          get().snapshot();
          const count = page().nodes.filter((n) => n.type === 'device' && n.data.stencilId === stencilId).length;
          const node: AppNode = {
            id: `n-${uid()}`,
            type: 'device',
            position,
            data: { stencilId, name: count ? `${s.name} ${count + 1}` : s.name, ...s.defaults, layer: activeLayer(cur()) } as DeviceData,
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        addZone: (position) => {
          get().snapshot();
          const node: AppNode = {
            id: `z-${uid()}`, type: 'zone', position, zIndex: -1,
            style: { width: 420, height: 260 },
            data: { title: 'Server room', color: theme()?.zones[0] ?? '#3b82f6' },
          };
          commit({ nodes: [node, ...page().nodes] });
        },
        addMeasure: (position, variant = 'dimension') => {
          get().snapshot();
          const data = variant === 'wall' ? { dx: 300, dy: 0, variant, thickness: 8 } : { dx: 200, dy: 0 };
          const node: AppNode = { id: `m-${uid()}`, type: 'measure', position, data };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        setDeviceRotation: (id, rotation) =>
          commit({ nodes: page().nodes.map((n) => (n.id === id && n.type === 'device' ? turnDevice(n, rotation, findStencil(n.data.stencilId, get().customStencils)) : n)) }),
        rotateSelection: (delta) => {
          const sel = page().nodes.filter((n) => n.selected && !extras(n).locked && (n.type === 'device' || (n.type === 'shape' && n.data.kind !== 'window' && n.data.kind !== 'callout')));
          if (!sel.length) return;
          get().snapshot();
          const ids = new Set(sel.map((n) => n.id));
          commit({
            nodes: page().nodes.map((n) => {
              if (!ids.has(n.id)) return n;
              const r = ((((n.data as { rotation?: number }).rotation ?? 0) + delta) % 360 + 360) % 360;
              return n.type === 'device' ? turnDevice(n, r, findStencil(n.data.stencilId, get().customStencils)) : ({ ...n, data: { ...n.data, rotation: r } } as AppNode);
            }),
          });
        },
        setNodeBox: (id, position, width, height) =>
          commit({ nodes: page().nodes.map((n) => (n.id === id ? { ...n, position, width, height, style: { ...n.style, width, height } } : n)) }),
        autoConnect: (id, dir) => {
          const pg = page();
          const src = pg.nodes.find((n) => n.id === id);
          if (!src || (src.type !== 'device' && src.type !== 'shape')) return;
          const size = nodeSize(src);
          const w = size.w || 120, h = size.h || 60;
          const gap = 80;
          const pos = {
            x: src.position.x + (dir === 'right' ? w + gap : dir === 'left' ? -(w + gap) : 0),
            y: src.position.y + (dir === 'bottom' ? h + gap : dir === 'top' ? -(h + gap) : 0),
          };
          const opposite = ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[dir];
          get().snapshot();
          let copy: AppNode;
          let sourceHandle: string, targetHandle: string;
          if (src.type === 'device') {
            const st = findStencil(src.data.stencilId, get().customStencils);
            const count = pg.nodes.filter((n) => n.type === 'device' && n.data.stencilId === src.data.stencilId).length;
            copy = {
              id: `n-${uid()}`, type: 'device', position: pos, ...(src.width ? { width: src.width, height: src.height } : {}),
              data: { stencilId: src.data.stencilId, name: `${st?.name ?? 'Device'} ${count + 1}`, ...st?.defaults, layer: src.data.layer, rotation: src.data.rotation },
            } as AppNode;
            // A free port facing the new device, and on the new device the port facing back.
            const used = new Set(pg.edges.flatMap((e) => [e.source === id ? e.sourceHandle : null, e.target === id ? e.targetHandle : null]));
            const ports = st?.ports ?? [];
            const pick = (list: typeof ports, side: string) => (list.find((p) => p.side === side) ?? list[0])?.id;
            sourceHandle = pick(ports.filter((p) => !used.has(p.id)), dir) ?? pick(ports, dir) ?? '';
            targetHandle = pick(ports, opposite) ?? '';
          } else {
            copy = { ...src, id: `s-${uid()}`, position: pos, selected: false, data: { ...src.data, comments: undefined, group: undefined, locked: undefined, target: undefined } } as AppNode;
            sourceHandle = dir;
            targetHandle = opposite;
          }
          const cable = src.type === 'device';
          const edge: CableEdge = {
            id: `e-${uid()}`, type: 'cable', source: id, target: copy.id, sourceHandle, targetHandle,
            data: { ...(cable ? { cable: 'Cat6' } : { cable: 'Line', arrows: 'end', route: 'step' }), layer: activeLayer(cur()) },
          } as CableEdge;
          commit({ nodes: [...pg.nodes.map((n) => ({ ...n, selected: false })), { ...copy, selected: true }], edges: [...pg.edges, edge] });
        },
        addLine: (a, b) => {
          get().snapshot();
          const node: AppNode = {
            id: `m-${uid()}`, type: 'measure', position: a,
            data: { dx: b.x - a.x, dy: b.y - a.y, variant: 'line', thickness: 2, color: theme()?.line ?? '#374151', layer: activeLayer(cur()) },
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        addFreeform: (points) => {
          if (points.length < 2) return;
          get().snapshot();
          const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
          const x = Math.min(...xs), y = Math.min(...ys);
          const width = Math.max(10, Math.max(...xs) - x), height = Math.max(10, Math.max(...ys) - y);
          const node: AppNode = {
            id: `s-${uid()}`, type: 'shape', position: { x, y }, width, height,
            data: {
              kind: 'freeform', text: '', fill: 'transparent', stroke: theme()?.line ?? '#374151', textColor: theme()?.text ?? '#111827', fontSize: 14, rotation: 0,
              points: points.map((p) => [(p.x - x) / width, (p.y - y) / height] as [number, number]), layer: activeLayer(cur()),
            },
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        addComment: (nodeId, text, author) => {
          if (!text.trim()) return;
          get().snapshot();
          const c = { id: `c-${uid()}`, text: text.trim(), author: author || undefined, at: Date.now() };
          commit({ nodes: page().nodes.map((n) => (n.id === nodeId && n.type !== 'backdrop' ? ({ ...n, data: { ...n.data, comments: [...(n.data.comments ?? []), c] } } as AppNode) : n)) });
        },
        replyToComment: (nodeId, commentId, text, author) => {
          if (!text.trim()) return;
          get().snapshot();
          const r = { id: `r-${uid()}`, text: text.trim(), author: author || undefined, at: Date.now() };
          const fix = (n: AppNode): AppNode => {
            if (n.id !== nodeId || n.type === 'backdrop' || !n.data.comments) return n;
            // A reply reopens a resolved thread, as in Visio.
            return { ...n, data: { ...n.data, comments: n.data.comments.map((c) => (c.id === commentId ? { ...c, resolved: undefined, replies: [...(c.replies ?? []), r] } : c)) } } as AppNode;
          };
          commit({ pages: cur().pages.map((pg) => ({ ...pg, nodes: pg.nodes.map(fix) })) });
        },
        updateComment: (nodeId, commentId, patch) => {
          get().snapshot();
          const fix = (n: AppNode): AppNode => {
            if (n.id !== nodeId || n.type === 'backdrop' || !n.data.comments) return n;
            const comments = patch === null ? n.data.comments.filter((c) => c.id !== commentId) : n.data.comments.map((c) => (c.id === commentId ? { ...c, ...patch } : c));
            return { ...n, data: { ...n.data, comments: comments.length ? comments : undefined } } as AppNode;
          };
          commit({ pages: cur().pages.map((pg) => ({ ...pg, nodes: pg.nodes.map(fix) })) });
        },
        moveMeasureEnd: (id, end, point) =>
          commit({
            nodes: page().nodes.map((n) => {
              if (n.id !== id || n.type !== 'measure') return n;
              const b = { x: n.position.x + n.data.dx, y: n.position.y + n.data.dy };
              if (end === 'b') return { ...n, data: { ...n.data, dx: point.x - n.position.x, dy: point.y - n.position.y } };
              return { ...n, position: point, data: { ...n.data, dx: b.x - point.x, dy: b.y - point.y } };
            }),
          }),
        setPageSetup: (setup) => {
          get().snapshot();
          const id = page().id;
          commit({ pages: cur().pages.map((pg) => (pg.id === id ? { ...pg, setup } : pg)) });
        },
        setPageScale: (scale) => {
          get().snapshot();
          const id = page().id;
          commit({ pages: cur().pages.map((pg) => (pg.id === id ? { ...pg, scale: scale ?? undefined } : pg)) });
        },
        addNote: (position) => {
          get().snapshot();
          const node: AppNode = { id: `t-${uid()}`, type: 'note', position, data: { text: 'Note' } };
          commit({ nodes: [...page().nodes, node] });
        },

        addShape: (kind, position) => {
          get().snapshot();
          const size = kind === 'text' ? { width: 180, height: 40 } : kind === 'arrow' ? { width: 140, height: 50 } : kind === 'diamond' ? { width: 140, height: 100 }
            : kind === 'door' ? { width: 80, height: 80 } : kind === 'window' ? { width: 120, height: 14 } : { width: 160, height: 80 };
          const plan = kind === 'door' || kind === 'window';
          const node: AppNode = {
            id: `s-${uid()}`,
            type: 'shape',
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            ...size,
            data: {
              kind,
              text: kind === 'text' ? 'Text' : kind === 'arrow' || plan ? '' : 'Label',
              fill: kind === 'text' || kind === 'door' ? 'transparent' : kind === 'arrow' ? (theme()?.fill ?? '#93c5fd') : (theme()?.fill ?? '#ffffff'),
              stroke: kind === 'text' ? 'transparent' : (theme()?.line ?? '#374151'),
              textColor: theme()?.text ?? '#111827',
              fontSize: kind === 'text' ? 18 : 14,
              rotation: 0,
              layer: activeLayer(cur()),
            },
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        updateNodeData: (id, patch) =>
          commit({ nodes: page().nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AppNode) : n)) }),
        updatePort: (nodeId, portId, patch) =>
          commit({
            nodes: page().nodes.map((n) => {
              if (n.id !== nodeId || n.type !== 'device') return n;
              const ports = { ...(n.data.ports ?? {}) };
              ports[portId] = { ...ports[portId], ...patch };
              return { ...n, data: { ...n.data, ports } };
            }),
          }),
        updateEdgeData: (id, patch) =>
          commit({ edges: page().edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data as CableData), ...patch } } : e)) }),

        updateDevicesData: (ids, patch) => {
          const set = new Set(ids);
          if (!set.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (set.has(n.id) && n.type === 'device' ? { ...n, data: { ...n.data, ...patch } } : n)) });
        },
        mapDevices: (ids, fn) => {
          const set = new Set(ids);
          if (!set.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (set.has(n.id) && n.type === 'device' ? { ...n, data: { ...n.data, ...fn(n.data) } } : n)) });
        },
        mapAllDevices: (fn) => {
          get().snapshot();
          commit({ pages: cur().pages.map((pg) => ({ ...pg, nodes: pg.nodes.map((n) => (n.type === 'device' ? { ...n, data: { ...n.data, ...fn(n.data) } } : n)) })) });
        },
        updateEdgesData: (ids, patch) => {
          const set = new Set(ids);
          if (!set.size) return;
          get().snapshot();
          commit({ edges: page().edges.map((e) => (set.has(e.id) ? { ...e, data: { ...(e.data as CableData), ...patch } } : e)) });
        },

        deleteSelected: () => {
          const pg = page();
          get().snapshot();
          const nodes = pg.nodes.filter((n) => !n.selected || isLocked(n));
          const ids = new Set(nodes.map((n) => n.id));
          commit({ nodes, edges: pg.edges.filter((e) => !e.selected && ids.has(e.source) && ids.has(e.target)), racks: pruneRacks(cur().racks, allWith(nodes)) });
        },

        copySelected: () => {
          const pg = page();
          const nodes = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
          if (!nodes.length) return null;
          const ids = new Set(nodes.map((n) => n.id));
          const clip: Clipboard = {
            format: 'netcraft-clip',
            nodes: structuredClone(nodes),
            edges: structuredClone(pg.edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
          };
          clipboard = { clip, pasted: 0 };
          return clip;
        },
        cutSelected: () => {
          const clip = get().copySelected();
          if (clip) get().deleteSelected();
          return clip;
        },
        paste: (given) => {
          if (given && given !== clipboard?.clip) clipboard = { clip: given, pasted: 0 };
          if (!clipboard) return 0;
          const { clip } = clipboard;
          if (!clip.nodes.length) return 0;
          get().snapshot();
          const step = 40 * ++clipboard.pasted;
          const ids = new Map(clip.nodes.map((n) => [n.id, reId(n.id)]));
          // A pasted group is a new group, independent of the original.
          const groups = new Map<string, string>();
          const newGroup = (g: string) => {
            if (!groups.has(g)) groups.set(g, `g-${uid()}`);
            return groups.get(g)!;
          };
          const nodes = clip.nodes.map((n) => {
            const copy = structuredClone(n);
            const g = extras(n).group;
            const data = g ? { ...copy.data, group: newGroup(g) } : copy.data;
            return { ...copy, id: ids.get(n.id)!, position: { x: n.position.x + step, y: n.position.y + step }, selected: true, data } as AppNode;
          });
          const edges = clip.edges.map((e) => ({ ...structuredClone(e), id: `e-${uid()}`, source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false }));
          commit({
            nodes: [...page().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes],
            edges: [...page().edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...edges],
          });
          return nodes.length;
        },

        alignSelected: (mode) => {
          const pos = alignPositions(movable(page().nodes), mode);
          if (!pos.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) });
        },
        distributeSelected: (axis) => {
          const pos = distributePositions(movable(page().nodes), axis);
          if (!pos.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) });
        },
        groupSelected: () => {
          const sel = page().nodes.filter((n) => n.selected && n.type !== 'backdrop');
          if (sel.length < 2) return;
          get().snapshot();
          const group = `g-${uid()}`;
          commit({ nodes: page().nodes.map((n) => (n.selected && n.type !== 'backdrop' ? ({ ...n, data: { ...n.data, group } } as AppNode) : n)) });
        },
        ungroupSelected: () => {
          if (!page().nodes.some((n) => n.selected && n.type !== 'backdrop' && extras(n).group)) return;
          get().snapshot();
          commit({
            nodes: page().nodes.map((n) => {
              if (!n.selected || n.type === 'backdrop' || !extras(n).group) return n;
              const data = { ...n.data };
              delete (data as { group?: string }).group;
              return { ...n, data } as AppNode;
            }),
          });
        },
        orderSelected: (to) => {
          const pg = page();
          const isSel = (n: AppNode) => !!n.selected && n.type !== 'backdrop';
          if (!pg.nodes.some(isSel)) return;
          get().snapshot();
          const z = orderZ(pg.nodes, to);
          const sel = pg.nodes.filter(isSel).map((n) => ({ ...n, zIndex: z }));
          // Array order breaks ties between equal zIndex values, so move them in the list too.
          const rest = pg.nodes.filter((n) => !isSel(n));
          commit({ nodes: to === 'front' ? [...rest, ...sel] : [...sel, ...rest] });
        },
        setPositions: (positions) => {
          if (!positions.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (positions.has(n.id) && !isLocked(n) ? { ...n, position: positions.get(n.id)! } : n)) });
        },
        copyFormat: () => {
          const pg = page();
          const e = pg.edges.find((x) => x.selected);
          const n = pg.nodes.find((x) => x.selected && x.type !== 'backdrop');
          if (e && !n) {
            const d = (e.data ?? { cable: 'Cat6' }) as CableData;
            formatClip = { kind: 'cable', patch: { cable: d.cable, color: d.color, route: d.route, arrows: d.arrows } };
          } else if (n?.type === 'shape') {
            const d = n.data;
            formatClip = { kind: 'shape', patch: { fill: d.fill, stroke: d.stroke, textColor: d.textColor, fontSize: d.fontSize, dashed: d.dashed, linePattern: d.linePattern, fillTransparency: d.fillTransparency, gradient: d.gradient, lineWidth: d.lineWidth, shadow: d.shadow } };
          } else if (n?.type === 'device') {
            const d = n.data;
            const infoBox = d.infoBox ? { ...d.infoBox, offset: undefined } : undefined;
            formatClip = { kind: 'device', patch: { labelFields: d.labelFields, infoBox, status: d.status } };
          } else return null;
          return formatClip.kind;
        },
        pasteFormat: () => {
          const clip = formatClip;
          if (!clip) return 0;
          const pg = page();
          if (clip.kind === 'cable') {
            const ids = pg.edges.filter((e) => e.selected).map((e) => e.id);
            if (!ids.length) return 0;
            get().snapshot();
            commit({ edges: pg.edges.map((e) => (e.selected ? { ...e, data: { ...(e.data as CableData), ...clip.patch } } : e)) });
            return ids.length;
          }
          const targets = pg.nodes.filter((n) => n.selected && n.type === clip.kind);
          if (!targets.length) return 0;
          get().snapshot();
          commit({
            nodes: pg.nodes.map((n) => {
              if (!n.selected || n.type !== clip.kind) return n;
              // Keep each device's own info-box position.
              const patch = clip.kind === 'device' && n.type === 'device' && clip.patch.infoBox
                ? { ...clip.patch, infoBox: { ...(clip.patch.infoBox as object), offset: n.data.infoBox?.offset } }
                : clip.patch;
              return { ...n, data: { ...n.data, ...patch } } as AppNode;
            }),
          });
          return targets.length;
        },
        formatKind: () => formatClip?.kind ?? null,
        addPicture: (position, src, width, height) => {
          get().snapshot();
          const k = Math.min(1, 360 / Math.max(width, height, 1));
          const w = Math.max(20, Math.round(width * k)), h = Math.max(20, Math.round(height * k));
          const node: AppNode = {
            id: `s-${uid()}`,
            type: 'shape',
            position: { x: Math.round(position.x - w / 2), y: Math.round(position.y - h / 2) },
            width: w,
            height: h,
            selected: true,
            data: { kind: 'image', text: '', src, fill: 'transparent', stroke: 'transparent', textColor: theme()?.text ?? '#111827', fontSize: 14, rotation: 0, valign: 'bottom' },
          } as AppNode;
          const pg = page();
          commit({ nodes: [...pg.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node], edges: pg.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
        },
        moveDrawing: (dx, dy) => {
          if (!dx && !dy) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (n.type === 'backdrop' ? n : { ...n, position: { x: Math.round(n.position.x + dx), y: Math.round(n.position.y + dy) } })) });
        },
        cropPicture: (id, crop) => {
          const n = page().nodes.find((x) => x.id === id);
          if (n?.type !== 'shape' || n.data.kind !== 'image') return;
          const w = n.width ?? n.measured?.width ?? 100, h = n.height ?? n.measured?.height ?? 100;
          const o = n.data.crop ?? { l: 0, t: 0, r: 0, b: 0 };
          const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
          // The whole (uncropped) picture's size on the page, from the current box.
          const fw = w / Math.max(0.05, 1 - o.l - o.r), fh = h / Math.max(0.05, 1 - o.t - o.b);
          const nw = Math.max(10, Math.round(fw * (1 - c.l - c.r))), nh = Math.max(10, Math.round(fh * (1 - c.t - c.b)));
          const position = { x: Math.round(n.position.x + fw * (c.l - o.l)), y: Math.round(n.position.y + fh * (c.t - o.t)) };
          const none = !c.l && !c.t && !c.r && !c.b;
          commit({ nodes: page().nodes.map((x) => (x.id === id && x.type === 'shape' ? { ...x, position, width: nw, height: nh, style: { ...x.style, width: nw, height: nh }, data: { ...x.data, crop: none ? undefined : c } } : x)) });
        },
        selectIds: (ids, add) => {
          const pg = page();
          const want = new Set(ids);
          const nodes = pg.nodes.map((n) => {
            const sel = want.has(n.id) || (!!add && !!n.selected);
            return !!n.selected === sel ? n : { ...n, selected: sel };
          });
          const on = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
          const edges = pg.edges.map((e) => {
            const sel = (on.has(e.source) && on.has(e.target)) || (!!add && !!e.selected);
            return !!e.selected === sel ? e : { ...e, selected: sel };
          });
          commit({ nodes, edges });
        },
        addTable: (position, cells) => {
          get().snapshot();
          const cols = Math.max(1, ...cells.map((r) => r.length));
          const size = { width: Math.max(160, cols * 110), height: Math.max(40, cells.length * 26) };
          const node: AppNode = {
            id: `s-${uid()}`,
            type: 'shape',
            position: { x: Math.round(position.x - size.width / 2), y: Math.round(position.y - size.height / 2) },
            ...size,
            selected: true,
            data: { kind: 'table', text: '', cells, headerRow: true, fill: '#ffffff', stroke: theme()?.line ?? '#374151', textColor: theme()?.text ?? '#111827', fontSize: 12, lineWidth: 1, align: 'left' },
          } as AppNode;
          commit({ nodes: [...page().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node] });
        },
        renameItems: (names) => {
          if (!names.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => {
            const v = names.get(n.id);
            if (v === undefined) return n;
            if (n.type === 'device') return { ...n, data: { ...n.data, name: v } };
            if (n.type === 'shape') return { ...n, data: { ...n.data, text: v } };
            if (n.type === 'zone') return { ...n, data: { ...n.data, title: v } };
            return n;
          }) });
        },
        selectWhere: (what) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected);
          // "Same type as selected": same stencil for devices, same drawing kind for shapes, same node type otherwise.
          const sig = (n: AppNode) => (n.type === 'device' ? `d:${n.data.stencilId}` : n.type === 'shape' ? `s:${n.data.kind}` : n.type);
          const same = new Set(sel.map(sig));
          const layerOf = (x: { data?: Record<string, unknown> }) => x.data?.layer as string | undefined;
          const pickNode = (n: AppNode): boolean => {
            if (n.type === 'backdrop' || n.hidden) return false;
            if (what === 'devices') return n.type === 'device';
            if (what === 'shapes') return n.type === 'shape' || n.type === 'measure' || n.type === 'note';
            if (what === 'text') return (n.type === 'shape' && n.data.kind === 'text') || n.type === 'note';
            if (what === 'zones') return n.type === 'zone';
            if (what === 'same') return same.has(sig(n));
            if (what.startsWith('layer:')) return layerOf(n) === what.slice(6);
            return false;
          };
          const pickEdge = (e: CableEdge) => what === 'cables' || (what.startsWith('layer:') && layerOf(e) === what.slice(6)) || (what === 'same' && pg.edges.some((x) => x.selected) && sel.length === 0);
          const nodes = pg.nodes.map((n) => ({ ...n, selected: pickNode(n) }));
          const edges = pg.edges.map((e) => ({ ...e, selected: pickEdge(e) }));
          commit({ nodes, edges });
          return nodes.filter((n) => n.selected).length + edges.filter((e) => e.selected).length;
        },
        setTipOnSelection: (tip) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected && n.type !== 'backdrop')) return;
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (n.selected && n.type !== 'backdrop' ? ({ ...n, data: { ...n.data, tip: tip.trim() || undefined } } as AppNode) : n)) });
        },
        changeShape: (stencilId) => {
          const pg = page();
          const st = findStencil(stencilId, get().customStencils);
          const sel = pg.nodes.filter((n) => n.selected && n.type === 'device' && !n.data.locked);
          if (!st || !sel.length) return 0;
          get().snapshot();
          const maps = new Map<string, Map<string, string>>();
          const nodes = pg.nodes.map((n) => {
            if (n.type !== 'device' || !sel.includes(n)) return n;
            const old = findStencil(n.data.stencilId, get().customStencils);
            const used = [...new Set([
              ...pg.edges.flatMap((e) => [e.source === n.id ? e.sourceHandle : null, e.target === n.id ? e.targetHandle : null]),
              ...Object.keys(n.data.ports ?? {}),
            ].filter((x): x is string => !!x))];
            const map = mapPorts(old?.ports ?? [], st.ports, used);
            maps.set(n.id, map);
            const ports = Object.fromEntries(Object.entries(n.data.ports ?? {}).flatMap(([k, v]) => (map.has(k) ? [[map.get(k)!, v]] : [])));
            // Same centre, new shape at its own size (a set size or turn would not fit the new picture).
            const old2 = nodeSize(n);
            const bw = st.width * (st.style === 'icon' ? 1 : st.scale), bh = st.height * (st.style === 'icon' ? 1 : st.scale);
            const position = old2.w ? { x: n.position.x + old2.w / 2 - bw / 2, y: n.position.y + old2.h / 2 - bh / 2 } : n.position;
            const { width: _w, height: _h, measured: _m, ...rest } = n;
            void _w; void _h; void _m;
            return { ...rest, position, data: { ...n.data, stencilId, ports: Object.keys(ports).length ? ports : undefined, rotation: undefined } } as AppNode;
          });
          let dropped = 0;
          const edges = pg.edges.flatMap((e) => {
            let out = e;
            for (const end of ['source', 'target'] as const) {
              const map = maps.get(out[end]);
              if (!map) continue;
              const h = end === 'source' ? out.sourceHandle : out.targetHandle;
              const to = h ? map.get(h) : undefined;
              if (h && !to) { dropped++; return []; }
              if (to) out = { ...out, [end === 'source' ? 'sourceHandle' : 'targetHandle']: to };
            }
            return [out];
          });
          commit({ nodes, edges });
          return dropped;
        },
        changeShapeKind: (kind) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected && n.type === 'shape')) return;
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (n.selected && n.type === 'shape' && !n.data.locked ? { ...n, data: { ...n.data, kind } } : n)) });
        },
        nudgeSelection: (dx, dy) => {
          const pg = page();
          const moving = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop' && !extras(n).locked);
          if (!moving.length) return;
          get().snapshot();
          const ids = new Set(moving.map((n) => n.id));
          commit({ nodes: pg.nodes.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) });
        },
        movePageTo: (id, index) => {
          const pages = [...cur().pages];
          const i = pages.findIndex((p) => p.id === id);
          if (i < 0) return;
          const [pg] = pages.splice(i, 1);
          pages.splice(Math.max(0, Math.min(pages.length, index)), 0, pg);
          get().snapshot();
          commit({ pages });
        },
        selectAll: () =>
          commit({
            nodes: page().nodes.map((n) => (n.type === 'backdrop' || n.hidden || n.selected ? n : { ...n, selected: true })),
            edges: page().edges.map((e) => (e.selected ? e : { ...e, selected: true })),
          }),
        addCallout: (position, target) => {
          get().snapshot();
          const node: AppNode = {
            id: `s-${uid()}`, type: 'shape', position, width: 160, height: 56,
            data: { kind: 'callout', text: 'Callout', fill: theme()?.calloutFill ?? '#fffbeb', stroke: theme()?.calloutLine ?? '#d97706', textColor: theme()?.text ?? '#111827', fontSize: 13, rotation: 0, target },
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        styleSelection: ({ fill, line, text, weight, shadow, textColor, format }) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected) && !pg.edges.some((e) => e.selected)) return;
          get().snapshot();
          commit({
            nodes: pg.nodes.map((n) => {
              if (!n.selected) return n;
              if (n.type === 'shape') {
                const { sizeDelta, list, ...fmt } = text ?? {};
                return {
                  ...n,
                  data: {
                    ...n.data, ...(fill !== undefined ? { fill } : {}), ...(line ? { stroke: line } : {}), ...fmt,
                    ...(weight !== undefined ? { lineWidth: weight ?? undefined } : {}), ...(shadow !== undefined ? { shadow: shadow || undefined } : {}),
                    ...(textColor ? { textColor } : {}),
                    ...(format ? { ...format, ...(format.linePattern ? { dashed: undefined } : {}) } : {}),
                    ...(list !== undefined ? { list: list ?? undefined } : {}),
                    ...(sizeDelta ? { fontSize: Math.max(6, Math.min(72, n.data.fontSize + sizeDelta)) } : {}),
                  },
                };
              }
              if (n.type === 'zone' && line) return { ...n, data: { ...n.data, color: line } };
              if (n.type === 'measure' && n.data.variant === 'line' && (weight !== undefined || line || format?.linePattern)) return { ...n, data: { ...n.data, ...(weight ? { thickness: weight } : {}), ...(line ? { color: line } : {}), ...(format?.linePattern ? { linePattern: format.linePattern, dashed: format.linePattern !== 'solid' || undefined } : {}) } };
              return n;
            }),
            edges: line === undefined && weight === undefined ? pg.edges : pg.edges.map((e) => (e.selected ? {
              ...e,
              data: { ...(e.data as CableData), ...(line !== undefined ? { color: line ?? undefined } : {}), ...(weight !== undefined ? { weight: weight ?? undefined } : {}) },
            } : e)),
          });
        },
        setSelectionLocked: (locked) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected && n.type !== 'backdrop')) return;
          get().snapshot();
          commit({
            nodes: pg.nodes.map((n) => (n.selected && n.type !== 'backdrop' ? ({ ...n, ...lockFlags(locked), data: { ...n.data, locked: locked || undefined } } as AppNode) : n)),
          });
        },
        selectItem: (pageId, kind, id) => {
          const p = cur();
          if (!p.pages.some((pg) => pg.id === pageId)) return;
          const pages = p.pages.map((pg) =>
            pg.id !== pageId ? pg : {
              ...pg,
              nodes: pg.nodes.map((n) => {
                const want = kind === 'node' && n.id === id;
                return !!n.selected === want ? n : { ...n, selected: want };
              }),
              edges: pg.edges.map((e) => {
                const want = kind === 'edge' && e.id === id;
                return !!e.selected === want ? e : { ...e, selected: want };
              }),
            });
          commit({ pages, activePageId: pageId });
        },
        replaceInHits: (hits, term, replacement, matchCase) => {
          if (!hits.length || !term) return 0;
          get().snapshot();
          commit({ pages: replaceHits(cur().pages, hits, term, replacement, matchCase) });
          return hits.length;
        },
        updateTitleBlock: (patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, titleBlock: { show: false, ...p.titleBlock, ...patch }, updatedAt: Date.now() } } });
        },
        duplicateSelected: () => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
          if (!sel.length) return;
          get().snapshot();
          // Copies of a group form a new group.
          const groups = new Map<string, string>();
          const regroup = (g?: string) => {
            if (g && !groups.has(g)) groups.set(g, `g-${uid()}`);
            return g ? { group: groups.get(g) } : {};
          };
          const copies = sel.map((n) => ({
            ...n,
            id: reId(n.id),
            position: { x: n.position.x + 40, y: n.position.y + 40 },
            selected: true,
            data: { ...n.data, ...regroup(extras(n).group) },
          })) as AppNode[];
          commit({ nodes: [...pg.nodes.map((n) => ({ ...n, selected: false })), ...copies] });
        },

        applyImport: (plan, defaultStencilId, link) => {
          get().snapshot();
          const custom = get().customStencils;
          const all = [...Object.values(custom), ...STENCILS];
          const pickStencil = (type: string) => {
            const t = type.trim().toLowerCase();
            const hit = t && (all.find((s) => s.name.toLowerCase() === t) ?? all.find((s) => s.name.toLowerCase().includes(t) || t.includes(s.name.toLowerCase())));
            return hit ? hit.id : defaultStencilId;
          };
          const byId = new Map(plan.updates.map((u) => [u.nodeId, u]));
          let pages = cur().pages.map((pg) => ({
            ...pg,
            nodes: pg.nodes.map((n) => {
              const u = byId.get(n.id);
              if (!u || n.type !== 'device') return n;
              const data = { ...n.data };
              for (const c of u.changes) (data as Record<string, unknown>)[c.field] = c.field === 'powerW' ? Number(c.to) : c.to;
              return { ...n, data };
            }),
          }));
          // New devices go on the active page, in a grid below what is already there.
          const active = activePage(cur()).id;
          const pgNodes = pages.find((p) => p.id === active)!.nodes;
          const top = pgNodes.reduce((m, n) => Math.max(m, n.position.y + (n.measured?.height ?? 100)), 0) + (pgNodes.length ? 120 : 0);
          const created: AppNode[] = plan.creates.map((c, i) => {
            const stencilId = pickStencil(c.type);
            const s = findStencil(stencilId, custom);
            return {
              id: `n-${uid()}`,
              type: 'device',
              position: { x: (i % 4) * 320, y: top + Math.floor(i / 4) * 200 },
              data: { ...s?.defaults, ...c.data, stencilId } as DeviceData,
            };
          });
          if (created.length) pages = pages.map((p) => (p.id === active ? { ...p, nodes: [...p.nodes, ...created] } : p));
          commit({ pages });
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, dataLink: link } } });
          return { updated: plan.updates.length, created: created.length };
        },

        addLayer: (name) => {
          const layer: Layer = { id: `l-${uid()}`, name, visible: true };
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: [...(p.layers ?? []), layer], updatedAt: Date.now() } } });
          return layer.id;
        },
        renameLayer: (id, name) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => (l.id === id ? { ...l, name } : l)) } } });
        },
        deleteLayer: (id) => {
          get().snapshot();
          // Items on the deleted layer stay, with no layer.
          const strip = <T extends { data?: Record<string, unknown> }>(x: T): T => (x.data?.layer === id ? { ...x, data: { ...x.data, layer: undefined } } : x);
          const pages = cur().pages.map((pg) => ({ ...pg, nodes: pg.nodes.map((n) => strip(n) as AppNode), edges: pg.edges.map((e) => strip(e) as CableEdge) }));
          commit({ pages });
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).filter((l) => l.id !== id) } } });
        },
        toggleLayer: (id) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) } } });
        },
        updateLayer: (id, patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)), updatedAt: Date.now() } } });
        },
        setActiveLayer: (id) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => ({ ...l, active: l.id === id ? true : undefined })) } } });
        },
        fitZoneToContents: (id) => {
          const pg = page();
          const z = pg.nodes.find((n) => n.id === id && n.type === 'zone');
          if (!z) return;
          const members = zoneMembers(z, pg.nodes);
          if (!members.length) return;
          get().snapshot();
          const pad = 24, title = 28;
          const xs = members.flatMap((m) => [m.position.x, m.position.x + nodeSize(m).w]);
          const ys = members.flatMap((m) => [m.position.y, m.position.y + nodeSize(m).h]);
          const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad - title;
          const width = Math.max(...xs) + pad - x, height = Math.max(...ys) + pad - y;
          commit({ nodes: pg.nodes.map((n) => (n.id === id ? { ...n, position: { x, y }, width, height, style: { ...n.style, width, height } } : n)) });
        },
        assignSelectionToLayer: (layerId) => {
          const pg = page();
          const onLayer = (x: AppNode) => x.selected && (x.type === 'device' || x.type === 'shape');
          const n = pg.nodes.filter(onLayer).length + pg.edges.filter((e) => e.selected).length;
          if (!n) return 0;
          get().snapshot();
          const layer = layerId ?? undefined;
          commit({
            nodes: pg.nodes.map((x) => (onLayer(x) ? ({ ...x, data: { ...x.data, layer } } as AppNode) : x)),
            edges: pg.edges.map((e) => (e.selected ? { ...e, data: { ...(e.data as CableData), layer } } : e)),
          });
          return n;
        },
        applyTheme: (themeId, allPages) => {
          const t = themeById(themeId);
          if (!t) return;
          get().snapshot();
          const active = cur().activePageId;
          const recolor = (nodes: AppNode[]) => {
            let z = 0;
            return nodes.map((n): AppNode => {
              if (n.type === 'zone') return { ...n, data: { ...n.data, color: t.zones[z++ % t.zones.length] } };
              if (n.type !== 'shape') return n;
              const d = n.data;
              if (d.kind === 'callout') return { ...n, data: { ...d, fill: t.calloutFill, stroke: t.calloutLine, textColor: t.text } };
              if (d.kind === 'text') return { ...n, data: { ...d, textColor: t.text } };
              if (d.kind === 'door' || d.kind === 'window') return { ...n, data: { ...d, stroke: t.line } };
              return { ...n, data: { ...d, fill: d.fill === 'transparent' ? d.fill : t.fill, stroke: d.stroke === 'transparent' ? d.stroke : t.line, textColor: t.text } };
            });
          };
          commit({ pages: cur().pages.map((pg) => (allPages || pg.id === active ? { ...pg, nodes: recolor(pg.nodes) } : pg)) });
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, theme: themeId } } });
        },
        setFieldDefs: (defs, renamed) => {
          if (renamed && renamed.from.trim() && renamed.from !== renamed.to) {
            const from = renamed.from.trim().toLowerCase();
            get().mapAllDevices((d) => (d.extraFields?.some((f) => f.label.trim().toLowerCase() === from)
              ? { extraFields: d.extraFields.map((f) => (f.label.trim().toLowerCase() === from ? { ...f, label: renamed.to } : f)) }
              : {}));
          }
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, fieldDefs: defs.length ? defs : undefined, updatedAt: Date.now() } } });
        },
        setHeaderFooter: (hf) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, headerFooter: hf ?? undefined, updatedAt: Date.now() } } });
        },
        saveReports: (reports) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, reports, updatedAt: Date.now() } } });
        },
        setDisplay: (patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, display: { ...DEFAULT_DISPLAY, ...p.display, ...patch } } } });
        },

        setActivePage: (id) => {
          if (cur().pages.some((p) => p.id === id)) commit({ activePageId: id });
        },
        addPage: (name, kind) => {
          get().snapshot();
          const pg = newPage(name, kind);
          commit({ pages: [...cur().pages, pg], activePageId: pg.id });
        },
        renamePage: (id, name) => commit({ pages: cur().pages.map((p) => (p.id === id ? { ...p, name } : p)) }),
        duplicatePage: (id) => {
          const src = cur().pages.find((p) => p.id === id);
          if (!src) return;
          get().snapshot();
          // New ids for everything, so the copy's devices are independent (and not mounted in racks).
          const map = new Map(src.nodes.map((n) => [n.id, reId(n.id)]));
          const pg: Page = {
            ...newPage(`${src.name} (copy)`, src.kind),
            nodes: src.nodes.map((n) => ({ ...n, id: map.get(n.id)!, selected: false, data: { ...n.data } }) as AppNode),
            edges: src.edges.map((e) => ({ ...e, id: `e-${uid()}`, source: map.get(e.source) ?? e.source, target: map.get(e.target) ?? e.target, selected: false })),
          };
          const pages = [...cur().pages];
          pages.splice(pages.findIndex((p) => p.id === id) + 1, 0, pg);
          commit({ pages, activePageId: pg.id });
        },
        deletePage: (id) => {
          const p = cur();
          if (p.pages.length <= 1) return;
          get().snapshot();
          const pages = p.pages.filter((x) => x.id !== id).map((x) => (x.backgroundId === id ? { ...x, backgroundId: undefined } : x));
          const idx = p.pages.findIndex((x) => x.id === id);
          commit({
            pages,
            racks: pruneRacks(p.racks, pages.flatMap((x) => x.nodes)),
            activePageId: p.activePageId === id ? pages[Math.max(0, idx - 1)].id : p.activePageId,
          });
        },
        setPageBackground: (id, background) => {
          get().snapshot();
          commit({
            pages: cur().pages.map((p) => {
              if (p.id === id) return { ...p, background: background || undefined, backgroundId: background ? undefined : p.backgroundId };
              // A page that stops being a background is no longer anyone's background.
              return !background && p.backgroundId === id ? { ...p, backgroundId: undefined } : p;
            }),
          });
        },
        setBackgroundOf: (pageId, backgroundId) => {
          get().snapshot();
          commit({ pages: cur().pages.map((p) => (p.id === pageId && !p.background ? { ...p, backgroundId: backgroundId ?? undefined } : p)) });
        },
        addBackgroundPage: () => {
          get().snapshot();
          const n = cur().pages.filter((p) => p.background).length + 1;
          const bg: Page = { ...newPage(`Background-${n}`, 'network'), background: true };
          commit({ pages: [...cur().pages.map((p) => (p.background || p.backgroundId ? p : { ...p, backgroundId: bg.id })), bg], activePageId: bg.id });
        },
        movePage: (id, dir) => {
          const pages = [...cur().pages];
          const i = pages.findIndex((p) => p.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= pages.length) return;
          [pages[i], pages[j]] = [pages[j], pages[i]];
          commit({ pages });
        },
        setBackdrop: (image, naturalWidth, naturalHeight) => {
          get().snapshot();
          // Fit the long side to ~1600px so a floor plan starts at a workable size.
          const k = 1600 / Math.max(naturalWidth, naturalHeight);
          const old = page().nodes.find((n) => n.type === 'backdrop');
          const node: AppNode = {
            id: old?.id ?? `b-${uid()}`,
            type: 'backdrop',
            position: old?.position ?? { x: 0, y: 0 },
            width: naturalWidth * k,
            height: naturalHeight * k,
            zIndex: -10,
            draggable: false,
            selectable: false,
            data: { image, naturalWidth, naturalHeight, opacity: 0.6, locked: true },
          };
          commit({ nodes: [node, ...page().nodes.filter((n) => n.type !== 'backdrop')] });
        },
        updateBackdrop: (patch) => {
          get().snapshot();
          if (!patch) {
            commit({ nodes: page().nodes.filter((n) => n.type !== 'backdrop') });
            return;
          }
          commit({
            nodes: page().nodes.map((n) => {
              if (n.type !== 'backdrop') return n;
              const data = { ...n.data, ...patch };
              // An unlocked backdrop can be moved and resized; a locked one ignores clicks so you can work on top.
              return { ...n, data, draggable: !data.locked, selectable: !data.locked, selected: n.selected && !data.locked };
            }),
          });
        },

        newProject: (name) => {
          const p = blankProject(name);
          set({ projects: { ...get().projects, [p.id]: p }, currentId: p.id, past: [], future: [] });
        },
        openProject: (id) => {
          const p = get().projects[id];
          if (p) set({ currentId: id, past: [], future: [], activeRackId: p.racks?.[0]?.id ?? null, selectedRackItemId: null });
          if (p) get().autoVersion(id);
        },
        updateProject: (patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, ...patch, updatedAt: Date.now() } } });
        },
        deleteProject: (id) => {
          const rest = { ...get().projects };
          delete rest[id];
          const versions = { ...get().versions };
          delete versions[id];
          set({ versions });
          if (!Object.keys(rest).length) {
            const p = blankProject('New client');
            rest[p.id] = p;
          }
          const currentId = id === get().currentId ? Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt)[0].id : get().currentId;
          set({ projects: rest, currentId, past: [], future: [] });
        },
        importProject: (p, stencils) => {
          if (stencils?.length) get().importStencils(stencils);
          const copy: Project = { ...migrateProject(p), id: uid(), updatedAt: Date.now() };
          set({ projects: { ...get().projects, [copy.id]: copy }, currentId: copy.id, past: [], future: [] });
        },

        view: 'diagram',
        activeRackId: null,
        selectedRackItemId: null,
        setView: (view) => set({ view }),
        setNodeSize: (id, size) => {
          get().snapshot();
          commit({
            nodes: page().nodes.map((n) => {
              if (n.id !== id) return n;
              const { width: _w, height: _h, measured: _m, ...rest } = n;
              void _w; void _h; void _m;
              return (size ? { ...rest, width: size.width, height: size.height } : rest) as AppNode;
            }),
          });
        },
        selectOnlyNode: (id) => {
          // The node may live on another page: switch to it, then select it there.
          const target = cur().pages.find((pg) => pg.nodes.some((n) => n.id === id));
          if (!target) return;
          commit({
            activePageId: target.id,
            pages: cur().pages.map((pg) =>
              pg.id !== target.id ? pg : {
                ...pg,
                nodes: pg.nodes.map((n) => ({ ...n, selected: n.id === id })),
                edges: pg.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
              }),
          });
        },
        selectRack: (id) => set({ activeRackId: id, selectedRackItemId: null }),
        selectRackItem: (id) => set({ selectedRackItemId: id }),

        addRack: (name, units) => {
          get().snapshot();
          const rack: Rack = { id: `r-${uid()}`, name, units, items: [] };
          commit({ racks: [...(cur().racks ?? []), rack] });
          set({ activeRackId: rack.id, selectedRackItemId: null });
          return rack.id;
        },
        updateRack: (id, patch) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === id);
          if (!r) return false;
          // Shrinking a rack must not cut off mounted equipment.
          if (patch.units !== undefined && r.items.some((it) => it.u + it.height - 1 > patch.units!)) return false;
          commit({ racks: racks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
          return true;
        },
        deleteRack: (id) => {
          get().snapshot();
          const racks = (cur().racks ?? []).filter((r) => r.id !== id);
          commit({ racks });
          set({ activeRackId: racks[0]?.id ?? null, selectedRackItemId: null });
        },
        placeRackItem: (rackId, item) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          if (!r || !fits(r, item.u, item.height, item.depth)) return false;
          // A device can only be mounted once across all racks.
          if (item.nodeId && racks.some((x) => x.items.some((it) => it.nodeId === item.nodeId))) return false;
          get().snapshot();
          const full: RackItem = { ...item, id: `ri-${uid()}` };
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, items: [...x.items, full] } : x)) });
          set({ selectedRackItemId: full.id });
          return true;
        },
        updateRackItem: (rackId, itemId, patch) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          const it = r?.items.find((x) => x.id === itemId);
          if (!r || !it) return false;
          const next = { ...it, ...patch };
          const moved = next.u !== it.u || next.height !== it.height || next.depth !== it.depth;
          if (moved && !fits(r, next.u, next.height, next.depth, itemId)) return false;
          if (moved) get().snapshot();
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, items: x.items.map((y) => (y.id === itemId ? next : y)) } : x)) });
          return true;
        },
        removeRackItem: (rackId, itemId) => {
          get().snapshot();
          commit({ racks: (cur().racks ?? []).map((x) => (x.id === rackId ? { ...x, items: x.items.filter((y) => y.id !== itemId) } : x)) });
          set({ selectedRackItemId: null });
        },
        addDeviceToRack: (rackId, stencilId, u) => {
          const s = findStencil(stencilId, get().customStencils);
          const r = (cur().racks ?? []).find((x) => x.id === rackId);
          if (!s || !r) return false;
          const height = s.rackUnits ?? 1;
          const at = u ?? findFreeU(r, height, 'full');
          if (at === null || !fits(r, at, height, 'full')) return false;
          get().snapshot();
          // Put the new device on the diagram below everything else so it doesn't cover existing work.
          const nodes = page().nodes;
          const bottom = nodes.reduce((m, n) => Math.max(m, n.position.y + (n.measured?.height ?? 100)), 0);
          const count = nodes.filter((n) => n.type === 'device' && n.data.stencilId === stencilId).length;
          const node: AppNode = {
            id: `n-${uid()}`,
            type: 'device',
            position: { x: 0, y: nodes.length ? bottom + 80 : 0 },
            data: { stencilId, name: count ? `${s.name} ${count + 1}` : s.name, location: r.name, ...s.defaults } as DeviceData,
          };
          const item: RackItem = { id: `ri-${uid()}`, kind: 'device', nodeId: node.id, u: at, height, depth: 'full' };
          commit({
            nodes: [...nodes, node],
            racks: (cur().racks ?? []).map((x) => (x.id === rackId ? { ...x, items: [...x.items, item] } : x)),
          });
          set({ selectedRackItemId: item.id });
          return true;
        },

        saveCustomStencil: (s) => {
          // Cables plugged into ports that were removed from the stencil have nothing to attach to; drop them.
          const portIds = new Set(s.ports.map((p) => p.id));
          const prunePage = (pg: Page): Page => {
            const users = new Set(pg.nodes.filter((n) => n.type === 'device' && n.data.stencilId === s.id).map((n) => n.id));
            if (!users.size) return pg;
            const dangling = (node: string, handle?: string | null) => users.has(node) && !!handle && !portIds.has(handle);
            const edges = pg.edges.filter((e) => !dangling(e.source, e.sourceHandle) && !dangling(e.target, e.targetHandle));
            return edges.length === pg.edges.length ? pg : { ...pg, edges };
          };
          const projects = Object.fromEntries(Object.entries(get().projects).map(([id, p]) => [id, { ...p, pages: p.pages.map(prunePage) }]));
          const custom = get().customStencils;
          const library = resolveLibrary(libraryOf(s), Object.values(custom).map(libraryOf));
          set({ projects, customStencils: { ...custom, [s.id]: { ...s, library, custom: true, style: 'image' } } });
        },
        deleteCustomStencil: (id) => {
          const rest = { ...get().customStencils };
          delete rest[id];
          set({ customStencils: rest });
        },
        importStencils: (list, library) => {
          const next = { ...get().customStencils };
          const names = new Set(Object.values(next).map(libraryOf));
          let added = 0;
          for (const s of list) {
            if (!s?.id || STENCIL_MAP[s.id] || s.style !== 'image' || !s.image) continue;
            if (!next[s.id]) added++;
            const lib = resolveLibrary(s.library?.trim() || library || DEFAULT_LIBRARY, names);
            names.add(lib);
            next[s.id] = { ...s, library: lib, custom: true };
          }
          set({ customStencils: next });
          return added;
        },
        renameLibrary: (from, to) => {
          const custom = get().customStencils;
          const others = Object.values(custom).map(libraryOf).filter((n) => !sameLibrary(n, from));
          const target = resolveLibrary(to, others);
          set({
            customStencils: Object.fromEntries(
              Object.entries(custom).map(([id, s]) => [id, sameLibrary(libraryOf(s), from) ? { ...s, library: target } : s]),
            ),
          });
        },
        deleteLibrary: (name) => {
          set({ customStencils: Object.fromEntries(Object.entries(get().customStencils).filter(([, s]) => !sameLibrary(libraryOf(s), name))) });
        },
      };
    },
    {
      name: 'netcraft',
      version: 4,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId, customStencils: s.customStencils, templates: s.templates, view: s.view, activeRackId: s.activeRackId }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<DiagramState>;
        if (version < 2) state.customStencils = {};
        // v3: projects hold pages instead of a single diagram.
        if (version < 3 && state.projects) {
          state.projects = Object.fromEntries(Object.entries(state.projects).map(([id, p]) => [id, migrateProject(p)]));
        }
        // v4: custom stencils belong to a library (palette folder); older ones go to "My stencils".
        if (version < 4 && state.customStencils) {
          state.customStencils = Object.fromEntries(
            Object.entries(state.customStencils).map(([id, s]) => [id, { ...s, library: libraryOf(s) }]),
          );
        }
        return state as DiagramState;
      },
    },
  ),
);

export const useCurrentProject = () => useDiagram((s) => s.projects[s.currentId]);

/** The page shown on the canvas. */
export const useCurrentPage = () => useDiagram((s) => activePage(s.projects[s.currentId]));

/** Built-in or custom stencil by id, reactive to library changes. */
export const useStencil = (id: string) => useDiagram((s) => findStencil(id, s.customStencils));

/** Non-reactive lookup for event handlers and exports. */
export const getStencil = (id: string) => findStencil(id, useDiagram.getState().customStencils);

// Save the version list whenever it changes (after it has been loaded, so an empty start never overwrites it).
if (typeof window !== 'undefined') {
  useDiagram.subscribe((s, prev) => {
    if (versionsLoaded && s.versions !== prev.versions) void idbSet(VERSIONS_KEY, s.versions).catch(() => undefined);
  });
}
