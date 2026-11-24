'use client';

import { Component, useState, type ReactNode } from 'react';
import { downloadBackup } from '@/lib/backup';
import { downloadBlob, safeName, saveProjectFile } from '@/lib/export';
import { rawSavedData, retrySave, setAsideSavedData, useSaveStatus } from '@/lib/persistence';
import { useDiagram } from '@/store/useDiagramStore';

const btn = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50';
const primary = 'rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700';

/** A red bar across the top while changes can't be saved, with Retry and Back up now. */
export function SaveBanner() {
  const { state, error } = useSaveStatus();
  const [busy, setBusy] = useState(false);
  if (state !== 'error') return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900">
      <b>Your latest changes are not saved:</b> {error}. Keep RackDraw open and back up your work.
      <span className="ml-auto flex gap-2">
        <button className={btn} disabled={busy} onClick={async () => { setBusy(true); await retrySave(); setBusy(false); }}>{busy ? 'Saving…' : 'Retry'}</button>
        <button className={primary} onClick={() => void downloadBackup()}>Back up everything now</button>
      </span>
    </div>
  );
}

/** Shown instead of the editor when the saved workspace can't be read: nothing is overwritten. */
export function RecoveryScreen({ error }: { error: string }) {
  const [downloaded, setDownloaded] = useState(false);
  const download = async () => {
    const raw = await rawSavedData();
    downloadBlob(`rackdraw-saved-data-${new Date().toISOString().slice(0, 10)}.json`, new Blob([raw ?? ''], { type: 'application/json' }));
    setDownloaded(true);
  };
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow" role="alert">
        <h1 className="mb-2 text-lg font-semibold text-gray-900">Your saved diagrams couldn&apos;t be opened</h1>
        <p className="mb-2 text-sm text-gray-700">{error}</p>
        <p className="mb-4 text-sm text-gray-600">Nothing has been changed or deleted. Download the saved data first (it can often be repaired), then try again or start with an empty workspace. Clients you saved to files or a backup can be opened again from File.</p>
        <div className="flex flex-wrap gap-2">
          <button className={primary} onClick={() => void download()}>Download the saved data</button>
          <button className={btn} onClick={() => location.reload()}>Try again</button>
          <button
            className={btn}
            disabled={!downloaded}
            title={downloaded ? 'Keeps the unreadable data aside on this computer, then starts empty' : 'Download the saved data first'}
            onClick={async () => {
              if (!confirm('Start with an empty workspace? The unreadable data is kept aside on this computer, and you have downloaded a copy.')) return;
              await setAsideSavedData();
              location.reload();
            }}
          >
            Start with an empty workspace
          </button>
        </div>
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
            {current && <button className={primary} onClick={() => saveProjectFile(current)}>Download this client</button>}
            <button className={btn} onClick={() => { s.setView('diagram'); reset(); }}>Try again</button>
            <button className={btn} onClick={() => void downloadBackup()}>Back up everything</button>
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
