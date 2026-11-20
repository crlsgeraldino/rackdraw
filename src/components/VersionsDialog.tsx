'use client';

import { useEffect, useState } from 'react';
import { useCurrentProject, useDiagram, type ProjectVersion } from '@/store/useDiagramStore';
import { askText } from './PromptHost';

export const VERSIONS_EVENT = 'netcraft:versions';
export const openVersions = () => window.dispatchEvent(new Event(VERSIONS_EVENT));

// One shared empty list: a new [] on every read would look like a change each time and re-render forever.
const NO_VERSIONS: ProjectVersion[] = [];
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * File → Version History (like Visio's): saved copies of this client. Save one before a big change, then restore
 * it or open it as a separate client to compare. One is also kept automatically each day, and before every restore.
 */
export function VersionsDialog() {
  const [open, setOpen] = useState(false);
  const project = useCurrentProject();
  const versions = useDiagram((s) => s.versions[project.id] ?? NO_VERSIONS);
  const { saveVersion, restoreVersion, versionAsCopy, deleteVersion } = useDiagram.getState();
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(VERSIONS_EVENT, show);
    return () => window.removeEventListener(VERSIONS_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!open) return null;

  const save = async () => {
    const name = await askText('Save a version\nName it so you can find it later, e.g. "Before firewall swap".', `Version ${new Date().toLocaleDateString()}`);
    if (name !== null) saveVersion(name || 'Version');
  };
  const counts = (p: typeof project) => {
    const devices = p.pages.reduce((n, pg) => n + pg.nodes.filter((x) => x.type === 'device').length, 0);
    const cables = p.pages.reduce((n, pg) => n + pg.edges.length, 0);
    return `${p.pages.length} page${p.pages.length === 1 ? '' : 's'} · ${devices} device${devices === 1 ? '' : 's'} · ${cables} cable${cables === 1 ? '' : 's'}`;
  };

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="flex max-h-[85vh] w-[min(640px,94vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Version History">
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-900">Version History · {project.name}</h2>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
          <button className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700" onClick={() => void save()}>Save a version now</button>
          <span className="text-xs text-gray-500">Now: {counts(project)}</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {versions.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No versions yet. Save one before a big change; NetCraft also keeps one automatically each day you work on this client.</li>}
          {versions.map((v) => (
            <li key={v.id} className="group flex items-center gap-3 border-b border-gray-100 px-4 py-2 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">
                  {v.name}
                  {v.auto && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">automatic</span>}
                </div>
                <div className="text-[11px] text-gray-500">{when(v.at)} · {counts(v.project)}</div>
              </div>
              <button className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-white" title="Open this version as a separate client, to compare or copy from"
                onClick={() => { versionAsCopy(v.id); setOpen(false); }}>Open as copy</button>
              <button className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-white" title="Make this version the current drawing (the current one is saved as a version first)"
                onClick={() => { if (confirm(`Restore "${v.name}" (${when(v.at)})?\nThe current drawing is saved as a version first, so you can go back.`)) { restoreVersion(v.id); setOpen(false); } }}>Restore</button>
              <button className="invisible rounded px-1 text-xs text-gray-400 hover:text-red-600 group-hover:visible" aria-label={`Delete ${v.name}`}
                onClick={() => { if (confirm(`Delete the version "${v.name}"?`)) deleteVersion(v.id); }}>✕</button>
            </li>
          ))}
        </ul>
        <p className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">Versions are kept on this computer with the client. Named versions stay until you delete them; the latest 20 automatic ones are kept.</p>
      </div>
    </div>
  );
}
