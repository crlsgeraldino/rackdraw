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
  /** Snap moved items to the 10px grid. */
  snapToGrid: boolean;
  /** Stencil ids starred in the Shapes window (Visio's Favorites). */
  favorites: string[];
  /** Your name on comments. */
  author: string;
}
const DEFAULTS: Prefs = { quickInfo: true, minimap: true, shapesPane: true, propsPane: true, ribbonCollapsed: false, rulers: true, grid: true, pageBreaks: true, dynamicGrid: true, snapToGrid: true, favorites: [], author: '' };

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
