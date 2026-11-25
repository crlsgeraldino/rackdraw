'use client';

import { useSyncExternalStore } from 'react';

/**
 * Per-viewer preferences kept in localStorage (they're about how this person likes to work, not the client's data).
 * Every read and write is guarded: storage can be blocked, and the app must work the same without it.
 */
const KEY = 'netcraft.prefs';

export interface Prefs {
  /** Show a floating card with a device's details when hovering it. */
  quickInfo: boolean;
  /** Pan & Zoom overview (minimap) on the canvas. */
  minimap: boolean;
  /** Shapes window on the left. */
  shapesPane: boolean;
  /** Properties / Shape Data pane on the right. */
  propsPane: boolean;
  /** Ribbon collapsed to its tab names (Ctrl+F1). */
  ribbonCollapsed: boolean;
  rulers: boolean;
  grid: boolean;
  /** Dashed lines where one printed sheet ends and the next begins. */
  pageBreaks: boolean;
  /** Dynamic grid: snap to and show alignment with other items while dragging. */
  dynamicGrid: boolean;
  /** Measurement units: automatic (cm on A-size paper, else inches), inches, centimetres or pixels. */
  units: 'auto' | 'in' | 'cm' | 'px';
  /** Navigation pane (pages and their items). */
  navPane: boolean;
  /** Device Table under the drawing (View → Device Table). */
  deviceTable: boolean;
  /** Snap moved items to the grid (half a grid square). */
  snapToGrid: boolean;
  /** Grid square size in px (View → Grid spacing): 10 fine, 20 normal, 40 coarse. */
  gridSize: number;
  /** Stencil ids starred in the Shapes window (Visio's Favorites). */
  favorites: string[];
  /** Your name on comments. */
  author: string;
  /** Your price book: unit price per Bill of Materials item (key → price), used for every client's quote. */
  priceBook: Record<string, number>;
  /** The .rackdraw file each client is saved to on this computer (client id → file), so Save writes back to it. */
  fileLinks: Record<string, { path: string; name: string; sig?: string; protected?: boolean; check?: import('./fileCrypto').PasswordCheck }>;
  /** Client files opened or saved lately (desktop app), newest first: File → Recent and the taskbar list. */
  recentFiles: { path: string; name: string; at: number }[];
  /** Clients whose files are password-protected (a check value per client id, never the password), also in a browser. */
  protectedClients: Record<string, import('./fileCrypto').PasswordCheck>;
  /** The RackDraw version last used on this computer (What's new shows what came after it). */
  lastSeenVersion: string;
}
const DEFAULTS: Prefs = { quickInfo: true, minimap: true, shapesPane: true, propsPane: true, ribbonCollapsed: false, rulers: true, grid: true, pageBreaks: true, dynamicGrid: true, snapToGrid: true, gridSize: 20, navPane: false, deviceTable: false, units: 'auto', favorites: [], author: '', priceBook: {}, fileLinks: {}, recentFiles: [], protectedClients: {}, lastSeenVersion: '' };

let current: Prefs = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    current = DEFAULTS;
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  load();
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not remembered next time; still applies now.
  }
  listeners.forEach((l) => l());
}

/** Current value outside React (e.g. in store actions). */
export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  load();
  return current[key];
}

export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      load();
      return current[key];
    },
    () => DEFAULTS[key],
  );
}
