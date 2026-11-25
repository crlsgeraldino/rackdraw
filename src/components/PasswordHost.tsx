'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { MIN_PASSWORD } from '@/lib/fileCrypto';

/*
 * The app's password box (window.prompt can't hide what is typed, and doesn't exist in the desktop app).
 * askPassword() shows it and resolves with the password, '' for "no password" / "remove" where allowed, or null on
 * Cancel.
 */

export interface AskPassword {
  title: string;
  message: string;
  /** Setting a new password: a second box to confirm it, the minimum length, and the can't-be-recovered warning. */
  confirm?: boolean;
  /** An empty password is allowed and means "no password" (backups). */
  optional?: boolean;
  /** Offer a "Remove password" button (resolves with ''). */
  allowRemove?: boolean;
  /** Shown in red (e.g. after a wrong password). */
  error?: string;
  okLabel?: string;
  /** A second choice (e.g. "Forgot it?"): resolves with PASSWORD_ALT. */
  altLabel?: string;
}

/** What askPassword resolves with when the `altLabel` button is chosen. */
export const PASSWORD_ALT = 'rackdraw:alternative-choice';

interface Pending extends AskPassword { resolve: (v: string | null) => void }
const usePending = create<{ ask: Pending | null }>(() => ({ ask: null }));

export function askPassword(opts: AskPassword): Promise<string | null> {
  return new Promise((resolve) => {
    usePending.getState().ask?.resolve(null);
    usePending.setState({ ask: { ...opts, resolve } });
  });
}

export function PasswordHost() {
  const ask = usePending((s) => s.ask);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [show, setShow] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { setPw(''); setAgain(''); setUnderstood(false); setShow(false); setTimeout(() => first.current?.focus(), 0); }, [ask]);
  if (!ask) return null;

  const done = (v: string | null) => { usePending.setState({ ask: null }); ask.resolve(v); };
  const empty = pw === '';
  const tooShort = ask.confirm && !empty && pw.length < MIN_PASSWORD;
  const mismatch = ask.confirm && !empty && pw !== again;
  const canOk = ask.optional && empty ? true : !empty && !tooShort && !mismatch && (!ask.confirm || understood);
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <form
        className="w-[min(440px,94vw)] rounded-lg bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-label={ask.title}
        onSubmit={(e) => { e.preventDefault(); if (canOk) done(pw); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } }}
      >
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-gray-900"><span aria-hidden>🔒</span>{ask.title}</h2>
        <p className="mb-3 whitespace-pre-line text-sm text-gray-600">{ask.message}</p>
        <label className="mb-2 block">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{ask.confirm ? 'New password' : 'Password'}</span>
          <input ref={first} type={show ? 'text' : 'password'} autoComplete={ask.confirm ? 'new-password' : 'current-password'} className={input} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
        </label>
        {ask.confirm && (
          <label className="mb-2 block">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Type it again</span>
            <input type={show ? 'text' : 'password'} autoComplete="new-password" className={input} value={again} onChange={(e) => setAgain(e.target.value)} aria-label="Confirm password" />
          </label>
        )}
        <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show what I type</label>
        {tooShort && <p className="mb-1 text-xs text-amber-700">At least {MIN_PASSWORD} characters.</p>}
        {mismatch && again !== '' && <p className="mb-1 text-xs text-amber-700">The two passwords are different.</p>}
        {ask.error && <p className="mb-1 text-xs font-medium text-red-600">{ask.error}</p>}
        {ask.confirm && !empty && (
          <label className="mb-2 mt-2 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>I understand that <b>if this password is forgotten, the file can&apos;t be opened by anyone</b> — there is no recovery. I&apos;ll keep it in our password manager.</span>
          </label>
        )}
        <div className="mt-3 flex items-center gap-2">
          {ask.allowRemove && <button type="button" className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => done('')}>Remove password</button>}
          {ask.altLabel && <button type="button" className="rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50" onClick={() => done(PASSWORD_ALT)}>{ask.altLabel}</button>}
          <span className="flex-1" />
          <button type="button" className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={() => done(null)}>Cancel</button>
          <button type="submit" disabled={!canOk} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">{ask.okLabel ?? 'OK'}</button>
        </div>
      </form>
    </div>
  );
}
