'use client';

import { appendEntries, type ChangeEntry } from '@/lib/changeLog';
import { applyScanRows, type ScanRow } from '@/lib/scanImport';
import type { WallMaterial } from '@/lib/wifi';
import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { isPassThrough } from '@/lib/trace';
import { isShelfDevice, mountInto, planRacks, rackUnitsOf } from '@/lib/autoRack';
import { placeOnShelf, shelfWidth } from '@/lib/rackShelf';
import { plugInAll } from '@/lib/powerCords';
import { backIds, backOf, backPortId, withBack } from '@/lib/backView';
import { labelledCables } from '@/lib/labels';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { describe, rackdrawStorage, reportLoadError, useSaveStatus, WORKSPACE_KEY } from '@/lib/persistence';
import { sanitizeProject, sanitizeStencil, sanitizeStencils } from '@/lib/sanitize';
import type { BackupFile } from '@/lib/backup';
import type { ImportPlan } from '@/lib/dataImport';
import { pack, unpack, usedPool } from '@/lib/blobPool';
import { DEFAULT_DISPLAY } from '@/lib/display';
import { DEFAULT_LIBRARY, libraryOf, resolveLibrary, sameLibrary } from '@/lib/libraries';
import { STENCIL_MAP, STENCILS } from '@/lib/stencils';
import { activePage, allDevices, migrateProject, newPage } from '@/lib/project';
import { findFreeU, fits } from '@/lib/rack';
import { alignPositions, distributePositions, isLocked, movable, orderZ, type AlignMode, type DistributeAxis } from '@/lib/arrange';
import { replaceHits, type FindHit } from '@/lib/find';
import { themeById } from '@/lib/themes';
import { projectFromTemplate, templateFromProject, type Template } from '@/lib/templates';
import { guideZoom, snapToGuides, SNAP_PX, useGuides } from '@/lib/guides';
import { getPref } from '@/lib/prefs';
import { PAGE_LINK } from '@/lib/links';
import { isWall, snapIntoWall, wallsAround } from '@/lib/floorplan';
import { intersectAll, subtractAll, unionAll, type Ring } from '@/lib/polybool';
import { normDeg, turnedBox } from '@/lib/rotation';
import { mapPorts } from '@/lib/changeShape';
import type { AppNode, BackdropData, CableData, CableEdge, CordRoute, DataLink, DeviceData, DeviceNode, DisplaySettings, Layer, Page, PageKind, PortData, Project, Rack, RackItem, PageScale, ShapeData, ShapeFormat, ShapeKind, ShapeNode, StencilDef, TextFormat, TextLook, TitleBlock } from '@/lib/types';


interface Snapshot {
  pages: Page[];
  racks: Rack[];
  activePageId: string;
  /** The client's layers (deleting a layer is undone with its items' layer ids). */
  layers?: Layer[];
}

/** What a change may touch: the active page's nodes/edges, or project-level pages/racks. */
/** A copied callout points at the copy of its item when that item was copied too. */
function retarget<D>(data: D, ids: Map<string, string>): D {
  const t = (data as { target?: unknown }).target;
  return typeof t === 'string' && ids.has(t) ? { ...data, target: ids.get(t) } : data;
}

type Patch = Partial<{ nodes: AppNode[]; edges: CableEdge[]; racks: Rack[]; pages: Page[]; activePageId: string; layers: Layer[] }>;

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
  /**
   * Splits a cable at an item dropped on it (Visio): A→B becomes A→item→B, keeping the cable's type, colour and VLAN.
   * No undo step of its own (the drag that dropped the item took one).
   */
  splitCable: (edgeId: string, nodeId: string, inHandle: string, outHandle: string) => void;
  /** Reverse Ends (Visio): swaps the ends of the given cables (and their arrows). */
  reverseCables: (ids: string[]) => void;
  /** Snaps a door or window into the wall it was dropped near (no undo step: the drag or drop took one). */
  snapDoorWindow: (id: string) => boolean;
  /** Show (or hide) the real length of the selected walls, or of every wall on the page when none is selected. */
  setWallLengths: (on: boolean) => number;
  /** Convert to Walls (Visio): walls round the selected zones and rectangles; rectangles are replaced, zones kept. */
  convertToWalls: (thickness?: number) => number;
  /** Shape operations (Visio): Union / Combine / Intersect / Subtract the selected drawing shapes into one. */
  shapeOperation: (op: 'union' | 'combine' | 'intersect' | 'subtract') => number;
  /** Insert a zone round the selection (Visio's container from selection), with room for its title. Returns its id. */
  wrapInZone: (title?: string) => string | null;
  /** Space Shapes (Visio): puts exactly `gap` px between neighbouring selected items, left to right or top to bottom. */
  spaceSelected: (axis: 'h' | 'v', gap: number) => void;
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
  /** Wi-Fi Plan: settings of the active page (show the coverage map, people on the floor). */
  setPageWifi: (patch: NonNullable<Page['wifi']>) => void;
  /** Wi-Fi Plan: what these walls are made of (one undo step). */
  setWallMaterial: (ids: string[], material: WallMaterial) => void;
  /** Wi-Fi Plan: adds access points (Planned) centred on these points of the active page (one undo step). */
  placeAccessPoints: (points: { x: number; y: number }[]) => number;
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
  /** Data → Labels: gives every physical cable without a label the number it prints with (C-001…). */
  numberCables: (pageId?: string) => void;
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
  /** Bring Forward / Send Backward: one step past the next overlapping item. */
  orderStep: (dir: 'forward' | 'backward') => void;
  /** Protection for the selection (text lock, can't be selected). */
  setProtection: (patch: { lockText?: boolean; noSelect?: boolean }) => void;
  /** Makes every item on the page selectable again. Returns how many were protected. */
  allowSelectAll: () => number;
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
  /**
   * Off-page Reference (Visio): a pair of arrow shapes, one here and one on the target page (or a new page called
   * `newName`), each linking to the other's page. Returns the new shape's id.
   */
  addOffPageRef: (position: { x: number; y: number }, target: { pageId: string } | { newName: string }) => string | null;
  /** Flip Horizontal / Vertical (Visio): mirrors the selection as a group about its centre. */
  flipSelection: (axis: 'h' | 'v') => void;
  /** Same Width / Height / Size: makes the selected items match the largest (or smallest) of them. */
  sameSize: (what: 'width' | 'height' | 'both', like: 'largest' | 'smallest') => void;
  /** Center Drawing: moves everything on the active page (locked items too) by dx, dy in one undo step. */
  moveDrawing: (dx: number, dy: number) => void;
  /** Picture → Crop: sets how much of each side is cut off; the box shrinks or grows so the picture keeps its scale. */
  cropPicture: (id: string, crop: { l: number; t: number; r: number; b: number } | null) => void;
  /** Lasso Select: selects these items (and the cables between selected items); `add` keeps the current selection. */
  selectIds: (ids: string[], add?: boolean) => void;
  /** Selects exactly these items and cables on the active page (a traced cable path). */
  selectPath: (nodeIds: string[], edgeIds: string[]) => void;
  /** Adds a table (Insert → Table) centred on `position`. */
  addTable: (position: { x: number; y: number }, cells: string[][]) => void;
  /** Renames items on the active page in one undo step: devices get a new name, drawing shapes new text. */
  renameItems: (names: Map<string, string>) => void;
  selectWhere: (what: 'devices' | 'cables' | 'shapes' | 'text' | 'zones' | 'same' | `layer:${string}`) => number;
  /** Sets (or clears) the ScreenTip of the selected items. */
  setTipOnSelection: (tip: string) => void;
  /** Alt Text for the selected items (empty removes it). */
  setAltOnSelection: (alt: string) => void;
  /**
   * Fill / line colour for the selection (ribbon Shape Style): shapes get fill and border, cables and zones the line
   * colour. `line: null` puts cables back to automatic colouring.
   */
  styleSelection: (style: { fill?: string; line?: string | null; text?: TextFormat; weight?: number | null; shadow?: boolean; textColor?: string | null; format?: ShapeFormat }) => void;
  /** Adds a callout; with `target` its leader line points at that item and it moves with it. */
  addCallout: (position: { x: number; y: number }, target?: string) => void;
  /** Moves nodes on the active page to new positions (one undo step). */
  setPositions: (positions: Map<string, { x: number; y: number }>) => void;
  /** Remembers the formatting of the selected cable, shape or device; returns what kind was copied. */
  copyFormat: () => FormatKind | null;
  /** Applies the copied formatting to selected items of the same kind; returns how many changed. */
  pasteFormat: () => number;
  /** What `copyFormat` holds, for menus. */
  formatKind: () => FormatKind | null;
  /** Shows a page and selects one node or cable on it (used by Find). */
  selectItem: (pageId: string, kind: 'node' | 'edge', id: string) => void;
  /** Changes one device on any page of the client (Device Table), one undo step. */
  updateDeviceOnPage: (pageId: string, id: string, patch: Partial<DeviceData>) => void;
  /** Changes devices and cables on any pages of the client in one undo step (Device Table edits and pastes). */
  editItems: (edits: ItemEdit[]) => void;
  /** Replaces `term` in the given Find hits (undoable). Returns how many fields changed. */
  replaceInHits: (hits: FindHit[], term: string, replacement: string, matchCase: boolean) => number;
  updateTitleBlock: (patch: Partial<TitleBlock>) => void;
  /** Adds change-log entries to a client (not an undo step). */
  appendChangeLog: (projectId: string, entries: ChangeEntry[]) => void;
  /** Review → Change Log: a note of the user's own (ticket number, site visit…). */
  addChangeNote: (text: string) => void;
  clearChangeLog: () => void;

  // projects
  newProject: (name: string) => void;
  openProject: (id: string) => void;
  updateProject: (patch: Partial<Pick<Project, 'name' | 'site' | 'address' | 'contact' | 'notes' | 'quote' | 'vlans'>>) => void;
  deleteProject: (id: string) => void;
  /** File → Restore from backup: adds the backup's clients (same id → a copy), stencils, templates and versions. */
  restoreBackup: (b: BackupFile) => { clients: number; copies: number; stencils: number; templates: number };
  importProject: (p: Project, stencils?: StencilDef[]) => void;

  /**
   * Applies a spreadsheet import: updates matched devices on any page and creates new ones on the active page
   * (stencil picked from the row's Type when it names one, else `defaultStencilId`). Returns counts.
   */
  applyImport: (plan: ImportPlan, defaultStencilId: string, link: DataLink) => { updated: number; created: number };
  /** Data → Import Network Scan: adds the new hosts and updates the matched devices (one undo step). */
  applyScan: (rows: ScanRow[], target: 'new-page' | 'active-page', pageName: string) => { updated: number; created: number };

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
  /** Select Contents (Visio): selects what a zone holds. */
  selectZoneContents: (id: string) => void;
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
  /**
   * Puts a floor plan / photo behind the active page (replacing any existing one), fitted to ~1600 px or at
   * `size` (e.g. a PDF at its printed size, so a printed drawing scale applies).
   */
  setBackdrop: (image: string, naturalWidth: number, naturalHeight: number, size?: { width: number; height: number }) => void;
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
  /**
   * Build rack from diagram: mounts the active page's rack-mountable devices (not already in a rack) in a new rack,
   * firewall at the top, panels above their switches, servers, UPS at the bottom. Returns how many were mounted.
   */
  /** Mounts the page's unmounted rack equipment: in new racks, or into the rack `into` (grown if needed). */
  buildRackFromDiagram: (name?: string, into?: string) => number;
  updateRack: (id: string, patch: Partial<Pick<Rack, 'name' | 'units' | 'location' | 'notes' | 'feedVolts' | 'feedAmps' | 'redundantFeeds' | 'power'>>) => boolean;
  deleteRack: (id: string) => void;
  /** Places an item if it fits; returns false otherwise. */
  placeRackItem: (rackId: string, item: Omit<RackItem, 'id'>) => boolean;
  /** Moves/resizes an item if the new spot fits; returns false otherwise. */
  updateRackItem: (rackId: string, itemId: string, patch: Partial<Omit<RackItem, 'id'>>) => boolean;
  removeRackItem: (rackId: string, itemId: string) => void;
  /** Creates a new diagram device from a stencil and mounts it at `u` (or the first free slot). */
  addDeviceToRack: (rackId: string, stencilId: string, u?: number) => boolean;
  /**
   * Stands a small device on a shelf: the shelf at `u` (or a new one there), or anywhere with room. Moves it when it
   * is already in this rack (on a shelf or mounted).
   */
  putOnShelf: (rackId: string, nodeId: string, u?: number) => boolean;
  /** Plugs a rack item's inlet into an outlet of a PDU / UPS (replacing what was there), or unplugs it (`to` null). */
  setPowerCord: (rackId: string, from: string, inlet: string, to: { item: string; outlet: number } | null) => void;
  /**
   * Re-plugs one end of a cable (dragged in the rack view): the end at `from` moves to `to`. A cable already on `to`
   * (where a port takes one) swaps over to `from`. The diagram's cable is the same cable, so it follows.
   */
  replugCable: (edgeId: string, from: { nodeId: string; port?: string }, to: { nodeId: string; port: string }) => boolean;
  /** A cable's or power cord's dressing in its rack (undefined = worked out). */
  setCableRackRoute: (edgeId: string, route: CordRoute | undefined) => void;
  setPowerCordRoute: (rackId: string, cordId: string, route: CordRoute | undefined) => void;
  /** Moves one end of a power cord to another inlet (`from`) or outlet (`to`); a cord already there swaps. */
  movePowerCordEnd: (rackId: string, cordId: string, end: 'from' | 'to', target: { item: string; slot: string | number }) => boolean;
  /** Plugs in every power supply and PDU in the rack not plugged in yet (all = unplug everything first). */
  plugInRack: (rackId: string, fresh?: boolean) => void;
  /**
   * A device placed as a shape's back view (e.g. "R760 - Rear" next to "R760 - Front"): folded into the front device
   * on its page, its cables moved to the front device's back ports, then removed. Returns the front device's id.
   */
  combineWithFront: (nodeId: string) => string | null;
  /** Takes a small device off its shelf and mounts it with its rack-mount kit, in the highest free unit. */
  mountWithKit: (rackId: string, nodeId: string) => boolean;
  /** Shows or hides, on the diagram, every patch panel mounted in a rack (Show on: Rack only). */
  setRackedPanelsShown: (show: boolean) => void;

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
  const s = STENCIL_MAP[id] ?? custom[id];
  // A shape with a back view: one device with both pictures and the ports of both sides.
  const back = s?.custom ? backOf(s, custom) : undefined;
  return back ? withBack(s!, back) : s;
}

/** The shape as stored (no back view merged in): for saving, editing and files. */
export function storedStencil(id: string, custom: Record<string, StencilDef>): StencilDef | undefined {
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

/** Copied diagram items. Also put on the system clipboard, so it can be pasted into another RackDraw window. */
export interface Clipboard {
  format: 'netcraft-clip';
  nodes: AppNode[];
  edges: CableEdge[];
}
export const CLIP_MIME = 'application/x-netcraft-clip';

/** Formatting copied with Copy format (format painter). */
type FormatKind = 'cable' | 'shape' | 'device' | 'zone' | 'note';
/** Format Painter: the copied item's own format (for items of its kind) and its text look (for any item with text). */
let formatClip: { kind: FormatKind; patch: Record<string, unknown>; look: TextLook } | null = null;

const LOOK_KEYS = ['fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'textColor'] as const;
const lookOf = (d: Record<string, unknown>): TextLook => Object.fromEntries(LOOK_KEYS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) as TextLook;

/**
 * Smart Duplicate (Visio): the copies made by the last Ctrl+D and where their originals were. If those copies are
 * duplicated again, the new ones keep the same spacing (including any move made in between).
 */
let lastDuplicate: Map<string, { x: number; y: number }> | null = null;

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
  const n = pg.nodes.find((x) => x.id === nodeId);
  if (!handle || n?.type !== 'device') return false;
  const used = pg.edges.filter((e) => (e.source === nodeId && e.sourceHandle === handle) || (e.target === nodeId && e.targetHandle === handle)).length;
  // A patch panel port takes two cables: the patch cord on its front and the run on its back.
  return used >= (isPassThrough(n, getStencil(n.data.stencilId)) ? 2 : 1);
}

/** Usual text size (px) of each kind of item, for A+ / A− on items that have none set. */
export const TEXT_DEFAULT_SIZE = { device: 11, zone: 12, note: 12, cable: 10 } as const;

/** The font part of a Home → Font change, for items with a TextLook (device, zone, note, cable). */
function lookPatch(t: TextFormat, current: number): TextLook {
  const out: TextLook = {};
  if ('fontFamily' in t) out.fontFamily = t.fontFamily || undefined;
  if (t.fontSize) out.fontSize = t.fontSize;
  if (t.sizeDelta) out.fontSize = Math.max(6, Math.min(72, current + t.sizeDelta));
  for (const k of ['bold', 'italic', 'underline', 'strike'] as const) if (t[k] !== undefined) out[k] = t[k] || undefined;
  return out;
}

/** Drawing shapes that Shape Operations can work on (closed outlines). */
const OPERABLE = new Set<ShapeKind>(['rect', 'rounded', 'ellipse', 'diamond', 'arrow', 'callout', 'freeform', 'offpage']);

/** A drawing shape's outline(s) on the page, turned with the shape. */
function shapeRings(n: ShapeNode): Ring[] {
  const d = n.data;
  const m = nodeSize(n);
  const w = n.width ?? m.w, h = n.height ?? m.h, x = n.position.x, y = n.position.y;
  const local: [number, number][][] = (() => {
    switch (d.kind) {
      case 'ellipse': return [Array.from({ length: 64 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return [0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)] as [number, number]; })];
      case 'diamond': return [[[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]];
      case 'arrow': { const hd = Math.min(w * 0.4, h) / w; return [[[0, 0.28], [1 - hd, 0.28], [1 - hd, 0], [1, 0.5], [1 - hd, 1], [1 - hd, 0.72], [0, 0.72]]]; }
      case 'offpage': { const tip = Math.min(h / 2, w / 3) / w; return [[[0, 0], [1 - tip, 0], [1, 0.5], [1 - tip, 1], [0, 1]]]; }
      case 'rounded': {
        // Quarter circles at the corners, as drawn.
        const r = Math.min(16, h / 3), rx = r / w, ry = r / h, out: [number, number][] = [];
        const corner = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 6; k++) { const t = a0 + (k / 6) * (Math.PI / 2); out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } };
        corner(1 - rx, 1 - ry, 0); corner(rx, 1 - ry, Math.PI / 2); corner(rx, ry, Math.PI); corner(1 - rx, ry, (3 * Math.PI) / 2);
        return [out];
      }
      case 'freeform': return d.rings?.length ? d.rings : [d.points ?? []];
      default: return [[[0, 0], [1, 0], [1, 1], [0, 1]]];
    }
  })();
  const rot = ((d.rotation ?? 0) * Math.PI) / 180, c = Math.cos(rot), sn = Math.sin(rot);
  return local.filter((r) => r.length >= 3).map((r) => r.map(([px, py]) => {
    const lx = (px - 0.5) * w, ly = (py - 0.5) * h;
    return { x: x + w / 2 + lx * c - ly * sn, y: y + h / 2 + lx * sn + ly * c };
  }));
}

/** One change from the Device Table: a device (node) or cable (edge) on a page, and the data it gets. */
export interface ItemEdit { pageId: string; kind: 'node' | 'edge'; id: string; patch: Record<string, unknown> }

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
/**
 * Pictures and other big strings in saved versions, each kept once (versions refer to them by key): twenty versions
 * of a drawing full of pictures cost about one copy of the pictures.
 */
let versionPool: Record<string, string> = {};
/** What is stored under VERSIONS_KEY (older releases stored the version lists alone). */
export interface StoredVersions { format: 2; versions: Record<string, ProjectVersion[]>; pool: Record<string, string> }

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
            [p.id]: { ...p, pages, racks: patch.racks ?? p.racks, activePageId: patch.activePageId ?? p.activePageId, ...(patch.layers ? { layers: patch.layers } : {}), updatedAt: Date.now() },
          },
        });
      };
      const snap = (): Snapshot => {
        const p = cur();
        return { pages: p.pages, racks: p.racks ?? [], activePageId: p.activePageId, layers: p.layers ?? [] };
      };
      /**
       * Items the user can act on: not on a hidden or locked layer. Select All, Delete, nudging and the Arrange
       * commands must never reach equipment the user can't see or has locked.
       */
      const reachable = () => {
        const blocked = new Set((cur().layers ?? []).filter((l) => !l.visible || l.locked).map((l) => l.id));
        // Rack-only devices (and their cables) aren't on the diagram: Select All / Delete there must not reach them.
        const rackOnly = new Set(cur().pages.flatMap((pg) => pg.nodes).filter((n) => n.type === 'device' && n.data.showOn === 'rack').map((n) => n.id));
        return (x: { source?: string; target?: string; data?: Record<string, unknown> }) =>
          !(typeof x.data?.layer === 'string' && blocked.has(x.data.layer)) && x.data?.showOn !== 'rack'
          && !(x.source !== undefined && (rackOnly.has(x.source) || rackOnly.has(x.target ?? '')));
      };
      /** Selected items on layers that were just hidden or locked are deselected. */
      const deselectBlocked = () => {
        const ok = reachable();
        const p = cur();
        const pages = p.pages.map((pg) => ({
          ...pg,
          nodes: pg.nodes.map((n) => (n.selected && !ok(n) ? { ...n, selected: false } : n)),
          edges: pg.edges.map((e) => (e.selected && !ok(e) ? { ...e, selected: false } : e)),
        }));
        set({ projects: { ...get().projects, [p.id]: { ...p, pages } } });
      };
      /**
       * React Flow deletes a device as two changes (its cables, then the device): one undo step for both.
       * A second "remove" snapshot in the same tick is skipped.
       */
      let removing = false;
      const snapshotRemoveOnce = () => {
        if (removing) return;
        removing = true;
        queueMicrotask(() => { removing = false; });
        get().snapshot();
      };
      /**
       * Adds stencils from a file or library. One with the id of a stencil you already have is skipped when it is the
       * same picture and ports, and comes in under a new id when it differs (a file must never replace your own).
       */
      const addStencils = (list: StencilDef[], library?: string) => {
        const next = { ...get().customStencils };
        const names = new Set(Object.values(next).map(libraryOf));
        const renamed = new Map<string, string>();
        const same = (a: StencilDef, b: StencilDef) => a.image === b.image && a.name === b.name && JSON.stringify(a.ports ?? []) === JSON.stringify(b.ports ?? []);
        let added = 0;
        for (const raw of sanitizeStencils(list)) {
          if (STENCIL_MAP[raw.id]) continue;
          let s = raw;
          const mine = next[s.id];
          if (mine && same(mine, s)) continue;
          if (mine) {
            const id = `custom-${uid()}`;
            renamed.set(s.id, id);
            s = { ...s, id };
          }
          added++;
          const lib = resolveLibrary(s.library?.trim() || library || DEFAULT_LIBRARY, names);
          names.add(lib);
          next[s.id] = { ...s, library: lib, custom: true };
        }
        set({ customStencils: next });
        return { added, renamed };
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
          const v: ProjectVersion = { id: `v-${uid()}`, name: name?.trim() || 'Version', at: Date.now(), auto: auto || undefined, project: pack(p, versionPool) };
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
          const restored: Project = { ...unpack(v.project, versionPool), id: p.id, updatedAt: Date.now() };
          set({ projects: { ...get().projects, [p.id]: restored }, past: [], future: [], activeRackId: restored.racks?.[0]?.id ?? null, selectedRackItemId: null });
        },
        versionAsCopy: (versionId) => {
          const v = (get().versions[cur().id] ?? []).find((x) => x.id === versionId);
          if (!v) return;
          const copy: Project = { ...unpack(v.project, versionPool), id: uid(), name: `${v.project.name} (${v.name})`, createdAt: Date.now(), updatedAt: Date.now() };
          set({ projects: { ...get().projects, [copy.id]: copy }, currentId: copy.id, past: [], future: [] });
        },
        loadVersions: async () => {
          if (versionsLoaded) return;
          let stored: StoredVersions | Record<string, ProjectVersion[]> | undefined;
          try {
            stored = await idbGet<StoredVersions | Record<string, ProjectVersion[]>>(VERSIONS_KEY);
          } catch (e) {
            // Never treat "couldn't read" as "none": versions are not written (so nothing is overwritten) and the user is told.
            useSaveStatus.setState({ versionsError: `Version History couldn't be read (${describe(e)}). Your clients are fine; new versions are not kept until RackDraw is restarted.` });
            return;
          }
          let saved: Record<string, ProjectVersion[]> | undefined;
          if (stored && (stored as StoredVersions).format === 2) {
            versionPool = { ...(stored as StoredVersions).pool, ...versionPool };
            saved = (stored as StoredVersions).versions;
          } else if (stored) {
            // Versions saved by older releases hold whole copies: move their pictures into the shared pool.
            saved = {};
            for (const [k, list] of Object.entries(stored as Record<string, ProjectVersion[]>)) saved[k] = list.map((v) => ({ ...v, project: pack(v.project, versionPool) }));
          }
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
          if (arr.some((c) => c.type === 'remove')) snapshotRemoveOnce();
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
          if (changes.toArray().some((c) => c.type === 'remove')) snapshotRemoveOnce();
          commit({ edges: changes.applyTo(page().edges) });
        },
        onConnect: (c) => {
          if (c.source === c.target && c.sourceHandle === c.targetHandle) return;
          // A device port takes one cable, a patch panel port two (drawing shapes' sides take any number of lines).
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
        splitCable: (edgeId, nodeId, inHandle, outHandle) => {
          const pg = page();
          const e = pg.edges.find((x) => x.id === edgeId);
          if (!e) return;
          const d = (e.data ?? { cable: 'Cat6' }) as CableData;
          // The label, length and label position stay with the first half.
          const rest: CableData = { ...d, label: undefined, length: undefined, labelAt: undefined, showLength: undefined };
          const a: CableEdge = { ...e, id: `e-${uid()}`, target: nodeId, targetHandle: inHandle, selected: false, data: d };
          const b: CableEdge = { ...e, id: `e-${uid()}`, source: nodeId, sourceHandle: outHandle, selected: false, data: rest };
          commit({ edges: [...pg.edges.filter((x) => x.id !== edgeId), a, b] });
        },
        reverseCables: (ids) => {
          const set = new Set(ids);
          if (!set.size) return;
          get().snapshot();
          const flip = { start: 'end', end: 'start' } as const;
          commit({ edges: page().edges.map((e) => {
            if (!set.has(e.id)) return e;
            const d = (e.data ?? { cable: 'Cat6' }) as CableData;
            const arrows = d.arrows === 'start' || d.arrows === 'end' ? flip[d.arrows] : d.arrows;
            return { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle, data: { ...d, arrows, labelAt: d.labelAt !== undefined ? 1 - d.labelAt : undefined } };
          }) });
        },
        snapDoorWindow: (id) => {
          const pg = page();
          const n = pg.nodes.find((x) => x.id === id);
          if (n?.type !== 'shape' || (n.data.kind !== 'door' && n.data.kind !== 'window') || n.data.locked) return false;
          const m = nodeSize(n);
          const hit = snapIntoWall(n.data.kind, { x: n.position.x, y: n.position.y, w: n.width ?? m.w, h: n.height ?? m.h }, pg.nodes.filter(isWall));
          if (!hit) {
            // Moved off its wall: no doorway to cut any more.
            if (n.data.wallGap) commit({ nodes: pg.nodes.map((x) => (x.id === id && x.type === 'shape' ? { ...x, data: { ...x.data, wallGap: undefined } } : x)) });
            return false;
          }
          const { box, rotation } = hit;
          const gap = n.data.kind === 'door' ? hit.thickness : undefined;
          commit({ nodes: pg.nodes.map((x) => (x.id === id && x.type === 'shape' ? { ...x, position: { x: box.x, y: box.y }, width: box.w, height: box.h, style: { ...x.style, width: box.w, height: box.h }, data: { ...x.data, rotation, wallGap: gap } } : x)) });
          return true;
        },
        setWallLengths: (on) => {
          const pg = page();
          const walls = pg.nodes.filter(isWall);
          const pick = walls.some((w) => w.selected) ? walls.filter((w) => w.selected) : walls;
          if (!pick.length) return 0;
          const ids = new Set(pick.map((w) => w.id));
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (ids.has(n.id) && n.type === 'measure' ? { ...n, data: { ...n.data, showLength: on || undefined } } : n)) });
          return pick.length;
        },
        convertToWalls: (thickness = 8) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && !extras(n).locked && (n.type === 'zone' || (n.type === 'shape' && (n.data.kind === 'rect' || n.data.kind === 'rounded'))));
          if (!sel.length) return 0;
          get().snapshot();
          const walls: AppNode[] = sel.flatMap((n) => {
            const m = nodeSize(n);
            return wallsAround({ x: n.position.x, y: n.position.y, w: n.width ?? m.w, h: n.height ?? m.h }).map((w) => ({
              id: `m-${uid()}`, type: 'measure', position: { x: Math.round(w.x), y: Math.round(w.y) },
              data: { dx: Math.round(w.dx), dy: Math.round(w.dy), variant: 'wall', thickness, layer: activeLayer(cur()) },
            }) as AppNode);
          });
          const gone = new Set(sel.filter((n) => n.type === 'shape').map((n) => n.id));
          commit({
            nodes: [...pg.nodes.filter((n) => !gone.has(n.id)).map((n) => (n.selected ? { ...n, selected: false } : n)), ...walls],
            edges: pg.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
          });
          return sel.length;
        },
        shapeOperation: (op) => {
          const pg = page();
          // In selection order on the page; the first one gives the result its look (and is what Subtract cuts from).
          const sel = pg.nodes.filter((n): n is ShapeNode => !!n.selected && n.type === 'shape' && !n.data.locked && OPERABLE.has(n.data.kind));
          if (sel.length < 2) return 0;
          const ringsOf = sel.map((n) => shapeRings(n));
          const all = ringsOf.flat();
          const result = op === 'union' ? unionAll(all)
            : op === 'combine' ? all
            : op === 'intersect' ? intersectAll(ringsOf.map((r) => r[0]))
            : subtractAll(ringsOf.map((r) => r[0]));
          if (!result.length) return -1;
          const pts = result.flat();
          const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
          const w = Math.max(1, Math.max(...pts.map((p) => p.x)) - x0), h = Math.max(1, Math.max(...pts.map((p) => p.y)) - y0);
          const f = sel[0].data;
          get().snapshot();
          const node: AppNode = {
            id: `s-${uid()}`, type: 'shape', position: { x: Math.round(x0), y: Math.round(y0) }, width: Math.round(w), height: Math.round(h), selected: true, zIndex: sel[0].zIndex,
            data: {
              kind: 'freeform', text: '', fill: f.fill === 'transparent' ? '#e5e7eb' : f.fill, stroke: f.stroke === 'transparent' ? '#374151' : f.stroke, textColor: f.textColor, fontSize: f.fontSize,
              lineWidth: f.lineWidth, dashed: f.dashed, linePattern: f.linePattern, fillTransparency: f.fillTransparency, shadow: f.shadow, layer: f.layer, rotation: 0,
              rings: result.map((r) => r.map((p) => [(p.x - x0) / w, (p.y - y0) / h] as [number, number])),
            },
          } as AppNode;
          const gone = new Set(sel.map((n) => n.id));
          commit({
            nodes: [...pg.nodes.filter((n) => !gone.has(n.id)).map((n) => (n.selected ? { ...n, selected: false } : n)), node],
            edges: pg.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
          });
          return 1;
        },
        wrapInZone: (title) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
          if (!sel.length) return null;
          const pts = sel.flatMap((n) => {
            if (n.type === 'measure') return [n.position, { x: n.position.x + n.data.dx, y: n.position.y + n.data.dy }];
            const m = nodeSize(n);
            return [n.position, { x: n.position.x + m.w, y: n.position.y + m.h }];
          });
          const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
          const x1 = Math.max(...pts.map((p) => p.x)), y1 = Math.max(...pts.map((p) => p.y));
          // Room round the items, more at the top for the zone's title (and below for device labels).
          const m = 24, top = 36, bottom = 36;
          get().snapshot();
          const id = `z-${uid()}`;
          const z = Math.min(-1, ...sel.map((n) => (n.zIndex ?? 0) - 1));
          const node: AppNode = {
            id, type: 'zone', position: { x: Math.round(x0 - m), y: Math.round(y0 - top) }, zIndex: z, selected: true,
            width: Math.round(x1 - x0 + m * 2), height: Math.round(y1 - y0 + top + bottom),
            style: { width: Math.round(x1 - x0 + m * 2), height: Math.round(y1 - y0 + top + bottom) },
            data: { title: title?.trim() || 'Zone', color: theme()?.zones[0] ?? '#3b82f6' },
          };
          commit({ nodes: [node, ...pg.nodes.map((n) => (n.selected ? { ...n, selected: false } : n))], edges: pg.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
          return id;
        },
        spaceSelected: (axis, gap) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop' && n.type !== 'measure' && !extras(n).locked);
          if (sel.length < 2) return;
          const key = (n: AppNode) => (axis === 'h' ? n.position.x : n.position.y);
          const sorted = [...sel].sort((a, b) => key(a) - key(b));
          const pos = new Map<string, { x: number; y: number }>();
          let edge = key(sorted[0]) + (axis === 'h' ? nodeSize(sorted[0]).w : nodeSize(sorted[0]).h);
          for (const n of sorted.slice(1)) {
            const at = Math.round(edge + gap);
            pos.set(n.id, axis === 'h' ? { x: at, y: n.position.y } : { x: n.position.x, y: at });
            edge = at + (axis === 'h' ? nodeSize(n).w : nodeSize(n).h);
          }
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) });
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
        setPageWifi: (patch) => {
          const pg = page();
          commit({ pages: cur().pages.map((x) => (x.id === pg.id ? { ...x, wifi: { ...x.wifi, ...patch } } : x)) });
        },
        setWallMaterial: (ids, material) => {
          if (!ids.length) return;
          get().snapshot();
          const set = new Set(ids);
          commit({ nodes: page().nodes.map((n) => (set.has(n.id) && n.type === 'measure' ? ({ ...n, data: { ...n.data, material } } as AppNode) : n)) });
        },
        placeAccessPoints: (points) => {
          if (!points.length) return 0;
          get().snapshot();
          const st = findStencil('access-point', get().customStencils);
          const w = (st?.width ?? 60) * (st?.scale ?? 1), h = (st?.height ?? 60) * (st?.scale ?? 1);
          const taken = new Set(allDevices(cur()).map((n) => n.data.name));
          let k = 1;
          const name = () => { while (taken.has(`AP-${k}`)) k++; taken.add(`AP-${k}`); return `AP-${k}`; };
          const added: AppNode[] = points.map((p) => ({
            id: `n-${uid()}`, type: 'device', position: { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) },
            data: { ...st?.defaults, stencilId: 'access-point', name: name(), status: 'planned' } as DeviceData,
          }));
          commit({ nodes: [...page().nodes, ...added] });
          return added.length;
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
        numberCables: (pageId) => {
          const p = cur();
          const ids = new Map(labelledCables(p, pageId).filter((c) => !c.e.data?.label?.trim()).map((c) => [c.e.id, c.id]));
          if (!ids.size) return;
          get().snapshot();
          commit({ pages: p.pages.map((pg) => ({ ...pg, edges: pg.edges.map((e) => (ids.has(e.id) ? { ...e, data: { ...(e.data ?? { cable: 'Cat6' }), label: ids.get(e.id) } } as CableEdge : e)) })) });
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
          const ok = reachable();
          const nodes = pg.nodes.filter((n) => !n.selected || isLocked(n) || !ok(n));
          const ids = new Set(nodes.map((n) => n.id));
          commit({ nodes, edges: pg.edges.filter((e) => (!e.selected || !ok(e)) && ids.has(e.source) && ids.has(e.target)), racks: pruneRacks(cur().racks, allWith(nodes)) });
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
            return { ...copy, id: ids.get(n.id)!, position: { x: n.position.x + step, y: n.position.y + step }, selected: true, data: retarget(data, ids) } as AppNode;
          });
          const edges = clip.edges.map((e) => ({ ...structuredClone(e), id: `e-${uid()}`, source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false }));
          commit({
            nodes: [...page().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes],
            edges: [...page().edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...edges],
          });
          return nodes.length;
        },

        alignSelected: (mode) => {
          const pos = alignPositions(movable(page().nodes.filter(reachable())), mode);
          if (!pos.size) return;
          get().snapshot();
          commit({ nodes: page().nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) });
        },
        distributeSelected: (axis) => {
          const pos = distributePositions(movable(page().nodes.filter(reachable())), axis);
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
        orderStep: (dir) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
          if (!sel.length) return;
          // Stacking order: zIndex, then position in the list.
          const stack = pg.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.type !== 'backdrop').sort((a, b) => (a.n.zIndex ?? 0) - (b.n.zIndex ?? 0) || a.i - b.i).map(({ n }) => n);
          const box = (n: AppNode) => { const m = nodeSize(n); return { x0: n.position.x, y0: n.position.y, x1: n.position.x + m.w, y1: n.position.y + m.h }; };
          const overlap = (a: AppNode, b: AppNode) => { const p = box(a), q = box(b); return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1; };
          const order = [...stack];
          const items = dir === 'forward' ? [...sel].sort((a, b) => order.indexOf(b) - order.indexOf(a)) : [...sel].sort((a, b) => order.indexOf(a) - order.indexOf(b));
          const z = new Map<string, number>();
          let moved = false;
          for (const it of items) {
            const at = order.indexOf(it);
            const range = dir === 'forward' ? order.slice(at + 1) : order.slice(0, at).reverse();
            // Past the next item it overlaps (or simply the next one up / down when nothing overlaps).
            const past = range.find((o) => !o.selected && overlap(o, it)) ?? range.find((o) => !o.selected);
            if (!past) continue;
            order.splice(at, 1);
            const j = order.indexOf(past);
            order.splice(dir === 'forward' ? j + 1 : j, 0, it);
            z.set(it.id, past.zIndex ?? 0);
            moved = true;
          }
          if (!moved) return;
          get().snapshot();
          const byId = new Map(pg.nodes.map((n) => [n.id, n]));
          const backdrops = pg.nodes.filter((n) => n.type === 'backdrop');
          commit({ nodes: [...backdrops, ...order.map((n) => { const v = byId.get(n.id)!; return z.has(n.id) ? { ...v, zIndex: z.get(n.id) } : v; })] });
        },
        setProtection: (patch) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected && n.type !== 'backdrop')) return;
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => {
            if (!n.selected || n.type === 'backdrop') return n;
            const data = { ...n.data } as Record<string, unknown>;
            for (const [k, v] of Object.entries(patch)) data[k] = v || undefined;
            return { ...n, data, ...(patch.noSelect ? { selected: false } : {}) } as AppNode;
          }) });
        },
        allowSelectAll: () => {
          const pg = page();
          const count = pg.nodes.filter((n) => n.type !== 'backdrop' && n.data.noSelect).length;
          if (!count) return 0;
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (n.type !== 'backdrop' && n.data.noSelect ? ({ ...n, data: { ...n.data, noSelect: undefined } } as AppNode) : n)) });
          return count;
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
            formatClip = { kind: 'cable', patch: { cable: d.cable, color: d.color, route: d.route, arrows: d.arrows, weight: d.weight }, look: lookOf(d) };
          } else if (n?.type === 'shape') {
            const d = n.data;
            formatClip = { kind: 'shape', patch: { fill: d.fill, stroke: d.stroke, textColor: d.textColor, fontSize: d.fontSize, dashed: d.dashed, linePattern: d.linePattern, fillTransparency: d.fillTransparency, gradient: d.gradient, lineWidth: d.lineWidth, shadow: d.shadow, rounding: d.rounding, align: d.align, valign: d.valign }, look: lookOf(d) };
          } else if (n?.type === 'device') {
            const d = n.data;
            const infoBox = d.infoBox ? { ...d.infoBox, offset: undefined } : undefined;
            formatClip = { kind: 'device', patch: { labelFields: d.labelFields, infoBox, status: d.status }, look: lookOf(d) };
          } else if (n?.type === 'zone') {
            formatClip = { kind: 'zone', patch: { color: n.data.color }, look: lookOf(n.data) };
          } else if (n?.type === 'note') {
            formatClip = { kind: 'note', patch: {}, look: lookOf(n.data) };
          } else return null;
          return formatClip.kind;
        },
        pasteFormat: () => {
          const clip = formatClip;
          if (!clip) return 0;
          const pg = page();
          const look = clip.look;
          const hasLook = Object.keys(look).length > 0;
          // Same kind: the whole format. Other kinds with text: just the font (Visio paints text formatting across).
          const nodeTargets = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop' && n.type !== 'measure' && (n.type === clip.kind || hasLook));
          const edgeTargets = pg.edges.filter((e) => e.selected && (clip.kind === 'cable' || hasLook));
          if (!nodeTargets.length && !edgeTargets.length) return 0;
          get().snapshot();
          commit({
            nodes: pg.nodes.map((n) => {
              if (!nodeTargets.includes(n)) return n;
              const same = n.type === clip.kind;
              // Keep each device's own info-box position.
              const own = !same ? {} : clip.kind === 'device' && n.type === 'device' && clip.patch.infoBox
                ? { ...clip.patch, infoBox: { ...(clip.patch.infoBox as object), offset: n.data.infoBox?.offset } }
                : clip.patch;
              // A drawing shape always has a size and colour; others fall back to their usual look when unset.
              const lk = n.type === 'shape' ? Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)) : { ...Object.fromEntries(LOOK_KEYS.map((k) => [k, undefined])), ...look };
              return { ...n, data: { ...n.data, ...lk, ...own } } as AppNode;
            }),
            edges: pg.edges.map((e) => {
              if (!edgeTargets.includes(e)) return e;
              const d = (e.data ?? { cable: 'Cat6' }) as CableData;
              return { ...e, data: { ...d, ...Object.fromEntries(LOOK_KEYS.map((k) => [k, undefined])), ...look, ...(clip.kind === 'cable' ? clip.patch : {}) } as CableData };
            }),
          });
          return nodeTargets.length + edgeTargets.length;
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
        addOffPageRef: (position, target) => {
          const p = cur();
          const here = activePage(p);
          let pages = p.pages;
          let targetId: string;
          if ('newName' in target) {
            const np = newPage(target.newName.trim() || `Page ${pages.length + 1}`, here.kind);
            pages = [...pages, np];
            targetId = np.id;
          } else {
            if (!pages.some((x) => x.id === target.pageId) || target.pageId === here.id) return null;
            targetId = target.pageId;
          }
          get().snapshot();
          const aId = `s-${uid()}`, bId = `s-${uid()}`;
          const w = 140, h = 44;
          const make = (id: string, pos: { x: number; y: number }, toPage: string, pair: string): AppNode => ({
            id, type: 'shape', position: { x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2) }, width: w, height: h,
            data: { kind: 'offpage', text: '', link: `${PAGE_LINK}${toPage}`, pair, fill: theme()?.fill ?? '#eff6ff', stroke: theme()?.line ?? '#2563eb', textColor: theme()?.text ?? '#111827', fontSize: 12, lineWidth: 1.5, rotation: 0 },
          } as AppNode);
          const a = { ...make(aId, position, targetId, bId), selected: true };
          // The partner goes in the same spot on the other page, so the two line up when you flip between pages.
          const b = make(bId, position, here.id, aId);
          commit({
            pages: pages.map((pg) => (pg.id === here.id ? { ...pg, nodes: [...pg.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), a] } : pg.id === targetId ? { ...pg, nodes: [...pg.nodes, b] } : pg)),
          });
          return aId;
        },
        flipSelection: (axis) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop' && !extras(n).locked);
          if (!sel.length) return;
          // The selection's box (dimension lines and walls by their two ends).
          const ends = (n: AppNode) => {
            if (n.type === 'measure') return [n.position, { x: n.position.x + n.data.dx, y: n.position.y + n.data.dy }];
            const m = nodeSize(n);
            return [n.position, { x: n.position.x + m.w, y: n.position.y + m.h }];
          };
          const pts = sel.flatMap(ends);
          const c = axis === 'h' ? (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2 : (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
          const mirror = (v: number) => 2 * c - v;
          const norm = (r: number) => ((Math.round(r) % 360) + 360) % 360;
          get().snapshot();
          const ids = new Set(sel.map((n) => n.id));
          commit({
            nodes: pg.nodes.map((n) => {
              if (!ids.has(n.id)) return n;
              if (n.type === 'measure') {
                const [a] = ends(n);
                return axis === 'h'
                  ? { ...n, position: { x: Math.round(mirror(a.x)), y: a.y }, data: { ...n.data, dx: -n.data.dx } }
                  : { ...n, position: { x: a.x, y: Math.round(mirror(a.y)) }, data: { ...n.data, dy: -n.data.dy } };
              }
              const m = nodeSize(n);
              const position = axis === 'h' ? { x: Math.round(mirror(n.position.x + m.w)), y: n.position.y } : { x: n.position.x, y: Math.round(mirror(n.position.y + m.h)) };
              if (n.type !== 'shape') return { ...n, position }; // devices, zones, notes: they swap sides but stay readable
              const d = n.data;
              const r = d.rotation ?? 0;
              let data: ShapeData;
              if (d.kind === 'freeform') data = { ...d, points: (d.points ?? []).map(([x, y]) => (axis === 'h' ? [1 - x, y] : [x, 1 - y]) as [number, number]) };
              else if (d.kind === 'arrow' || d.kind === 'offpage') data = { ...d, rotation: norm(axis === 'h' ? 180 - r : -r) };
              else if (d.kind === 'door') data = { ...d, flip: !d.flip || undefined, rotation: norm(axis === 'h' ? -r : 180 - r) };
              else if (d.kind === 'image') data = { ...d, ...(axis === 'h' ? { flipX: !d.flipX || undefined } : { flipY: !d.flipY || undefined }), rotation: norm(-r) };
              else data = { ...d, rotation: norm(-r) };
              return { ...n, position, data };
            }),
          });
        },
        sameSize: (what, like) => {
          const pg = page();
          const sel = pg.nodes.filter((n) => n.selected && !extras(n).locked && (n.type === 'device' || n.type === 'shape' || n.type === 'zone'));
          if (sel.length < 2) return;
          // The size saved on the item first (it is what gets changed); the drawn size for items that have none saved.
          const sizes = sel.map((n) => {
            const st = n.style as { width?: number; height?: number } | undefined, m = nodeSize(n);
            return { w: n.width ?? st?.width ?? m.w, h: n.height ?? st?.height ?? m.h };
          });
          const pick = (k: 'w' | 'h') => (like === 'largest' ? Math.max : Math.min)(...sizes.map((z) => z[k]));
          const W = pick('w'), H = pick('h');
          get().snapshot();
          const ids = new Map(sel.map((n, i) => [n.id, sizes[i]]));
          commit({
            nodes: pg.nodes.map((n) => {
              const z = ids.get(n.id);
              if (!z || !z.w || !z.h) return n;
              // Devices and pictures keep their proportions: they match the width or height, or fit inside the size.
              const keep = n.type === 'device' || (n.type === 'shape' && n.data.kind === 'image');
              let w = what === 'height' ? z.w : W, h = what === 'width' ? z.h : H;
              if (keep) { const k = what === 'height' ? H / z.h : what === 'width' ? W / z.w : Math.min(W / z.w, H / z.h); w = z.w * k; h = z.h * k; }
              w = Math.round(w); h = Math.round(h);
              return { ...n, width: w, height: h, style: { ...n.style, width: w, height: h } } as AppNode;
            }),
          });
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
          const want = new Set(ids.filter((id) => { const n = pg.nodes.find((x) => x.id === id); return !(n && n.type !== 'backdrop' && n.data.noSelect); }));
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
        selectPath: (nodeIds, edgeIds) => {
          const pg = page();
          const n = new Set(nodeIds), e = new Set(edgeIds);
          commit({
            nodes: pg.nodes.map((x) => (!!x.selected === n.has(x.id) ? x : { ...x, selected: n.has(x.id) })),
            edges: pg.edges.map((x) => (!!x.selected === e.has(x.id) ? x : { ...x, selected: e.has(x.id) })),
          });
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
          const ok = reachable();
          const pickNode = (n: AppNode): boolean => {
            if (n.type === 'backdrop' || n.hidden || !ok(n)) return false;
            if (what === 'devices') return n.type === 'device';
            if (what === 'shapes') return n.type === 'shape' || n.type === 'measure' || n.type === 'note';
            if (what === 'text') return (n.type === 'shape' && n.data.kind === 'text') || n.type === 'note';
            if (what === 'zones') return n.type === 'zone';
            if (what === 'same') return same.has(sig(n));
            if (what.startsWith('layer:')) return layerOf(n) === what.slice(6);
            return false;
          };
          const pickEdge = (e: CableEdge) => ok(e) && (what === 'cables' || (what.startsWith('layer:') && layerOf(e) === what.slice(6)) || (what === 'same' && pg.edges.some((x) => x.selected) && sel.length === 0));
          const nodes = pg.nodes.map((n) => ({ ...n, selected: pickNode(n) }));
          const edges = pg.edges.map((e) => ({ ...e, selected: pickEdge(e) }));
          commit({ nodes, edges });
          return nodes.filter((n) => n.selected).length + edges.filter((e) => e.selected).length;
        },
        setAltOnSelection: (alt) => {
          const pg = page();
          if (!pg.nodes.some((n) => n.selected && n.type !== 'backdrop')) return;
          get().snapshot();
          commit({ nodes: pg.nodes.map((n) => (n.selected && n.type !== 'backdrop' ? ({ ...n, data: { ...n.data, alt: alt.trim() || undefined } } as AppNode) : n)) });
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
          const ok = reachable();
          const moving = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop' && !extras(n).locked && ok(n));
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
        selectAll: () => {
          const ok = reachable();
          commit({
            nodes: page().nodes.map((n) => (n.type === 'backdrop' || n.hidden || n.selected || n.data.noSelect || !ok(n) ? n : { ...n, selected: true })),
            edges: page().edges.map((e) => (e.selected || !ok(e) ? e : { ...e, selected: true })),
          });
        },
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
                const { sizeDelta, list, textMargin, ...fmt } = text ?? {};
                return {
                  ...n,
                  data: {
                    ...n.data, ...(fill !== undefined ? { fill } : {}), ...(line ? { stroke: line } : {}), ...fmt,
                    ...(weight !== undefined ? { lineWidth: weight ?? undefined } : {}), ...(shadow !== undefined ? { shadow: shadow || undefined } : {}),
                    ...(textColor !== undefined ? { textColor: textColor ?? theme()?.text ?? '#111827' } : {}),
                    ...(format ? { ...format, ...(format.linePattern ? { dashed: undefined } : {}) } : {}),
                    ...(list !== undefined ? { list: list ?? undefined } : {}),
                    ...(textMargin !== undefined ? { textMargin: textMargin ?? undefined } : {}),
                    ...(sizeDelta ? { fontSize: Math.max(6, Math.min(72, n.data.fontSize + sizeDelta)) } : {}),
                  },
                };
              }
              if ((n.type === 'device' || n.type === 'zone' || n.type === 'note') && (text || textColor !== undefined)) {
                const look = text ? lookPatch(text, n.data.fontSize ?? TEXT_DEFAULT_SIZE[n.type]) : {};
                n = { ...n, data: { ...n.data, ...look, ...(textColor !== undefined ? { textColor: textColor ?? undefined } : {}) } } as AppNode;
              }
              if (n.type === 'device' && (line !== undefined || weight !== undefined || format?.linePattern)) {
                // Devices: Line adds (or recolours) an outline, Weight and Dashes change it; Automatic / No line removes it.
                const cur = n.data.border;
                let border: DeviceData['border'];
                if (line === null || line === 'transparent') border = undefined;
                else {
                  border = { ...(cur ?? { color: '#334155' }), ...(line ? { color: line } : {}), ...(format?.linePattern ? { pattern: format.linePattern } : {}) };
                  if (weight !== undefined) border.width = weight ?? undefined;
                  if (!cur && !line && weight === null) border = undefined;
                }
                n = { ...n, data: { ...n.data, border } } as AppNode;
              }
              if (n.type === 'zone' && (line || weight !== undefined)) {
                return { ...n, data: { ...n.data, ...(line && line !== 'transparent' ? { color: line } : {}), ...(weight !== undefined ? { lineWidth: weight ?? undefined } : {}) } };
              }
              if (n.type === 'measure' && n.data.variant === 'line' && (weight !== undefined || line || format?.linePattern)) return { ...n, data: { ...n.data, ...(weight ? { thickness: weight } : {}), ...(line ? { color: line } : {}), ...(format?.linePattern ? { linePattern: format.linePattern, dashed: format.linePattern !== 'solid' || undefined } : {}) } };
              return n;
            }),
            edges: line === undefined && weight === undefined && !text && textColor === undefined ? pg.edges : pg.edges.map((e) => (e.selected ? {
              ...e,
              data: {
                ...(e.data as CableData), ...(line !== undefined && line !== 'transparent' ? { color: line ?? undefined } : {}), ...(weight !== undefined ? { weight: weight ?? undefined } : {}),
                ...(text ? lookPatch(text, (e.data as CableData | undefined)?.fontSize ?? TEXT_DEFAULT_SIZE.cable) : {}),
                ...(textColor !== undefined ? { textColor: textColor ?? undefined } : {}),
              },
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
        editItems: (edits) => {
          if (!edits.length) return;
          const byPage = new Map<string, Map<string, ItemEdit>>();
          for (const e of edits) { if (!byPage.has(e.pageId)) byPage.set(e.pageId, new Map()); byPage.get(e.pageId)!.set(e.id, e); }
          get().snapshot();
          commit({ pages: cur().pages.map((pg) => {
            const m = byPage.get(pg.id);
            if (!m) return pg;
            return {
              ...pg,
              nodes: pg.nodes.map((n) => { const e = m.get(n.id); return e && e.kind === 'node' && n.type === 'device' ? { ...n, data: { ...n.data, ...(e.patch as Partial<DeviceData>) } } : n; }),
              edges: pg.edges.map((x) => { const e = m.get(x.id); return e && e.kind === 'edge' ? { ...x, data: { ...((x.data ?? { cable: 'Cat6' }) as CableData), ...(e.patch as Partial<CableData>) } } : x; }),
            };
          }) });
        },
        updateDeviceOnPage: (pageId, id, patch) => {
          get().snapshot();
          commit({ pages: cur().pages.map((pg) => (pg.id !== pageId ? pg : { ...pg, nodes: pg.nodes.map((n) => (n.id === id && n.type === 'device' ? { ...n, data: { ...n.data, ...patch } } : n)) })) });
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
        appendChangeLog: (projectId, entries) => {
          const p = get().projects[projectId];
          if (!p || !entries.length) return;
          set({ projects: { ...get().projects, [projectId]: { ...p, changeLog: appendEntries(p.changeLog, entries) } } });
        },
        addChangeNote: (text) => {
          const t = text.trim();
          if (!t) return;
          get().appendChangeLog(get().currentId, [{ at: Date.now(), kind: 'note', action: 'note', target: 'Note', detail: t }]);
        },
        clearChangeLog: () => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, changeLog: undefined, updatedAt: Date.now() } } });
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
          // Smart Duplicate: duplicating the last copies again repeats the spacing between them and their originals.
          const mem = lastDuplicate;
          const first = sel[0];
          const from = mem && sel.every((n) => mem.has(n.id)) ? mem.get(first.id)! : null;
          const off = from ? { x: first.position.x - from.x, y: first.position.y - from.y } : { x: 40, y: 40 };
          const ids = new Map(sel.map((n) => [n.id, reId(n.id)]));
          const copies = sel.map((n) => ({
            ...n,
            id: ids.get(n.id)!,
            position: { x: n.position.x + off.x, y: n.position.y + off.y },
            selected: true,
            data: retarget({ ...n.data, ...regroup(extras(n).group) }, ids),
          })) as AppNode[];
          // Cables between duplicated items are duplicated too (Visio copies connectors glued at both ends).
          const cables = pg.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({
            ...e, id: `e-${uid()}`, source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false,
          }));
          lastDuplicate = new Map(sel.map((n) => [ids.get(n.id)!, n.position]));
          commit({ nodes: [...pg.nodes.map((n) => ({ ...n, selected: false })), ...copies], edges: [...pg.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...cables] });
        },

        applyScan: (rows, target, pageName) => {
          get().snapshot();
          const custom = get().customStencils;
          const r = applyScanRows(cur(), rows, { target, pageName, date: new Date().toISOString().slice(0, 10), id: () => `n-${uid()}` }, (id) => findStencil(id, custom));
          commit({ pages: r.pages, activePageId: r.activePageId });
          return { updated: r.updated, created: r.created };
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
              for (const c of u.changes) (data as Record<string, unknown>)[c.field] = c.field === 'powerW' || c.field === 'weightLb' ? Number(c.to) : c.to;
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
          commit({ pages, layers: (cur().layers ?? []).filter((l) => l.id !== id) });
        },
        toggleLayer: (id) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) } } });
          deselectBlocked();
        },
        updateLayer: (id, patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)), updatedAt: Date.now() } } });
          deselectBlocked();
        },
        setActiveLayer: (id) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, layers: (p.layers ?? []).map((l) => ({ ...l, active: l.id === id ? true : undefined })) } } });
        },
        selectZoneContents: (id) => {
          const pg = page();
          const z = pg.nodes.find((n) => n.id === id);
          if (!z) return;
          get().selectIds(zoneMembers(z, pg.nodes).map((m) => m.id));
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
            nodes: src.nodes.map((n) => ({ ...n, id: map.get(n.id)!, selected: false, data: retarget({ ...n.data }, map) }) as AppNode),
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
        setBackdrop: (image, naturalWidth, naturalHeight, size) => {
          get().snapshot();
          // Fit the long side to ~1600px so a floor plan starts at a workable size.
          const k = 1600 / Math.max(naturalWidth, naturalHeight);
          const old = page().nodes.find((n) => n.type === 'backdrop');
          const node: AppNode = {
            id: old?.id ?? `b-${uid()}`,
            type: 'backdrop',
            position: old?.position ?? { x: 0, y: 0 },
            width: size?.width ?? naturalWidth * k,
            height: size?.height ?? naturalHeight * k,
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
        restoreBackup: (b) => {
          const projects = { ...get().projects };
          const ids = new Map<string, string>();
          let copies = 0;
          for (const [oldId, raw] of Object.entries(b.projects ?? {})) {
            let p: Project;
            try {
              p = sanitizeProject(raw).project;
            } catch {
              continue;
            }
            const clash = !!projects[oldId];
            const id = clash ? uid() : oldId;
            if (clash) copies++;
            ids.set(oldId, id);
            projects[id] = { ...p, id, name: clash ? `${p.name} (restored)` : p.name };
          }
          // Only well-formed stencils and templates come in: a damaged one would break the palette on every start.
          const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
          const goodStencils = Object.fromEntries(Object.entries(b.customStencils ?? {}).filter(([, s]) => isObj(s) && typeof s.id === 'string' && Array.isArray(s.ports) && typeof s.width === 'number' && typeof s.height === 'number'));
          const goodTemplates = Object.fromEntries(Object.entries(b.templates ?? {}).filter(([, t]) => isObj(t) && isObj(t.project) && Array.isArray((t.project as { pages?: unknown }).pages)));
          const newStencils = Object.keys(goodStencils).filter((k) => !(k in get().customStencils)).length;
          const newTemplates = Object.keys(goodTemplates).filter((k) => !(k in get().templates)).length;
          const customStencils = { ...goodStencils, ...get().customStencils } as Record<string, StencilDef>;
          const templates = { ...goodTemplates, ...get().templates } as Record<string, Template>;
          const versions = { ...get().versions };
          if (b.versions?.format === 2) {
            versionPool = { ...b.versions.pool, ...versionPool };
            for (const [oldId, list] of Object.entries(b.versions.versions ?? {})) {
              const id = ids.get(oldId);
              if (!id || !Array.isArray(list)) continue;
              const have = new Set((versions[id] ?? []).map((v) => v.id));
              versions[id] = [...(versions[id] ?? []), ...list.filter((v) => !have.has(v.id))].sort((a, c) => c.at - a.at);
            }
          }
          set({ projects, customStencils, templates, versions });
          return {
            clients: ids.size, copies, stencils: newStencils, templates: newTemplates,
          };
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
          // Checked and repaired first: a damaged file must not crash the app (and keep crashing it on every start).
          // (Before its stencils are added, so a refused file leaves nothing behind.)
          let copy: Project = { ...sanitizeProject(p, p?.name).project, id: uid(), updatedAt: Date.now() };
          if (stencils?.length) {
            // A file's stencil with the id of a different stencil of yours comes in as a copy: its devices use the copy.
            const { renamed } = addStencils(stencils);
            if (renamed.size) {
              const pages = copy.pages.map((pg) => ({
                ...pg,
                nodes: pg.nodes.map((n) => (n.type === 'device' && renamed.has(n.data.stencilId) ? { ...n, data: { ...n.data, stencilId: renamed.get(n.data.stencilId)! } } : n)),
              }));
              copy = { ...copy, pages };
            }
          }
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
        buildRackFromDiagram: (name, into) => {
          const p = cur();
          let racks = p.racks ?? [];
          const mounted = new Set(racks.flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
          // A shape's back view placed as its own device is part of its front device, not mounted on its own.
          const backs = backIds(get().customStencils);
          let devices = page().nodes.filter((n): n is DeviceNode => n.type === 'device' && !mounted.has(n.id) && !backs.has(n.data.stencilId));
          const cables = p.pages.flatMap((pg) => pg.edges.map((e) => ({ a: e.source, b: e.target })));
          let count = 0;
          let first: string | undefined;
          const target = into ? racks.find((r) => r.id === into) : undefined;
          if (target) {
            const res = mountInto(target, devices, getStencil);
            if (res.mounted) {
              racks = racks.map((r) => (r.id === target.id ? res.rack : r));
              count += res.mounted;
              first = target.id;
            }
            devices = res.left;
          }
          // One rack per Location (MDF, IDF-1…) when the devices say where they are; otherwise a single rack.
          const { racks: built, mounted: n } = planRacks(name || `Rack ${String.fromCharCode(65 + racks.length)}`, devices, getStencil, cables);
          count += n;
          if (!count) return 0;
          get().snapshot();
          commit({ racks: [...racks, ...built] });
          set({ activeRackId: first ?? built[0].id, selectedRackItemId: null, view: 'racks' });
          return count;
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
          if (moved && it.shelf) return get().putOnShelf(rackId, it.nodeId!, next.u);
          if (moved && !fits(r, next.u, next.height, next.depth, itemId)) return false;
          if (moved) get().snapshot();
          // What stands on a shelf moves with it.
          const follow = (y: RackItem) => (y.shelf?.id === itemId ? { ...y, u: next.u, height: next.height, depth: next.depth } : y);
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, items: x.items.map((y) => (y.id === itemId ? next : it.kind === 'shelf' ? follow(y) : y)) } : x)) });
          return true;
        },
        removeRackItem: (rackId, itemId) => {
          get().snapshot();
          // Taking a shelf out takes what stands on it out of the rack too (it stays on the diagram).
          commit({ racks: (cur().racks ?? []).map((x) => {
            if (x.id !== rackId) return x;
            const items = x.items.filter((y) => y.id !== itemId && y.shelf?.id !== itemId);
            const ids = new Set(items.map((y) => y.id));
            return { ...x, items, ...(x.power ? { power: x.power.filter((c) => ids.has(c.from) && ids.has(c.to)) } : {}) };
          }) });
          set({ selectedRackItemId: null });
        },
        setPowerCord: (rackId, from, inlet, to) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          if (!r) return;
          get().snapshot();
          const rest = (r.power ?? []).filter((c) => !(c.from === from && c.inlet === inlet) && !(to && c.to === to.item && c.outlet === to.outlet));
          const power = to ? [...rest, { id: `pc-${uid()}`, from, inlet, to: to.item, outlet: to.outlet }] : rest;
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, power } : x)) });
        },
        replugCable: (edgeId, from, to) => {
          const p = cur();
          const pg = p.pages.find((x) => x.edges.some((e) => e.id === edgeId));
          const e = pg?.edges.find((x) => x.id === edgeId);
          if (!pg || !e) return false;
          const atSource = e.source === from.nodeId && (e.sourceHandle ?? undefined) === from.port;
          if (!atSource && !(e.target === from.nodeId && (e.targetHandle ?? undefined) === from.port)) return false;
          const other = atSource ? { id: e.target, h: e.targetHandle } : { id: e.source, h: e.sourceHandle };
          if (other.id === to.nodeId && other.h === to.port) return false; // both ends on one port
          if (from.nodeId === to.nodeId && from.port === to.port) return false;
          // A cable already on the target port (where a port takes only one) swaps over to where this one was.
          const rest: Page = { ...pg, edges: pg.edges.filter((x) => x.id !== edgeId) };
          const blocker = portTaken(rest, to.nodeId, to.port)
            ? pg.edges.find((x) => x.id !== edgeId && ((x.source === to.nodeId && x.sourceHandle === to.port) || (x.target === to.nodeId && x.targetHandle === to.port)))
            : undefined;
          get().snapshot();
          const moved = (x: CableEdge, at: 'source' | 'target', n: string, h?: string): CableEdge =>
            at === 'source' ? { ...x, source: n, sourceHandle: h ?? null } : { ...x, target: n, targetHandle: h ?? null };
          const edges = pg.edges.map((x) => {
            if (x.id === edgeId) return moved(x, atSource ? 'source' : 'target', to.nodeId, to.port);
            if (blocker && x.id === blocker.id) {
              const bAtSource = x.source === to.nodeId && x.sourceHandle === to.port;
              return moved(x, bAtSource ? 'source' : 'target', from.nodeId, from.port);
            }
            return x;
          });
          commit({ pages: p.pages.map((x) => (x.id === pg.id ? { ...x, edges } : x)) });
          return true;
        },
        setCableRackRoute: (edgeId, route) => {
          const p = cur();
          get().snapshot();
          commit({ pages: p.pages.map((pg) => (pg.edges.some((e) => e.id === edgeId)
            ? { ...pg, edges: pg.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...(e.data ?? { cable: 'Cat6' }), rackRoute: route } as CableData } : e)) }
            : pg)) });
        },
        setPowerCordRoute: (rackId, cordId, route) => {
          const racks = cur().racks ?? [];
          get().snapshot();
          commit({ racks: racks.map((r) => (r.id === rackId ? { ...r, power: (r.power ?? []).map((c) => (c.id === cordId ? { ...c, route } : c)) } : r)) });
        },
        movePowerCordEnd: (rackId, cordId, end, target) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          const c = r?.power?.find((x) => x.id === cordId);
          if (!r || !c) return false;
          const [k1, k2] = end === 'to' ? ['to', 'outlet'] as const : ['from', 'inlet'] as const;
          const slot = end === 'to' ? Number(target.slot) : String(target.slot);
          if (c[k1] === target.item && c[k2] === slot) return false;
          if (end === 'to' ? target.item === c.from : target.item === c.to) return false; // into itself
          get().snapshot();
          const old = { item: c[k1], slot: c[k2] };
          const power = (r.power ?? []).map((x) => {
            if (x.id === cordId) return { ...x, [k1]: target.item, [k2]: slot };
            // A cord already there swaps over.
            if (x[k1] === target.item && x[k2] === slot) return { ...x, [k1]: old.item, [k2]: old.slot };
            return x;
          });
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, power } : x)) });
          return true;
        },
        plugInRack: (rackId, fresh) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          if (!r) return;
          const devs = new Map(cur().pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n]));
          const custom = get().customStencils;
          get().snapshot();
          const power = plugInAll(fresh ? { ...r, power: [] } : r, devs, (id) => findStencil(id, custom));
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...x, power } : x)) });
        },
        combineWithFront: (nodeId) => {
          const custom = get().customStencils;
          const pg = cur().pages.find((x) => x.nodes.some((n) => n.id === nodeId));
          const rear = pg?.nodes.find((n): n is DeviceNode => n.id === nodeId && n.type === 'device');
          if (!pg || !rear) return null;
          const front = pg.nodes.find((n): n is DeviceNode => n.type === 'device' && n.id !== nodeId && findStencil(n.data.stencilId, custom)?.back?.id === rear.data.stencilId);
          if (!front) return null;
          get().snapshot();
          const move = (id: string, h?: string | null) => (id === nodeId ? { id: front.id, h: h ? backPortId(h) : h } : { id, h });
          const pages = cur().pages.map((x) => (x.id !== pg.id ? x : {
            ...x,
            nodes: x.nodes.filter((n) => n.id !== nodeId),
            edges: x.edges.map((e) => {
              if (e.source !== nodeId && e.target !== nodeId) return e;
              const s = move(e.source, e.sourceHandle), t = move(e.target, e.targetHandle);
              return { ...e, source: s.id, sourceHandle: s.h ?? null, target: t.id, targetHandle: t.h ?? null };
            }).filter((e) => e.source !== e.target),
          }));
          // Its port notes go with its ports; it leaves any rack (the front device is the one mounted).
          const notes = Object.fromEntries(Object.entries(rear.data.ports ?? {}).map(([k, v]) => [backPortId(k), v]));
          const withNotes = pages.map((x) => ({ ...x, nodes: x.nodes.map((n) => (n.id === front.id && n.type === 'device' ? { ...n, data: { ...n.data, ports: { ...notes, ...n.data.ports } } } as AppNode : n)) }));
          const racks = (cur().racks ?? []).map((r) => {
            const gone = r.items.filter((it) => it.nodeId === nodeId).map((it) => it.id);
            return gone.length ? { ...r, items: r.items.filter((it) => !gone.includes(it.id)), ...(r.power ? { power: r.power.filter((c) => !gone.includes(c.from) && !gone.includes(c.to)) } : {}) } : r;
          });
          commit({ pages: withNotes, racks });
          return front.id;
        },
        mountWithKit: (rackId, nodeId) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          const it = r?.items.find((x) => x.nodeId === nodeId);
          if (!r || !it) return false;
          const node = cur().pages.flatMap((pg) => pg.nodes).find((n) => n.id === nodeId);
          const height = node?.type === 'device' ? rackUnitsOf(findStencil(node.data.stencilId, get().customStencils)) || 1 : 1;
          const rest: Rack = { ...r, items: r.items.filter((x) => x.id !== it.id) };
          const u = findFreeU(rest, height, 'full');
          if (u === null) return false;
          get().snapshot();
          const mounted: RackItem = { id: it.id, kind: 'device', nodeId, u, height, depth: 'full' };
          commit({ racks: racks.map((x) => (x.id === rackId ? { ...rest, items: [...rest.items, mounted] } : x)) });
          return true;
        },
        setRackedPanelsShown: (show) => {
          const p = cur();
          const racked = new Set((p.racks ?? []).flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
          const custom = get().customStencils;
          const panel = (n: AppNode) => n.type === 'device' && racked.has(n.id) && n.data.stencilId !== 'wall-jack' && isPassThrough(n, findStencil(n.data.stencilId, custom));
          get().snapshot();
          commit({
            pages: p.pages.map((pg) => ({
              ...pg,
              nodes: pg.nodes.map((n) => (panel(n) && n.type === 'device' && (n.data.showOn === 'rack') === show
                ? { ...n, selected: false, data: { ...n.data, showOn: show ? undefined : 'rack' } } as AppNode
                : n)),
            })),
          });
        },
        putOnShelf: (rackId, nodeId, u) => {
          const racks = cur().racks ?? [];
          const r = racks.find((x) => x.id === rackId);
          if (!r || racks.some((x) => x.id !== rackId && x.items.some((it) => it.nodeId === nodeId))) return false;
          const custom = get().customStencils;
          const devs = new Map(cur().pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n]));
          const stOf = (id?: string) => { const d = id ? devs.get(id) : undefined; return d ? findStencil(d.data.stencilId, custom) : undefined; };
          const moving = r.items.find((it) => it.nodeId === nodeId);
          const placed = placeOnShelf(r, nodeId, shelfWidth(stOf(nodeId), 1), (it) => shelfWidth(stOf(it.nodeId), it.height), u, moving);
          if (!placed) return false;
          get().snapshot();
          commit({ racks: racks.map((x) => (x.id === rackId ? placed : x)) });
          set({ selectedRackItemId: placed.items.find((it) => it.nodeId === nodeId)?.id ?? null });
          return true;
        },
        addDeviceToRack: (rackId, stencilId, u) => {
          const s = findStencil(stencilId, get().customStencils);
          const r = (cur().racks ?? []).find((x) => x.id === rackId);
          if (!s || !r) return false;
          const height = rackUnitsOf(s) || 1;
          const shelf = isShelfDevice(s);
          const at = u ?? findFreeU(r, height, 'full');
          if (!shelf && (at === null || !fits(r, at, height, 'full'))) return false;
          if (shelf && !placeOnShelf(r, 'probe', shelfWidth(s, 1), () => 0, u ?? undefined)) return false;
          get().snapshot();
          // Put the new device on the diagram below everything else so it doesn't cover existing work.
          const nodes = page().nodes;
          const bottom = nodes.reduce((m, n) => Math.max(m, n.position.y + (n.measured?.height ?? 100)), 0);
          const count = nodes.filter((n) => n.type === 'device' && n.data.stencilId === stencilId).length;
          const node: AppNode = {
            id: `n-${uid()}`,
            type: 'device',
            position: { x: 0, y: nodes.length ? bottom + 80 : 0 },
            data: {
              stencilId, name: count ? `${s.name} ${count + 1}` : s.name, location: r.name, ...s.defaults,
              // Patch panels added in the rack view belong in the rack, not on the diagram.
              ...(isPassThrough({ data: { stencilId, name: s.name } } as DeviceNode, s) ? { showOn: 'rack' } : {}),
            } as DeviceData,
          };
          if (shelf) {
            commit({ nodes: [...nodes, node] });
            const devs = new Map(cur().pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n]));
            const custom = get().customStencils;
            const widthOf = (it: RackItem) => { const d = it.nodeId ? devs.get(it.nodeId) : undefined; return shelfWidth(d ? findStencil(d.data.stencilId, custom) : undefined, it.height); };
            const placed = placeOnShelf(r, node.id, shelfWidth(s, 1), widthOf, u ?? undefined);
            if (!placed) return false;
            commit({ racks: (cur().racks ?? []).map((x) => (x.id === rackId ? placed : x)) });
            set({ selectedRackItemId: placed.items.find((it) => it.nodeId === node.id)?.id ?? null });
            return true;
          }
          const item: RackItem = { id: `ri-${uid()}`, kind: 'device', nodeId: node.id, u: at!, height, depth: 'full' };
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
        importStencils: (list, library) => addStencils(list, library).added,
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
      name: WORKSPACE_KEY,
      version: 4,
      // Coalesced, error-reporting saves (lib/persistence.ts); same stored format as before.
      storage: rackdrawStorage as never,
      onRehydrateStorage: () => (_state, error) => { if (error) reportLoadError(error); },
      // Stored stencils are checked on every start: one broken stencil must not show the error screen forever.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DiagramState>;
        const custom = p.customStencils && typeof p.customStencils === 'object'
          ? Object.fromEntries(Object.values(p.customStencils).map(sanitizeStencil).filter((s): s is StencilDef => !!s).map((s) => [s.id, s]))
          : current.customStencils;
        return { ...current, ...p, customStencils: custom };
      },
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId, customStencils: s.customStencils, templates: s.templates, view: s.view, activeRackId: s.activeRackId }),
      migrate: (persisted, version) => {
        // Saved by a newer RackDraw: refuse (the recovery screen explains) rather than write it back in an older format.
        if (version > 4) throw new Error('Your diagrams were saved by a newer version of RackDraw. Install that version (or newer) to open them.');
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

/** Version History as stored (only the pictures some version uses), for File → Back up everything. */
export function snapshotVersions(): StoredVersions {
  const versions = useDiagram.getState().versions;
  return { format: 2, versions, pool: usedPool(versions, versionPool) };
}

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
    if (versionsLoaded && s.versions !== prev.versions) {
      // Only the pictures some version still uses are kept.
      versionPool = usedPool(s.versions, versionPool);
      const stored: StoredVersions = { format: 2, versions: s.versions, pool: versionPool };
      void idbSet(VERSIONS_KEY, stored)
        .then(() => { if (useSaveStatus.getState().versionsError?.startsWith('Version History could not be saved')) useSaveStatus.setState({ versionsError: undefined }); })
        .catch((e) => useSaveStatus.setState({ versionsError: `Version History could not be saved (${describe(e)}). It is tried again with the next version.` }));
    }
  });
}
