'use client';

/**
 * Saving the workspace safely.
 *
 * The store used to write everything to IndexedDB after every change (each drag frame, each keystroke), turning the
 * whole state into JSON every time and ignoring failures. Now:
 *  - changes are coalesced: one write at most every SAVE_DELAY ms, and never two writes at once;
 *  - a failed write (disk full, storage blocked…) is reported to the user and retried, never silently dropped;
 *  - pending changes are flushed when the window is hidden or closed (Electron asks for a flush before closing);
 *  - if the saved data can't be read, saving is blocked so the unreadable data is never overwritten by an empty
 *    workspace, and the app shows a recovery screen instead of loading forever.
 * The stored format is unchanged (the same JSON as zustand's createJSONStorage), so older versions still read it.
 */
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { create } from 'zustand';

const SAVE_DELAY = 400;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';
interface Status {
  state: SaveState;
  error?: string;
  lastSaved?: number;
  /** The saved workspace could not be read: the app shows the recovery screen. */
  loadError?: string;
}
export const useSaveStatus = create<Status>(() => ({ state: 'saved' }));

let latest: { name: string; value: StorageValue<unknown> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
/** Set when loading failed: never write over data we couldn't read. */
let blocked = false;

function describe(e: unknown) {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError') return 'the disk or browser storage is full';
  return err?.message || String(e);
}

function schedule(delay = SAVE_DELAY) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void flushSave(); }, delay);
}

/**
 * Writes pending changes now (also used before the window closes). Resolves only when nothing is waiting and no write
 * is in flight (true) or a write failed (false): several callers can wait at once, and none returns early while
 * another one's write is still running.
 */
export async function flushSave(): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  for (;;) {
    while (writing) await writing;
    if (!latest || blocked) return useSaveStatus.getState().state !== 'error';
    if (!(await writeOnce())) return false;
  }
}

/** Writes the latest state once (sets `writing` before its first await, so others see it in flight). */
function writeOnce(): Promise<boolean> {
  const job = latest!;
  latest = null;
  useSaveStatus.setState({ state: 'saving' });
  let ok = true;
  const run = (async () => {
    try {
      await idbSet(job.name, JSON.stringify(job.value));
      try { localStorage.removeItem(job.name); } catch { /* not needed */ }
      useSaveStatus.setState({ state: latest ? 'pending' : 'saved', error: undefined, lastSaved: Date.now() });
    } catch (e) {
      ok = false;
      // Keep it for the next try, unless something newer is already waiting.
      latest ??= job;
      useSaveStatus.setState({ state: 'error', error: describe(e) });
    }
  })();
  writing = run.then(() => { writing = null; });
  return writing.then(() => ok);
}

/** Retry after a failed save (the banner's Retry button). */
export const retrySave = () => flushSave();

export const rackdrawStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    let raw: string | null | undefined;
    try {
      raw = (await idbGet<string>(name)) ?? localStorage.getItem(name);
    } catch (e) {
      blocked = true;
      throw new Error(`The saved diagrams couldn't be read from this computer's storage (${describe(e)}).`);
    }
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as StorageValue<unknown>;
    } catch {
      blocked = true;
      throw new Error('The saved diagrams are damaged and could not be read.');
    }
  },
  setItem: (name, value) => {
    if (blocked) return;
    latest = { name, value };
    if (useSaveStatus.getState().state !== 'error') useSaveStatus.setState({ state: 'pending' });
    schedule();
  },
  removeItem: (name) => del(name),
};

/** Called when loading failed (zustand's onRehydrateStorage). */
export function reportLoadError(e: unknown) {
  blocked = true;
  useSaveStatus.setState({ loadError: describe(e) });
}

/** The raw saved workspace as text, for the recovery screen's download. */
export async function rawSavedData(name = 'netcraft'): Promise<string | null> {
  try {
    const v = await idbGet<unknown>(name);
    if (v != null) return typeof v === 'string' ? v : JSON.stringify(v);
  } catch { /* fall through */ }
  try { return localStorage.getItem(name); } catch { return null; }
}

/** Recovery: keeps the unreadable data under another key, then starts an empty workspace. */
export async function setAsideSavedData(name = 'netcraft') {
  const raw = await rawSavedData(name);
  if (raw != null) await idbSet(`${name}-unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`, raw);
  await del(name);
  try { localStorage.removeItem(name); } catch { /* ignore */ }
}

if (typeof window !== 'undefined') {
  // Flush when the window is hidden or closed; Electron also calls this before closing (see electron/main.cjs).
  const now = () => { void flushSave(); };
  window.addEventListener('pagehide', now);
  window.addEventListener('beforeunload', now);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  (window as unknown as { __rackdrawFlush?: () => Promise<boolean> }).__rackdrawFlush = flushSave;
  // Ask the browser not to evict the workspace under storage pressure.
  void navigator.storage?.persist?.().catch(() => undefined);
}
