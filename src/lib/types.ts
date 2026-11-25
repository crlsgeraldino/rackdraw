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

export type StencilCategory =
  | 'Firewalls' | 'Switching' | 'Wireless' | 'Servers' | 'Endpoints' | 'WAN' | 'Layout' | 'Custom'
  | 'Personal' | 'Carrier' | 'Cabling' | 'Infrastructure' | 'Security';

export const STENCIL_CATEGORIES: StencilCategory[] = ['Firewalls', 'Switching', 'WAN', 'Carrier', 'Wireless', 'Personal', 'Servers', 'Infrastructure', 'Security', 'Endpoints', 'Cabling', 'Custom'];

/** The kinds of network a piece of equipment is used in (the Shapes window filters by them). */
export type NetworkScope = 'PAN' | 'WLAN' | 'LAN' | 'CAN' | 'MAN' | 'WAN';
export const NETWORK_SCOPES: { value: NetworkScope; label: string; title: string }[] = [
  { value: 'PAN', label: 'PAN', title: 'Personal area network: Bluetooth / USB devices around one person (phone, watch, headset, keyboard)' },
  { value: 'WLAN', label: 'WLAN', title: 'Wireless LAN: access points, controllers, mesh, bridges, antennas' },
  { value: 'LAN', label: 'LAN', title: 'Local area network: one building (switches, patch panels, servers, endpoints)' },
  { value: 'CAN', label: 'CAN', title: 'Campus area network: several buildings joined by fiber or wireless bridges' },
  { value: 'MAN', label: 'MAN', title: 'Metropolitan area network: city-wide carrier links (metro Ethernet, dark fiber, GPON, microwave)' },
  { value: 'WAN', label: 'WAN', title: 'Wide area network: Internet, MPLS, SD-WAN, VPN, cellular and satellite links between sites' },
];

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
  /** The kinds of network it is used in (PAN … WAN). */
  networks?: NetworkScope[];
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
  /** Link speed, e.g. "1G", "10G". */
  speed?: string;
  /** Power over Ethernet the port supplies, e.g. "PoE+". */
  poe?: string;
  /** Port state as configured / seen on the switch; missing = not recorded. */
  status?: PortStatus;
}

export type PortStatus = 'up' | 'down' | 'disabled';
export const PORT_SPEEDS = ['10M', '100M', '1G', '2.5G', '5G', '10G', '25G', '40G', '100G'];
export const POE_CLASSES = ['PoE', 'PoE+', 'PoE++', 'PoE++ 90W'];
export const PORT_STATUSES: { value: PortStatus; label: string; color: string }[] = [
  { value: 'up', label: 'Up', color: '#16a34a' },
  { value: 'down', label: 'Down', color: '#dc2626' },
  { value: 'disabled', label: 'Disabled', color: '#6b7280' },
];

/** Speed, PoE and status in one line ("1G · PoE+ · Down"), for lists and tables. */
export const portLink = (pd?: PortData) => [pd?.speed, pd?.poe, pd?.status ? PORT_STATUSES.find((s) => s.value === pd.status)?.label : ''].filter(Boolean).join(' · ');

/** Does this port have anything written down about it? */
export const isDocumented = (pd?: PortData) => !!(pd && (pd.description || pd.ip || pd.vlan || pd.uplink || pd.notes || pd.speed || pd.poe || pd.status));

/** Editing state shared by every kind of diagram item (Arrange menu, hyperlinks). */
export interface NodeExtras {
  /** Items with the same group id are selected and moved together. */
  group?: string;
  /** Locked items can't be moved, deleted or aligned until unlocked. */
  locked?: boolean;
  /** Hyperlink: a web/mailto address, or `page:<pageId>` to jump to another page of the project. */
  link?: string;
  /** More hyperlinks (Visio allows several per shape), each with an optional name. */
  moreLinks?: ExtraLink[];
  /** Review comments on this item (Review → New Comment). */
  comments?: ItemComment[];
  /** ScreenTip (Insert → ScreenTip): text shown when hovering the item. */
  tip?: string;
  /** Alt Text: a description for screen readers and exports (Visio's Format Shape → Alt Text). */
  alt?: string;
  /** Protection: the item's text can't be edited on the drawing. */
  lockText?: boolean;
  /** Protection: the item can't be selected (clicks go through it); Arrange → Protection → Allow selecting all. */
  noSelect?: boolean;
}

export interface ExtraLink {
  label?: string;
  address: string;
}

/** Every hyperlink of an item, the main one first. */
export const allLinks = (d: { link?: string; moreLinks?: ExtraLink[] }): ExtraLink[] =>
  [...(d.link?.trim() ? [{ address: d.link }] : []), ...(d.moreLinks ?? []).filter((l) => l.address.trim())];

export interface ItemComment {
  id: string;
  author?: string;
  text: string;
  /** Epoch ms. */
  at: number;
  resolved?: boolean;
  /** Replies, oldest first (a comment thread). */
  replies?: { id: string; author?: string; text: string; at: number }[];
}

export interface DeviceData extends Record<string, unknown>, NodeExtras, TextLook {
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
  /** Weight in pounds, for rack weight totals. */
  weightLb?: number;
  /** UPS rating (UPS devices): output watts and datasheet runtime at half load. */
  ups?: import('./rackPower').UpsInfo;
  /** Lifecycle dates (YYYY-MM-DD): Data → Lifecycle, Check Diagram, Design → Devices by Warranty. */
  purchaseDate?: string;
  warrantyEnd?: string;
  endOfLife?: string;
  /** ISP / carrier circuit this device stands for (Internet, modem / ONT, router…). */
  circuit?: import('./lifecycle').CircuitInfo;
  status?: DeviceStatus;
  /** Layer id (see Project.layers). */
  layer?: string;
  ports?: Record<string, PortData>;
  /** Access point: band and power for the Wi-Fi coverage estimate; missing = 5 GHz at the band's typical power. */
  wifi?: { band?: import('./wifi').Band; eirp?: number };
  /** Which fields the label on the diagram shows; missing = name and IP. Empty = no label. */
  labelFields?: DeviceLabelField[];
  /** Where the label was dragged to, relative to its default spot. */
  labelOffset?: { x: number; y: number };
  /** Your own details, e.g. WAN IP, LAN subnet, gateway, ISP circuit ID, firmware. */
  extraFields?: ExtraField[];
  /** The printable info box drawn beside the device. */
  infoBox?: InfoBoxSettings;
  /**
   * Set while drawing (never saved): an icon whose bottom port is cabled shows its label to the left, so the cable
   * doesn't run through the text.
   */
  labelBeside?: boolean;
  /** The label was dragged while beside its icon: it stays on that side, moved by labelOffset. */
  labelSide?: 'left';
  /** Turned clockwise by this many degrees (0–359). */
  rotation?: number;
  /** An outline round the device (Home → Line / Weight); missing = none. */
  border?: DeviceBorder;
}

export interface DeviceBorder {
  color: string;
  /** Line weight in px; missing = 1.5. */
  width?: number;
  pattern?: LinePattern;
}

export interface ExtraField {
  label: string;
  value: string;
}

/** Define Shape Data (Visio): a field every device of the client gets, with a type and optional pick-list. */
export type FieldType = 'text' | 'number' | 'date' | 'list' | 'yesno';
export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  /** Choices for a list field. */
  options?: string[];
  /** Check Diagram flags devices where it is empty. */
  required?: boolean;
  /** Only devices of this category (empty = every device). */
  category?: StencilCategory;
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

/** Font of an item's own text (device label, zone title, note, cable label); missing = the usual look. */
export interface TextLook {
  fontFamily?: string;
  /** Font colour; missing = the item's usual colour. */
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/** CSS for a TextLook (only what is set). */
export function lookStyle(l: TextLook): { color?: string; fontFamily?: string; fontSize?: number; fontWeight?: number; fontStyle?: string; textDecoration?: string } {
  const deco = [l.underline && 'underline', l.strike && 'line-through'].filter(Boolean).join(' ');
  return {
    ...(l.fontFamily ? { fontFamily: l.fontFamily } : {}),
    ...(l.textColor ? { color: l.textColor } : {}),
    ...(l.fontSize ? { fontSize: l.fontSize } : {}),
    ...(l.bold !== undefined ? { fontWeight: l.bold ? 700 : 400 } : {}),
    ...(l.italic ? { fontStyle: 'italic' } : {}),
    ...(deco ? { textDecoration: deco } : {}),
  };
}

export interface ZoneData extends Record<string, unknown>, NodeExtras, TextLook {
  title: string;
  color: string;
  /** Container style (Visio's container gallery); missing = dashed outline. */
  style?: ZoneStyle;
  /** Show the room's area after its title (needs a page drawing scale), like Visio's space shapes. */
  showArea?: boolean;
  /** Outline weight in px (Home → Weight); missing = the style's own. */
  lineWidth?: number;
}

export type ZoneStyle = 'dashed' | 'solid' | 'header' | 'band' | 'filled';

export interface NoteData extends Record<string, unknown>, NodeExtras, TextLook {
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

export type ShapeKind = 'text' | 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'arrow' | 'door' | 'window' | 'callout' | 'freeform' | 'table' | 'image' | 'offpage';

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
  /** Line weight in px (default 2). */
  lineWidth?: number;
  /** Font name; missing = the app font. */
  fontFamily?: string;
  /** Drop shadow (Shape Style → Shadow). */
  shadow?: boolean;
  /** Freeform (Pencil tool): the drawn path as fractions (0–1) of the shape's box. */
  points?: [number, number][];
  /** Shape operations result: closed outlines as fractions (0–1) of the box, drawn even-odd (inner rings are holes). */
  rings?: [number, number][][];
  // Font and paragraph (Home tab)
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Callout: the item its leader line points to (moves with it). */
  target?: string;
  /** Table (Insert → Table): rows of cell text. */
  cells?: string[][];
  /** Table: the first row is a heading row (bold, shaded). */
  headerRow?: boolean;
  /** Picture (Insert → Picture / paste): the image as a data URL. */
  src?: string;
  /** Fill transparency in percent (0 = solid, 100 = invisible). */
  fillTransparency?: number;
  /** Gradient fill: lighter at the top, the fill colour at the bottom (like Visio's linear gradient). */
  gradient?: boolean;
  /** Line pattern; missing = solid (or dashed when `dashed` is set, from older files). */
  linePattern?: LinePattern;
  /** Rounded corners of a rectangle, in px. */
  rounding?: number;
  /** Bulleted or numbered lines (Home → Paragraph). */
  list?: TextList | null;
  /** Text direction: across (default), or vertical reading down / up (Home → Paragraph). */
  textDir?: TextDir;
  /** Line spacing (1 = single); missing = 1.2. */
  lineSpacing?: number;
  /** Space (px) between the shape's edge and its text (Visio's text-block margins); missing = normal. */
  textMargin?: number;
  /** Picture crop: how much is cut off each side, as fractions (0–1) of the whole picture. */
  crop?: Crop;
  /** Off-page reference: the matching shape on the other page (its `link` is that page). */
  pair?: string;
  /** Callout style; missing = box. */
  calloutStyle?: CalloutStyle;
  /** Door set into a wall: the wall's thickness, so the doorway is cut out of it. */
  wallGap?: number;
  /** Door: how far it is open, as a percentage of a right angle (Visio's door open %); missing = fully open. */
  doorOpen?: number;
  /** Picture flipped left-right / upside down (Arrange → Flip). */
  flipX?: boolean;
  flipY?: boolean;
}

export type TextList = 'bullet' | 'number';
export type CalloutStyle = 'box' | 'rounded' | 'oval' | 'line';
export type TextDir = 'across' | 'down' | 'up';

/** CSS for vertical text: written top-to-bottom ('down'), or turned to read bottom-to-top ('up'). */
export const textDirStyle = (dir?: TextDir): { writingMode?: 'vertical-rl'; transform?: string } =>
  dir === 'down' ? { writingMode: 'vertical-rl' } : dir === 'up' ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } : {};
export interface Crop { l: number; t: number; r: number; b: number }

/** Shape text as list lines: each non-empty line gets a bullet or its number. */
export function listLines(text: string, list?: TextList | null): { mark: string; text: string }[] | null {
  if (!list) return null;
  let i = 0;
  return text.split('\n').map((line) => (line.trim() ? { mark: list === 'bullet' ? '•' : `${++i}.`, text: line } : { mark: '', text: line }));
}

export type LinePattern = 'solid' | 'dash' | 'dot' | 'dashdot';

/** The line pattern of a drawing shape (older files only had "dashed"). */
export const patternOf = (d: { linePattern?: LinePattern; dashed?: boolean }): LinePattern => d.linePattern ?? (d.dashed ? 'dash' : 'solid');

/** SVG dash pattern for a line pattern at a line weight; round caps make the dots round. */
export function dashFor(p: LinePattern, w: number): { strokeDasharray?: string; strokeLinecap?: 'round' } {
  const k = Math.max(1, w);
  if (p === 'dash') return { strokeDasharray: `${3 * k} ${2 * k}` };
  if (p === 'dot') return { strokeDasharray: `0.01 ${2 * k}`, strokeLinecap: 'round' };
  if (p === 'dashdot') return { strokeDasharray: `${4 * k} ${1.8 * k} 0.01 ${1.8 * k}`, strokeLinecap: 'round' };
  return {};
}

/** Shape-only format options (Home → Shape Style → Fill / Line options). */
export interface ShapeFormat {
  fillTransparency?: number;
  gradient?: boolean;
  linePattern?: LinePattern;
  rounding?: number;
}

export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Change the font size by this many px. */
  sizeDelta?: number;
  /** Set the font size (px). */
  fontSize?: number;
  fontFamily?: string;
  /** Bullets / numbering; null = none. */
  list?: TextList | null;
  textDir?: TextDir;
  lineSpacing?: number;
  /** Text margin in px; null = back to normal. */
  textMargin?: number | null;
}

/** Print / PDF header and footer (Visio's Page Setup → Header/Footer): left, centre and right text, with codes. */
export interface HeaderFooter {
  header: [string, string, string];
  footer: [string, string, string];
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
  /** Wall: always show its real length beside it (not only while selected). */
  showLength?: boolean;
  /** Line tool: colour, dashes and arrowheads. */
  color?: string;
  dashed?: boolean;
  /** Line tool: dash / dot / dash-dot (wins over `dashed`). */
  linePattern?: LinePattern;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  layer?: string;
  /** Wall: what it is made of, for the Wi-Fi coverage estimate; missing = drywall. */
  material?: import('./wifi').WallMaterial;
}
export type MeasureNode = Node<MeasureData, 'measure'>;
export type DeviceNode = Node<DeviceData, 'device'>;
export type ZoneNode = Node<ZoneData, 'zone'>;
export type NoteNode = Node<NoteData, 'note'>;
export type BackdropNode = Node<BackdropData, 'backdrop'>;
export type AppNode = DeviceNode | ZoneNode | NoteNode | BackdropNode | ShapeNode | MeasureNode;

export type CableType =
  | 'Cat6' | 'Cat6a' | 'Cat5e' | 'Fiber' | 'Fiber SM' | 'Fiber MM' | 'DAC' | 'Coax' | 'WAN' | 'MPLS' | 'Serial' | 'Console' | 'USB'
  | 'Wireless' | 'Bluetooth' | 'Cellular' | 'Microwave' | 'Satellite' | 'VPN' | 'Line';

export type CableRoute = 'step' | 'straight' | 'curved';
export type CableArrows = 'none' | 'end' | 'start' | 'both';

export interface CableData extends Record<string, unknown>, TextLook {
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
  /** Line weight chosen for this cable (px); missing = by cable type. */
  weight?: number;
  /** What the cable is for (WAN uplink, uplink, access…); missing = worked out from its ends; 'none' = none. */
  role?: import('./cableRole').CableRole | 'none';
  /** The text this cable shows; missing = the client's setting (Design → Cable Text). */
  tag?: import('./cableRole').CableTag;
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

export type DeviceColorBy = 'none' | 'status' | 'location' | 'model' | 'layer' | 'warranty';
export type CableColorBy = 'type' | 'vlan';

export interface DisplaySettings {
  deviceColor: DeviceColorBy;
  cableColor: CableColorBy;
  showLegend: boolean;
  /** Hop where cables cross (Visio line jumps); missing = on. */
  lineJumps?: boolean;
  /** Data Graphics (Visio): fields shown as small tags or icons on every device. */
  dataGraphics?: DataGraphic[];
  /** Design → Fonts: the client's font for all text that has no font of its own; missing = the app font. */
  font?: string;
  /** Design → Connectors: how cables hop where they cross; missing = arc. */
  jumpStyle?: JumpStyle;
  /** Line jump size (radius, px); missing = 5. */
  jumpSize?: number;
  /** Corner radius of right-angle cables (px); 0 = square corners; missing = 8. */
  cableCorners?: number;
  /** Design → Cable Text: what every cable shows (typed label, function, type, or both); missing = label only. */
  cableTag?: import('./cableRole').CableTag;
  /** Design → Cable Text: the port each cable plugs into, written at each end ("X1", "24"). */
  cablePorts?: boolean;
  /** Design → Backgrounds: the drawing page's colour; missing = white. */
  pageColor?: string;
  /** Design → Borders & Titles: a border design round the page, most with the page name, client, date and page number. */
  frame?: PageFrame;
  /** Colour of the border; missing = navy. */
  frameColor?: string;
  /** Borders & Titles: show the date (missing = yes). */
  frameDate?: boolean;
  /** Borders & Titles: show "Page n of m" (missing = yes). */
  framePage?: boolean;
}

export type JumpStyle = 'arc' | 'gap' | 'square';
export type PageFrame = 'none' | 'simple' | 'banner' | 'classic' | 'engineer' | 'corners' | 'sideband' | 'underline' | 'footer' | 'headfoot' | 'tab' | 'rounded' | 'modern';
export const FRAME_COLOR = '#1e3a8a';

export interface DataGraphic {
  /** Field key, as in Reports: 'ip', 'model', 'status', … or 'x:<field name>'. */
  field: string;
  /** 'tag' shows the value as text; 'icon' shows ✔ / ✘ for yes-no values, a coloured dot for status, else the text. */
  style: 'tag' | 'icon';
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
  /** The rack's power circuit: volts, amps, and whether it has A + B feeds (each must carry the whole load). */
  feedVolts?: number;
  feedAmps?: number;
  redundantFeeds?: boolean;
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
  /** Floor plan: show the Wi-Fi coverage estimate (Data → Wi-Fi Plan). */
  wifi?: { show?: boolean; people?: number };
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
  /** Define Shape Data: fields every device gets (values live in each device's extra fields, by name). */
  fieldDefs?: FieldDef[];
  /** Header and footer on printed and PDF sheets. */
  headerFooter?: HeaderFooter;
  /** Design → Themes: colours for new drawing shapes, callouts and zones. */
  theme?: string;
  /** Saved report definitions (Data → Reports). */
  reports?: import('./report').ReportDef[];
  /** Cost estimate / quote settings (Data → Bill of Materials → Labor & quote). */
  quote?: import('./quote').QuoteSettings;
  /** VLAN / IP plan (Data → IP Plan). */
  vlans?: import('./ipam').VlanDef[];
  display?: DisplaySettings;
  titleBlock?: TitleBlock;
  /** What changed in the documentation and when (Review → Change Log), newest last. */
  changeLog?: import('./changeLog').ChangeEntry[];
  /** v0.2 and earlier kept a single diagram here; migrated into `pages` on load. */
  nodes?: AppNode[];
  edges?: CableEdge[];
  createdAt: number;
  updatedAt: number;
}

export const CABLE_STYLES: Record<CableType, { color: string; dash?: string; width: number }> = {
  Cat6: { color: '#2563eb', width: 2 },
  Cat6a: { color: '#1d4ed8', width: 2.2 },
  Cat5e: { color: '#0891b2', width: 2 },
  Fiber: { color: '#ea580c', width: 2.5 },
  'Fiber SM': { color: '#ca8a04', width: 2.5 },
  'Fiber MM': { color: '#06b6d4', width: 2.5 },
  DAC: { color: '#4b5563', width: 2.5 },
  Coax: { color: '#78350f', width: 2.5 },
  WAN: { color: '#dc2626', width: 2.5 },
  MPLS: { color: '#be123c', dash: '10 3 2 3', width: 2.5 },
  Serial: { color: '#57534e', dash: '6 2', width: 1.8 },
  Console: { color: '#6b7280', dash: '4 3', width: 1.5 },
  USB: { color: '#475569', width: 1.5 },
  Wireless: { color: '#7c3aed', dash: '2 4', width: 2 },
  Bluetooth: { color: '#0284c7', dash: '1 3', width: 2 },
  Cellular: { color: '#c026d3', dash: '6 3', width: 2 },
  Microwave: { color: '#9333ea', dash: '12 4', width: 2.5 },
  Satellite: { color: '#4f46e5', dash: '3 5', width: 2 },
  VPN: { color: '#059669', dash: '8 4', width: 2 },
  Line: { color: '#374151', width: 1.5 },
};
