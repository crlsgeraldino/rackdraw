'use client';

import { Component, useState, type ReactNode } from 'react';
import { backUpEverything } from '@/lib/backupFlow';
import { downloadBlob, safeName } from '@/lib/export';
import { saveClientCopy } from '@/lib/fileSave';
import { rawSavedData, retrySave, setAsideSavedData, takeOverWorkspace, useSaveStatus } from '@/lib/persistence';
import { useDiagram } from '@/store/useDiagramStore';

const btn = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50';
const primary = 'rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700';

/** A red bar across the top while changes can't be saved, with Retry and Back up now. */
export function SaveBanner() {
  const { state, error, versionsError } = useSaveStatus();
  const [busy, setBusy] = useState(false);
  if (state !== 'error') {
    return versionsError ? (
      <div role="alert" className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-sm text-amber-900">
        {versionsError}
        <button className="ml-auto text-xs underline" onClick={() => useSaveStatus.setState({ versionsError: undefined })}>Hide</button>
      </div>
    ) : null;
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900">
      <b>Your latest changes are not saved:</b> {error}. Keep RackDraw open and back up your work.
      <span className="ml-auto flex gap-2">
        <button className={btn} disabled={busy} onClick={async () => { setBusy(true); await retrySave(); setBusy(false); }}>{busy ? 'Saving…' : 'Retry'}</button>
        <button className={primary} onClick={() => void backUpEverything()}>Back up everything now</button>
      </span>
    </div>
  );
}

/** Shown instead of the editor when the saved workspace can't be read: nothing is overwritten. */
export function RecoveryScreen({ error }: { error: string }) {
  // 'none' until the user has a copy, or knows there can't be one ('unreadable': the data is then left untouched).
  const [copy, setCopy] = useState<'none' | 'downloaded' | 'empty' | 'unreadable'>('none');
  const [note, setNote] = useState('');
  const downloaded = copy !== 'none';
  const download = async () => {
    try {
      const raw = await rawSavedData();
      if (raw == null) { setCopy('empty'); setNote('Nothing is stored, so there is nothing to download.'); return; }
      downloadBlob(`rackdraw-saved-data-${new Date().toISOString().slice(0, 10)}.json`, new Blob([raw], { type: 'application/json' }));
      setCopy('downloaded');
      setNote('');
    } catch (e) {
      setCopy('unreadable');
      setNote(`${(e as Error).message} If you start with an empty workspace, the saved data stays untouched on this computer.`);
    }
  };
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow" role="alert">
        <h1 className="mb-2 text-lg font-semibold text-gray-900">Your saved diagrams couldn&apos;t be opened</h1>
        <p className="mb-2 text-sm text-gray-700">{error}</p>
        <p className="mb-4 text-sm text-gray-600">Nothing has been changed or deleted. Download the saved data first (it can often be repaired), then try again or start with an empty workspace. Clients you saved to files or a backup can be opened again from File.</p>
        <div className="flex flex-wrap gap-2">
          {note && <p className="w-full text-sm font-medium text-amber-800">{note}</p>}
          <button className={primary} onClick={() => void download()}>Download the saved data</button>
          <button className={btn} onClick={() => location.reload()}>Try again</button>
          <button
            className={btn}
            disabled={!downloaded}
            title={downloaded ? 'Keeps the unreadable data aside on this computer, then starts empty' : 'Download the saved data first'}
            onClick={async () => {
              const msg = copy === 'unreadable'
                ? 'Start with an empty workspace? The saved data stays untouched on this computer (RackDraw keeps the new workspace somewhere else).'
                : copy === 'empty' ? 'Start with an empty workspace?' : 'Start with an empty workspace? The unreadable data is kept aside on this computer, and you have downloaded a copy.';
              if (!confirm(msg)) return;
              try {
                await setAsideSavedData();
                location.reload();
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            Start with an empty workspace
          </button>
        </div>
      </div>
    </div>
  );
}

/** Browser: RackDraw is open in another tab (only one tab may change the diagrams, so they can't overwrite each other). */
export function OtherTabScreen({ kind }: { kind: 'busy' | 'moved' }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow" role="alert">
        <h1 className="mb-2 text-lg font-semibold text-gray-900">{kind === 'busy' ? 'RackDraw is already open in another tab' : 'RackDraw is now open in another tab'}</h1>
        <p className="mb-4 text-sm text-gray-600">
          Only one tab or window can change your diagrams at a time, so they never overwrite each other.
          {kind === 'moved' ? ' Your changes here were saved before the other tab took over.' : ' Switch to that tab, or use RackDraw here: the other tab saves its changes first.'}
        </p>
        <button className={primary} disabled={busy} onClick={() => { setBusy(true); void takeOverWorkspace(); }}>{busy ? 'Switching…' : 'Use RackDraw here'}</button>
      </div>
    </div>
  );
}

/** Catches a crash while drawing a client, so one damaged client can't lock the user out of the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const s = useDiagram.getState();
    const current = s.projects[s.currentId];
    const others = Object.values(s.projects).filter((p) => p.id !== s.currentId).sort((a, b) => b.updatedAt - a.updatedAt);
    const reset = () => this.setState({ error: null });
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow" role="alert">
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Something went wrong showing “{current?.name ?? 'this client'}”</h1>
          <p className="mb-1 text-sm text-gray-700">Your work is saved. You can download this client, open another one, or try again.</p>
          <p className="mb-4 break-words font-mono text-xs text-gray-500">{error.message}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {current && <button className={primary} onClick={() => void saveClientCopy(current)}>Save a copy of this client</button>}
            <button className={btn} onClick={() => { s.setView('diagram'); reset(); }}>Try again</button>
            <button className={btn} onClick={() => void backUpEverything()}>Back up everything</button>
          </div>
          {others.length > 0 && (
            <label className="block text-sm text-gray-700">
              Open another client:{' '}
              <select
                className="rounded border border-gray-300 px-1.5 py-1 text-sm"
                defaultValue=""
                onChange={(e) => { if (e.target.value) { s.openProject(e.target.value); reset(); } }}
              >
                <option value="" disabled>Choose…</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {current && (
            <button className="mt-3 text-xs text-gray-500 underline" onClick={() => downloadBlob(`${safeName(current.name)}-raw.json`, new Blob([JSON.stringify(current)], { type: 'application/json' }))}>
              Download this client&apos;s raw data (for support)
            </button>
          )}
        </div>
      </div>
    );
  }
}
