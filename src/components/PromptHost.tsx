'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/*
 * The app's own text prompt. window.prompt() doesn't exist in the desktop (Electron) app, so anything that asks for
 * a line of text uses askText() instead: it shows a small dialog and resolves with the text, or null on Cancel.
 */

interface Ask { message: string; value: string; multiline?: boolean; resolve: (v: string | null) => void }
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

export function askText(message: string, value = '', opts: { multiline?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useAsk.getState().ask?.resolve(null);
    useAsk.setState({ ask: { message, value, multiline: opts.multiline, resolve } });
  });
}

export function PromptHost() {
  const ask = useAsk((s) => s.ask);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ask) setTimeout(() => { field.current?.focus(); field.current?.select(); }, 0);
  }, [ask]);
  if (!ask) return null;
  const done = (v: string | null) => {
    useAsk.setState({ ask: null });
    ask.resolve(v);
  };
  const lines = ask.message.split('\n');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <form
        className="w-[min(420px,92vw)] rounded-lg bg-white p-4 shadow-xl"
        role="dialog"
        aria-label={lines[0]}
        onSubmit={(e) => { e.preventDefault(); done(field.current?.value ?? ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } }}
      >
        <p className="text-sm font-medium text-gray-800">{lines[0]}</p>
        {lines.slice(1).map((l, i) => <p key={i} className="text-xs text-gray-500">{l}</p>)}
        {ask.multiline ? (
          <textarea ref={field} rows={3} defaultValue={ask.value} className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(e.currentTarget.value); } }} />
        ) : (
          <input ref={field} defaultValue={ask.value} className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" />
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">OK</button>
        </div>
      </form>
    </div>
  );
}
