'use client';

import { STENCIL_MAP } from '@/lib/stencils';
import { CABLE_STYLES, type CableData, type CableType, type DeviceNode } from '@/lib/types';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

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
  const update = useDiagram((s) => s.updateNodeData);
  const updatePort = useDiagram((s) => s.updatePort);
  const snapshot = useDiagram((s) => s.snapshot);
  const stencil = STENCIL_MAP[node.data.stencilId];
  const d = node.data;
  const set = (k: string) => (v: string) => update(node.id, { [k]: v });

  const peer = (portId: string) => {
    const e = project.edges.find((x) => (x.source === node.id && x.sourceHandle === portId) || (x.target === node.id && x.targetHandle === portId));
    if (!e) return '';
    const otherId = e.source === node.id ? e.target : e.source;
    const otherPort = e.source === node.id ? e.targetHandle : e.sourceHandle;
    const other = project.nodes.find((n) => n.id === otherId);
    const name = other?.type === 'device' ? other.data.name : '?';
    return `${name} : ${otherPort ?? ''}`;
  };

  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">{stencil?.name}</div>
      <Field label="Name / hostname" value={d.name} onChange={set('name')} />
      <Field label="Model" value={d.model} onChange={set('model')} />
      <Field label="Management IP" value={d.ip} onChange={set('ip')} mono />
      <Field label="Serial number" value={d.serial} onChange={set('serial')} mono />
      <Field label="Location / rack" value={d.location} onChange={set('location')} />
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

function ProjectProps() {
  const p = useCurrentProject();
  const update = useDiagram((s) => s.updateProject);
  const devices = p.nodes.filter((n) => n.type === 'device').length;
  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Client</div>
      <Field label="Client name" value={p.name} onChange={(v) => update({ name: v })} />
      <Field label="Site" value={p.site} onChange={(v) => update({ site: v })} />
      <Field label="Address" value={p.address} onChange={(v) => update({ address: v })} />
      <Field label="On-site contact" value={p.contact} onChange={(v) => update({ contact: v })} />
      <Field label="Notes" value={p.notes} onChange={(v) => update({ notes: v })} area />
      <p className="mt-3 text-xs text-gray-500">{devices} devices · {p.edges.length} cables</p>
      <p className="mt-1 text-[10px] text-gray-400">Select a device or cable to edit it.</p>
    </>
  );
}

export function PropertiesPanel() {
  const p = useCurrentProject();
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
  } else {
    body = <ProjectProps />;
  }

  return <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3">{body}</aside>;
}
