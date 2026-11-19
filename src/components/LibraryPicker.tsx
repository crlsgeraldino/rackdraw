'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_LIBRARY, groupLibraries, sameLibrary } from '@/lib/libraries';
import { useDiagram } from '@/store/useDiagramStore';

const NEW = '__new__';

/** Picks an existing stencil library or types the name of a new one. */
export function LibraryPicker({ value, onChange, className = '' }: { value: string; onChange: (name: string) => void; className?: string }) {
  const custom = useDiagram((s) => s.customStencils);
  const libraries = useMemo(() => {
    const names = groupLibraries(Object.values(custom)).map((l) => l.name);
    return names.some((n) => sameLibrary(n, DEFAULT_LIBRARY)) ? names : [DEFAULT_LIBRARY, ...names];
  }, [custom]);
  const existing = libraries.find((l) => sameLibrary(l, value));
  // A name that isn't a library yet (e.g. the Visio file name) starts in "new library" mode.
  const [typing, setTyping] = useState(!existing);

  return (
    <div className={`flex min-w-0 gap-1 ${className}`}>
      <select
        className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1"
        value={typing ? NEW : existing ?? NEW}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setTyping(true);
            onChange('');
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
        aria-label="Library"
      >
        {libraries.map((l) => <option key={l} value={l}>{l}</option>)}
        <option value={NEW}>+ New library…</option>
      </select>
      {typing && (
        <input
          autoFocus={!value}
          className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 outline-none focus:border-blue-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Library name"
          aria-label="New library name"
        />
      )}
    </div>
  );
}
