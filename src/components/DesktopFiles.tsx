'use client';

import { useEffect } from 'react';
import { desktop, openClientFile } from '@/lib/fileSave';
import { useDiagram } from '@/store/useDiagramStore';

/** Desktop app: opens the files double-clicked in Explorer (also while RackDraw is already running). */
export function DesktopFiles() {
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    const off = d.onOpenFile(async (f) => {
      try {
        await openClientFile(new File([f.bytes as BlobPart], f.name), f.path);
        useDiagram.getState().setView('diagram');
      } catch (e) {
        alert(`"${f.name}" could not be opened.\n\n${(e as Error).message}`);
      }
    });
    const offFailed = d.onOpenFailed?.((r) => alert(`"${r.name}" could not be opened: ${r.reason}.`));
    d.ready();
    return () => { off(); offFailed?.(); };
  }, []);
  return null;
}
