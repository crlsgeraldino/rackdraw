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
  /** Library (palette folder) a custom stencil belongs to, e.g. the Visio file it came from. Missing = "My stencils". */
  library?: string;
  /** Height in rack units when mounted; undefined = not rack-mount (sits on a shelf, 1U by default). */
  rackUnits?: number;
  defaults?: Partial<DeviceData>;
}

/** Shareable stencil library file. */
export interface StencilLibraryFile {
  format: 'netcraft-stencils';
  version: 1;
  /** Library name when the file holds one library; each stencil also carries its own `library`. */
  name?: string;
  stencils: StencilDef[];
}

export interface PortData {
  label?: string;
  description?: string;
  vlan?: string;
}

/** Editing state shared by every kind of diagram item (Arrange menu, hyperlinks). */
export interface NodeExtras {
  /** Items with the same group id are selected and moved together. */
  group?: string;
  /** Locked items can't be moved, deleted or aligned until unlocked. */
  locked?: boolean;
  /** Hyperlink: a web/mailto address, or `page:<pageId>` to jump to another page of the project. */
  link?: string;
}

export interface DeviceData extends Record<string, unknown>, NodeExtras {
  stencilId: string;
  name: string;
  model?: string;
  ip?: string;
  mac?: string;
  serial?: string;
  location?: string;
  notes?: string;
  assetTag?: string;
  /** Typical power draw in watts, for rack power totals. */
  powerW?: number;
  status?: DeviceStatus;
  /** Layer id (see Project.layers). */
  layer?: string;
  ports?: Record<string, PortData>;
}

export interface ZoneData extends Record<string, unknown>, NodeExtras {
  title: string;
  color: string;
}

export interface NoteData extends Record<string, unknown>, NodeExtras {
  text: string;
}

/** A floor plan or site photo placed behind everything on a page. */
export interface BackdropData extends Record<string, unknown> {
  image: string;
  /** Natural size of the image, for keeping proportions when resizing. */
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
  locked: boolean;
}

export type ShapeKind = 'text' | 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'arrow';

/** A drawing shape for annotations (boxes, callouts, arrows, free text). */
export interface ShapeData extends Record<string, unknown>, NodeExtras {
  kind: ShapeKind;
  text: string;
  fill: string;
  stroke: string;
  textColor: string;
  fontSize: number;
  dashed?: boolean;
  /** Arrow direction in degrees (0 = pointing right). */
  rotation?: number;
  layer?: string;
}

export type ShapeNode = Node<ShapeData, 'shape'>;
export type DeviceNode = Node<DeviceData, 'device'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type NoteNode = Node<NoteData, 'note'>;
export type BackdropNode = Node<BackdropData, 'backdrop'>;
export type AppNode = DeviceNode | ZoneNode | NoteNode | BackdropNode | ShapeNode;

export type CableType = 'Cat6' | 'Cat5e' | 'Fiber' | 'DAC' | 'WAN' | 'Console' | 'Wireless' | 'VPN' | 'Line';

export type CableRoute = 'step' | 'straight' | 'curved';
export type CableArrows = 'none' | 'end' | 'start' | 'both';

export interface CableData extends Record<string, unknown> {
  cable: CableType;
  label?: string;
  vlan?: string;
  layer?: string;
  route?: CableRoute;
  arrows?: CableArrows;
}

export type DeviceStatus = 'active' | 'planned' | 'offline' | 'retired';
export const DEVICE_STATUSES: { value: DeviceStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: '#16a34a' },
  { value: 'planned', label: 'Planned', color: '#2563eb' },
  { value: 'offline', label: 'Offline', color: '#dc2626' },
  { value: 'retired', label: 'Retired', color: '#6b7280' },
];

/** Like Visio layers: named groups of devices/cables that can be shown or hidden together. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
}

export type DeviceColorBy = 'none' | 'status' | 'location' | 'model' | 'layer';
export type CableColorBy = 'type' | 'vlan';

export interface DisplaySettings {
  deviceColor: DeviceColorBy;
  cableColor: CableColorBy;
  showLegend: boolean;
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

export interface DataLink {
  fileName: string;
  /** Field → column header name. */
  columns: Record<string, string>;
  matchKey: string;
  createMissing: boolean;
  lastApplied: number;
}

export type PageKind = 'network' | 'floorplan';

/** Drawing title block printed along the bottom of every PDF and printed page (client and site come from the project). */
export interface TitleBlock {
  show: boolean;
  /** Your company (the MSP preparing the document). */
  preparedBy?: string;
  author?: string;
  revision?: string;
  /** Free text; empty = the day it's printed or exported. */
  date?: string;
}

/** One drawing in a client project (like a Visio page). Cables connect devices on the same page. */
export interface Page {
  id: string;
  name: string;
  kind: PageKind;
  nodes: AppNode[];
  edges: CableEdge[];
}

export interface Project {
  id: string;
  name: string;
  site?: string;
  address?: string;
  contact?: string;
  notes?: string;
  pages: Page[];
  activePageId: string;
  /** Racks belong to the client and can hold devices from any page. */
  racks?: Rack[];
  /** The spreadsheet last imported, so it can be re-applied with Refresh. */
  dataLink?: DataLink;
  layers?: Layer[];
  display?: DisplaySettings;
  titleBlock?: TitleBlock;
  /** v0.2 and earlier kept a single diagram here; migrated into `pages` on load. */
  nodes?: AppNode[];
  edges?: CableEdge[];
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
  Line: { color: '#374151', width: 1.5 },
};
