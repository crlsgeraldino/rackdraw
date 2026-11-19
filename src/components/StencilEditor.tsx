'use client';

import { useMemo, useRef, useState } from 'react';
import { STENCIL_CATEGORIES, type PortDef, type PortKind, type PortSide, type StencilCategory, type StencilDef } from '@/lib/types';

const KINDS: { value: PortKind; label: string }[] = [
  { value: 'rj45', label: 'RJ45' },
  { value: 'sfp', label: 'SFP / SFP+' },
  { value: 'console', label: 'Console' },
  { value: 'usb', label: 'USB' },
  { value: 'power', label: 'Power' },
  { value: 'link', label: 'Other / wireless' },
];
const SIDES: PortSide[] = ['top', 'bottom', 'left', 'right'];

const VIEW_W = 680;
const VIEW_H = 380;

/** Picks the edge a cable should leave from, based on where the port sits on the device. */
function guessSide(cx: number, cy: number, w: number, h: number): PortSide {
  const dx = Math.min(cx, w - cx) / w;
  const dy = Math.min(cy, h - cy) / h;
  if (dx < dy && dx < 0.12) return cx < w / 2 ? 'left' : 'right';
  return cy < h / 2 ? 'top' : 'bottom';
}

function nextLabel(ports: PortDef[]) {
  for (let i = ports.length + 1; ; i++) {
    const label = `P${i}`;
    if (!ports.some((p) => p.id === label || p.label === label)) return label;
  }
}

export function StencilEditor({ initial, isNew, onSave, onCancel }: { initial: StencilDef; isNew: boolean; onSave: (s: StencilDef) => void; onCancel: () => void }) {
  const [s, setS] = useState<StencilDef>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const k = Math.min(VIEW_W / s.width, VIEW_H / s.height); // native → editor pixels
  const canvasWidth = Math.round(s.width * s.scale);
  const sel = s.ports.find((p) => p.id === selected) ?? null;
  const dupLabels = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const p of s.ports) (seen.has(p.label) ? dups : seen).add(p.label);
    return dups;
  }, [s.ports]);

  const toNative = (e: React.PointerEvent) => {
    const r = surface.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(s.width, (e.clientX - r.left) / k)),
      y: Math.max(0, Math.min(s.height, (e.clientY - r.top) / k)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-port]')) return;
    const p = toNative(e);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released (e.g. a very quick click); dragging still works without capture.
    }
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    setSelected(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = toNative(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!draft) return;
    let x = Math.min(draft.x0, draft.x1);
    let y = Math.min(draft.y0, draft.y1);
    let w = Math.abs(draft.x1 - draft.x0);
    let h = Math.abs(draft.y1 - draft.y0);
    // A click (no drag) drops a default-size port centred on the pointer.
    if (w * k < 6 || h * k < 6) {
      const size = Math.max(8, Math.min(s.width, s.height) * 0.12);
      w = h = size;
      x = Math.max(0, Math.min(s.width - size, draft.x0 - size / 2));
      y = Math.max(0, Math.min(s.height - size, draft.y0 - size / 2));
    }
    const label = nextLabel(s.ports);
    const port: PortDef = {
      id: `${label}-${Math.random().toString(36).slice(2, 6)}`,
      label, kind: 'rj45', x, y, w, h,
      side: guessSide(x + w / 2, y + h / 2, s.width, s.height),
    };
    setS({ ...s, ports: [...s.ports, port] });
    setSelected(port.id);
    setDraft(null);
  };

  const updatePort = (patch: Partial<PortDef>) =>
    setS({ ...s, ports: s.ports.map((p) => (p.id === selected ? { ...p, ...patch, flip: (patch.side ?? p.side) === 'bottom' } : p)) });

  const removePort = () => {
    setS({ ...s, ports: s.ports.filter((p) => p.id !== selected) });
    setSelected(null);
  };

  const valid = s.name.trim() && canvasWidth >= 24 && dupLabels.size === 0;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <div className="flex max-h-full w-[1040px] max-w-full flex-col rounded-lg bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <h2 className="font-semibold text-gray-900">{isNew ? 'New stencil' : 'Edit stencil'}</h2>
          <button className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onCancel} aria-label="Close">×</button>
        </header>

        <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500">
              <b>Drag a box</b> over each port (or click for a default size). Each box becomes a place you can connect a cable.
            </p>
            <div className="flex items-center justify-center rounded border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px]" style={{ width: VIEW_W, height: VIEW_H }}>
              <div
                ref={surface}
                className="relative cursor-crosshair touch-none select-none"
                style={{ width: s.width * k, height: s.height * k }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- user artwork as a data URL */}
                <img src={s.image} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
                {s.ports.map((p) => (
                  <button
                    key={p.id}
                    data-port
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={`absolute flex items-center justify-center rounded-sm border-2 text-[10px] font-semibold ${p.id === selected ? 'border-blue-600 bg-blue-500/30 text-blue-900' : dupLabels.has(p.label) ? 'border-red-600 bg-red-500/25 text-red-900' : 'border-emerald-500 bg-emerald-400/25 text-emerald-950'}`}
                    style={{ left: p.x * k, top: p.y * k, width: p.w * k, height: p.h * k }}
                    title={p.label}
                  >
                    <span className="rounded bg-white/80 px-0.5">{p.label}</span>
                  </button>
                ))}
                {draft && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-blue-600 bg-blue-400/20"
                    style={{ left: Math.min(draft.x0, draft.x1) * k, top: Math.min(draft.y0, draft.y1) * k, width: Math.abs(draft.x1 - draft.x0) * k, height: Math.abs(draft.y1 - draft.y0) * k }}
                  />
                )}
              </div>
            </div>
            <p className="text-[11px] text-gray-400">{s.ports.length} ports · artwork {s.width}×{s.height}</p>
          </div>

          <div className="flex w-72 shrink-0 flex-col gap-3 text-sm">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Name</span>
              <input className="w-full rounded border border-gray-300 px-2 py-1 outline-none focus:border-blue-500" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="e.g. Meraki MX68" />
            </label>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Vendor</span>
                <input className="w-full rounded border border-gray-300 px-2 py-1 outline-none focus:border-blue-500" value={s.vendor ?? ''} onChange={(e) => setS({ ...s, vendor: e.target.value })} />
              </label>
              <label className="block flex-1">
                <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Category</span>
                <select className="w-full rounded border border-gray-300 px-1.5 py-1" value={s.category} onChange={(e) => setS({ ...s, category: e.target.value as StencilCategory })}>
                  {STENCIL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Width on the diagram: {canvasWidth}px</span>
              <input
                type="range" min={40} max={1000} step={10} className="w-full"
                value={canvasWidth}
                onChange={(e) => setS({ ...s, scale: Number(e.target.value) / s.width })}
              />
              <span className="text-[10px] text-gray-400">The built-in SonicWall is 524px wide; icons are 64px.</span>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Rack height</span>
              <select
                className="w-full rounded border border-gray-300 px-1.5 py-1"
                value={s.rackUnits ?? 0}
                onChange={(e) => setS({ ...s, rackUnits: Number(e.target.value) || undefined })}
              >
                <option value={0}>Not rack-mount (1U on a shelf)</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((u) => <option key={u} value={u}>{u}U</option>)}
              </select>
            </label>

            <div className="rounded border border-gray-200 p-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{sel ? 'Selected port' : 'Ports'}</h3>
              {sel ? (
                <div className="space-y-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-gray-500">Label</span>
                    <input autoFocus className={`w-full rounded border px-2 py-1 font-mono outline-none ${dupLabels.has(sel.label) ? 'border-red-500' : 'border-gray-300 focus:border-blue-500'}`} value={sel.label} onChange={(e) => updatePort({ label: e.target.value })} />
                    {dupLabels.has(sel.label) && <span className="text-[10px] text-red-600">Another port already uses this label.</span>}
                  </label>
                  <div className="flex gap-2">
                    <label className="block flex-1">
                      <span className="mb-0.5 block text-[11px] text-gray-500">Type</span>
                      <select className="w-full rounded border border-gray-300 px-1 py-1" value={sel.kind} onChange={(e) => updatePort({ kind: e.target.value as PortKind })}>
                        {KINDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="mb-0.5 block text-[11px] text-gray-500">Cable exits</span>
                      <select className="w-full rounded border border-gray-300 px-1 py-1" value={sel.side} onChange={(e) => updatePort({ side: e.target.value as PortSide })}>
                        {SIDES.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-gray-500">Role (optional)</span>
                    <input className="w-full rounded border border-gray-300 px-2 py-1 outline-none focus:border-blue-500" value={sel.role ?? ''} placeholder="WAN, LAN, MGMT…" onChange={(e) => updatePort({ role: e.target.value || undefined })} />
                  </label>
                  <div className="flex justify-between">
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={removePort}>Delete port</button>
                    <button type="button" className="text-xs text-gray-600 hover:underline" onClick={() => setSelected(null)}>Done</button>
                  </div>
                </div>
              ) : s.ports.length ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                  {s.ports.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={`w-full rounded px-1 py-0.5 text-left hover:bg-gray-100 ${dupLabels.has(p.label) ? 'text-red-600' : ''}`} onClick={() => setSelected(p.id)}>
                        <span className="font-mono">{p.label}</span> <span className="text-gray-400">{KINDS.find((o) => o.value === p.kind)?.label} · {p.side}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400">No ports yet. A device without ports can still be placed and labeled, but cables can&apos;t attach to it.</p>
              )}
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-2.5">
          <button className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={onCancel}>Cancel</button>
          <button
            disabled={!valid}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => onSave({ ...s, name: s.name.trim() })}
          >
            Save stencil
          </button>
        </footer>
      </div>
    </div>
  );
}
