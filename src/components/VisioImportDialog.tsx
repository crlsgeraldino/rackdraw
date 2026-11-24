'use client';

import { useEffect, useMemo, useState } from 'react';
import { groupLibraries, libraryNameFromFile, resolveLibrary } from '@/lib/libraries';
import { STENCIL_CATEGORIES, type StencilCategory, type StencilDef } from '@/lib/types';
import { VisioPackage, canvasDibEncoder, type VisioMasterInfo } from '@/lib/visio/vssx';
import { useDiagram } from '@/store/useDiagramStore';
import { LibraryPicker } from './LibraryPicker';

const MAX_SIDE = 2000;
const uid = () => Math.random().toString(36).slice(2, 10);

interface Converted {
  image: string;
  width: number;
  height: number;
  widthIn: number;
  heightIn: number;
  ports: StencilDef['ports'];
  warnings: string[];
}

/** Renders a master and rasterizes it (keeps stored stencils small and fast to draw). */
async function convert(pkg: VisioPackage, m: VisioMasterInfo): Promise<Converted> {
  const r = pkg.render(m, canvasDibEncoder);
  const vb = r.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
  const W = Number(vb[1]), H = Number(vb[2]);
  const k = Math.min(1, MAX_SIDE / Math.max(W, H)) * (Math.max(W, H) < 400 ? 2 : 1); // small shapes: render sharper
  const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(W * k));
    canvas.height = Math.max(1, Math.round(H * k));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      image: canvas.toDataURL('image/webp', 0.92),
      width: canvas.width,
      height: canvas.height,
      widthIn: r.widthIn,
      heightIn: r.heightIn,
      ports: r.ports.map((p) => ({ ...p, x: p.x * k, y: p.y * k, w: p.w * k, h: p.h * k })),
      warnings: r.warnings,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 19" rack gear (16.5–19.5" wide) gets a rack height from its height in inches (1U = 1.75"). */
function guessRackUnits(wIn: number, hIn: number) {
  if (wIn < 16.5 || wIn > 19.6) return undefined;
  return Math.max(1, Math.round(hIn / 1.75));
}

export function VisioImportDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [pkg, setPkg] = useState<VisioPackage | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<VisioMasterInfo | null>(null);
  const [previews, setPreviews] = useState<Record<string, Converted | { error: string }>>({});
  const [category, setCategory] = useState<StencilCategory>('Custom');
  const [withPorts, setWithPorts] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const vendor = file.name.replace(/\.(vssx|vsdx|vstx)$/i, '').replace(/[-_]+/g, ' ');
  const [library, setLibrary] = useState(() => libraryNameFromFile(file.name));
  const custom = useDiagram((s) => s.customStencils);

  useEffect(() => {
    VisioPackage.open(file).then(
      (p) => { setPkg(p); setFocus(p.masters[0] ?? null); },
      (e) => setError((e as Error).message),
    );
  }, [file]);

  // Preview the focused master.
  useEffect(() => {
    if (!pkg || !focus || previews[focus.id]) return;
    let live = true;
    convert(pkg, focus).then(
      (c) => live && setPreviews((p) => ({ ...p, [focus.id]: c })),
      (e) => live && setPreviews((p) => ({ ...p, [focus.id]: { error: (e as Error).message } })),
    );
    return () => { live = false; };
  }, [pkg, focus, previews]);

  const list = useMemo(() => (pkg?.masters ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())), [pkg, q]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const preview = focus ? previews[focus.id] : undefined;

  const run = async () => {
    if (!pkg) return;
    const chosen = pkg.masters.filter((m) => picked.has(m.id));
    const { saveCustomStencil } = useDiagram.getState();
    const target = resolveLibrary(library, groupLibraries(Object.values(custom)).map((l) => l.name));
    const warnings = new Set<string>();
    let done = 0, failed = 0;
    for (const m of chosen) {
      setProgress(`Converting ${done + failed + 1} of ${chosen.length}: ${m.name}`);
      await new Promise((r) => setTimeout(r, 0)); // let the progress text paint
      try {
        const c = (previews[m.id] && !('error' in previews[m.id]) ? previews[m.id] : await convert(pkg, m)) as Converted;
        c.warnings.forEach((w) => warnings.add(w));
        const displayW = Math.max(64, Math.min(700, c.widthIn * 27.6));
        saveCustomStencil({
          id: `custom-${uid()}`,
          name: m.name,
          vendor,
          library: target,
          category,
          style: 'image',
          custom: true,
          image: c.image,
          width: c.width,
          height: c.height,
          scale: displayW / c.width,
          rackUnits: guessRackUnits(c.widthIn, c.heightIn),
          ports: withPorts ? c.ports : [],
        });
        done++;
      } catch {
        failed++;
      }
    }
    setProgress(null);
    alert(
      `Imported ${done} stencil${done === 1 ? '' : 's'} into the library "${target}".` +
      (failed ? `\n${failed} could not be converted.` : '') +
      (warnings.size ? `\n\nNotes:\n• ${[...warnings].join('\n• ')}` : '') +
      '\n\nHover a stencil and click ✎ to name its ports.',
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => !progress && onClose()}>
      <div className="flex h-[640px] max-h-full w-[980px] max-w-full flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Import Visio stencil" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">Import Visio stencil</h2>
            <p className="text-xs text-gray-500">{file.name}{pkg ? ` · ${pkg.masters.length} shapes` : ''}</p>
          </div>
          <button className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} disabled={!!progress} aria-label="Close">×</button>
        </header>

        {error ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-700">{error}</div>
        ) : !pkg ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Reading stencil…</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-80 shrink-0 flex-col border-r border-gray-200">
              <div className="space-y-1 border-b border-gray-200 p-2">
                <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" placeholder="Search shapes…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="flex gap-2 text-[11px]">
                  <button className="text-blue-600 hover:underline" onClick={() => setPicked(new Set([...picked, ...list.map((m) => m.id)]))}>Select {q ? 'matches' : 'all'}</button>
                  <button className="text-blue-600 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
                  <span className="ml-auto text-gray-500">{picked.size} selected</span>
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto py-1 text-sm">
                {list.map((m) => (
                  <li key={m.id} className={`flex items-center gap-2 px-2 py-0.5 ${focus?.id === m.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} />
                    <button className="flex-1 truncate text-left" onClick={() => setFocus(m)} title={m.name}>{m.name}</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex min-w-0 flex-1 flex-col p-4">
              <div className="relative flex min-h-0 flex-1 items-center justify-center rounded border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-4">
                {!focus ? null : !preview ? (
                  <span className="text-sm text-gray-500">Converting preview…</span>
                ) : 'error' in preview ? (
                  <span className="text-sm text-red-600">{preview.error}</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- converted artwork as a data URL
                  <span className="absolute inset-4 flex items-center justify-center"><img src={preview.image} alt={focus.name} className="max-h-full max-w-full object-contain" /></span>
                )}
              </div>
              {focus && preview && !('error' in preview) && (
                <p className="mt-2 text-xs text-gray-600">
                  <b>{focus.name}</b> · {preview.widthIn.toFixed(2)}″ × {preview.heightIn.toFixed(2)}″
                  {guessRackUnits(preview.widthIn, preview.heightIn) ? ` · ${guessRackUnits(preview.widthIn, preview.heightIn)}U rack-mount` : ''}
                  {` · ${preview.ports.length} connection point${preview.ports.length === 1 ? '' : 's'}`}
                  {preview.warnings.length ? ` · ⚠ ${preview.warnings[0]}` : ''}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <div className="flex min-w-[300px] flex-1 items-center gap-1.5" title="The palette shows each library as its own folder. Pick an existing one to add these shapes to it.">
                  Library
                  <LibraryPicker className="flex-1" value={library} onChange={setLibrary} />
                </div>
                <label className="flex items-center gap-1.5">
                  Category
                  <select className="rounded border border-gray-300 px-1.5 py-1" value={category} onChange={(e) => setCategory(e.target.value as StencilCategory)}>
                    {STENCIL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5" title="Visio connection points become places to plug cables in">
                  <input type="checkbox" checked={withPorts} onChange={(e) => setWithPorts(e.target.checked)} />
                  Turn connection points into ports
                </label>
              </div>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5">
          <span className="text-xs text-gray-500">{progress ?? 'Vendor artwork keeps its own license: import it for your own documentation.'}</span>
          <div className="flex gap-2">
            <button className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50" onClick={onClose} disabled={!!progress}>Cancel</button>
            <button disabled={!picked.size || !!progress} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" onClick={run}>
              Import {picked.size || ''} stencil{picked.size === 1 ? '' : 's'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
