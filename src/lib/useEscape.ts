'use client';

/*
 * Escape closes the dialog or panel on top (only that one), wherever the keyboard focus is.
 * A field that uses Escape itself (cancel an edit) calls e.preventDefault() so the dialog stays open.
 */
import { useEffect, useRef } from 'react';

const stack: (() => void)[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || !stack.length) return;
  e.preventDefault();
  stack[stack.length - 1]();
}

export function useEscape(close: () => void, active = true) {
  const latest = useRef(close);
  useEffect(() => { latest.current = close; }, [close]);
  useEffect(() => {
    if (!active) return;
    const f = () => latest.current();
    stack.push(f);
    if (!listening) { window.addEventListener('keydown', onKey); listening = true; }
    return () => {
      const i = stack.lastIndexOf(f);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
