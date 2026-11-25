'use client';

import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/** A labelled group of ribbon commands with its name along the bottom, like Office. */
export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group relative flex shrink-0 flex-col px-1.5 after:absolute after:bottom-3 after:right-0 after:top-1.5 after:w-px after:bg-slate-200 last:after:hidden">
      <div className="flex min-h-0 flex-1 items-stretch gap-0.5">{children}</div>
      <div className="mt-0.5 truncate text-center text-[10px] font-medium leading-3 tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

/** Shared look of ribbon buttons: rounded, soft hover / pressed states, a clear "on" state and a keyboard focus ring. */
const BTN = 'rounded-md text-slate-700 transition-colors duration-100 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:pointer-events-none disabled:opacity-35';
const ON = 'bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.25)] hover:bg-blue-100 hover:text-blue-800';

type BtnProps = {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
};

/** Large button: big icon over a (possibly two-line) label; `caret` marks one that opens a menu. */
export function Big({ icon, label, onClick, disabled, title, active, caret }: BtnProps & { caret?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={active}
      className={`${BTN} flex min-w-[54px] max-w-[86px] flex-col items-center justify-start gap-1 px-1.5 pb-1 pt-1.5 text-[11px] leading-[13px] ${active ? ON : ''}`}
    >
      <Icon name={icon} size={26} />
      <span className="line-clamp-2 text-center">{label}{caret && <span className="ml-0.5 text-[9px] text-slate-400">▾</span>}</span>
    </button>
  );
}

/** Small button: icon and label on one row; stack up to three in a Column. */
export function Small({ icon, label, onClick, disabled, title, active, iconOnly }: BtnProps & { iconOnly?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      className={`${BTN} flex h-[23px] items-center gap-1 whitespace-nowrap px-1 text-[11px] ${active ? ON : ''}`}
    >
      <Icon name={icon} size={16} />
      {/* Hidden when the window is too narrow for this group (see the ribbon's fit check). */}
      {!iconOnly && <span className="ribbon-label">{label}</span>}
    </button>
  );
}

/** Stacks small controls in columns of three (three rows fill the ribbon height); more than three wrap to a new column. */
export function Column({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement);
  const cols: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 3) cols.push(items.slice(i, i + 3));
  if (cols.length <= 1) return <div className="flex flex-col justify-start gap-px py-0.5">{children}</div>;
  return (
    <div className="flex gap-1">
      {cols.map((c, i) => <div key={i} className="flex flex-col justify-start gap-px py-0.5">{c}</div>)}
    </div>
  );
}

/** Checkbox styled for the ribbon. */
export function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="flex h-[23px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-[11px] text-slate-700 transition-colors hover:bg-slate-100" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer rounded accent-blue-600" />
      {label}
    </label>
  );
}

/**
 * A button that opens a floating panel. The panel is positioned with fixed coordinates from the button, so it
 * is never clipped by the ribbon and closes on an outside click or Escape.
 */
export function Drop({
  trigger,
  children,
  width = 220,
}: {
  trigger: (open: () => void, isOpen: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 2 });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <span ref={anchor} className="inline-flex">
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div ref={panel} className="fixed z-[1600] rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-xl ring-1 ring-black/5" style={{ left: pos.left, top: pos.top, width, maxHeight: `calc(100vh - ${pos.top + 8}px)`, overflowY: 'auto' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** Colour swatches used by the Fill / Line drop-downs. */
export const SWATCHES = ['#ffffff', '#f3f4f6', '#dbeafe', '#dcfce7', '#fef9c3', '#fee2e2', '#ede9fe', '#93c5fd', '#2563eb', '#16a34a', '#ea580c', '#dc2626', '#7c3aed', '#374151', '#000000'];

export function Swatches({ onPick, none, auto, noLine }: { onPick: (c: string | undefined) => void; none?: boolean; auto?: string; noLine?: boolean }) {
  return (
    <div>
      <div className="grid grid-cols-5 gap-1">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="h-6 w-full rounded border border-gray-300" style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {none && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => onPick('transparent')}>No fill</button>}
        {noLine && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => onPick('transparent')}>No line</button>}
        {auto && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => onPick(undefined)}>{auto}</button>}
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-gray-600">
          More…
          <input type="color" className="h-5 w-6 cursor-pointer" onChange={(e) => onPick(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
