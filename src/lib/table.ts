/** Tables on the page (Insert → Table): a grid of text cells, e.g. a VLAN list or an IP plan. */

export type Cells = string[][];

export const makeTable = (rows: number, cols: number): Cells =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Column ${c + 1}` : '')));

const cols = (t: Cells) => Math.max(1, ...t.map((r) => r.length));

export const insertRow = (t: Cells, at: number): Cells => [...t.slice(0, at), Array(cols(t)).fill(''), ...t.slice(at)];
export const insertCol = (t: Cells, at: number): Cells => t.map((r) => [...r.slice(0, at), '', ...r.slice(at)]);
export const deleteRow = (t: Cells, at: number): Cells => (t.length > 1 ? t.filter((_, i) => i !== at) : t);
export const deleteCol = (t: Cells, at: number): Cells => (cols(t) > 1 ? t.map((r) => r.filter((_, i) => i !== at)) : t);
export const setCell = (t: Cells, r: number, c: number, v: string): Cells => t.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row));

/** Ready-made tables for network documentation. */
export const TABLE_PRESETS: { id: string; label: string; cells: () => Cells }[] = [
  { id: 'vlan', label: 'VLAN table', cells: () => [['VLAN', 'Name', 'Subnet', 'Gateway'], ['1', 'Default', '', ''], ['10', 'Data', '', ''], ['20', 'Voice', '', ''], ['30', 'Guest', '', '']] },
  { id: 'isp', label: 'ISP / circuits', cells: () => [['Provider', 'Circuit ID', 'Speed', 'Public IP', 'Support #'], ['', '', '', '', ''], ['', '', '', '', '']] },
  { id: 'wifi', label: 'Wi-Fi networks', cells: () => [['SSID', 'Security', 'VLAN', 'Notes'], ['', 'WPA2/WPA3', '', ''], ['', '', '', '']] },
];

/** The cell the user last clicked in each table, so the Table ribbon group knows where to add or delete. */
let active: { id: string; r: number; c: number } | null = null;
export const setActiveCell = (id: string, r: number, c: number) => { active = { id, r, c }; };
export const activeCell = (id: string, t: Cells) => (active && active.id === id && active.r < t.length && active.c < cols(t) ? active : { id, r: t.length - 1, c: cols(t) - 1 });
