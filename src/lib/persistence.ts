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

/**
 * Where the workspace is stored: 'netcraft' (the app's original name), or a new key after "Start with an empty
 * workspace" when the old data could not even be read — that data then stays untouched under its own key.
 */
const KEY_PREF = 'rackdraw.workspaceKey';
export const WORKSPACE_KEY: string = (() => {
  try { return (typeof window !== 'undefined' && localStorage.getItem(KEY_PREF)) || 'netcraft'; } catch { return 'netcraft'; }
})();

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';
interface Status {
  state: SaveState;
  error?: string;
  lastSaved?: number;
  /** The saved workspace could not be read: the app shows the recovery screen. */
  loadError?: string;
  /** Version History could not be read or saved (the clients themselves are fine). */
  versionsError?: string;
  /** Browser: RackDraw is open in another tab ('busy'), or this tab handed over to another one ('moved'). */
  otherTab?: 'busy' | 'moved';
}
export const useSaveStatus = create<Status>(() => ({ state: 'saved' }));

let latest: { name: string; value: StorageValue<unknown> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
/** Set when loading failed: never write over data we couldn't read. */
let blocked = false;

export function describe(e: unknown) {
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

/** Run before the final save (window hidden or closing): e.g. the change log writes down the last edits. */
const beforeFinal: (() => void)[] = [];
export const addBeforeFinalSave = (f: () => void) => { beforeFinal.push(f); };

/** Saves everything now, after letting `addBeforeFinalSave` hooks record their last changes. */
export function finalSave(): Promise<boolean> {
  for (const f of beforeFinal) { try { f(); } catch { /* a hook must never stop the save */ } }
  return flushSave();
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

/**
 * The raw saved workspace as text, for the recovery screen's download; null when nothing is stored. Throws when the
 * storage can't be read at all (then there is nothing to copy, and nothing may be deleted).
 */
export async function rawSavedData(name = WORKSPACE_KEY): Promise<string | null> {
  let v: unknown;
  try {
    v = await idbGet<unknown>(name);
  } catch (e) {
    throw new Error(`The saved data can't be read even to make a copy (${describe(e)}).`);
  }
  if (v != null) return typeof v === 'string' ? v : JSON.stringify(v);
  try { return localStorage.getItem(name); } catch { return null; }
}

/**
 * Recovery: starts an empty workspace without losing the unreadable data. Data that can be read is copied aside
 * (checked) before the original is removed; data that can't even be read is left exactly where it is, and the new
 * workspace is stored under a new key. Throws (changing nothing) if that isn't possible.
 */
export async function setAsideSavedData(): Promise<'copied' | 'kept'> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let raw: string | null;
  try {
    raw = await rawSavedData();
  } catch {
    try { localStorage.setItem(KEY_PREF, `netcraft-${stamp}`); } catch (e) { throw new Error(`Nothing was changed: a new workspace could not be set up (${describe(e)}).`); }
    return 'kept';
  }
  if (raw != null) {
    const aside = `${WORKSPACE_KEY}-unreadable-${stamp}`;
    await idbSet(aside, raw);
    if ((await idbGet<string>(aside)) !== raw) throw new Error('Nothing was changed: the unreadable data could not be kept aside safely.');
    await del(WORKSPACE_KEY);
  }
  try { localStorage.removeItem(WORKSPACE_KEY); } catch { /* ignore */ }
  return 'copied';
}

/*
 * Browser: only one tab may change the workspace (each tab writes the whole workspace, so two would overwrite each
 * other's clients). The first tab holds a lock; another tab shows "open in another tab" and can take over: the first
 * tab then saves, lets go and stops writing, and the new tab reloads with the fresh data. The desktop app runs a
 * single window and needs none of this.
 */
const LOCK = 'rackdraw-workspace';
let releaseHeld: (() => void) | null = null;
let channel: BroadcastChannel | null = null;

function claimWorkspace() {
  const w = window as unknown as { rackdrawDesktop?: unknown };
  if (w.rackdrawDesktop || !navigator.locks || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(LOCK);
  channel.onmessage = async (e) => {
    if (e.data !== 'release' || !releaseHeld) return;
    await flushSave();
    blocked = true;
    useSaveStatus.setState({ otherTab: 'moved' });
    releaseHeld();
    releaseHeld = null;
    channel?.postMessage('released');
  };
  void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
    if (!lock) {
      blocked = true;
      useSaveStatus.setState({ otherTab: 'busy' });
      return undefined;
    }
    return new Promise<void>((r) => { releaseHeld = r; });
  }).catch(() => undefined);
}

/** "Use RackDraw here": the other tab saves and lets go, then this tab reloads with the fresh data. */
export async function takeOverWorkspace() {
  const ch = channel ?? new BroadcastChannel(LOCK);
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 5000);
    ch.addEventListener('message', (e) => { if (e.data === 'released') { clearTimeout(t); resolve(); } });
    ch.postMessage('release');
  });
  location.reload();
}

if (typeof window !== 'undefined') {
  claimWorkspace();
  // Flush when the window is hidden or closed; Electron also calls this before closing (see electron/main.cjs).
  const now = () => { void finalSave(); };
  window.addEventListener('pagehide', now);
  window.addEventListener('beforeunload', now);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  (window as unknown as { __rackdrawFlush?: () => Promise<boolean> }).__rackdrawFlush = finalSave;
  // Ask the browser not to evict the workspace under storage pressure.
  void navigator.storage?.persist?.().catch(() => undefined);
}
