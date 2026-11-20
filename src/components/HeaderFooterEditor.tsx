'use client';

import { useRef } from 'react';
import { HF_CODES } from '@/lib/headerFooter';
import type { HeaderFooter } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const EMPTY: HeaderFooter = { header: ['', '', ''], footer: ['', '', ''] };
const SPOTS = ['Left', 'Center', 'Right'] as const;

/**
 * Header & footer for printed and PDF sheets (Visio's Page Setup → Header/Footer): left, centre and right text for
 * each, with codes for page number, date, client… Clicking a code puts it where the cursor last was.
 */
export function HeaderFooterEditor() {
  const project = useCurrentProject();
  const setHF = useDiagram((s) => s.setHeaderFooter);
  const hf = project.headerFooter ?? EMPTY;
  const last = useRef<{ part: 'header' | 'footer'; i: number; el: HTMLInputElement } | null>(null);
  const change = (part: 'header' | 'footer', i: number, v: string) => {
    const next: HeaderFooter = { header: [...hf.header] as HeaderFooter['header'], footer: [...hf.footer] as HeaderFooter['footer'] };
    next[part][i] = v;
    setHF([...next.header, ...next.footer].some((t) => t.trim()) ? next : null);
  };
  const insert = (code: string) => {
    const l = last.current ?? { part: 'footer' as const, i: 2, el: null as unknown as HTMLInputElement };
    const cur = hf[l.part][l.i];
    const at = l.el?.selectionStart ?? cur.length;
    change(l.part, l.i, cur.slice(0, at) + code + cur.slice(at));
  };
  return (
    <div className="text-sm">
      {(['header', 'footer'] as const).map((part) => (
        <div key={part} className="mb-1.5">
          <div className="mb-0.5 text-[11px] font-medium capitalize text-gray-500">{part}</div>
          <div className="grid grid-cols-3 gap-1">
            {SPOTS.map((spot, i) => (
              <input
                key={spot}
                className="min-w-0 rounded border border-gray-300 px-1.5 py-1 text-xs"
                placeholder={spot}
                value={hf[part][i]}
                onFocus={(e) => { last.current = { part, i, el: e.currentTarget }; }}
                onSelect={(e) => { last.current = { part, i, el: e.currentTarget }; }}
                onChange={(e) => change(part, i, e.target.value)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        {HF_CODES.map((c) => (
          <button key={c.code} type="button" className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50" title={`Insert ${c.code}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c.code)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-gray-400">On printed sheets and the PDF. With nothing set, sheets show “Page n of m”. The sheet title shows in the PDF only.</p>
    </div>
  );
}
