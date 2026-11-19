'use client';

import { useMemo } from 'react';
import { displayColors, hiddenLayers } from '@/lib/display';
import { useCurrentProject } from '@/store/useDiagramStore';

/** Data colors and hidden layers for the current client. */
export function useDisplay() {
  const project = useCurrentProject();
  return useMemo(() => ({ ...displayColors(project), hidden: hiddenLayers(project) }), [project]);
}
