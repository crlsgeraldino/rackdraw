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
import type { AppNode, BackdropData, CableData, CableEdge, DataLink, DeviceData, DisplaySettings, Layer, Page, PageKind, PortData, Project, Rack, RackItem, ShapeKind, StencilDef, TitleBlock } from '@/lib/types';

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
  past: Snapshot[];
  future: Snapshot[];

  // canvas
  onNodesChange: (changes: NodeChangeset<AppNode>) => void;
  onEdgesChange: (changes: EdgeChangeset<CableEdge>) => void;
  onConnect: (c: Connection) => void;
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  // elements
  addStencil: (stencilId: string, position: { x: number; y: number }) => void;
  addZone: (position: { x: number; y: number }) => void;
  addNote: (position: { x: number; y: number }) => void;
  addShape: (kind: ShapeKind, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  updatePort: (nodeId: string, portId: string, patch: PortData) => void;
  updateEdgeData: (id: string, patch: Partial<CableData>) => void;
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
  /** Puts the selected devices/cables on the active page onto a layer (null = no layer). Returns how many moved. */
  assignSelectionToLayer: (layerId: string | null) => number;
  setDisplay: (patch: Partial<DisplaySettings>) => void;

  // pages (current project)
  setActivePage: (id: string) => void;
  addPage: (name: string, kind: PageKind) => void;
  renamePage: (id: string, name: string) => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  movePage: (id: string, dir: -1 | 1) => void;
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

/** Last copy, and how many times it has been pasted (each paste lands a little further down-right). */
let clipboard: { clip: Clipboard; pasted: number } | null = null;

/** Data fields shared by all node kinds (group, lock, link). */
const extras = (n: AppNode) => n.data as { group?: string; locked?: boolean; link?: string };

/** React Flow flags for a locked item: it can be selected (to edit or unlock) but not dragged or deleted. */
const lockFlags = (locked: boolean) => ({ draggable: !locked, deletable: !locked });

const HISTORY_LIMIT = 100;
const first = blankProject('New client');

export const useDiagram = create<DiagramState>()(
  persist(
    (set, get) => {
      const cur = () => get().projects[get().currentId];
      const page = () => activePage(cur());

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
          const arr = changes.toArray();
          if (arr.some((c) => c.type === 'remove')) get().snapshot();
          const before = page().nodes;
          let nodes = changes.applyTo(before);
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
          get().snapshot();
          // Device-to-device links are network cables; anything touching a drawing shape is a plain arrow line.
          const isDevice = (id: string) => page().nodes.find((n) => n.id === id)?.type === 'device';
          const cable = isDevice(c.source) && isDevice(c.target);
          const edge: CableEdge = {
            ...c,
            id: `e-${uid()}`,
            type: 'cable',
            data: cable ? { cable: 'Cat6' } : { cable: 'Line', arrows: 'end', route: 'step' },
          } as CableEdge;
          commit({ edges: addEdge(edge, page().edges) });
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
            data: { stencilId, name: count ? `${s.name} ${count + 1}` : s.name, ...s.defaults } as DeviceData,
          };
          commit({ nodes: [...page().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        addZone: (position) => {
          get().snapshot();
          const node: AppNode = {
            id: `z-${uid()}`, type: 'zone', position, zIndex: -1,
            style: { width: 420, height: 260 },
            data: { title: 'Server room', color: '#3b82f6' },
          };
          commit({ nodes: [node, ...page().nodes] });
        },
        addNote: (position) => {
          get().snapshot();
          const node: AppNode = { id: `t-${uid()}`, type: 'note', position, data: { text: 'Note' } };
          commit({ nodes: [...page().nodes, node] });
        },

        addShape: (kind, position) => {
          get().snapshot();
          const size = kind === 'text' ? { width: 180, height: 40 } : kind === 'arrow' ? { width: 140, height: 50 } : kind === 'diamond' ? { width: 140, height: 100 } : { width: 160, height: 80 };
          const node: AppNode = {
            id: `s-${uid()}`,
            type: 'shape',
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            ...size,
            data: {
              kind,
              text: kind === 'text' ? 'Text' : kind === 'arrow' ? '' : 'Label',
              fill: kind === 'text' ? 'transparent' : kind === 'arrow' ? '#93c5fd' : '#ffffff',
              stroke: kind === 'text' ? 'transparent' : '#374151',
              textColor: '#111827',
              fontSize: kind === 'text' ? 18 : 14,
              rotation: 0,
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
        assignSelectionToLayer: (layerId) => {
          const pg = page();
          const n = pg.nodes.filter((x) => x.selected && x.type === 'device').length + pg.edges.filter((e) => e.selected).length;
          if (!n) return 0;
          get().snapshot();
          const layer = layerId ?? undefined;
          commit({
            nodes: pg.nodes.map((x) => (x.selected && x.type === 'device' ? { ...x, data: { ...x.data, layer } } : x)),
            edges: pg.edges.map((e) => (e.selected ? { ...e, data: { ...(e.data as CableData), layer } } : e)),
          });
          return n;
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
          const pages = p.pages.filter((x) => x.id !== id);
          const idx = p.pages.findIndex((x) => x.id === id);
          commit({
            pages,
            racks: pruneRacks(p.racks, pages.flatMap((x) => x.nodes)),
            activePageId: p.activePageId === id ? pages[Math.max(0, idx - 1)].id : p.activePageId,
          });
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
        },
        updateProject: (patch) => {
          const p = cur();
          set({ projects: { ...get().projects, [p.id]: { ...p, ...patch, updatedAt: Date.now() } } });
        },
        deleteProject: (id) => {
          const rest = { ...get().projects };
          delete rest[id];
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
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId, customStencils: s.customStencils, view: s.view, activeRackId: s.activeRackId }),
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
