'use client';

/**
 * Ribbon icons: small line drawings on a 20×20 grid (stroke = currentColor), drawn here so the app needs no icon
 * library. Coloured accents use fixed colours like Office icons do.
 */
const P: Record<string, React.ReactNode> = {
  new: <><path d="M5 2h7l4 4v12H5z" /><path d="M12 2v4h4" /><path d="M10 9v6M7 12h6" /></>,
  open: <><path d="M2 5h6l2 2h8v9H2z" /><path d="M2 9h16" /></>,
  save: <><path d="M3 3h11l3 3v11H3z" /><path d="M6 3v5h7V3" /><rect x="6" y="11" width="8" height="6" /></>,
  undo: <><path d="M7 5L3 9l4 4" /><path d="M3 9h9a5 5 0 0 1 0 10H9" /></>,
  redo: <><path d="M13 5l4 4-4 4" /><path d="M17 9H8a5 5 0 0 0 0 10h3" /></>,
  print: <><path d="M5 8V2h10v6" /><rect x="2" y="8" width="16" height="7" rx="1" /><path d="M5 13h10v5H5z" /></>,
  pdf: <><path d="M5 2h7l4 4v12H5z" /><path d="M12 2v4h4" /><path d="M7 13h6M7 10h6" stroke="#dc2626" /></>,
  image: <><rect x="2" y="3" width="16" height="14" rx="1" /><circle cx="7" cy="8" r="1.5" /><path d="M2 15l5-5 4 4 2-2 5 5" /></>,
  csv: <><rect x="2" y="3" width="16" height="14" rx="1" /><path d="M2 8h16M2 12.5h16M8 3v14M13 3v14" stroke="#16a34a" /></>,
  paste: <><path d="M7 3H4v15h12V3h-3" /><rect x="7" y="1.5" width="6" height="3" rx="1" /><path d="M8 9h7v8H8z" fill="#fff" /></>,
  cut: <><circle cx="5" cy="15" r="2.5" /><circle cx="15" cy="15" r="2.5" /><path d="M6.5 13L14 3M13.5 13L6 3" /></>,
  copy: <><rect x="6" y="6" width="11" height="12" rx="1" /><path d="M4 14H3V2h11v2" /></>,
  painter: <><rect x="3" y="2" width="12" height="5" rx="1" /><path d="M15 4.5h2v5H9.5v3" /><rect x="8" y="12.5" width="3" height="6" rx="1" /></>,
  duplicate: <><rect x="2" y="2" width="10" height="10" rx="1" /><rect x="8" y="8" width="10" height="10" rx="1" /><path d="M13 11v4M11 13h4" /></>,
  group: <><path d="M2 2h3M15 2h3v3M18 15v3h-3M5 18H2v-3M2 5V2" /><rect x="5" y="5" width="5" height="5" /><circle cx="13" cy="13" r="3" /></>,
  ungroup: <><rect x="2" y="2" width="6" height="6" /><circle cx="14" cy="14" r="4" /></>,
  front: <><rect x="2" y="2" width="9" height="9" fill="#e5e7eb" /><rect x="8" y="8" width="10" height="10" fill="#93c5fd" /></>,
  back: <><rect x="8" y="8" width="10" height="10" fill="#e5e7eb" /><rect x="2" y="2" width="9" height="9" fill="#93c5fd" /></>,
  lock: <><rect x="4" y="9" width="12" height="9" rx="1" /><path d="M7 9V6a3 3 0 0 1 6 0v3" /></>,
  unlock: <><rect x="4" y="9" width="12" height="9" rx="1" /><path d="M7 9V6a3 3 0 0 1 6-.5" /></>,
  arrange: <><rect x="7.5" y="1.5" width="5" height="4" /><rect x="1.5" y="14" width="5" height="4" /><rect x="13.5" y="14" width="5" height="4" /><path d="M10 5.5V10M4 14v-4h12v4" /></>,
  find: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l5 5" /></>,
  replace: <><path d="M3 6h10l-3-3M17 14H7l3 3" /></>,
  selectAll: <><rect x="2" y="2" width="16" height="16" strokeDasharray="2 2" /><path d="M6 10l3 3 5-6" /></>,
  page: <><path d="M5 2h7l4 4v12H5z" /><path d="M12 2v4h4" /></>,
  floorplan: <><path d="M2 2h16v16H2z" /><path d="M2 10h7v8M9 2v4M13 10h5" /></>,
  picture: <><rect x="2" y="3" width="16" height="14" rx="1" /><path d="M2 15l5-5 4 4 2-2 5 5" /><circle cx="14" cy="7" r="1.5" /></>,
  device: <><rect x="1.5" y="6" width="17" height="8" rx="1" /><path d="M4.5 9h2v2h-2zM8 9h2v2H8zM11.5 9h2v2h-2z" /><circle cx="16" cy="10" r=".5" /></>,
  visio: <><rect x="2" y="2" width="16" height="16" rx="2" fill="#3955a3" stroke="#3955a3" /><path d="M6 6l4 9 4-9" stroke="#fff" strokeWidth="2" /></>,
  library: <><path d="M3 3h4v14H3zM8 3h4v14H8z" /><path d="M13 4l3.5-1 2.5 13.5-3.5 1z" /></>,
  text: <><path d="M4 4h12M10 4v13M7 17h6" /></>,
  shapes: <><rect x="2" y="2" width="8" height="8" /><circle cx="14" cy="14" r="4" /></>,
  zone: <><rect x="2" y="3" width="16" height="14" rx="2" strokeDasharray="3 2" stroke="#2563eb" /></>,
  note: <><path d="M3 3h14v10l-4 4H3z" fill="#fef9c3" /><path d="M13 17v-4h4" /></>,
  rotateRight: <><path d="M15 4v4h-4" /><path d="M15 8a6.5 6.5 0 1 0 1.5 5" /><rect x="7" y="9" width="5" height="5" fill="#93c5fd" /></>,
  rotateLeft: <><path d="M5 4v4h4" /><path d="M5 8a6.5 6.5 0 1 1-1.5 5" /><rect x="8" y="9" width="5" height="5" fill="#93c5fd" /></>,
  pointer: <><path d="M5 2l10 9-4.5.8L13 17l-2 1-2.6-5.2L5 15z" /></>,
  lineTool: <><path d="M3 17L17 3" /><circle cx="3" cy="17" r="1.5" /><circle cx="17" cy="3" r="1.5" /></>,
  pencil: <><path d="M3 17l1-4L14 3l3 3L7 16z" /><path d="M12 5l3 3" /><path d="M3 17l4-1" stroke="#2563eb" /></>,
  dimension: <><path d="M2 6v8M18 6v8M3 10h14M3 10l3-2M3 10l3 2M17 10l-3-2M17 10l-3 2" /></>,
  titleBlock: <><rect x="2" y="2" width="16" height="16" /><path d="M2 13h16M8 13v5M13 13v5" /></>,
  jumps: <><path d="M2 10h6a2 2 0 0 1 4 0h6" /><path d="M10 2v16" /></>,
  colors: <><circle cx="7" cy="7" r="4" fill="#93c5fd" /><circle cx="13" cy="7" r="4" fill="#fca5a5" /><circle cx="10" cy="12.5" r="4" fill="#86efac" /></>,
  legend: <><rect x="3" y="3" width="14" height="14" rx="1" /><path d="M6 7h2M6 10h2M6 13h2" stroke="#2563eb" /><path d="M10 7h4M10 10h4M10 13h4" /></>,
  check: <><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z" /><path d="M7 10l2 2 4-4" stroke="#16a34a" /></>,
  layers: <><path d="M10 2l8 4-8 4-8-4z" /><path d="M2 10l8 4 8-4M2 14l8 4 8-4" /></>,
  excel: <><rect x="2" y="2" width="16" height="16" rx="2" fill="#16a34a" stroke="#16a34a" /><path d="M6 6l8 8M14 6l-8 8" stroke="#fff" strokeWidth="2" /></>,
  zoomIn: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l5 5M6 8.5h5M8.5 6v5" /></>,
  zoomOut: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l5 5M6 8.5h5" /></>,
  fit: <><path d="M2 7V2h5M13 2h5v5M18 13v5h-5M7 18H2v-5" /><rect x="6" y="6" width="8" height="8" /></>,
  hundred: <><path d="M3 6l2-1v10M8 5h3v10H8zM14 5h3v10h-3z" /></>,
  racks: <><rect x="4" y="1.5" width="12" height="17" rx="1" /><path d="M6 5h8M6 8h8M6 11h8M6 14h8" /></>,
  diagram: <><rect x="2" y="2" width="6" height="5" /><rect x="12" y="13" width="6" height="5" /><path d="M5 7v3.5h10V13" /></>,
  info: <><circle cx="10" cy="10" r="8" /><path d="M10 9v5M10 6v.5" /></>,
  minimap: <><rect x="2" y="2" width="16" height="16" rx="1" /><rect x="9" y="9" width="7" height="7" fill="#bfdbfe" /></>,
  panes: <><rect x="2" y="3" width="16" height="14" rx="1" /><path d="M7 3v14M13 3v14" /></>,
  fill: <><path d="M4 10l6-6 6 6-6 6z" /><path d="M17 13c1 1.5 1.5 2.5 0 3.5-1.5-1-1-2 0-3.5z" fill="currentColor" /></>,
  line: <><path d="M3 17L17 3" /><path d="M2 19h16" strokeWidth="2.5" /></>,
  edit: <><path d="M12 3l5 5-9 9H3v-5z" /><path d="M10 5l5 5" /></>,
  delete: <><path d="M3 5h14M8 5V3h4v2M5 5l1 13h8l1-13" /></>,
  scale: <><path d="M2 14L14 2l4 4L6 18z" /><path d="M5 11l2 2M8 8l2 2M11 5l2 2" /></>,
  exportFile: <><path d="M5 2h7l4 4v12H5z" /><path d="M12 2v4h4M10 9v7M7 13l3 3 3-3" /></>,
  close: <><path d="M4 4l12 12M16 4L4 16" /></>,
  goBack: <><circle cx="10" cy="10" r="8" /><path d="M11 6l-4 4 4 4" /></>,
  chevronUp: <path d="M5 12l5-5 5 5" />,
  chevronDown: <path d="M5 8l5 5 5-5" />,
  ruler: <><rect x="1.5" y="6" width="17" height="8" /><path d="M4 6v3M7 6v2M10 6v3M13 6v2M16 6v3" /></>,
  grid: <><rect x="2" y="2" width="16" height="16" /><path d="M2 7.3h16M2 12.6h16M7.3 2v16M12.6 2v16" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {P[name] ?? <circle cx="10" cy="10" r="6" />}
    </svg>
  );
}
