'use client';

import { useEffect, useMemo, useState } from 'react';
import { CHANGE_KINDS, changeKindLabel, changeLogCsv, changeTime, diffProjects, type ChangeEntry, type ChangeKind } from '@/lib/changeLog';
import { CHANGE_LOG_EVENT } from '@/lib/events';
import { downloadBlob, safeName } from '@/lib/export';
import { addBeforeFinalSave } from '@/lib/persistence';
import type { Project } from '@/lib/types';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Quiet time after the last edit before it is written down (a burst of typing is one change). */
const SETTLE_MS = 4000;

/*
 * Writes the change log: remembers each client as it was, and some seconds after the edits stop (or when the window
 * is hidden or closed) records what changed since. Opening or switching to a client just starts from it.
 */
let base: { id: string; p: Project } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set while the recorder itself writes to the store, so its own update isn't seen as an edit. */
let busy = false;

function record() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!base) return;
  const s = useDiagram.getState();
  const now = s.projects[base.id];
  if (!now) { base = null; return; }
  if (now !== base.p) {
    const entries = diffProjects(base.p, now, Date.now(), getStencil);
    if (entries.length) {
      busy = true;
      try { s.appendChangeLog(base.id, entries); } finally { busy = false; }
    }
  }
  base = { id: base.id, p: useDiagram.getState().projects[base.id] };
}

let started = false;
function start() {
  if (started) return;
  started = true;
  addBeforeFinalSave(record);
  const watch = () => {
    if (busy) return;
    const s = useDiagram.getState();
    const p = s.projects[s.currentId];
    if (!p) return;
    if (!base || !s.projects[base.id]) { base = { id: p.id, p }; return; }
    if (base.id !== p.id) {
      // Switched client: finish the old one, then start from the new one as it is.
      record();
      base = { id: p.id, p };
      return;
    }
    if (p === base.p) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(record, SETTLE_MS);
  };
  watch();
  useDiagram.subscribe(watch);
}

/** Starts the change log recorder once the saved clients are loaded. */
export function ChangeLogRecorder() {
  useEffect(() => {
    if (useDiagram.persist.hasHydrated()) start();
    return useDiagram.persist.onFinishHydration(start);
  }, []);
  return null;
}

/** Opens the Change Log when asked (Review → Change Log). */
export function ChangeLogHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => { record(); setOpen(true); };
    window.addEventListener(CHANGE_LOG_EVENT, show);
    return () => window.removeEventListener(CHANGE_LOG_EVENT, show);
  }, []);
  return open ? <ChangeLogDialog onClose={() => setOpen(false)} /> : null;
}

const ACTION_STYLE: Record<ChangeEntry['action'], string> = {
  added: 'bg-green-100 text-green-800', removed: 'bg-red-100 text-red-800', changed: 'bg-blue-50 text-blue-800', note: 'bg-amber-100 text-amber-800',
};

/** Review → Change Log: what changed, newest first, with filters, notes of your own, and CSV. */
export function ChangeLogDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const log = useMemo(() => project.changeLog ?? [], [project.changeLog]);
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<Set<ChangeKind>>(new Set());
  const [since, setSince] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const from = since ? new Date(`${since}T00:00:00`).getTime() : 0;
    return log
      .filter((e) => (!kinds.size || kinds.has(e.kind)) && e.at >= from && (!term || `${e.target} ${e.detail}`.toLowerCase().includes(term)))
      .slice()
      .reverse();
  }, [log, q, kinds, since]);

  // Grouped by day, newest first.
  const days = useMemo(() => {
    const out: { day: string; items: ChangeEntry[] }[] = [];
    for (const e of shown) {
      const day = changeTime(e.at).slice(0, 10);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [shown]);

  const addNote = () => {
    if (!note.trim()) return;
    useDiagram.getState().addChangeNote(note);
    setNote('');
  };
  const toggle = (k: ChangeKind) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex h-[min(720px,92vh)] w-[min(900px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Change log" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">Change log — {project.name}</h2>
            <p className="text-[11px] text-gray-500">Recorded as you work: devices, details, ports, cables, racks and the IP plan. Saved with the client.</p>
          </div>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        <form className="flex gap-2 border-b border-gray-100 px-4 py-2" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
          <input
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            placeholder="Add a note: ticket #1234, replaced the IDF switch, site visit…" aria-label="Note"
          />
          <button type="submit" disabled={!note.trim()} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">Add note</button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 text-xs">
          <input className="w-48 rounded border border-gray-300 px-2 py-0.5 outline-none focus:border-blue-500" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (name, IP, port…)" aria-label="Search" />
          {CHANGE_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => toggle(k)} className={`rounded-full border px-2 py-0.5 ${kinds.has(k) ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {changeKindLabel(k)}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-gray-600">Since <input type="date" className="rounded border border-gray-300 px-1 py-0.5" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {!log.length && (
            <p className="py-10 text-center text-sm text-gray-500">
              Nothing recorded yet. From now on, adding or editing devices, ports, cables, racks and the IP plan of this client is written down here.
            </p>
          )}
          {log.length > 0 && !shown.length && <p className="py-10 text-center text-sm text-gray-500">Nothing matches the filters.</p>}
          {days.map((d) => (
            <section key={d.day} className="mb-3">
              <h3 className="sticky top-0 bg-white py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{d.day}</h3>
              <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-xs">
                {d.items.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-2 px-2 py-1">
                    <span className="w-10 shrink-0 font-mono text-gray-400">{changeTime(e.at).slice(11)}</span>
                    <span className={`w-14 shrink-0 rounded px-1 text-center text-[10px] ${ACTION_STYLE[e.action]}`}>{changeKindLabel(e.kind)}</span>
                    <span className="min-w-0 flex-1">
                      {e.kind !== 'note' && <b className="font-medium text-gray-900">{e.target}</b>}
                      {e.kind !== 'note' && ' — '}
                      <span className="text-gray-700">{e.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex items-center gap-2 border-t border-gray-200 px-4 py-2.5 text-sm">
          <span className="text-xs text-gray-500">{shown.length === log.length ? `${log.length} entr${log.length === 1 ? 'y' : 'ies'}` : `${shown.length} of ${log.length} entries`}</span>
          <button
            type="button" disabled={!log.length}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
            onClick={() => { if (confirm(`Clear the whole change log of ${project.name}? This can't be undone (save a CSV first if you need it).`)) useDiagram.getState().clearChangeLog(); }}
          >
            Clear log…
          </button>
          <span className="flex-1" />
          <button
            type="button" disabled={!shown.length}
            className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
            onClick={() => downloadBlob(`${safeName(project.name)} change log.csv`, new Blob(['﻿' + changeLogCsv(shown)], { type: 'text/csv;charset=utf-8' }))}
          >
            CSV{shown.length !== log.length ? ' (filtered)' : ''}
          </button>
          <button type="button" className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
