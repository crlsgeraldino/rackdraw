'use client';

import { useMemo } from 'react';
import { setPref, usePref } from '@/lib/prefs';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/**
 * Prices for the current client: your price book first, then the prices this client's quote was made with (from its
 * file or a backup). Saving a price puts it in both, so the client's numbers are the same on another computer.
 * Used by the Bill of Materials and the replacement forecast, so a price typed in one shows in the other.
 */
export function usePriceBook() {
  const project = useCurrentProject();
  const book = usePref('priceBook');
  const own = project.quote?.prices;
  const prices = useMemo(() => ({ ...own, ...book }), [own, book]);
  const savePrice = (key: string, v?: number) => {
    const next = { ...book };
    if (v === undefined) delete next[key];
    else next[key] = v;
    setPref('priceBook', next);
    const mine = { ...(project.quote?.prices ?? {}) };
    if (v === undefined) delete mine[key];
    else mine[key] = v;
    useDiagram.getState().updateProject({ quote: { ...project.quote, prices: mine } });
  };
  return { prices, book, savePrice };
}
