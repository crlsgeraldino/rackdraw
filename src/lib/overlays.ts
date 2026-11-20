'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Sizes of things drawn outside a device's box (its label, its info box), so cables can be routed around them.
 * Sizes are in diagram units (CSS pixels before zoom), keyed `${nodeId}|label` or `${nodeId}|info`.
 */
const sizes = new Map<string, { w: number; h: number }>();
let version = 0;
const listeners = new Set<() => void>();

function set(key: string, size: { w: number; h: number } | null) {
  const old = sizes.get(key);
  if (size ? old && old.w === size.w && old.h === size.h : !old) return;
  if (size) sizes.set(key, size);
  else sizes.delete(key);
  version++;
  listeners.forEach((l) => l());
}

export const overlaySize = (key: string) => sizes.get(key);

/** Re-renders when any overlay changes size. */
export function useOverlayVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0,
  );
}

/** Callback ref for an overlay element: keeps its size registered under `key` while it is mounted. */
export function useOverlaySize<T extends HTMLElement>(key: string) {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el) {
        set(key, null);
        return;
      }
      const measure = () => set(key, { w: el.offsetWidth, h: el.offsetHeight });
      measure();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(el);
    },
    [key],
  );
}
