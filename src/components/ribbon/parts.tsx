'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/** A labelled group of ribbon commands with its name along the bottom, like Office. */
export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r border-gray-200 px-1.5 last:border-r-0">
      <div className="flex min-h-0 flex-1 items-stretch gap-0.5">{children}</div>
      <div className="mt-0.5 truncate text-center text-[10px] leading-3 text-gray-500">{label}</div>
    </div>
  );
}

type BtnProps = {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
};

/** Large button: big icon over a (possibly two-line) label. */
export function Big({ icon, label, onClick, disabled, title, active }: BtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex w-[52px] flex-col items-center justify-start gap-0.5 rounded px-0.5 pt-1 text-[11px] leading-tight text-gray-800 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent ${active ? 'bg-blue-100 ring-1 ring-blue-300' : ''}`}
    >
      <Icon name={icon} size={26} />
      <span className="line-clamp-2 text-center">{label}</span>
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
      aria-label={iconOnly ? label : undefined}
      className={`flex h-[22px] items-center gap-1 whitespace-nowrap rounded px-1 text-[11px] text-gray-800 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent ${active ? 'bg-blue-100 ring-1 ring-blue-300' : ''}`}
    >
      <Icon name={icon} size={16} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

/** Stacks small controls in a column (three rows fill the ribbon height). */
export function Column({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col justify-start gap-px py-0.5">{children}</div>;
}

/** Checkbox styled for the ribbon. */
export function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="flex h-[22px] items-center gap-1 whitespace-nowrap px-1 text-[11px] text-gray-800" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3 w-3" />
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
        <div ref={panel} className="fixed z-[1600] rounded border border-gray-200 bg-white p-2 text-sm shadow-xl" style={{ left: pos.left, top: pos.top, width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** Colour swatches used by the Fill / Line drop-downs. */
export const SWATCHES = ['#ffffff', '#f3f4f6', '#dbeafe', '#dcfce7', '#fef9c3', '#fee2e2', '#ede9fe', '#93c5fd', '#2563eb', '#16a34a', '#ea580c', '#dc2626', '#7c3aed', '#374151', '#000000'];

export function Swatches({ onPick, none, auto }: { onPick: (c: string | undefined) => void; none?: boolean; auto?: string }) {
  return (
    <div>
      <div className="grid grid-cols-5 gap-1">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="h-6 w-full rounded border border-gray-300" style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {none && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => onPick('transparent')}>No fill</button>}
        {auto && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => onPick(undefined)}>{auto}</button>}
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-gray-600">
          More…
          <input type="color" className="h-5 w-6 cursor-pointer" onChange={(e) => onPick(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
