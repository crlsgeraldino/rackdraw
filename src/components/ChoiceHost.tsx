'use client';

/*
 * A question with more than OK / Cancel (window.confirm can only do those two): askChoice() shows the app's own small
 * dialog and resolves with the chosen value, or null on Cancel / Escape / a click outside.
 */
import { create } from 'zustand';
import { useEscape } from '@/lib/useEscape';

export interface Choice<T extends string> {
  label: string;
  value: T;
  /** The suggested choice: a filled blue button, focused first. */
  primary?: boolean;
  /** Can't be undone: a red button. */
  danger?: boolean;
}

interface Ask { title: string; message: string; choices: Choice<string>[]; resolve: (v: string | null) => void }
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

export function askChoice<T extends string>(o: { title: string; message: string; choices: Choice<T>[] }): Promise<T | null> {
  return new Promise((resolve) => {
    useAsk.getState().ask?.resolve(null);
    useAsk.setState({ ask: { ...o, resolve: resolve as (v: string | null) => void } });
  });
}

export function ChoiceHost() {
  const ask = useAsk((s) => s.ask);
  const done = (v: string | null) => {
    useAsk.setState({ ask: null });
    ask?.resolve(v);
  };
  useEscape(() => done(null), !!ask);
  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[2900] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <div className="w-[min(480px,94vw)] rounded-lg bg-white p-4 shadow-xl" role="alertdialog" aria-modal="true" aria-label={ask.title}>
        <h2 className="text-base font-semibold text-gray-900">{ask.title}</h2>
        {ask.message.split('\n').filter(Boolean).map((l, i) => <p key={i} className="mt-1.5 text-sm text-gray-600">{l}</p>)}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={() => done(null)}>Cancel</button>
          {ask.choices.map((c) => (
            <button key={c.value} type="button" autoFocus={c.primary} onClick={() => done(c.value)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${c.primary ? 'bg-blue-600 text-white hover:bg-blue-700' : c.danger ? 'border border-red-300 text-red-700 hover:bg-red-50' : 'border border-gray-300 text-gray-800 hover:bg-gray-50'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
