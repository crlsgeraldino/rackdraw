'use client';

import { fmtRuntime, rackPower, upsRating } from '@/lib/rackPower';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { activePage, allDevices } from '@/lib/project';
import { openPortMap } from '@/lib/events';
import { isShelfDevice, rackUnitsOf } from '@/lib/autoRack';
import { shelfAt } from '@/lib/rackShelf';
import { ACCESSORIES, RACK_SIZES, fits, findFreeU, rackLabel, usedUnits } from '@/lib/rack';
import { groupLibraries } from '@/lib/libraries';
import { patchRows, rackCables, rackPortStates } from '@/lib/rackPatching';
import { isPassThrough, pathLength, pathText, tracePath } from '@/lib/trace';
import { STENCILS } from '@/lib/stencils';
import { PORT_STATUSES, type CableData, type Rack, type RackDepth, type RackItem, type StencilDef } from '@/lib/types';
import { findStencil, getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { rackFromDiagram } from './rackFromDiagram';
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
  return useMemo(() => new Map(allDevices(project).map((n) => [n.id, n])), [project]);
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
  const term = q.trim().toLowerCase();
  const hit = (s: StencilDef) => !term || s.name.toLowerCase().includes(term);
  // Imported stencils grouped by library (a matching library name lists all of it), then the built-ins.
  const stencilGroups = [
    ...groupLibraries(Object.values(custom)).map((l) => ({ name: l.name, items: !term || l.name.toLowerCase().includes(term) ? l.stencils : l.stencils.filter(hit) })),
    { name: 'Built-in', items: STENCILS.filter(hit) },
  ].filter((g) => g.items.length);

  const start = (e: React.DragEvent, p: Payload) => {
    payload = p;
    e.dataTransfer.setData(DND, '1');
    e.dataTransfer.effectAllowed = 'copy';
  };
  const heightOf = (s?: StencilDef) => rackUnitsOf(s) || 1;

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
        <>
          <button onClick={() => { setAdding(true); setName(`Rack ${String.fromCharCode(65 + racks.length)}`); }} className="mb-1 w-full rounded border border-dashed border-blue-400 bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">+ Add rack</button>
          <BuildFromDiagram className="mb-3 w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100" />
        </>
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
                  <span className="ml-1 shrink-0 text-[10px] text-gray-400">{isShelfDevice(s) ? 'shelf' : `${heightOf(s)}U`}</span>
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

          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">New device <span className="font-normal normal-case tracking-normal text-gray-400">(also added to the diagram)</span></h3>
          <input className={`${inputCls} mb-1 text-xs`} placeholder="Search devices…" value={q} onChange={(e) => setQ(e.target.value)} />
          {stencilGroups.map((g) => (
            <div key={g.name} className="mb-2">
              <h4 className="truncate px-1 pb-0.5 text-[10px] font-semibold text-gray-500" title={g.name}>{g.name}</h4>
              <div className="space-y-0.5">
                {g.items.map((s) => (
                  <div key={s.id} draggable onDragStart={(e) => start(e, { type: 'stencil', stencilId: s.id, height: heightOf(s) })} className="flex cursor-grab items-center justify-between rounded px-2 py-1 text-xs hover:bg-gray-50" title="Drag into the rack: also adds it to the diagram">
                    <span className="truncate">{s.name}</span>
                    <span className="ml-1 shrink-0 text-[10px] text-gray-400">{isShelfDevice(s) ? 'shelf' : `${heightOf(s)}U`}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

/** "Build rack from diagram": the current page's rack equipment, mounted in a new rack the way a tech would. */
function BuildFromDiagram({ className }: { className: string }) {
  const [msg, setMsg] = useState('');
  return (
    <>
      <button
        className={className}
        title="Mount the diagram page's rack equipment (firewall, patch panels, switches, servers, UPS) in a new rack: firewall at the top, each patch panel above its switch with a cable manager between, UPS at the bottom"
        onClick={() => void rackFromDiagram().then(setMsg)}
      >
        Build rack from diagram
      </button>
      {msg && <p className="mb-2 text-[11px] text-amber-700">{msg}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Elevations({ rack, hotCable }: { rack: Rack; hotCable: string | null }) {
  const devices = useDevices();
  const project = useCurrentProject();
  const [showCables, setShowCables] = useState(true);
  const portStates = useMemo(() => rackPortStates(project), [project]);
  const cables = useMemo(() => (showCables ? rackCables(project, rack) : []), [project, rack, showCables]);
  const custom = useDiagram((s) => s.customStencils);
  const selectedId = useDiagram((s) => s.selectedRackItemId);
  const { placeRackItem, updateRackItem, addDeviceToRack, selectRackItem, putOnShelf } = useDiagram.getState();
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
  const [notice, setNotice] = useState('');
  const [portHover, setPortHover] = useState<{ nodeId: string; port: string; x: number; y: number } | null>(null);
  const refs = { front: useRef<SVGSVGElement>(null), rear: useRef<SVGSVGElement>(null) };
  const stencil = (id: string) => findStencil(id, custom);

  const racked = new Set((project.racks ?? []).flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
  const panelsInRacks = [...devices.values()].filter((n) => racked.has(n.id) && n.data.stencilId !== 'wall-jack' && isPassThrough(n, stencil(n.data.stencilId)));
  const depthFor = (face: 'front' | 'rear', p: Payload): RackDepth => (p.type === 'accessory' ? (ACCESSORIES[p.index].depth === 'full' ? 'full' : face) : 'full');
  // Small equipment goes on a shelf: the one under the pointer, or a new 1U shelf in a free unit.
  const shelfPayload = (p: Payload) => isShelfDevice(p.type === 'node' ? stencil(devices.get(p.nodeId)?.data.stencilId ?? '') : p.type === 'stencil' ? stencil(p.stencilId) : undefined);
  const shelfOk = (u: number) => !!shelfAt(rack, u) || fits(rack, u, 1, 'full');

  const onDragOver = (face: 'front' | 'rear') => (e: React.DragEvent) => {
    if (!payload || !e.dataTransfer.types.includes(DND)) return;
    e.preventDefault();
    const u = uAtPoint(rack, refs[face].current!, e.clientY, payload.height);
    const shelf = shelfPayload(payload);
    setPreview({ face, p: { u, height: shelf ? 1 : payload.height, valid: shelf ? shelfOk(u) : fits(rack, u, payload.height, depthFor(face, payload)) } });
  };
  const onDrop = (face: 'front' | 'rear') => (e: React.DragEvent) => {
    e.preventDefault();
    const p = payload;
    payload = null;
    setPreview(null);
    if (!p) return;
    const u = uAtPoint(rack, refs[face].current!, e.clientY, p.height);
    let ok = false;
    const shelf = shelfPayload(p);
    if (p.type === 'node') ok = shelf ? putOnShelf(rack.id, p.nodeId, u) : placeRackItem(rack.id, { kind: 'device', nodeId: p.nodeId, u, height: p.height, depth: 'full' });
    else if (p.type === 'accessory') {
      const a = ACCESSORIES[p.index];
      ok = placeRackItem(rack.id, { kind: a.kind, label: a.label.replace(/ \dU$/, ''), u, height: a.height, depth: depthFor(face, p) });
    } else {
      // A device of this kind already on the diagram and not in any rack is the one meant: mount it rather than
      // adding a second one to the diagram. Dragging the shape in again (none left unracked) adds a new one.
      const racked = new Set((project.racks ?? []).flatMap((r) => r.items.map((it) => it.nodeId)).filter(Boolean));
      const onPage = new Set(activePage(project).nodes.map((n) => n.id));
      const same = [...devices.values()].filter((n) => n.data.stencilId === p.stencilId && !racked.has(n.id));
      const existing = same.find((n) => onPage.has(n.id)) ?? same[0];
      if (existing) {
        ok = shelf ? putOnShelf(rack.id, existing.id, u) : placeRackItem(rack.id, { kind: 'device', nodeId: existing.id, u, height: p.height, depth: 'full' });
        if (ok) setNotice(`Mounted "${existing.data.name}", the one already on the diagram. To add another, drag the shape in again.`);
      } else {
        ok = addDeviceToRack(rack.id, p.stencilId, u);
        if (ok) setNotice('');
      }
    }
    if (p.type !== 'stencil') setNotice('');
    setError(ok ? '' : shelf ? `There is no room on a shelf at U${u}: drop it on a shelf with room, or in a free unit (a shelf is added).` : `It doesn't fit at U${u}: that space is taken or outside the rack.`);
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
      setPreview({ face, p: { u, height: it.height, valid: it.shelf ? shelfOk(u) : fits(rack, u, it.height, it.depth, it.id) } });
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
        <BackToDiagram />
        <span>Drag devices and accessories from the left into the rack. Drag mounted items to move them.</span>
        {panelsInRacks.length > 0 && (
          <label className="ml-auto flex items-center gap-1" title="Off: patch panels in racks are drawn here only. On the diagram, cables through them are one line &quot;via&quot; the panel. Each device can also be set in Shape Data → Show on.">
            <input type="checkbox" checked={panelsInRacks.some((n) => n.data.showOn !== 'rack')} onChange={(e) => useDiagram.getState().setRackedPanelsShown(e.target.checked)} /> Patch panels on the diagram
          </label>
        )}
        <label className={`${panelsInRacks.length ? 'ml-3' : 'ml-auto'} flex items-center gap-1`} title="Draw the cables between this rack's equipment on its front (from the diagram)">
          <input type="checkbox" checked={showCables} onChange={(e) => setShowCables(e.target.checked)} /> Patch cables
        </label>
        <div className="ml-2 flex items-center gap-1">
          <button className="rounded border border-gray-200 px-2 py-0.5 hover:bg-gray-50" onClick={() => setWidth((w) => Math.max(160, w - 40))}>−</button>
          <span className="w-12 text-center">{Math.round((width / INNER_W) * 100)}%</span>
          <button className="rounded border border-gray-200 px-2 py-0.5 hover:bg-gray-50" onClick={() => setWidth((w) => Math.min(900, w + 40))}>+</button>
        </div>
      </div>
      {error && <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">{error}</div>}
      {notice && !error && <div className="flex items-center border-b border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-800" role="status">{notice}<button type="button" className="ml-auto px-1 text-blue-700 hover:text-blue-900" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
      {portHover && <PortCard hover={portHover} />}
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
              portStates={portStates}
              cables={cables}
              hotCable={hotCable}
              onPortHover={dragging ? undefined : setPortHover}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** What one port is: shown while pointing at it in the rack (like the diagram's port notes on hover). */
function PortCard({ hover }: { hover: { nodeId: string; port: string; x: number; y: number } }) {
  const project = useCurrentProject();
  const custom = useDiagram((s) => s.customStencils);
  const devices = useDevices();
  const d = devices.get(hover.nodeId);
  if (!d) return null;
  const st = findStencil(d.data.stencilId, custom);
  const pd = d.data.ports?.[hover.port] ?? {};
  const label = pd.label || st?.ports.find((q) => q.id === hover.port)?.label || hover.port;
  // The cables on this port (any page) and their far ends: a patch panel port has two (front cord, back run).
  const fars: string[] = [];
  const cables: (CableData | undefined)[] = [];
  for (const pg of project.pages) for (const e of pg.edges) {
    const mine = e.source === d.id && e.sourceHandle === hover.port ? 'source' : e.target === d.id && e.targetHandle === hover.port ? 'target' : null;
    if (!mine) continue;
    const otherId = mine === 'source' ? e.target : e.source;
    const otherPort = mine === 'source' ? e.targetHandle : e.sourceHandle;
    const o = devices.get(otherId);
    const ost = o ? findStencil(o.data.stencilId, custom) : undefined;
    const oname = o?.data.name ?? 'item';
    const oport = otherPort ? o?.data.ports?.[otherPort]?.label || ost?.ports.find((q) => q.id === otherPort)?.label || otherPort : '';
    const where = (project.racks ?? []).flatMap((r) => r.items.filter((it) => it.nodeId === otherId).map((it) => `${r.name} ${rackLabel(it)}`))[0];
    fars.push([oname, oport && `port ${oport}`].filter(Boolean).join(' · ') + (where ? ` (${where})` : o ? ' (not racked)' : ''));
    cables.push(e.data);
  }
  const far = fars.join('\n');
  const cableText = cables.map((cable) => [cable?.cable, cable?.vlan && `VLAN ${cable.vlan}`, cable?.length, cable?.label].filter(Boolean).join(' · ')).filter(Boolean).join('\n');
  const status = PORT_STATUSES.find((s) => s.value === pd.status);
  const trace = tracePath(project, d.id, hover.port, (id) => findStencil(id, custom));
  const rows: [string, string][] = [
    ['Path', trace.hops.length > 2 ? [pathText(trace), pathLength(trace) && `(${pathLength(trace)})`].filter(Boolean).join(' ') : ''],
    ['Cable to', far], ['Connected to', pd.description ?? ''],
    ['Cable', cableText],
    ['Link', [pd.speed, pd.poe].filter(Boolean).join(' · ')], ['IP', pd.ip ?? ''], ['VLAN', pd.vlan ?? ''], ['Notes', pd.notes ?? ''],
  ];
  const shown = rows.filter(([, v]) => v);
  const left = Math.min(hover.x + 14, window.innerWidth - 300), top = Math.min(hover.y + 14, window.innerHeight - 220);
  return (
    <div className="pointer-events-none fixed z-50 w-72 rounded-md border border-gray-200 bg-white p-2.5 text-xs shadow-xl" style={{ left, top }}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-semibold text-gray-900">{d.data.name}</span>
        <span className="rounded bg-gray-100 px-1 font-mono text-[11px]">{label}</span>
        {pd.uplink && <span className="rounded bg-orange-100 px-1 text-[9px] font-semibold text-orange-700">UPLINK</span>}
        {status && <span className="ml-auto flex items-center gap-1 text-[10px]" style={{ color: status.color }}><span className="h-2 w-2 rounded-full" style={{ background: status.color }} />{status.label}</span>}
      </div>
      {shown.length ? (
        <div className="grid grid-cols-[78px_1fr] gap-x-2 gap-y-0.5">
          {shown.flatMap(([k, v]) => [<span key={`${k}-k`} className="text-gray-500">{k}</span>, <span key={`${k}-v`} className="whitespace-pre-line break-words text-gray-800">{v}</span>])}
        </div>
      ) : (
        <p className="text-gray-400">Nothing plugged in or noted. Select the device on the diagram to add port notes.</p>
      )}
    </div>
  );
}

function ItemProps({ rack, item, onHot }: { rack: Rack; item: RackItem; onHot: (id: string | null) => void }) {
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
            <Field label="Weight (lb)">
              <input type="number" min={0} className={inputCls} value={d.weightLb ?? ''} onFocus={snapshot} onChange={(e) => updateNodeData(device.id, { weightLb: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Field>
          </div>
          <label className="mb-2 flex items-start gap-1.5 text-xs text-gray-700" title="Patch panels, cable managers and the like usually belong in the rack only. Cables through a rack-only patch panel are drawn on the diagram as one line &quot;via&quot; it.">
            <input type="checkbox" className="mt-0.5" checked={d.showOn !== 'rack'} onChange={(e) => { snapshot(); updateNodeData(device.id, { showOn: e.target.checked ? undefined : 'rack' }); }} />
            <span>Show on the diagram too<span className="block text-[11px] text-gray-500">Off: only in the rack (still in the bill of materials, port maps and cable paths).</span></span>
          </label>
          {d.stencilId === 'ups' && (
            <div className="flex gap-2">
              <Field label="UPS output (W)">
                <input type="number" min={0} className={inputCls} value={d.ups?.capacityW ?? ''} placeholder={String(upsRating(device).capacityW)} onFocus={snapshot} onChange={(e) => updateNodeData(device.id, { ups: { ...d.ups, capacityW: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              </Field>
              <Field label="Runtime at half load (min)">
                <input type="number" min={0} className={inputCls} value={d.ups?.runtimeHalfMin ?? ''} placeholder="15" onFocus={snapshot} onChange={(e) => updateNodeData(device.id, { ups: { ...d.ups, runtimeHalfMin: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              </Field>
            </div>
          )}
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
          <input type="number" min={1} max={rack.units} className={inputCls} value={item.height} onChange={(e) => move({ height: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
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
        {device && d?.showOn !== 'rack' && (
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
        {device && (getStencil(device.data.stencilId)?.ports ?? []).filter((q) => q.kind === 'rj45' || q.kind === 'sfp').length >= 4 && (
          <button className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => openPortMap(device.id)}>
            Port map
          </button>
        )}
        <button className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => removeRackItem(rack.id, item.id)}>
          Remove from rack
        </button>
      </div>
      {device && <p className="mt-2 text-[10px] text-gray-400">Removing it from the rack keeps the device on the diagram.</p>}
      {device && <Patching rack={rack} onlyNode={device.id} onHot={onHot} />}
    </>
  );
}

/**
 * The rack's patching schedule (Visio-style port-to-port list): every cable from equipment in this rack, from the
 * diagram. Pointing at a row highlights its patch cord; with `onlyNode`, just that device's connections.
 */
function Patching({ rack, onlyNode, onHot }: { rack: Rack; onlyNode?: string; onHot: (id: string | null) => void }) {
  const project = useCurrentProject();
  const custom = useDiagram((s) => s.customStencils);
  const rows = useMemo(() => {
    const stencilOf = (id: string) => findStencil(id, custom);
    const all = patchRows(project, rack, stencilOf).map((r) => {
      const t = tracePath(project, r.fromId, r.fromPort, stencilOf);
      return { ...r, path: t.hops.length > 2 ? pathText(t) : '' };
    });
    if (!onlyNode) return all;
    const ids = new Set(rackCables(project, rack).filter((c) => c.a.nodeId === onlyNode || c.b.nodeId === onlyNode).map((c) => c.id));
    return all.filter((r) => ids.has(r.id));
  }, [project, rack, custom, onlyNode]);
  const end = (e: { position: string; device: string; port: string; where: string }) => (
    <span className="min-w-0">
      <span className="font-medium">{e.device}</span>{e.port && <span className="font-mono"> · {e.port}</span>}
      <span className="block text-[10px] text-gray-400">{[e.position, e.where].filter(Boolean).join(' · ')}</span>
    </span>
  );
  return (
    <div className="mt-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{onlyNode ? 'Connections' : 'Patching'} ({rows.length})</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400">{onlyNode ? 'No cables on this device yet.' : 'No cables yet: draw them port to port on the diagram and they show here and in the rack.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-1.5 px-2 py-1 hover:bg-blue-50" onPointerEnter={() => onHot(r.id)} onPointerLeave={() => onHot(null)}>
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} title={r.cable} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                {end(r.from)}
                <span className="text-[10px] text-gray-500">→ {[r.cable, r.vlan && `VLAN ${r.vlan}`, r.length, r.label].filter(Boolean).join(' · ')}</span>
                {end(r.to)}
                {r.path && <span className="text-[10px] text-emerald-700">⤷ {r.path}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RackProps({ rack, onHot }: { rack: Rack; onHot: (id: string | null) => void }) {
  const { updateRack, deleteRack, snapshot } = useDiagram.getState();
  const [err, setErr] = useState('');
  const used = usedUnits(rack);
  const project = useCurrentProject();
  const custom = useDiagram((s) => s.customStencils);
  const pw = useMemo(() => rackPower(project, rack, (id) => findStencil(id, custom)), [project, rack, custom]);
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
      </dl>

      <div className="mt-3 text-[11px] uppercase tracking-wide text-gray-500">Power &amp; cooling</div>
      <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 rounded border border-gray-200 p-2 text-xs">
        <dt className="text-gray-500">Power draw</dt><dd>{pw.totalW ? `${pw.totalW.toLocaleString()} W` : '—'}{pw.poeW > 0 && <span className="text-gray-400"> (PoE {pw.poeW} W)</span>}</dd>
        <dt className="text-gray-500">Heat</dt><dd>{pw.btu ? `${pw.btu.toLocaleString()} BTU/h` : '—'}</dd>
        <dt className="text-gray-500">Weight</dt><dd>{pw.weightLb ? `${pw.weightLb} lb (${Math.round(pw.weightLb * 0.4536)} kg)` : '—'}</dd>
        {pw.circuit && (
          <>
            <dt className="text-gray-500">Circuit load</dt>
            <dd>
              <span className="inline-block h-1.5 w-12 overflow-hidden rounded bg-gray-200 align-middle"><span className={`block h-full ${pw.circuit.pct > 1 ? 'bg-red-500' : pw.circuit.pct > 0.8 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pw.circuit.pct * 100)}%` }} /></span>
              <span className="ml-1.5">{Math.round(pw.circuit.pct * 100)}% of {Math.round(pw.circuit.continuousW)} W</span>
            </dd>
          </>
        )}
        {pw.ups.map((u) => (
          <Fragment key={u.id}>
            <dt className="truncate text-gray-500" title={u.name}>{u.name}</dt>
            <dd title={u.assumed ? 'Rating assumed (set Capacity and Runtime at half load on the UPS for an exact figure)' : undefined}>
              {Math.round(u.pct * 100)}% load · ~{fmtRuntime(u.runtimeMin)}{u.assumed && <span className="text-gray-400"> *</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
      <div className="mt-2 flex items-end gap-2">
        <Field label="Circuit (V)">
          <select className={inputCls} value={rack.feedVolts ?? ''} onChange={(e) => { snapshot(); updateRack(rack.id, { feedVolts: e.target.value ? Number(e.target.value) : undefined }); }}>
            <option value="">—</option>{[120, 208, 230, 240].map((v) => <option key={v} value={v}>{v} V</option>)}
          </select>
        </Field>
        <Field label="Breaker (A)">
          <select className={inputCls} value={rack.feedAmps ?? ''} onChange={(e) => { snapshot(); updateRack(rack.id, { feedAmps: e.target.value ? Number(e.target.value) : undefined }); }}>
            <option value="">—</option>{[10, 15, 16, 20, 30, 32].map((a) => <option key={a} value={a}>{a} A</option>)}
          </select>
        </Field>
      </div>
      <label className="mb-1 flex items-center gap-1.5 text-xs text-gray-700"><input type="checkbox" className="accent-blue-600" checked={!!rack.redundantFeeds} onChange={(e) => { snapshot(); updateRack(rack.id, { redundantFeeds: e.target.checked || undefined }); }} /> A + B feeds (each carries the whole rack)</label>
      {pw.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-700">⚠ {w}</p>)}
      <p className="mt-1 text-[10px] text-gray-400">
        Adds each device&apos;s Power (W) and Weight, or a typical figure for built-in equipment{pw.typicalCount ? ` (${pw.typicalCount} typical)` : ''}, plus the PoE switches deliver. Heat = W × 3.412.{pw.ups.some((u) => u.assumed) ? ' * UPS rating assumed: set it on the UPS.' : ''}
      </p>
      <Patching rack={rack} onHot={onHot} />

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

/** Back to the drawing (the same as View → Diagram, which is easy to miss from here). */
function BackToDiagram() {
  return (
    <button
      className="flex shrink-0 items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100"
      onClick={() => useDiagram.getState().setView('diagram')}
      title="Go back to the drawing (View → Diagram)"
    >
      <span aria-hidden>←</span> Diagram
    </button>
  );
}

export function RackView() {
  const project = useCurrentProject();
  const activeId = useDiagram((s) => s.activeRackId);
  const selectedId = useDiagram((s) => s.selectedRackItemId);
  const { selectRack, removeRackItem, addRack } = useDiagram.getState();
  const racks = project.racks ?? [];
  const rack = racks.find((r) => r.id === activeId) ?? racks[0];
  const item = rack?.items.find((it) => it.id === selectedId);
  const [hot, setHot] = useState<string | null>(null);

  useEffect(() => {
    if (rack && rack.id !== activeId) selectRack(rack.id);
  }, [rack, activeId, selectRack]);

  // Delete removes the selected rack item (not the device itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && rack && item) removeRackItem(rack.id, item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rack, item, removeRackItem]);

  return (
    <div className="flex min-h-0 flex-1">
      <SideList rack={rack} />
      {rack ? (
        <Elevations rack={rack} hotCable={hot} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-gray-50">
          <div className="max-w-sm rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
            <p className="mb-3">No racks for <b>{project.name}</b> yet.</p>
            <div className="mb-3 flex justify-center"><BackToDiagram /></div>
            <div className="flex flex-col items-center gap-2">
              <BuildFromDiagram className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" />
              <button className="rounded border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => addRack('Rack A', 42)}>Add an empty 42U rack</button>
            </div>
            <p className="mt-3 text-xs text-gray-400">Devices you mount are the same ones on the diagram: edit a name or IP in either place.</p>
          </div>
        </div>
      )}
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3">
        {rack && item ? <ItemProps rack={rack} item={item} onHot={setHot} /> : rack ? <RackProps rack={rack} onHot={setHot} /> : <p className="text-sm text-gray-500">Add a rack to get started.</p>}
      </aside>
    </div>
  );
}
