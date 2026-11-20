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

/** What you know about one port: what is plugged into it, even when that device isn't drawn on the diagram. */
export interface PortData {
  label?: string;
  /** "Connected to": what is plugged in (e.g. "Front desk printer", "Core switch port 48"). */
  description?: string;
  /** IP of what is plugged in. */
  ip?: string;
  vlan?: string;
  /** This port is an uplink (to the core, firewall, ISP…). */
  uplink?: boolean;
  notes?: string;
}

/** Does this port have anything written down about it? */
export const isDocumented = (pd?: PortData) => !!(pd && (pd.description || pd.ip || pd.vlan || pd.uplink || pd.notes));

/** Editing state shared by every kind of diagram item (Arrange menu, hyperlinks). */
export interface NodeExtras {
  /** Items with the same group id are selected and moved together. */
  group?: string;
  /** Locked items can't be moved, deleted or aligned until unlocked. */
  locked?: boolean;
  /** Hyperlink: a web/mailto address, or `page:<pageId>` to jump to another page of the project. */
  link?: string;
  /** Review comments on this item (Review → New Comment). */
  comments?: ItemComment[];
}

export interface ItemComment {
  id: string;
  author?: string;
  text: string;
  /** Epoch ms. */
  at: number;
  resolved?: boolean;
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
  /** Which fields the label on the diagram shows; missing = name and IP. Empty = no label. */
  labelFields?: DeviceLabelField[];
  /** Where the label was dragged to, relative to its default spot. */
  labelOffset?: { x: number; y: number };
  /** Your own details, e.g. WAN IP, LAN subnet, gateway, ISP circuit ID, firmware. */
  extraFields?: ExtraField[];
  /** The printable info box drawn beside the device. */
  infoBox?: InfoBoxSettings;
  /** Turned clockwise by this many degrees (0–359). */
  rotation?: number;
}

export interface ExtraField {
  label: string;
  value: string;
}

/** Suggested names for extra fields. */
export const EXTRA_FIELD_SUGGESTIONS = [
  'WAN IP', 'LAN subnet', 'Gateway', 'DNS', 'DHCP range', 'Public IP block', 'ISP', 'Circuit ID', 'Firmware',
  'Management VLAN', 'Wi-Fi SSID', 'License expiry', 'Warranty', 'Admin URL', 'VPN', 'Console',
];

export type InfoBoxField = 'model' | 'ip' | 'mac' | 'serial' | 'assetTag' | 'location' | 'extra' | 'notes';
export const INFO_BOX_FIELDS: { value: InfoBoxField; label: string }[] = [
  { value: 'model', label: 'Model' },
  { value: 'ip', label: 'IP' },
  { value: 'mac', label: 'MAC' },
  { value: 'serial', label: 'Serial' },
  { value: 'assetTag', label: 'Asset tag' },
  { value: 'location', label: 'Location' },
  { value: 'extra', label: 'My fields' },
  { value: 'notes', label: 'Notes' },
];
export const DEFAULT_INFO_FIELDS: InfoBoxField[] = ['model', 'ip', 'serial', 'extra'];

/** Which ports the info box lists: none, uplinks only, or every port that has a cable or notes. */
export type InfoBoxPorts = 'none' | 'uplinks' | 'used';

export interface InfoBoxSettings {
  show: boolean;
  fields?: InfoBoxField[];
  ports?: InfoBoxPorts;
  /** Where the box was dragged to, relative to its default spot (right of the device). */
  offset?: { x: number; y: number };
}

export type DeviceLabelField = 'name' | 'ip' | 'model' | 'location' | 'serial';
export const DEVICE_LABEL_FIELDS: { value: DeviceLabelField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'ip', label: 'IP' },
  { value: 'model', label: 'Model' },
  { value: 'location', label: 'Location' },
  { value: 'serial', label: 'Serial' },
];
export const DEFAULT_LABEL_FIELDS: DeviceLabelField[] = ['name', 'ip'];

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

export type ShapeKind = 'text' | 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'arrow' | 'door' | 'window' | 'callout' | 'freeform';

/** A drawing shape for annotations (boxes, callouts, arrows, free text). */
export interface ShapeData extends Record<string, unknown>, NodeExtras {
  kind: ShapeKind;
  text: string;
  fill: string;
  stroke: string;
  textColor: string;
  fontSize: number;
  dashed?: boolean;
  /** Arrow direction / door rotation in degrees (0 = arrow pointing right, door hinged bottom-left). */
  rotation?: number;
  /** Door swings the other way. */
  flip?: boolean;
  layer?: string;
  /** Freeform (Pencil tool): the drawn path as fractions (0–1) of the shape's box. */
  points?: [number, number][];
  // Font and paragraph (Home tab)
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Callout: the item its leader line points to (moves with it). */
  target?: string;
}

export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Change the font size by this many px. */
  sizeDelta?: number;
}

export type ShapeNode = Node<ShapeData, 'shape'>;

/** A dimension line: from the node's position to position + (dx, dy). Its length is shown with the page scale. */
export interface MeasureData extends Record<string, unknown>, NodeExtras {
  dx: number;
  dy: number;
  /** Optional text shown instead of / before the measured length. */
  label?: string;
  /** 'wall' draws a floor-plan wall (thick line), 'line' a plain line (Line tool), instead of a dimension line. */
  variant?: 'dimension' | 'wall' | 'line';
  /** Wall thickness / line width in diagram units. */
  thickness?: number;
  /** Line tool: colour, dashes and arrowheads. */
  color?: string;
  dashed?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  layer?: string;
}
export type MeasureNode = Node<MeasureData, 'measure'>;
export type DeviceNode = Node<DeviceData, 'device'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type NoteNode = Node<NoteData, 'note'>;
export type BackdropNode = Node<BackdropData, 'backdrop'>;
export type AppNode = DeviceNode | ZoneNode | NoteNode | BackdropNode | ShapeNode | MeasureNode;

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
  /** Line color chosen for this cable; missing = color by type or VLAN (View menu). */
  color?: string;
  /** Cable run length as text, e.g. "42 ft" (typed, or measured from a scaled drawing). */
  length?: string;
  /** Show the length on the cable's label. */
  showLength?: boolean;
  /** Where the cable's text sits along it, 0 (source) … 1 (target); missing = the middle. */
  labelAt?: number;
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
  /** Printed and exported (default true). Visio's "Print" column. */
  print?: boolean;
  /** Items can't be selected, moved or deleted. */
  locked?: boolean;
  /** New devices, shapes and cables go on the active layer. */
  active?: boolean;
}

export type DeviceColorBy = 'none' | 'status' | 'location' | 'model' | 'layer';
export type CableColorBy = 'type' | 'vlan';

export interface DisplaySettings {
  deviceColor: DeviceColorBy;
  cableColor: CableColorBy;
  showLegend: boolean;
  /** Hop where cables cross (Visio line jumps); missing = on. */
  lineJumps?: boolean;
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
export type LengthUnit = 'ft' | 'm';

/** Drawing scale of a page: how many real units one diagram unit (px) stands for. */
export interface PageScale {
  perPx: number;
  unit: LengthUnit;
}

export interface Page {
  id: string;
  name: string;
  kind: PageKind;
  nodes: AppNode[];
  edges: CableEdge[];
  scale?: PageScale;
  /** Paper size and orientation of the drawing page (Design → Page Setup); missing = Letter landscape. */
  setup?: { paper: 'letter' | 'legal' | 'tabloid' | 'a4' | 'a3'; landscape: boolean };
  /** A background page (Visio): drawn behind the pages that use it; not printed on its own. */
  background?: boolean;
  /** The background page shown behind this page. */
  backgroundId?: string;
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
  /** Design → Themes: colours for new drawing shapes, callouts and zones. */
  theme?: string;
  /** Saved report definitions (Data → Reports). */
  reports?: import('./report').ReportDef[];
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
