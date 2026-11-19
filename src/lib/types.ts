import type { Edge, Node } from '@xyflow/react';

export type PortKind = 'rj45' | 'sfp' | 'console' | 'usb' | 'power' | 'link';
export type PortSide = 'top' | 'bottom' | 'left' | 'right';

export interface PortDef {
  id: string;
  label: string;
  kind: PortKind;
  /** Geometry in the stencil's native units. */
  x: number;
  y: number;
  w: number;
  h: number;
  side: PortSide;
  /** RJ45 latch notch at the bottom instead of the top. */
  flip?: boolean;
  role?: string;
}

export type StencilCategory = 'Firewalls' | 'Switching' | 'Wireless' | 'Servers' | 'Endpoints' | 'WAN' | 'Layout' | 'Custom';

export const STENCIL_CATEGORIES: StencilCategory[] = ['Firewalls', 'Switching', 'WAN', 'Wireless', 'Servers', 'Endpoints', 'Custom'];

export interface StencilDef {
  id: string;
  name: string;
  vendor?: string;
  category: StencilCategory;
  /** Native artwork size. */
  width: number;
  height: number;
  /** Native units → canvas pixels. */
  scale: number;
  ports: PortDef[];
  /**
   * 'panel' = built-in front-panel art with ports drawn on it; 'icon' = symbol with a caption;
   * 'image' = user-imported SVG/PNG/JPG with ports marked on top of it.
   */
  style: 'panel' | 'icon' | 'image';
  /** Data URL of the artwork, for 'image' stencils. */
  image?: string;
  /** True for stencils the user imported (stored with their data, not in the app). */
  custom?: boolean;
  /** Height in rack units when mounted; undefined = not rack-mount (sits on a shelf, 1U by default). */
  rackUnits?: number;
  defaults?: Partial<DeviceData>;
}

/** Shareable stencil library file. */
export interface StencilLibraryFile {
  format: 'netcraft-stencils';
  version: 1;
  stencils: StencilDef[];
}

export interface PortData {
  label?: string;
  description?: string;
  vlan?: string;
}

export interface DeviceData extends Record<string, unknown> {
  stencilId: string;
  name: string;
  model?: string;
  ip?: string;
  serial?: string;
  location?: string;
  notes?: string;
  assetTag?: string;
  /** Typical power draw in watts, for rack power totals. */
  powerW?: number;
  ports?: Record<string, PortData>;
}

export interface ZoneData extends Record<string, unknown> {
  title: string;
  color: string;
}

export interface NoteData extends Record<string, unknown> {
  text: string;
}

export type DeviceNode = Node<DeviceData, 'device'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type NoteNode = Node<NoteData, 'note'>;
export type AppNode = DeviceNode | ZoneNode | NoteNode;

export type CableType = 'Cat6' | 'Cat5e' | 'Fiber' | 'DAC' | 'WAN' | 'Console' | 'Wireless' | 'VPN';

export interface CableData extends Record<string, unknown> {
  cable: CableType;
  label?: string;
  vlan?: string;
}

export type CableEdge = Edge<CableData, 'cable'>;

/** What a rack slot holds: a device from the diagram, or a passive accessory. */
export type RackItemKind = 'device' | 'blank' | 'shelf' | 'cable-manager' | 'pdu' | 'other';

/** 'full' occupies the slot front and back; 'front'/'rear' leave the other side free. */
export type RackDepth = 'full' | 'front' | 'rear';

export interface RackItem {
  id: string;
  kind: RackItemKind;
  /** Lowest rack unit occupied (1 = bottom). */
  u: number;
  height: number;
  depth: RackDepth;
  /** Diagram device this slot holds (kind === 'device'). */
  nodeId?: string;
  /** Label for accessories. Devices use their diagram name. */
  label?: string;
}

export interface Rack {
  id: string;
  name: string;
  units: number;
  location?: string;
  notes?: string;
  items: RackItem[];
}

export interface Project {
  id: string;
  name: string;
  site?: string;
  address?: string;
  contact?: string;
  notes?: string;
  nodes: AppNode[];
  edges: CableEdge[];
  racks?: Rack[];
  createdAt: number;
  updatedAt: number;
}

export const CABLE_STYLES: Record<CableType, { color: string; dash?: string; width: number }> = {
  Cat6: { color: '#2563eb', width: 2 },
  Cat5e: { color: '#0891b2', width: 2 },
  Fiber: { color: '#ea580c', width: 2.5 },
  DAC: { color: '#4b5563', width: 2.5 },
  WAN: { color: '#dc2626', width: 2.5 },
  Console: { color: '#6b7280', dash: '4 3', width: 1.5 },
  Wireless: { color: '#7c3aed', dash: '2 4', width: 2 },
  VPN: { color: '#059669', dash: '8 4', width: 2 },
};
