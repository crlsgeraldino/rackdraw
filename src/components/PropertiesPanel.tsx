'use client';

import { rackLabel } from '@/lib/rack';
import { baseSize } from './nodes';
import { useRef, useState } from 'react';
import { loadImageFile } from '@/lib/imageImport';
import { CABLE_STYLES, type BackdropNode, type CableData, type CableType, type DeviceNode } from '@/lib/types';
import { allDevices } from '@/lib/project';
import { useCurrentPage, useCurrentProject, useDiagram, useStencil } from '@/store/useDiagramStore';

function Field({ label, value, onChange, mono, area }: { label: string; value?: string; onChange: (v: string) => void; mono?: boolean; area?: boolean }) {
  const snapshot = useDiagram((s) => s.snapshot);
  const cls = `w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500 ${mono ? 'font-mono' : ''}`;
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{label}</span>
      {area ? (
        <textarea className={cls} rows={3} value={value ?? ''} onFocus={snapshot} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} value={value ?? ''} onFocus={snapshot} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function DeviceProps({ node }: { node: DeviceNode }) {
  const project = useCurrentProject();
  const pg = useCurrentPage();
  const update = useDiagram((s) => s.updateNodeData);
  const updatePort = useDiagram((s) => s.updatePort);
  const snapshot = useDiagram((s) => s.snapshot);
  const stencil = useStencil(node.data.stencilId);
  const { selectRack, selectRackItem, setView, setNodeSize } = useDiagram.getState();
  const d = node.data;
  const set = (k: string) => (v: string) => update(node.id, { [k]: v });
  const mount = (project.racks ?? []).flatMap((rack) => rack.items.filter((it) => it.nodeId === node.id).map((item) => ({ rack, item })))[0];

  const peer = (portId: string) => {
    const e = pg.edges.find((x) => (x.source === node.id && x.sourceHandle === portId) || (x.target === node.id && x.targetHandle === portId));
    if (!e) return '';
    const otherId = e.source === node.id ? e.target : e.source;
    const otherPort = e.source === node.id ? e.targetHandle : e.sourceHandle;
    const other = pg.nodes.find((n) => n.id === otherId);
    const name = other?.type === 'device' ? other.data.name : '?';
    return `${name} : ${otherPort ?? ''}`;
  };

  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">{stencil?.name}</div>
      <Field label="Name / hostname" value={d.name} onChange={set('name')} />
      <Field label="Model" value={d.model} onChange={set('model')} />
      <Field label="Management IP" value={d.ip} onChange={set('ip')} mono />
      <Field label="MAC address" value={d.mac} onChange={set('mac')} mono />
      <Field label="Serial number" value={d.serial} onChange={set('serial')} mono />
      {stencil && (() => {
        const base = baseSize(stencil);
        const pct = node.width ? Math.round((node.width / base.width) * 100) : 100;
        const setPct = (p: number) => setNodeSize(node.id, p === 100 ? null : { width: (base.width * p) / 100, height: (base.height * p) / 100 });
        return (
          <div className="mb-2">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Size on diagram</span>
            <div className="flex items-center gap-1">
              <button className="rounded border border-gray-300 px-2 py-0.5 text-sm hover:bg-gray-50" onClick={() => setPct(Math.max(20, pct - 10))} aria-label="Smaller">−</button>
              <span className="w-12 text-center text-sm">{pct}%</span>
              <button className="rounded border border-gray-300 px-2 py-0.5 text-sm hover:bg-gray-50" onClick={() => setPct(Math.min(600, pct + 10))} aria-label="Larger">+</button>
              {pct !== 100 && <button className="ml-auto text-xs text-blue-600 hover:underline" onClick={() => setPct(100)}>Reset size</button>}
            </div>
            <span className="text-[10px] text-gray-400">Or drag a corner handle on the canvas.</span>
          </div>
        );
      })()}
      <Field label="Location" value={d.location} onChange={set('location')} />
      <div className="flex gap-2">
        <Field label="Asset tag" value={d.assetTag} onChange={set('assetTag')} />
        <Field label="Power (W)" value={d.powerW === undefined ? '' : String(d.powerW)} onChange={(v) => update(node.id, { powerW: v === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} mono />
      </div>
      {mount ? (
        <p className="mb-2 text-xs text-gray-600">
          Mounted in <button className="font-medium text-blue-600 hover:underline" onClick={() => { selectRack(mount.rack.id); selectRackItem(mount.item.id); setView('racks'); }}>{mount.rack.name} · {rackLabel(mount.item)}</button>
        </p>
      ) : (project.racks ?? []).length ? (
        <p className="mb-2 text-xs text-gray-400">Not in a rack. Use the Racks view to mount it.</p>
      ) : null}
      <Field label="Notes" value={d.notes} onChange={set('notes')} area />

      {stencil && stencil.ports.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ports</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-gray-500">
                <th className="py-1 pr-1">Port</th>
                <th className="pr-1">Description</th>
                <th className="w-12">VLAN</th>
              </tr>
            </thead>
            <tbody>
              {stencil.ports.map((p) => {
                const pd = d.ports?.[p.id] ?? {};
                const link = peer(p.id);
                return (
                  <tr key={p.id} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-1 font-mono">
                      {p.label}
                      {p.role && <div className="text-[9px] text-gray-400">{p.role}</div>}
                    </td>
                    <td className="pr-1">
                      <input className="w-full rounded border border-gray-200 px-1 py-0.5" value={pd.description ?? ''} placeholder={link || '—'} onFocus={snapshot} onChange={(e) => updatePort(node.id, p.id, { description: e.target.value })} />
                      {link && pd.description && <div className="text-[9px] text-green-700">→ {link}</div>}
                    </td>
                    <td>
                      <input className="w-full rounded border border-gray-200 px-1 py-0.5 font-mono" value={pd.vlan ?? ''} onFocus={snapshot} onChange={(e) => updatePort(node.id, p.id, { vlan: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CableProps({ id, data }: { id: string; data: CableData }) {
  const update = useDiagram((s) => s.updateEdgeData);
  const snapshot = useDiagram((s) => s.snapshot);
  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Cable</div>
      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Type</span>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(CABLE_STYLES) as CableType[]).map((c) => (
            <button
              key={c}
              onClick={() => { snapshot(); update(id, { cable: c }); }}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${data.cable === c ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={CABLE_STYLES[c].color} strokeWidth="2.5" strokeDasharray={CABLE_STYLES[c].dash} /></svg>
              {c}
            </button>
          ))}
        </div>
      </label>
      <Field label="Label" value={data.label} onChange={(v) => update(id, { label: v })} />
      <Field label="VLAN(s)" value={data.vlan} onChange={(v) => update(id, { vlan: v })} mono />
    </>
  );
}

/** Settings for the page on the canvas, including a floor plan / photo backdrop. */
function PageProps() {
  const pg = useCurrentPage();
  const { renamePage, setBackdrop, updateBackdrop, snapshot } = useDiagram.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const bd = pg.nodes.find((n): n is BackdropNode => n.type === 'backdrop');

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const img = await loadImageFile(f);
      setBackdrop(img.dataUrl, img.width, img.height);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Page · {pg.kind === 'floorplan' ? 'Floor plan' : 'Network diagram'}</div>
      <Field label="Page name" value={pg.name} onChange={(v) => renamePage(pg.id, v)} />
      <span className="mb-1 block text-[11px] font-medium text-gray-500">{pg.kind === 'floorplan' ? 'Floor plan image' : 'Background image (optional)'}</span>
      {bd ? (
        <div className="space-y-2 rounded border border-gray-200 p-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- preview of the user's image */}
          <img src={bd.data.image} alt="" className="max-h-24 w-full rounded object-contain" />
          <label className="block">
            Opacity {Math.round(bd.data.opacity * 100)}%
            <input type="range" min={10} max={100} className="w-full" value={Math.round(bd.data.opacity * 100)} onPointerDown={snapshot}
              onChange={(e) => updateBackdrop({ opacity: Number(e.target.value) / 100 })} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={bd.data.locked} onChange={(e) => updateBackdrop({ locked: e.target.checked })} />
            Locked (unlock to move or resize it)
          </label>
          <div className="flex gap-2">
            <button className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={() => fileRef.current?.click()}>Replace…</button>
            <button className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50" onClick={() => updateBackdrop(null)}>Remove</button>
          </div>
        </div>
      ) : (
        <button
          disabled={busy}
          className="w-full rounded border border-dashed border-gray-400 bg-gray-50 px-2 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Loading…' : '+ Add image (floor plan, site photo, PNG/JPG/SVG)'}
        </button>
      )}
      <input ref={fileRef} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.svg,image/*" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );
}

function ProjectProps() {
  const p = useCurrentProject();
  const update = useDiagram((s) => s.updateProject);
  const devices = allDevices(p).length;
  const cables = p.pages.reduce((n, pg) => n + pg.edges.length, 0);
  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Client</div>
      <Field label="Client name" value={p.name} onChange={(v) => update({ name: v })} />
      <Field label="Site" value={p.site} onChange={(v) => update({ site: v })} />
      <Field label="Address" value={p.address} onChange={(v) => update({ address: v })} />
      <Field label="On-site contact" value={p.contact} onChange={(v) => update({ contact: v })} />
      <Field label="Notes" value={p.notes} onChange={(v) => update({ notes: v })} area />
      <p className="mt-3 text-xs text-gray-500">{devices} devices · {cables} cables · {p.pages.length} page{p.pages.length === 1 ? '' : 's'}</p>
      <p className="mt-1 text-[10px] text-gray-400">Select a device or cable to edit it.</p>
    </>
  );
}

export function PropertiesPanel() {
  const p = useCurrentPage();
  const update = useDiagram((s) => s.updateNodeData);
  const selNodes = p.nodes.filter((n) => n.selected);
  const selEdges = p.edges.filter((e) => e.selected);

  let body: React.ReactNode;
  if (selNodes.length + selEdges.length > 1) {
    body = <p className="text-sm text-gray-500">{selNodes.length + selEdges.length} items selected</p>;
  } else if (selNodes[0]?.type === 'device') {
    body = <DeviceProps node={selNodes[0]} />;
  } else if (selNodes[0]?.type === 'zone') {
    const z = selNodes[0];
    body = (
      <>
        <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Zone</div>
        <Field label="Title" value={z.data.title} onChange={(v) => update(z.id, { title: v })} />
        <div className="flex gap-1">
          {['#3b82f6', '#16a34a', '#dc2626', '#ea580c', '#7c3aed', '#6b7280'].map((c) => (
            <button key={c} onClick={() => update(z.id, { color: c })} className={`h-6 w-6 rounded ${z.data.color === c ? 'ring-2 ring-offset-1' : ''}`} style={{ background: c }} aria-label={c} />
          ))}
        </div>
      </>
    );
  } else if (selNodes[0]?.type === 'note') {
    body = <p className="text-sm text-gray-500">Edit the note text directly on the canvas.</p>;
  } else if (selEdges[0]) {
    body = <CableProps id={selEdges[0].id} data={(selEdges[0].data ?? { cable: 'Cat6' }) as CableData} />;
  } else if (selNodes[0]?.type === 'backdrop') {
    body = <PageProps />;
  } else {
    body = (
      <>
        <PageProps />
        <hr className="my-4 border-gray-200" />
        <ProjectProps />
      </>
    );
  }

  return <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3">{body}</aside>;
}
