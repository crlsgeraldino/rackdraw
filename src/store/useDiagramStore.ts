'use client';

import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { STENCIL_MAP } from '@/lib/stencils';
import { findFreeU, fits } from '@/lib/rack';
import type { AppNode, CableData, CableEdge, DeviceData, PortData, Project, Rack, RackItem, StencilDef } from '@/lib/types';

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
  nodes: AppNode[];
  edges: CableEdge[];
  racks: Rack[];
}

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
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  updatePort: (nodeId: string, portId: string, patch: PortData) => void;
  updateEdgeData: (id: string, patch: Partial<CableData>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;

  // projects
  newProject: (name: string) => void;
  openProject: (id: string) => void;
  updateProject: (patch: Partial<Pick<Project, 'name' | 'site' | 'address' | 'contact' | 'notes'>>) => void;
  deleteProject: (id: string) => void;
  importProject: (p: Project, stencils?: StencilDef[]) => void;

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
  /** Adds stencils from a library or project file; returns how many were new. */
  importStencils: (list: StencilDef[]) => number;
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
  return { id: uid(), name, nodes: [], edges: [], createdAt: now, updatedAt: now };
}

const HISTORY_LIMIT = 100;
const first = blankProject('New client');

export const useDiagram = create<DiagramState>()(
  persist(
    (set, get) => {
      const cur = () => get().projects[get().currentId];

      /** Replace the current project's nodes/edges. */
      const commit = (patch: Partial<Snapshot>) => {
        const p = cur();
        set({ projects: { ...get().projects, [p.id]: { ...p, ...patch, updatedAt: Date.now() } } });
      };

      return {
        projects: { [first.id]: first },
        currentId: first.id,
        customStencils: {},
        past: [],
        future: [],

        snapshot: () => {
          const p = cur();
          set({ past: [...get().past.slice(-HISTORY_LIMIT + 1), { nodes: p.nodes, edges: p.edges, racks: p.racks ?? [] }], future: [] });
        },
        undo: () => {
          const { past, future } = get();
          if (!past.length) return;
          const p = cur();
          const prev = past[past.length - 1];
          set({ past: past.slice(0, -1), future: [{ nodes: p.nodes, edges: p.edges, racks: p.racks ?? [] }, ...future] });
          commit(prev);
        },
        redo: () => {
          const { past, future } = get();
          if (!future.length) return;
          const p = cur();
          const next = future[0];
          set({ past: [...past, { nodes: p.nodes, edges: p.edges, racks: p.racks ?? [] }], future: future.slice(1) });
          commit(next);
        },

        onNodesChange: (changes) => {
          const arr = changes.toArray();
          if (arr.some((c) => c.type === 'remove')) get().snapshot();
          const nodes = changes.applyTo(cur().nodes);
          // Removing a device removes its cables too.
          const ids = new Set(nodes.map((n) => n.id));
          const edges = cur().edges.filter((e) => ids.has(e.source) && ids.has(e.target));
          const removed = arr.some((c) => c.type === 'remove');
          commit(removed ? { nodes, edges, racks: pruneRacks(cur().racks, nodes) } : { nodes, edges });
        },
        onEdgesChange: (changes) => {
          if (changes.toArray().some((c) => c.type === 'remove')) get().snapshot();
          commit({ edges: changes.applyTo(cur().edges) });
        },
        onConnect: (c) => {
          if (c.source === c.target && c.sourceHandle === c.targetHandle) return;
          get().snapshot();
          const edge: CableEdge = {
            ...c,
            id: `e-${uid()}`,
            type: 'cable',
            data: { cable: 'Cat6' },
          } as CableEdge;
          commit({ edges: addEdge(edge, cur().edges) });
        },

        addStencil: (stencilId, position) => {
          const s = findStencil(stencilId, get().customStencils);
          if (!s) return;
          get().snapshot();
          const count = cur().nodes.filter((n) => n.type === 'device' && n.data.stencilId === stencilId).length;
          const node: AppNode = {
            id: `n-${uid()}`,
            type: 'device',
            position,
            data: { stencilId, name: count ? `${s.name} ${count + 1}` : s.name, ...s.defaults } as DeviceData,
          };
          commit({ nodes: [...cur().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] });
        },
        addZone: (position) => {
          get().snapshot();
          const node: AppNode = {
            id: `z-${uid()}`, type: 'zone', position, zIndex: -1,
            style: { width: 420, height: 260 },
            data: { title: 'Server room', color: '#3b82f6' },
          };
          commit({ nodes: [node, ...cur().nodes] });
        },
        addNote: (position) => {
          get().snapshot();
          const node: AppNode = { id: `t-${uid()}`, type: 'note', position, data: { text: 'Note' } };
          commit({ nodes: [...cur().nodes, node] });
        },

        updateNodeData: (id, patch) =>
          commit({ nodes: cur().nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AppNode) : n)) }),
        updatePort: (nodeId, portId, patch) =>
          commit({
            nodes: cur().nodes.map((n) => {
              if (n.id !== nodeId || n.type !== 'device') return n;
              const ports = { ...(n.data.ports ?? {}) };
              ports[portId] = { ...ports[portId], ...patch };
              return { ...n, data: { ...n.data, ports } };
            }),
          }),
        updateEdgeData: (id, patch) =>
          commit({ edges: cur().edges.map((e) => (e.id === id ? { ...e, data: { ...(e.data as CableData), ...patch } } : e)) }),

        deleteSelected: () => {
          const p = cur();
          get().snapshot();
          const nodes = p.nodes.filter((n) => !n.selected);
          const ids = new Set(nodes.map((n) => n.id));
          commit({ nodes, edges: p.edges.filter((e) => !e.selected && ids.has(e.source) && ids.has(e.target)), racks: pruneRacks(p.racks, nodes) });
        },
        duplicateSelected: () => {
          const p = cur();
          const sel = p.nodes.filter((n) => n.selected);
          if (!sel.length) return;
          get().snapshot();
          const copies = sel.map((n) => ({
            ...n,
            id: `${n.id.split('-')[0]}-${uid()}`,
            position: { x: n.position.x + 40, y: n.position.y + 40 },
            selected: true,
            data: { ...n.data },
          })) as AppNode[];
          commit({ nodes: [...p.nodes.map((n) => ({ ...n, selected: false })), ...copies] });
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
          const copy: Project = { ...p, id: uid(), updatedAt: Date.now() };
          set({ projects: { ...get().projects, [copy.id]: copy }, currentId: copy.id, past: [], future: [] });
        },

        view: 'diagram',
        activeRackId: null,
        selectedRackItemId: null,
        setView: (view) => set({ view }),
        setNodeSize: (id, size) => {
          get().snapshot();
          commit({
            nodes: cur().nodes.map((n) => {
              if (n.id !== id) return n;
              const { width: _w, height: _h, measured: _m, ...rest } = n;
              void _w; void _h; void _m;
              return (size ? { ...rest, width: size.width, height: size.height } : rest) as AppNode;
            }),
          });
        },
        selectOnlyNode: (id) =>
          commit({
            nodes: cur().nodes.map((n) => ({ ...n, selected: n.id === id })),
            edges: cur().edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
          }),
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
          const nodes = cur().nodes;
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
          const projects = Object.fromEntries(
            Object.entries(get().projects).map(([id, p]) => {
              const users = new Set(p.nodes.filter((n) => n.type === 'device' && n.data.stencilId === s.id).map((n) => n.id));
              if (!users.size) return [id, p];
              const dangling = (node: string, handle?: string | null) => users.has(node) && !!handle && !portIds.has(handle);
              const edges = p.edges.filter((e) => !dangling(e.source, e.sourceHandle) && !dangling(e.target, e.targetHandle));
              return [id, edges.length === p.edges.length ? p : { ...p, edges }];
            }),
          );
          set({ projects, customStencils: { ...get().customStencils, [s.id]: { ...s, custom: true, style: 'image' } } });
        },
        deleteCustomStencil: (id) => {
          const rest = { ...get().customStencils };
          delete rest[id];
          set({ customStencils: rest });
        },
        importStencils: (list) => {
          const next = { ...get().customStencils };
          let added = 0;
          for (const s of list) {
            if (!s?.id || STENCIL_MAP[s.id] || s.style !== 'image' || !s.image) continue;
            if (!next[s.id]) added++;
            next[s.id] = { ...s, custom: true };
          }
          set({ customStencils: next });
          return added;
        },
      };
    },
    {
      name: 'netcraft',
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId, customStencils: s.customStencils, view: s.view, activeRackId: s.activeRackId }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<DiagramState>;
        if (version < 2) state.customStencils = {};
        return state as DiagramState;
      },
    },
  ),
);

export const useCurrentProject = () => useDiagram((s) => s.projects[s.currentId]);

/** Built-in or custom stencil by id, reactive to library changes. */
export const useStencil = (id: string) => useDiagram((s) => findStencil(id, s.customStencils));

/** Non-reactive lookup for event handlers and exports. */
export const getStencil = (id: string) => findStencil(id, useDiagram.getState().customStencils);
