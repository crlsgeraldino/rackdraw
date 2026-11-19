'use client';

import { useMemo, useRef, useState } from 'react';
import { readStencilLibrary, saveStencilLibrary } from '@/lib/export';
import { loadImageFile } from '@/lib/imageImport';
import { STENCILS, StencilThumb } from '@/lib/stencils';
import { STENCIL_CATEGORIES, type StencilDef } from '@/lib/types';
import { useDiagram } from '@/store/useDiagramStore';
import { StencilEditor } from './StencilEditor';
import { VisioImportDialog } from './VisioImportDialog';

export const DND_TYPE = 'application/x-netcraft-stencil';

const uid = () => Math.random().toString(36).slice(2, 10);

export function Palette() {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<StencilDef | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const visioRef = useRef<HTMLInputElement>(null);
  const [visioFile, setVisioFile] = useState<File | null>(null);
  const custom = useDiagram((s) => s.customStencils);
  const projects = useDiagram((s) => s.projects);
  const { saveCustomStencil, deleteCustomStencil, importStencils } = useDiagram.getState();

  const customList = useMemo(() => Object.values(custom).sort((a, b) => a.name.localeCompare(b.name)), [custom]);
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = [...customList, ...STENCILS].filter((s) => !term || `${s.name} ${s.vendor ?? ''} ${s.category}`.toLowerCase().includes(term));
    return STENCIL_CATEGORIES.map((c) => ({ c, items: list.filter((s) => s.category === c) })).filter((g) => g.items.length);
  }, [q, customList]);

  const drag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(DND_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onImage = async (file?: File) => {
    if (!file) return;
    try {
      const img = await loadImageFile(file);
      setEditing({
        id: `custom-${uid()}`,
        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
        category: 'Custom',
        style: 'image',
        custom: true,
        image: img.dataUrl,
        width: img.width,
        height: img.height,
        // Start wide images at the built-in panel size and small ones at icon size.
        scale: Math.min(img.width >= img.height * 2 ? 524 : 96, img.width) / img.width,
        ports: [],
      });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onLibrary = async (file?: File) => {
    if (!file) return;
    try {
      const added = importStencils(await readStencilLibrary(file));
      alert(added ? `Imported ${added} stencil${added === 1 ? '' : 's'}.` : 'Those stencils are already in your library (updated).');
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const remove = (s: StencilDef) => {
    const uses = Object.values(projects).reduce((n, p) => n + p.nodes.filter((x) => x.type === 'device' && x.data.stencilId === s.id).length, 0);
    const warn = uses ? `\n\nIt is used by ${uses} device${uses === 1 ? '' : 's'} in your diagrams; they will show as "missing stencil" until you import it again.` : '';
    if (confirm(`Delete the stencil "${s.name}"?${warn}`)) deleteCustomStencil(s.id);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-2">
        <input
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
          placeholder="Search shapes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="border-b border-gray-200 p-2">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">My stencils ({customList.length})</h3>
        </div>
        <button
          onClick={() => imageRef.current?.click()}
          className="mb-1 w-full rounded border border-dashed border-blue-400 bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          title="Import an SVG, PNG or JPG (vendor photo, Visio shape exported as SVG…) and mark its ports"
        >
          + Import image as device
        </button>
        <button
          onClick={() => visioRef.current?.click()}
          className="mb-1 w-full rounded border border-dashed border-violet-400 bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
          title="Import shapes from a Visio stencil (.vssx), e.g. vendor stencils from Dell, Ubiquiti, Cisco"
        >
          + Import Visio stencil (.vssx)
        </button>
        <div className="flex gap-1 text-[11px]">
          <button className="flex-1 rounded px-1 py-0.5 text-gray-600 hover:bg-gray-100" onClick={() => libRef.current?.click()} title="Add stencils from a .netcraft-stencils.json or project file">Import library</button>
          <button className="flex-1 rounded px-1 py-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40" disabled={!customList.length} onClick={() => saveStencilLibrary(customList)} title="Save all your stencils to one file to share with techs">Export library</button>
        </div>
        <input ref={imageRef} type="file" hidden accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={visioRef} type="file" hidden accept=".vssx,.vsdx,.vstx,.vss,.vsd" onChange={(e) => { setVisioFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <input ref={libRef} type="file" hidden accept=".json,application/json" onChange={(e) => { onLibrary(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groups.map(({ c, items }) => (
          <section key={c} className="mb-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{c}</h3>
            <div className="grid grid-cols-1 gap-1">
              {items.map((s) => (
                <div
                  key={s.id}
                  draggable
                  onDragStart={(e) => drag(e, s.id)}
                  className={`group relative flex cursor-grab gap-2 rounded border border-transparent p-1.5 hover:border-gray-200 hover:bg-gray-50 active:cursor-grabbing ${s.style === 'icon' ? 'items-center' : 'flex-col items-start'}`}
                  title={`Drag onto the canvas: ${s.name}`}
                >
                  <div className={s.style === 'icon' ? 'flex w-10 shrink-0 justify-center' : ''}><StencilThumb stencil={s} /></div>
                  <span className="text-xs text-gray-700">
                    {s.name}
                    {s.custom && <span className="ml-1 rounded bg-blue-100 px-1 text-[9px] text-blue-700">mine</span>}
                  </span>
                  {s.custom && (
                    <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                      <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-blue-600" onClick={() => setEditing(s)} title="Edit stencil and ports">✎</button>
                      <button className="rounded bg-white px-1 text-[11px] text-gray-600 shadow hover:text-red-600" onClick={() => remove(s)} title="Delete stencil">✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        <section className="mb-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layout</h3>
          <div className="grid grid-cols-2 gap-1">
            <div draggable onDragStart={(e) => drag(e, '__zone')} className="cursor-grab rounded border-2 border-dashed border-blue-400 bg-blue-50 p-2 text-center text-[11px] text-blue-700">Zone / room</div>
            <div draggable onDragStart={(e) => drag(e, '__note')} className="cursor-grab rounded bg-yellow-100 p-2 text-center text-[11px] text-gray-700 shadow-sm">Note</div>
          </div>
        </section>
      </div>
      <p className="border-t border-gray-200 p-2 text-[10px] leading-snug text-gray-500">
        Drag a shape onto the canvas. Drag from one port to another to draw a cable.
      </p>

      {visioFile && <VisioImportDialog key={`${visioFile.name}:${visioFile.lastModified}:${visioFile.size}`} file={visioFile} onClose={() => setVisioFile(null)} />}
      {editing && (
        <StencilEditor
          initial={editing}
          isNew={!custom[editing.id]}
          onCancel={() => setEditing(null)}
          onSave={(s) => {
            saveCustomStencil(s);
            setEditing(null);
          }}
        />
      )}
    </aside>
  );
}
