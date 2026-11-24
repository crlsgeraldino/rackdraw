'use client';

/*
 * Save / Save As / opening files, the way a desktop program does it.
 *  - Desktop app: the first Save of a client asks where (Save client dialog, .rackdraw); after that Save writes back
 *    to the same file without asking; Save As always asks. Files opened from Explorer or File → Open are linked to
 *    their client, so Save writes back to them.
 *  - Browser: Save downloads the client as a .rackdraw file.
 * Which file a client is linked to (and what it held when last saved, to show unsaved changes) is remembered on this
 * computer only (prefs), never inside the file.
 */
import { useEffect, useState } from 'react';
import { projectFileBytes, projectFilePayload, readProjectFile, safeName, saveProjectFile } from './export';
import { getPref, setPref, usePref } from './prefs';
import { checksum, RACKDRAW_EXT } from './rackdrawFile';
import type { Project } from './types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { showToast } from '@/components/Toast';

export interface DesktopBridge {
  save(bytes: Uint8Array, suggestedName: string, path: string | undefined, saveAs: boolean): Promise<{ path: string; name: string } | null>;
  onOpenFile(cb: (f: { path: string; name: string; bytes: Uint8Array }) => void): () => void;
  ready(): void;
  openPath(path: string): Promise<boolean>;
  showInFolder(path: string): Promise<boolean>;
  pathOf(file: File): string;
}

/** The desktop app's file bridge (electron/preload.cjs); undefined in a browser. */
export const desktop = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { rackdrawDesktop?: DesktopBridge }).rackdrawDesktop;

/** The file a client is linked to on this computer, if any. */
export const fileOf = (projectId: string) => getPref('fileLinks')[projectId];

/** Fields that change without the drawing changing (selection, on-screen measuring, timestamps). */
const VOLATILE = new Set(['selected', 'dragging', 'resizing', 'measured', 'updatedAt']);
/** What the client's file holds, as a short signature: the same signature means nothing to save. */
export function contentSignature(p: Project): string {
  return checksum(JSON.stringify(projectFilePayload(p), (k, v) => (VOLATILE.has(k) ? undefined : v)));
}

export function linkFile(projectId: string, path: string, name: string, sig?: string) {
  setPref('fileLinks', { ...getPref('fileLinks'), [projectId]: { path, name, ...(sig ? { sig } : {}) } });
}

/** Puts a file at the top of File → Recent (ten kept). */
export function addRecent(path: string, name: string) {
  if (!path) return;
  const rest = getPref('recentFiles').filter((r) => r.path.toLowerCase() !== path.toLowerCase());
  setPref('recentFiles', [{ path, name, at: Date.now() }, ...rest].slice(0, 10));
}
export function removeRecent(path: string) {
  setPref('recentFiles', getPref('recentFiles').filter((r) => r.path.toLowerCase() !== path.toLowerCase()));
}

/** The save in progress: saves run one at a time, so a second Ctrl+S can't overtake the first with older content. */
let saving: Promise<unknown> | null = null;

/** File → Save (Ctrl+S) and Save As (Ctrl+Shift+S) for the current client. Resolves with the file, or null if cancelled. */
export async function saveClient(as = false): Promise<{ path: string; name: string } | null> {
  while (saving) await saving.catch(() => undefined);
  const run = saveNow(as);
  saving = run;
  try {
    return await run;
  } finally {
    if (saving === run) saving = null;
  }
}

async function saveNow(as: boolean): Promise<{ path: string; name: string } | null> {
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
    linkFile(p.id, r.path, r.name, contentSignature(p));
    addRecent(r.path, r.name);
    showToast(`Saved to ${r.name}`);
    return r;
  } catch (e) {
    alert(`The client could not be saved: ${(e as Error).message}\n\nTry Save As to pick another place (the disk may be full or the folder read-only).`);
    return null;
  }
}

/**
 * Opens a client file (double-clicked in Explorer, File → Open or Recent in the desktop app). A file that is already
 * open as a client goes to that client unless you choose to open the saved file again as another one.
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
  if (path) addRecent(path, file.name);
  // Linked only to .rackdraw files: an older .json file is saved as a new .rackdraw file (Save asks where).
  if (path && /\.rackdraw$/i.test(path)) {
    const opened = useDiagram.getState().projects[useDiagram.getState().currentId];
    linkFile(opened.id, path, file.name, contentSignature(opened));
  }
}

/** File → Recent: opens the file again; a file that has gone is taken off the list. */
export async function openRecent(path: string, name: string) {
  const d = desktop();
  if (!d) return;
  if (!(await d.openPath(path))) {
    removeRecent(path);
    alert(`"${name}" isn't there any more (moved, renamed or deleted). It has been taken off the list.`);
  }
}

/** Explorer with the file selected. */
export async function showFileInFolder(path: string) {
  const d = desktop();
  if (d && !(await d.showInFolder(path))) alert('That file isn\'t there any more (moved, renamed or deleted).');
}

/**
 * The current client's file and whether it has changes not saved to it. Worked out a moment after the edits stop,
 * so typing stays fast on big drawings.
 */
export function useFileStatus(): { name: string; path: string; dirty: boolean } | null {
  const project = useCurrentProject();
  const links = usePref('fileLinks');
  const link = links[project.id];
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!link) return;
    const t = setTimeout(() => setDirty(!!link.sig && contentSignature(project) !== link.sig), 700);
    return () => clearTimeout(t);
  }, [project, link]);
  return link ? { name: link.name, path: link.path, dirty: !!link.sig && dirty } : null;
}
