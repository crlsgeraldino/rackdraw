'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCESSORIES, RACK_SIZES, fits, findFreeU, rackLabel, usedUnits } from '@/lib/rack';
import { STENCILS } from '@/lib/stencils';
import type { DeviceNode, Rack, RackDepth, RackItem, StencilDef } from '@/lib/types';
import { findStencil, getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { INNER_W, RackElevation, rackSize, uAtPoint, type RackPreview } from './RackElevation';

/** What is being dragged from the side list. Kept outside React: dragover can't read dataTransfer contents. */
type Payload =
  | { type: 'node'; nodeId: string; height: number }
  | { type: 'accessory'; index: number; height: number }
  | { type: 'stencil'; stencilId: string; height: number };
let payload: Payload | null = null;

const DND = 'application/x-netcraft-rack';

function useDevices() {
  const project = useCurrentProject();
  return useMemo(() => new Map(project.nodes.filter((n): n is DeviceNode => n.type === 'device').map((n) => [n.id, n])), [project.nodes]);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
const inputCls = 'w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500';

/* ------------------------------------------------------------------ */

function SideList({ rack }: { rack: Rack | undefined }) {
  const project = useCurrentProject();
  const devices = useDevices();
  const custom = useDiagram((s) => s.customStencils);
  const { selectRack, addRack } = useDiagram.getState();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [units, setUnits] = useState(42);
  const [q, setQ] = useState('');
  const racks = project.racks ?? [];

  const mounted = new Set(racks.flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
  const unracked = [...devices.values()].filter((n) => !mounted.has(n.id));
  const stencils = [...Object.values(custom), ...STENCILS].filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));

  const start = (e: React.DragEvent, p: Payload) => {
    payload = p;
    e.dataTransfer.setData(DND, '1');
    e.dataTransfer.effectAllowed = 'copy';
  };
  const heightOf = (s?: StencilDef) => s?.rackUnits ?? 1;

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white p-2 text-sm">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Racks</h3>
      <div className="mb-2 space-y-0.5">
        {racks.map((r) => (
          <button key={r.id} onClick={() => selectRack(r.id)} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${r.id === rack?.id ? 'bg-blue-50 font-medium text-blue-700' : 'hover:bg-gray-50'}`}>
            <span className="truncate">{r.name}</span>
            <span className="text-[10px] text-gray-400">{usedUnits(r)}/{r.units}U</span>
          </button>
        ))}
      </div>
      {adding ? (
        <form
          className="mb-3 rounded border border-gray-200 p-2"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) { addRack(name.trim(), units); setAdding(false); setName(''); } }}
        >
          <input autoFocus className={`${inputCls} mb-1`} placeholder="Rack name (e.g. MDF Rack A)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-1">
            <select className="flex-1 rounded border border-gray-300 px-1 py-1 text-sm" value={units} onChange={(e) => setUnits(Number(e.target.value))}>
              {RACK_SIZES.map((u) => <option key={u} value={u}>{u}U</option>)}
            </select>
            <button type="submit" disabled={!name.trim()} className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">Add</button>
            <button type="button" className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => { setAdding(true); setName(`Rack ${String.fromCharCode(65 + racks.length)}`); }} className="mb-3 w-full rounded border border-dashed border-blue-400 bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">+ Add rack</button>
      )}

      {rack && (
        <>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">On the diagram, not racked ({unracked.length})</h3>
          <div className="mb-3 space-y-0.5">
            {unracked.length === 0 && <p className="px-1 text-[11px] text-gray-400">Every device is mounted.</p>}
            {unracked.map((n) => {
              const s = getStencil(n.data.stencilId);
              return (
                <div key={n.id} draggable onDragStart={(e) => start(e, { type: 'node', nodeId: n.id, height: heightOf(s) })} className="flex cursor-grab items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50" title="Drag into the rack">
                  <span className="truncate">{n.data.name}</span>
                  <span className="ml-1 shrink-0 text-[10px] text-gray-400">{heightOf(s)}U</span>
                </div>
              );
            })}
          </div>

          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Accessories</h3>
          <div className="mb-3 grid grid-cols-2 gap-1">
            {ACCESSORIES.map((a, i) => (
              <div key={a.label} draggable onDragStart={(e) => start(e, { type: 'accessory', index: i, height: a.height })} className="cursor-grab rounded border border-gray-200 px-1.5 py-1 text-[11px] hover:bg-gray-50" title="Drag into the rack">
                {a.label}
              </div>
            ))}
          </div>

          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">New device</h3>
          <input className={`${inputCls} mb-1 text-xs`} placeholder="Search devices…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="space-y-0.5">
            {stencils.map((s) => (
              <div key={s.id} draggable onDragStart={(e) => start(e, { type: 'stencil', stencilId: s.id, height: heightOf(s) })} className="flex cursor-grab items-center justify-between rounded px-2 py-1 text-xs hover:bg-gray-50" title="Drag into the rack: also adds it to the diagram">
                <span className="truncate">{s.name}</span>
                <span className="ml-1 shrink-0 text-[10px] text-gray-400">{heightOf(s)}U</span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function Elevations({ rack }: { rack: Rack }) {
  const devices = useDevices();
  const custom = useDiagram((s) => s.customStencils);
  const selectedId = useDiagram((s) => s.selectedRackItemId);
  const { placeRackItem, updateRackItem, addDeviceToRack, selectRackItem } = useDiagram.getState();
  const [width, setWidth] = useState(440);
  const area = useRef<HTMLDivElement>(null);
  // Start zoomed so the front and rear views fit side by side.
  useEffect(() => {
    const w = area.current?.clientWidth ?? 0;
    if (!w) return;
    const perFace = (w - 32 - 24 - 32) / 2; // padding, gap, card padding
    setWidth(Math.max(200, Math.min(440, Math.floor(perFace * (INNER_W / rackSize(rack).width)))));
    // Only on first show of a rack; afterwards the zoom buttons are in charge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rack.id]);
  const [preview, setPreview] = useState<{ face: 'front' | 'rear'; p: RackPreview } | null>(null);
  const [dragging, setDragging] = useState<RackItem | null>(null);
  const [error, setError] = useState('');
  const refs = { front: useRef<SVGSVGElement>(null), rear: useRef<SVGSVGElement>(null) };
  const stencil = (id: string) => findStencil(id, custom);

  const depthFor = (face: 'front' | 'rear', p: Payload): RackDepth => (p.type === 'accessory' ? (ACCESSORIES[p.index].depth === 'full' ? 'full' : face) : 'full');

  const onDragOver = (face: 'front' | 'rear') => (e: React.DragEvent) => {
    if (!payload || !e.dataTransfer.types.includes(DND)) return;
    e.preventDefault();
    const u = uAtPoint(rack, refs[face].current!, e.clientY, payload.height);
    setPreview({ face, p: { u, height: payload.height, valid: fits(rack, u, payload.height, depthFor(face, payload)) } });
  };
  const onDrop = (face: 'front' | 'rear') => (e: React.DragEvent) => {
    e.preventDefault();
    const p = payload;
    payload = null;
    setPreview(null);
    if (!p) return;
    const u = uAtPoint(rack, refs[face].current!, e.clientY, p.height);
    let ok = false;
    if (p.type === 'node') ok = placeRackItem(rack.id, { kind: 'device', nodeId: p.nodeId, u, height: p.height, depth: 'full' });
    else if (p.type === 'accessory') {
      const a = ACCESSORIES[p.index];
      ok = placeRackItem(rack.id, { kind: a.kind, label: a.label.replace(/ \dU$/, ''), u, height: a.height, depth: depthFor(face, p) });
    } else ok = addDeviceToRack(rack.id, p.stencilId, u);
    setError(ok ? '' : `It doesn't fit at U${u}: that space is taken or outside the rack.`);
  };

  /** Drag an item already in the rack to a new position. */
  const onItemPointerDown = (face: 'front' | 'rear') => (it: RackItem, e: React.PointerEvent) => {
    e.preventDefault();
    selectRackItem(it.id);
    const svg = refs[face].current!;
    const grab = uAtPoint(rack, svg, e.clientY, 1) ; // unit under the pointer
    const offset = it.u + it.height - 1 - grab; // units between pointer and the item's top
    let moved = false;
    let target = it.u;
    const move = (ev: PointerEvent) => {
      const u = uAtPoint(rack, svg, ev.clientY, it.height, offset);
      if (u === it.u && !moved) return;
      moved = true;
      target = u;
      setDragging(it);
      setPreview({ face, p: { u, height: it.height, valid: fits(rack, u, it.height, it.depth, it.id) } });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      setPreview(null);
      if (moved && target !== it.u) {
        const ok = updateRackItem(rack.id, it.id, { u: target });
        setError(ok ? '' : `It doesn't fit at U${target}.`);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-gray-50">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
        <span>Drag devices and accessories from the left into the rack. Drag mounted items to move them.</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded border border-gray-200 px-2 py-0.5 hover:bg-gray-50" onClick={() => setWidth((w) => Math.max(160, w - 40))}>−</button>
          <span className="w-12 text-center">{Math.round((width / INNER_W) * 100)}%</span>
          <button className="rounded border border-gray-200 px-2 py-0.5 hover:bg-gray-50" onClick={() => setWidth((w) => Math.min(900, w + 40))}>+</button>
        </div>
      </div>
      {error && <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">{error}</div>}
      <div ref={area} className="flex flex-1 flex-wrap content-start gap-6 overflow-auto p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) selectRackItem(null); }}>
        {(['front', 'rear'] as const).map((face) => (
          <div key={face} onDragOver={onDragOver(face)} onDragLeave={() => setPreview(null)} onDrop={onDrop(face)} className="rounded bg-white p-2 shadow-sm">
            <RackElevation
              rack={rack}
              face={face}
              devices={devices}
              stencil={stencil}
              selectedId={selectedId}
              hiddenId={dragging?.id}
              preview={preview?.face === face ? preview.p : null}
              onItemPointerDown={onItemPointerDown(face)}
              svgRef={refs[face]}
              width={width * (rackSize(rack).width / INNER_W)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ItemProps({ rack, item }: { rack: Rack; item: RackItem }) {
  const devices = useDevices();
  const { updateRackItem, removeRackItem, updateNodeData, snapshot, setView, selectOnlyNode } = useDiagram.getState();
  const [err, setErr] = useState('');
  const device = item.nodeId ? devices.get(item.nodeId) : undefined;
  const d = device?.data;

  const move = (patch: Partial<RackItem>) => setErr(updateRackItem(rack.id, item.id, patch) ? '' : "That doesn't fit: the space is taken or outside the rack.");
  const setD = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => device && updateNodeData(device.id, { [k]: e.target.value });

  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">{item.kind === 'device' ? 'Mounted device' : 'Accessory'} · {rackLabel(item)}</div>
      {device && d ? (
        <>
          <Field label="Name / hostname"><input className={inputCls} value={d.name} onFocus={snapshot} onChange={setD('name')} /></Field>
          <Field label="Model"><input className={inputCls} value={d.model ?? ''} onFocus={snapshot} onChange={setD('model')} /></Field>
          <Field label="Management IP"><input className={`${inputCls} font-mono`} value={d.ip ?? ''} onFocus={snapshot} onChange={setD('ip')} /></Field>
          <Field label="Serial number"><input className={`${inputCls} font-mono`} value={d.serial ?? ''} onFocus={snapshot} onChange={setD('serial')} /></Field>
          <div className="flex gap-2">
            <Field label="Asset tag"><input className={inputCls} value={d.assetTag ?? ''} onFocus={snapshot} onChange={setD('assetTag')} /></Field>
            <Field label="Power (W)">
              <input type="number" min={0} className={inputCls} value={d.powerW ?? ''} onFocus={snapshot} onChange={(e) => updateNodeData(device.id, { powerW: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
        </>
      ) : item.kind === 'device' ? (
        <p className="mb-2 text-xs text-red-600">This device was removed from the diagram.</p>
      ) : (
        <Field label="Label"><input className={inputCls} value={item.label ?? ''} onChange={(e) => updateRackItem(rack.id, item.id, { label: e.target.value })} /></Field>
      )}

      <div className="flex gap-2">
        <Field label="Bottom U">
          <input type="number" min={1} max={rack.units} className={inputCls} value={item.u} onChange={(e) => move({ u: Number(e.target.value) })} />
        </Field>
        <Field label="Height (U)">
          <input type="number" min={1} max={rack.units} className={inputCls} value={item.height} onChange={(e) => move({ height: Math.max(1, Number(e.target.value)) })} />
        </Field>
      </div>
      <Field label="Mounting depth">
        <select className={inputCls} value={item.depth} onChange={(e) => move({ depth: e.target.value as RackDepth })}>
          <option value="full">Full depth (front and rear)</option>
          <option value="front">Front only</option>
          <option value="rear">Rear only</option>
        </select>
      </Field>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {device && (
          <button
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => {
              selectOnlyNode(device.id);
              setView('diagram');
            }}
          >
            Show on diagram
          </button>
        )}
        <button className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => removeRackItem(rack.id, item.id)}>
          Remove from rack
        </button>
      </div>
      {device && <p className="mt-2 text-[10px] text-gray-400">Removing it from the rack keeps the device on the diagram.</p>}
    </>
  );
}

function RackProps({ rack }: { rack: Rack }) {
  const devices = useDevices();
  const { updateRack, deleteRack, snapshot } = useDiagram.getState();
  const [err, setErr] = useState('');
  const used = usedUnits(rack);
  const power = rack.items.reduce((sum, it) => sum + (it.nodeId ? Number(devices.get(it.nodeId)?.data.powerW ?? 0) : 0), 0);
  const deviceCount = rack.items.filter((it) => it.kind === 'device').length;
  const largestFree = (() => {
    for (let h = rack.units; h >= 1; h--) if (findFreeU(rack, h, 'full') !== null) return h;
    return 0;
  })();

  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Rack</div>
      <Field label="Name"><input className={inputCls} value={rack.name} onFocus={snapshot} onChange={(e) => updateRack(rack.id, { name: e.target.value })} /></Field>
      <Field label="Size">
        <select
          className={inputCls}
          value={rack.units}
          onChange={(e) => setErr(updateRack(rack.id, { units: Number(e.target.value) }) ? '' : 'Move equipment out of the top units before shrinking the rack.')}
        >
          {[...new Set([...RACK_SIZES, rack.units])].sort((a, b) => a - b).map((u) => <option key={u} value={u}>{u}U</option>)}
        </select>
      </Field>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      <Field label="Location"><input className={inputCls} value={rack.location ?? ''} placeholder="e.g. 2nd floor IDF" onFocus={snapshot} onChange={(e) => updateRack(rack.id, { location: e.target.value })} /></Field>
      <Field label="Notes"><textarea className={inputCls} rows={3} value={rack.notes ?? ''} onFocus={snapshot} onChange={(e) => updateRack(rack.id, { notes: e.target.value })} /></Field>

      <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 rounded border border-gray-200 p-2 text-xs">
        <dt className="text-gray-500">Used</dt><dd>{used}U of {rack.units}U</dd>
        <dt className="text-gray-500">Free</dt><dd>{rack.units - used}U (largest {largestFree}U)</dd>
        <dt className="text-gray-500">Devices</dt><dd>{deviceCount}</dd>
        <dt className="text-gray-500">Power</dt><dd>{power ? `${power} W` : '—'}</dd>
      </dl>
      <p className="mt-1 text-[10px] text-gray-400">Power adds up each mounted device&apos;s Power (W) field.</p>

      <button
        className="mt-4 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        onClick={() => { if (confirm(`Delete rack "${rack.name}"? The devices stay on the diagram.`)) deleteRack(rack.id); }}
      >
        Delete rack
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */

export function RackView() {
  const project = useCurrentProject();
  const activeId = useDiagram((s) => s.activeRackId);
  const selectedId = useDiagram((s) => s.selectedRackItemId);
  const { selectRack, removeRackItem, addRack } = useDiagram.getState();
  const racks = project.racks ?? [];
  const rack = racks.find((r) => r.id === activeId) ?? racks[0];
  const item = rack?.items.find((it) => it.id === selectedId);

  useEffect(() => {
    if (rack && rack.id !== activeId) selectRack(rack.id);
  }, [rack, activeId, selectRack]);

  // Delete removes the selected rack item (not the device itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && rack && item) removeRackItem(rack.id, item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rack, item, removeRackItem]);

  return (
    <div className="flex min-h-0 flex-1">
      <SideList rack={rack} />
      {rack ? (
        <Elevations rack={rack} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-gray-50">
          <div className="max-w-sm rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
            <p className="mb-3">No racks for <b>{project.name}</b> yet.</p>
            <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" onClick={() => addRack('Rack A', 42)}>Add a 42U rack</button>
            <p className="mt-3 text-xs text-gray-400">Devices you mount are the same ones on the diagram: edit a name or IP in either place.</p>
          </div>
        </div>
      )}
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3">
        {rack && item ? <ItemProps rack={rack} item={item} /> : rack ? <RackProps rack={rack} /> : <p className="text-sm text-gray-500">Add a rack to get started.</p>}
      </aside>
    </div>
  );
}
