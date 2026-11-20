/**
 * Design → Themes (like Visio's): a coordinated set of colours for drawing shapes, callouts and zones. Applying a
 * theme recolours what is already drawn; new shapes then use it. Devices and cables keep their own colours (cables
 * are coloured by type / VLAN, devices by their pictures and data colours).
 */

export interface Theme {
  id: string;
  name: string;
  /** Drawing shapes: fill, line and text. */
  fill: string;
  line: string;
  text: string;
  /** Callouts. */
  calloutFill: string;
  calloutLine: string;
  /** Zone colours, used in turn. */
  zones: string[];
}

export const THEMES: Theme[] = [
  { id: 'office', name: 'Office', fill: '#ffffff', line: '#374151', text: '#111827', calloutFill: '#fffbeb', calloutLine: '#d97706', zones: ['#3b82f6', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#6b7280'] },
  { id: 'slate', name: 'Slate', fill: '#f1f5f9', line: '#475569', text: '#0f172a', calloutFill: '#f8fafc', calloutLine: '#64748b', zones: ['#475569', '#64748b', '#334155', '#94a3b8', '#1e293b', '#0f172a'] },
  { id: 'ocean', name: 'Ocean', fill: '#e0f2fe', line: '#0369a1', text: '#0c4a6e', calloutFill: '#ecfeff', calloutLine: '#0891b2', zones: ['#0284c7', '#0891b2', '#0d9488', '#2563eb', '#4f46e5', '#0e7490'] },
  { id: 'forest', name: 'Forest', fill: '#ecfdf5', line: '#047857', text: '#064e3b', calloutFill: '#f7fee7', calloutLine: '#65a30d', zones: ['#059669', '#65a30d', '#0d9488', '#15803d', '#a16207', '#4d7c0f'] },
  { id: 'sunset', name: 'Sunset', fill: '#fff7ed', line: '#c2410c', text: '#431407', calloutFill: '#fef2f2', calloutLine: '#dc2626', zones: ['#ea580c', '#dc2626', '#d97706', '#db2777', '#9333ea', '#b45309'] },
  { id: 'mono', name: 'Monochrome', fill: '#ffffff', line: '#000000', text: '#000000', calloutFill: '#ffffff', calloutLine: '#000000', zones: ['#000000', '#404040', '#737373', '#262626', '#525252', '#a3a3a3'] },
];

export const themeById = (id?: string) => THEMES.find((t) => t.id === id);
