'use client';

import { useMemo } from 'react';
import { displayColors, hiddenLayers } from '@/lib/display';
import type { Project } from '@/lib/types';
import { useCurrentProject } from '@/store/useDiagramStore';

// Worked out once per change of the client and shared: every cable and device asks for it, and each working it out
// on its own (a scan of the whole client) made big pages slow.
const cache = new WeakMap<Project, ReturnType<typeof compute>>();
const compute = (p: Project) => ({ ...displayColors(p), hidden: hiddenLayers(p) });

/** Data colors and hidden layers for the current client. */
export function useDisplay() {
  const project = useCurrentProject();
  return useMemo(() => {
    let v = cache.get(project);
    if (!v) { v = compute(project); cache.set(project, v); }
    return v;
  }, [project]);
}
