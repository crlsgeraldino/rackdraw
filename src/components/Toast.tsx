'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

/** A short message at the bottom of the window ("Saved to Acme.rackdraw") that goes away by itself. */
const useToast = create<{ text: string | null; n: number }>(() => ({ text: null, n: 0 }));

export function showToast(text: string) {
  useToast.setState((s) => ({ text, n: s.n + 1 }));
}

export function Toast() {
  const { text, n } = useToast();
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => useToast.setState({ text: null }), 2600);
    return () => clearTimeout(t);
  }, [text, n]);
  if (!text) return null;
  return (
    <div role="status" className="pointer-events-none fixed bottom-10 left-1/2 z-[3000] -translate-x-1/2 rounded-md bg-gray-900/90 px-3 py-1.5 text-sm text-white shadow-lg">
      {text}
    </div>
  );
}
