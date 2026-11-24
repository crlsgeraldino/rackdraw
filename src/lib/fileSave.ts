'use client';

/*
 * Save / Save As / opening files, the way a desktop program does it.
 *  - Desktop app: the first Save of a client asks where (Save client dialog, .rackdraw); after that Save writes back
 *    to the same file without asking; Save As always asks. Files opened from Explorer or File → Open are linked to
 *    their client, so Save writes back to them.
 *  - Browser: Save downloads the client as a .rackdraw file.
 * Which file a client is linked to is remembered on this computer only (prefs), never inside the file.
 */
import { projectFileBytes, readProjectFile, safeName, saveProjectFile } from './export';
import { getPref, setPref } from './prefs';
import { RACKDRAW_EXT } from './rackdrawFile';
import { useDiagram } from '@/store/useDiagramStore';
import { showToast } from '@/components/Toast';

export interface DesktopBridge {
  save(bytes: Uint8Array, suggestedName: string, path: string | undefined, saveAs: boolean): Promise<{ path: string; name: string } | null>;
  onOpenFile(cb: (f: { path: string; name: string; bytes: Uint8Array }) => void): () => void;
  ready(): void;
  pathOf(file: File): string;
}

/** The desktop app's file bridge (electron/preload.cjs); undefined in a browser. */
export const desktop = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { rackdrawDesktop?: DesktopBridge }).rackdrawDesktop;

/** The file a client is linked to on this computer, if any. */
export const fileOf = (projectId: string) => getPref('fileLinks')[projectId];

export function linkFile(projectId: string, path: string, name: string) {
  setPref('fileLinks', { ...getPref('fileLinks'), [projectId]: { path, name } });
}

/** File → Save (Ctrl+S) and Save As (Ctrl+Shift+S) for the current client. Resolves with the file, or null if cancelled. */
export async function saveClient(as = false): Promise<{ path: string; name: string } | null> {
  const s = useDiagram.getState();
  const p = s.projects[s.currentId];
  if (!p) return null;
  const d = desktop();
  if (!d) {
    saveProjectFile(p);
    const name = `${safeName(p.name)}${RACKDRAW_EXT}`;
    showToast(`Downloaded ${name}`);
    return { path: '', name };
  }
  try {
    const r = await d.save(projectFileBytes(p), `${safeName(p.name)}${RACKDRAW_EXT}`, fileOf(p.id)?.path, as);
    if (!r) return null;
    linkFile(p.id, r.path, r.name);
    showToast(`Saved to ${r.name}`);
    return r;
  } catch (e) {
    alert(`The client could not be saved: ${(e as Error).message}\n\nTry Save As to pick another place (the disk may be full or the folder read-only).`);
    return null;
  }
}

/**
 * Opens a client file (double-clicked in Explorer, or File → Open in the desktop app). A file that is already open
 * as a client goes to that client unless you choose to open the saved file again as another one.
 */
export async function openClientFile(file: File, path: string): Promise<void> {
  const s = useDiagram.getState();
  const links = getPref('fileLinks');
  const already = path ? Object.entries(links).find(([id, l]) => s.projects[id] && l.path.toLowerCase() === path.toLowerCase())?.[0] : undefined;
  if (already) {
    const again = confirm(`"${file.name}" is already open as the client "${s.projects[already].name}".\n\nOK: open the saved file as another client.\nCancel: go to the client that is open.`);
    if (!again) { s.openProject(already); return; }
  }
  const { project, stencils } = await readProjectFile(file);
  s.importProject(project, stencils);
  // Linked only to .rackdraw files: an older .json file is saved as a new .rackdraw file (Save asks where).
  if (path && /\.rackdraw$/i.test(path)) linkFile(useDiagram.getState().currentId, path, file.name);
}
