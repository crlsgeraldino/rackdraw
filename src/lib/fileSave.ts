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
import { checksum, packProtected, protectionOf, RACKDRAW_EXT, RACKDRAW_MIME, unprotect } from './rackdrawFile';
import { deriveSecret, makeCheck, passwordMatches, WrongPasswordError, type PasswordCheck, type Secret } from './fileCrypto';
import { downloadBlob } from './export';
import { askPassword } from '@/components/PasswordHost';
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
  const prot = protection.get(projectId);
  setPref('fileLinks', { ...getPref('fileLinks'), [projectId]: { path, name, ...(sig ? { sig } : {}), ...(prot ? { protected: true, check: prot.check } : {}) } });
}

/*
 * Password protection. The key of each protected client is kept in memory only while RackDraw runs (never the
 * password, never on disk). Whether a client's file is protected — and a check value to recognise its password — is
 * remembered on this computer, so after a restart Save asks for the password instead of quietly writing the file
 * unprotected.
 */
const protection = new Map<string, { secret?: Secret; check: PasswordCheck }>();

/** Whether the client's file is password-protected (in this session or as remembered). */
export function isProtected(projectId: string) {
  return protection.has(projectId) || !!fileOf(projectId)?.protected;
}

/** The key to protect the client's file with; asks for the password after a restart. null = cancelled. */
async function secretFor(projectId: string, fileName: string): Promise<Secret | null | undefined> {
  const mem = protection.get(projectId);
  if (mem?.secret) return mem.secret;
  const link = fileOf(projectId);
  const check = mem?.check ?? (link?.protected ? link.check : undefined);
  if (!check) return undefined; // not protected
  let error: string | undefined;
  for (;;) {
    const pw = await askPassword({ title: 'Password needed', message: `"${fileName}" is password-protected. Enter its password to save it (it stays protected).`, error, okLabel: 'Save' });
    if (pw === null) return null;
    if (await passwordMatches(pw, check)) {
      const secret = await deriveSecret(pw);
      protection.set(projectId, { secret, check });
      return secret;
    }
    error = 'Wrong password. Try again.';
  }
}

/** The bytes of the client's file: protected when it is. null = cancelled (no password given). */
async function fileBytes(projectId: string, fileName: string): Promise<Uint8Array | null> {
  const s = useDiagram.getState();
  const plain = projectFileBytes(s.projects[projectId]);
  const secret = await secretFor(projectId, fileName);
  if (secret === null) return null;
  return secret ? packProtected(plain, secret) : plain;
}

/**
 * File → Password: protect the client's file with a password, change it, or remove it; then save. Changing or
 * removing it after a restart needs the current password first.
 */
export async function setClientPassword(): Promise<void> {
  const s = useDiagram.getState();
  const p = s.projects[s.currentId];
  if (!p) return;
  const name = fileOf(p.id)?.name ?? `${safeName(p.name)}${RACKDRAW_EXT}`;
  const was = isProtected(p.id);
  if (was && !protection.get(p.id)?.secret) {
    // Prove it's yours before changing it.
    if ((await secretFor(p.id, name)) === null) return;
  }
  const pw = await askPassword({
    title: was ? 'Change or remove the password' : 'Protect with a password',
    message: was
      ? `"${name}" is protected. Type a new password, or remove the password.`
      : `Anyone opening "${name}" will need this password — in RackDraw, from email, a shared folder or a USB stick.\nThe copy RackDraw keeps on this computer and exports (PDF, Visio, Word…) are not protected.`,
    confirm: true, allowRemove: was, okLabel: was ? 'Change and save' : 'Protect and save',
  });
  if (pw === null) return;
  if (pw === '') {
    if (!confirm(`Remove the password from "${name}"? The file will open without a password.`)) return;
    protection.delete(p.id);
    const link = fileOf(p.id);
    if (link) setPref('fileLinks', { ...getPref('fileLinks'), [p.id]: { path: link.path, name: link.name, ...(link.sig ? { sig: link.sig } : {}) } });
  } else {
    const [secret, check] = await Promise.all([deriveSecret(pw), makeCheck(pw)]);
    protection.set(p.id, { secret, check });
  }
  const r = await saveClient();
  if (r) showToast(pw === '' ? `Password removed: ${r.name}` : `Protected: ${r.name}`);
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
  const suggested = `${safeName(p.name)}${RACKDRAW_EXT}`;
  const bytes = await fileBytes(p.id, fileOf(p.id)?.name ?? suggested);
  if (!bytes) return null;
  if (!d) {
    if (isProtected(p.id)) downloadBlob(suggested, new Blob([bytes as BlobPart], { type: RACKDRAW_MIME }));
    else saveProjectFile(p);
    showToast(`Downloaded ${suggested}`);
    return { path: '', name: suggested };
  }
  try {
    const r = await d.save(bytes, suggested, fileOf(p.id)?.path, as);
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
  // A password-protected file: ask for the password, then read the drawing inside.
  let toRead = file;
  let opened: { secret: Secret; check: PasswordCheck } | null = null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (protectionOf(bytes)) {
    let error: string | undefined;
    for (;;) {
      const pw = await askPassword({ title: 'Password needed', message: `"${file.name}" is password-protected.`, error, okLabel: 'Open' });
      if (pw === null) return;
      try {
        const { inner, secret } = await unprotect(bytes, pw);
        toRead = new File([inner as BlobPart], file.name);
        opened = { secret, check: await makeCheck(pw) };
        break;
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
        error = 'Wrong password. Try again.';
      }
    }
  }
  const { project, stencils } = await readProjectFile(toRead);
  s.importProject(project, stencils);
  if (opened) protection.set(useDiagram.getState().currentId, opened);
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
export function useFileStatus(): { name: string; path: string; dirty: boolean; locked: boolean } | null {
  const project = useCurrentProject();
  const links = usePref('fileLinks');
  const link = links[project.id];
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!link) return;
    const t = setTimeout(() => setDirty(!!link.sig && contentSignature(project) !== link.sig), 700);
    return () => clearTimeout(t);
  }, [project, link]);
  return link ? { name: link.name, path: link.path, dirty: !!link.sig && dirty, locked: !!link.protected || protection.has(project.id) } : null;
}
