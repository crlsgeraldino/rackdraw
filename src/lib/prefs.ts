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
}
const DEFAULTS: Prefs = { quickInfo: true, minimap: true, shapesPane: true, propsPane: true, ribbonCollapsed: false };

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
