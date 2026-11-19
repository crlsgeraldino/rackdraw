'use client';

import { addEdge, type Connection, type EdgeChangeset, type NodeChangeset } from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STENCIL_MAP } from '@/lib/stencils';
import type { AppNode, CableData, CableEdge, DeviceData, PortData, Project } from '@/lib/types';

interface Snapshot {
  nodes: AppNode[];
  edges: CableEdge[];
}

interface DiagramState {
  projects: Record<string, Project>;
  currentId: string;
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
  importProject: (p: Project) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

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
        past: [],
        future: [],

        snapshot: () => {
          const p = cur();
          set({ past: [...get().past.slice(-HISTORY_LIMIT + 1), { nodes: p.nodes, edges: p.edges }], future: [] });
        },
        undo: () => {
          const { past, future } = get();
          if (!past.length) return;
          const p = cur();
          const prev = past[past.length - 1];
          set({ past: past.slice(0, -1), future: [{ nodes: p.nodes, edges: p.edges }, ...future] });
          commit(prev);
        },
        redo: () => {
          const { past, future } = get();
          if (!future.length) return;
          const p = cur();
          const next = future[0];
          set({ past: [...past, { nodes: p.nodes, edges: p.edges }], future: future.slice(1) });
          commit(next);
        },

        onNodesChange: (changes) => {
          const arr = changes.toArray();
          if (arr.some((c) => c.type === 'remove')) get().snapshot();
          const nodes = changes.applyTo(cur().nodes);
          // Removing a device removes its cables too.
          const ids = new Set(nodes.map((n) => n.id));
          const edges = cur().edges.filter((e) => ids.has(e.source) && ids.has(e.target));
          commit({ nodes, edges });
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
          const s = STENCIL_MAP[stencilId];
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
          commit({ nodes, edges: p.edges.filter((e) => !e.selected && ids.has(e.source) && ids.has(e.target)) });
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
          if (get().projects[id]) set({ currentId: id, past: [], future: [] });
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
        importProject: (p) => {
          const copy: Project = { ...p, id: uid(), updatedAt: Date.now() };
          set({ projects: { ...get().projects, [copy.id]: copy }, currentId: copy.id, past: [], future: [] });
        },
      };
    },
    {
      name: 'netcraft',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ projects: s.projects, currentId: s.currentId }),
    },
  ),
);

export const useCurrentProject = () => useDiagram((s) => s.projects[s.currentId]);
