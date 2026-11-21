'use client';

import { HeaderFooterEditor } from './HeaderFooterEditor';

import { turnedBox } from '@/lib/rotation';
import { fmtNum, fromUnits, useUnits } from '@/lib/measure';
import { rackLabel } from '@/lib/rack';
import { baseSize } from './nodes';
import { useRef, useState } from 'react';
import { loadImageFile } from '@/lib/imageImport';
import { CABLE_STYLES, DEFAULT_INFO_FIELDS, EXTRA_FIELD_SUGGESTIONS, INFO_BOX_FIELDS, type ExtraField, type InfoBoxPorts, type InfoBoxSettings, DEFAULT_LABEL_FIELDS, isDocumented, type PortData, type PortDef, DEVICE_LABEL_FIELDS, DEVICE_STATUSES, type CableEdge, type DeviceLabelField, type BackdropNode, type CableArrows, type CableData, type CableRoute, type CableType, type DeviceNode, type ShapeData, type ShapeNode } from '@/lib/types';
import { allDevices } from '@/lib/project';
import { useCurrentPage, useCurrentProject, useDiagram, useStencil } from '@/store/useDiagramStore';
import { PAGE_LINK, resolveLink } from '@/lib/links';
import { ArrangeButtons } from './ArrangeMenu';
import { setPref } from '@/lib/prefs';
import { editStencil } from './ContextMenu';
import { useFollowLink } from './NodeBadges';
import { realLength, SET_SCALE_EVENT } from '@/lib/units';
import type { LengthUnit } from '@/lib/types';

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

/** Remembers which sections are collapsed while the app is open (like Visio's pane sections). */
const closedSections = new Set<string>();

/** A collapsible section of the Shape Data pane. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const key = title.replace(/\s*\(.*\)$/, '');
  const [open, setOpen] = useState(!closedSections.has(key));
  return (
    <section className="-mx-3 border-b border-gray-200">
      <button
        className="flex w-full items-center gap-1.5 bg-gray-50 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-100"
        onClick={() => { if (open) closedSections.add(key); else closedSections.delete(key); setOpen(!open); }}
        aria-expanded={open}
      >
        <span className="w-3 text-[10px] text-gray-400">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="px-3 pb-2 pt-2">{children}</div>}
    </section>
  );
}

/** X / Y of the selected item (Visio's Size & Position), in diagram units. */
function PositionEditor({ id }: { id: string }) {
  const page = useCurrentPage();
  const units = useUnits(page);
  const node = page.nodes.find((n) => n.id === id);
  const setPositions = useDiagram((s) => s.setPositions);
  if (!node) return null;
  const read = (v: string) => {
    const n = Number(v.replace(',', '.').replace(/[a-z\s]+$/i, ''));
    return Number.isFinite(n) ? Math.round(fromUnits(n, units)) : null;
  };
  const commitAxis = (axis: 'x' | 'y', v: string) => {
    const n = read(v);
    if (n !== null && n !== Math.round(node.position[axis])) setPositions(new Map([[id, { ...node.position, [axis]: n }]]));
  };
  const field = (label: string, value: number, onCommit: (v: string) => void, aria: string) => (
    <label className="flex flex-1 items-center gap-1 text-xs">
      <span className="w-3 text-gray-500">{label}</span>
      <input
        key={`${label}${value}${units}`}
        className="w-full rounded border border-gray-300 px-1.5 py-0.5 font-mono outline-none focus:border-blue-500"
        defaultValue={fmtNum(value, units)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={aria}
      />
    </label>
  );
  // Width / height for drawing shapes, zones and notes (devices size by percentage above).
  const sizable = node.type === 'shape' || node.type === 'zone' || node.type === 'note';
  const st = node.style as { width?: number; height?: number } | undefined;
  const w = Math.round(node.width ?? st?.width ?? node.measured?.width ?? 0), h = Math.round(node.height ?? st?.height ?? node.measured?.height ?? 0);
  const setSize = (which: 'w' | 'h', v: string) => {
    const n = read(v);
    if (n === null || n < 10 || n === (which === 'w' ? w : h)) return;
    useDiagram.getState().snapshot();
    useDiagram.getState().setNodeBox(id, node.position, which === 'w' ? n : w, which === 'h' ? n : h);
  };
  return (
    <div className="mt-1">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Position{sizable ? ' and size' : ''} ({units})</span>
      <div className="flex gap-2">
        {field('X', node.position.x, (v) => commitAxis('x', v), 'X position')}
        {field('Y', node.position.y, (v) => commitAxis('y', v), 'Y position')}
      </div>
      {sizable && w > 0 && (
        <div className="mt-1 flex gap-2">
          {field('W', w, (v) => setSize('w', v), 'Width')}
          {field('H', h, (v) => setSize('h', v), 'Height')}
        </div>
      )}
    </div>
  );
}

function DeviceProps({ node }: { node: DeviceNode }) {
  const project = useCurrentProject();
  const pg = useCurrentPage();
  const update = useDiagram((s) => s.updateNodeData);
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] uppercase tracking-wide text-gray-500">{stencil?.name}</span>
        {stencil && (
          <button className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => editStencil(stencil.id, node.id)} title="Edit the shape: its picture, size and ports (like Visio's Edit Master)">
            Edit shape…
          </button>
        )}
      </div>
      <Section title="Shape Data">
      <Field label="Name / hostname" value={d.name} onChange={set('name')} />
      <div className="flex gap-2">
        <label className="mb-2 block flex-1">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Status</span>
          <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={d.status ?? 'active'} onChange={(e) => { snapshot(); update(node.id, { status: e.target.value }); }}>
            {DEVICE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <LayerSelect value={d.layer} onChange={(layer) => { snapshot(); update(node.id, { layer }); }} />
      </div>
      <Field label="Model" value={d.model} onChange={set('model')} />
      <Field label="Management IP" value={d.ip} onChange={set('ip')} mono />
      <Field label="MAC address" value={d.mac} onChange={set('mac')} mono />
      <Field label="Serial number" value={d.serial} onChange={set('serial')} mono />
      <ExtraFieldsEditor node={node} />
      <Field label="Location" value={d.location} onChange={set('location')} />
      <LinkField nodeId={node.id} value={d.link} />
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
      </Section>
      {stencil && stencil.ports.length > 0 && (
        <Section title={`Ports (${stencil.ports.length})`}>
          <PortList node={node} ports={stencil.ports} peer={peer} />
        </Section>
      )}
      <Section title="Display">
        <LabelEditor nodes={[node]} />
        <InfoBoxEditor nodes={[node]} />
      </Section>
      <Section title="Size & Position">
      {stencil && (() => {
        const b0 = baseSize(stencil);
        // A turned device's box surrounds the turned drawing.
        const base = stencil.style === 'icon' ? b0 : (({ w, h }) => ({ width: w, height: h }))(turnedBox(b0.width, b0.height, node.data.rotation ?? 0));
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
        <PositionEditor id={node.id} />
        <div className="mt-2">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Angle</span>
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} max={359} className="w-20 rounded border border-gray-300 px-1.5 py-1 text-sm" value={Math.round(d.rotation ?? 0)}
              onFocus={() => useDiagram.getState().snapshot()}
              onChange={(e) => useDiagram.getState().setDeviceRotation(node.id, Number(e.target.value) || 0)}
            />
            <span className="text-sm text-gray-500">°</span>
            {[0, 90, 180, 270].map((a) => (
              <button key={a} className={`rounded border px-1.5 py-0.5 text-xs ${Math.round(d.rotation ?? 0) === a ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`} onClick={() => { useDiagram.getState().snapshot(); useDiagram.getState().setDeviceRotation(node.id, a); }}>{a}°</button>
            ))}
          </div>
          <span className="text-[10px] text-gray-400">Or drag the round handle above the selected device (Shift: 15° steps).</span>
        </div>
      </Section>
    </>
  );
}

/**
 * The device's ports: what is plugged into each (even devices not drawn on the diagram), its IP and VLAN,
 * whether it's an uplink, and notes. Click a row to edit it.
 */
function PortList({ node, ports, peer }: { node: DeviceNode; ports: PortDef[]; peer: (portId: string) => string }) {
  const updatePort = useDiagram((s) => s.updatePort);
  const snapshot = useDiagram((s) => s.snapshot);
  const [open, setOpen] = useState<string | null>(null);
  const [onlyNoted, setOnlyNoted] = useState(false);
  const noted = ports.filter((p) => isDocumented(node.data.ports?.[p.id]) || peer(p.id)).length;
  const shown = onlyNoted ? ports.filter((p) => isDocumented(node.data.ports?.[p.id]) || peer(p.id) || open === p.id) : ports;
  const input = 'w-full rounded border border-gray-300 px-1.5 py-0.5 text-xs outline-none focus:border-blue-500';

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ports</h4>
        <label className="flex items-center gap-1 text-[10px] text-gray-500" title="Only ports with notes or a cable">
          <input type="checkbox" checked={onlyNoted} onChange={(e) => setOnlyNoted(e.target.checked)} />
          In use ({noted})
        </label>
      </div>
      <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-xs">
        {shown.map((p) => {
          const pd = node.data.ports?.[p.id] ?? {};
          const cable = peer(p.id);
          const isOpen = open === p.id;
          const set = (patch: Partial<PortData>) => updatePort(node.id, p.id, patch);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-1.5 px-1.5 py-1 text-left ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                onClick={() => setOpen(isOpen ? null : p.id)}
                aria-expanded={isOpen}
              >
                <span className="w-9 shrink-0 font-mono font-medium">{pd.label || p.label}</span>
                {pd.uplink && <span className="shrink-0 rounded bg-orange-100 px-1 text-[9px] font-semibold text-orange-700">UPLINK</span>}
                <span className={`min-w-0 flex-1 truncate ${pd.description ? 'text-gray-800' : cable ? 'text-green-700' : 'text-gray-300'}`}>
                  {pd.description || (cable ? `→ ${cable}` : p.role || '—')}
                </span>
                {pd.ip && <span className="shrink-0 font-mono text-[10px] text-gray-500">{pd.ip}</span>}
                {pd.vlan && <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] text-gray-600">V{pd.vlan}</span>}
                {pd.notes && <span className="shrink-0 text-[10px] text-gray-400" title={pd.notes}>✎</span>}
              </button>
              {isOpen && (
                <div className="space-y-1.5 bg-blue-50/40 px-2 pb-2 pt-1">
                  <label className="block">
                    <span className="text-[10px] text-gray-500">Port name on this device</span>
                    <input className={`${input} font-mono`} value={pd.label ?? ''} placeholder={p.label} onFocus={snapshot} onChange={(e) => set({ label: e.target.value || undefined })} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500">Connected to</span>
                    <input className={input} value={pd.description ?? ''} placeholder={cable || 'e.g. Front desk printer, Core switch port 48'} onFocus={snapshot} onChange={(e) => set({ description: e.target.value })} />
                  </label>
                  <div className="flex gap-1.5">
                    <label className="block flex-[2]">
                      <span className="text-[10px] text-gray-500">IP</span>
                      <input className={`${input} font-mono`} value={pd.ip ?? ''} placeholder="10.0.0.50" onFocus={snapshot} onChange={(e) => set({ ip: e.target.value })} />
                    </label>
                    <label className="block flex-1">
                      <span className="text-[10px] text-gray-500">VLAN</span>
                      <input className={`${input} font-mono`} value={pd.vlan ?? ''} onFocus={snapshot} onChange={(e) => set({ vlan: e.target.value })} />
                    </label>
                  </div>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!pd.uplink} onChange={(e) => { snapshot(); set({ uplink: e.target.checked || undefined }); }} />
                    Uplink port
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-gray-500">Notes</span>
                    <textarea className={input} rows={2} value={pd.notes ?? ''} placeholder="Patch panel B-12, PoE camera, LACP member…" onFocus={snapshot} onChange={(e) => set({ notes: e.target.value })} />
                  </label>
                  {cable && <p className="text-[10px] text-green-700">Cable on the diagram: {cable}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The user's own name/value details on a device: WAN IP, LAN subnet, gateway, circuit ID… */
function ExtraFieldsEditor({ node }: { node: DeviceNode }) {
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const list = node.data.extraFields ?? [];
  const set = (next: ExtraField[]) => update(node.id, { extraFields: next.length ? next : undefined });
  const input = 'min-w-0 rounded border border-gray-300 px-1.5 py-1 text-sm outline-none focus:border-blue-500';
  // Fields defined for the whole client (Data → Define Shape Data) come first, with the right kind of input.
  const category = useStencil(node.data.stencilId)?.category;
  const defs = (useCurrentProject().fieldDefs ?? []).filter((d) => d.label.trim() && (!d.category || d.category === category));
  const key = (s: string) => s.trim().toLowerCase();
  const defined = new Set(defs.map((d) => key(d.label)));
  const valueOf = (label: string) => list.find((f) => key(f.label) === key(label))?.value ?? '';
  const setValue = (label: string, value: string) => {
    const has = list.some((f) => key(f.label) === key(label));
    const next = has ? list.map((f) => (key(f.label) === key(label) ? { ...f, value } : f)) : [...list, { label, value }];
    set(next.filter((f) => !(defined.has(key(f.label)) && !f.value)));
  };
  return (
    <div className="mb-2">
      {defs.length > 0 && (
        <div className="mb-2 space-y-1">
          {defs.map((d) => {
            const v = valueOf(d.label);
            const missing = d.required && !v.trim();
            return (
              <label key={d.id} className="flex items-center gap-1">
                <span className={`w-24 shrink-0 truncate text-xs ${missing ? 'text-amber-700' : 'text-gray-600'}`} title={d.required ? `${d.label} (required)` : d.label}>{d.label}{d.required ? ' *' : ''}</span>
                {d.type === 'list' ? (
                  <select className={`${input} flex-1 text-xs`} value={v} onFocus={snapshot} onChange={(e) => setValue(d.label, e.target.value)}>
                    <option value="">—</option>
                    {[...new Set([...(d.options ?? []), ...(v && !(d.options ?? []).includes(v) ? [v] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : d.type === 'yesno' ? (
                  <select className={`${input} flex-1 text-xs`} value={v} onFocus={snapshot} onChange={(e) => setValue(d.label, e.target.value)}>
                    <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                  </select>
                ) : (
                  <input
                    className={`${input} flex-1 text-xs ${d.type === 'text' ? 'font-mono' : ''}`} type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                    value={v} onFocus={snapshot} onChange={(e) => setValue(d.label, e.target.value)} aria-label={d.label}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">My fields</span>
      <datalist id="nc-extra-field-names">{EXTRA_FIELD_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
      <div className="space-y-1">
        {list.map((f, i) => defined.has(key(f.label)) ? null : (
          <div key={i} className="flex gap-1">
            <input className={`${input} w-24 shrink-0 text-xs`} list="nc-extra-field-names" placeholder="Name" value={f.label} onFocus={snapshot}
              onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Field name" />
            <input className={`${input} flex-1 font-mono text-xs`} placeholder="Value" value={f.value} onFocus={snapshot}
              onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label={`${f.label || 'Field'} value`} />
            <button className="shrink-0 px-1 text-gray-400 hover:text-red-600" onClick={() => { snapshot(); set(list.filter((_, j) => j !== i)); }} aria-label={`Remove ${f.label || 'field'}`}>✕</button>
          </div>
        ))}
      </div>
      <button className="mt-1 text-xs text-blue-600 hover:underline" onClick={() => { snapshot(); set([...list, { label: list.length ? '' : 'WAN IP', value: '' }]); }}>
        + Add field
      </button>
      <span className="ml-1 text-[10px] text-gray-400">e.g. WAN IP, LAN subnet, gateway, circuit ID</span>
    </div>
  );
}

/** The printable info box beside each device: on/off, which details, which ports. Works on several devices at once. */
function InfoBoxEditor({ nodes }: { nodes: DeviceNode[] }) {
  const mapDevices = useDiagram((s) => s.mapDevices);
  const ids = nodes.map((n) => n.id);
  const boxOf = (n: DeviceNode) => n.data.infoBox ?? { show: false };
  const shown = nodes.filter((n) => boxOf(n).show).length;
  const first = boxOf(nodes[0]);
  const fields = first.fields ?? DEFAULT_INFO_FIELDS;
  const change = (patch: Partial<InfoBoxSettings>) => mapDevices(ids, (d) => ({ infoBox: { show: false, ...d.infoBox, ...patch } }));
  const moved = nodes.some((n) => n.data.infoBox?.offset && (n.data.infoBox.offset.x || n.data.infoBox.offset.y));
  return (
    <div className="mb-2 rounded border border-gray-200 p-2">
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={shown === nodes.length} ref={(el) => { if (el) el.indeterminate = shown > 0 && shown < nodes.length; }}
          onChange={(e) => change({ show: e.target.checked })} />
        Info box on the diagram
      </label>
      <p className="mb-1 text-[10px] text-gray-400">Details beside the device; it prints and exports with the diagram.</p>
      {shown > 0 && (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {INFO_BOX_FIELDS.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-1">
                <input type="checkbox" checked={fields.includes(value)}
                  onChange={(e) => change({ fields: INFO_BOX_FIELDS.map((x) => x.value).filter((x) => (x === value ? e.target.checked : fields.includes(x))) })} />
                {label}
              </label>
            ))}
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-xs">
            Ports
            <select className="rounded border border-gray-300 px-1 py-0.5 text-xs" value={first.ports ?? 'used'} onChange={(e) => change({ ports: e.target.value as InfoBoxPorts })}>
              <option value="used">All in use (cabled or noted)</option>
              <option value="uplinks">Uplinks only</option>
              <option value="none">None</option>
            </select>
          </label>
          <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
            <span>Drag the box on the canvas to move it.</span>
            {moved && <button className="text-blue-600 hover:underline" onClick={() => change({ offset: undefined })}>Reset position</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** What the device label on the diagram shows, for one or several devices. */
function LabelEditor({ nodes }: { nodes: DeviceNode[] }) {
  const updateDevices = useDiagram((s) => s.updateDevicesData);
  const ids = nodes.map((n) => n.id);
  const fieldsOf = (n: DeviceNode) => n.data.labelFields ?? DEFAULT_LABEL_FIELDS;
  const state = (f: DeviceLabelField) => {
    const on = nodes.filter((n) => fieldsOf(n).includes(f)).length;
    return on === nodes.length ? true : on === 0 ? false : null; // null = mixed
  };
  // One undoable change for all selected devices; a field shown on only some of them counts as shown.
  const toggle = (f: DeviceLabelField, on: boolean) =>
    updateDevices(ids, { labelFields: DEVICE_LABEL_FIELDS.map((x) => x.value).filter((x) => (x === f ? on : state(x) !== false)) });
  const moved = nodes.some((n) => n.data.labelOffset && (n.data.labelOffset.x || n.data.labelOffset.y));
  return (
    <div className="mb-2">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Show on the diagram</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {DEVICE_LABEL_FIELDS.map(({ value, label }) => {
          const st = state(value);
          return (
            <label key={value} className="flex items-center gap-1">
              <input type="checkbox" checked={st === true} ref={(el) => { if (el) el.indeterminate = st === null; }} onChange={(e) => toggle(value, e.target.checked)} />
              {label}
            </label>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>Drag the label on the canvas to move it.</span>
        {moved && <button className="text-blue-600 hover:underline" onClick={() => updateDevices(ids, { labelOffset: undefined, labelSide: undefined })}>Reset position</button>}
      </div>
    </div>
  );
}

const CABLE_SWATCHES = ['#2563eb', '#0891b2', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#374151', '#9ca3af', '#000000'];

/** Line color for one or several cables; "Auto" follows the cable type or VLAN coloring (View menu). */
function CableColorEditor({ edges }: { edges: CableEdge[] }) {
  const updateEdges = useDiagram((s) => s.updateEdgesData);
  const ids = edges.map((e) => e.id);
  const colors = new Set(edges.map((e) => e.data?.color ?? ''));
  const current = colors.size === 1 ? [...colors][0] : null; // null = mixed
  const set = (color: string | undefined) => updateEdges(ids, { color });
  return (
    <div className="mb-2">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Line color</span>
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => set(undefined)}
          className={`h-5 rounded border px-1.5 text-[10px] ${current === '' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          title="Color by cable type or VLAN (View menu)"
        >
          Auto
        </button>
        {CABLE_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => set(c)}
            className={`h-5 w-5 rounded border ${current === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-gray-300'}`}
            style={{ background: c }}
            aria-label={c}
            title={c}
          />
        ))}
        <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded border border-gray-300" title="Other color…" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={current || '#2563eb'} onChange={(e) => set(e.target.value)} aria-label="Other color" />
        </label>
      </div>
    </div>
  );
}

/** Layer picker; layers are created in the View menu. */
function LayerSelect({ value, onChange }: { value?: string; onChange: (layer: string | undefined) => void }) {
  const layers = useCurrentProject().layers ?? [];
  return (
    <label className="mb-2 block flex-1">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Layer</span>
      <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} title={layers.length ? '' : 'Create layers in the View menu'}>
        <option value="">None</option>
        {layers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.visible ? '' : ' (hidden)'}</option>)}
      </select>
    </label>
  );
}

/** Hyperlink of an item: a web address (device web UI, ticket, KB article) or another page of this client. */
function LinkField({ nodeId, value }: { nodeId: string; value?: string }) {
  const pages = useCurrentProject().pages;
  const here = useCurrentPage().id;
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const follow = useFollowLink();
  const isPage = !!value?.startsWith(PAGE_LINK);
  const target = resolveLink(value);
  const invalid = !!value?.trim() && !target;
  const set = (link: string) => update(nodeId, { link: link || undefined });
  return (
    <div className="mb-2">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Link</span>
      <div className="flex gap-1">
        <select
          className="w-24 shrink-0 rounded border border-gray-300 px-1 py-1 text-sm"
          value={isPage ? value : ''}
          onChange={(e) => { snapshot(); set(e.target.value); }}
          aria-label="Link type"
        >
          <option value="">Web</option>
          {pages.filter((pg) => pg.id !== here).map((pg) => <option key={pg.id} value={`${PAGE_LINK}${pg.id}`}>Page: {pg.name}</option>)}
        </select>
        {!isPage && (
          <input
            className={`min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none ${invalid ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`}
            value={value ?? ''}
            placeholder="https://… or 192.168.1.1"
            onFocus={snapshot}
            onChange={(e) => set(e.target.value)}
            aria-label="Link address"
          />
        )}
        {target && <button className="shrink-0 rounded border border-gray-300 px-2 text-xs text-blue-700 hover:bg-blue-50" onClick={() => follow(value)} title="Follow the link">Open</button>}
      </div>
      {invalid && <span className="text-[10px] text-red-600">Use a web address (https://…), mailto: or a host name / IP.</span>}
    </div>
  );
}

/** Cable run length: typed, or measured from the drawing when the page has a scale. */
function CableLength({ id, data }: { id: string; data: CableData }) {
  const scale = useCurrentPage().scale;
  const update = useDiagram((s) => s.updateEdgeData);
  const snapshot = useDiagram((s) => s.snapshot);
  // Length of the drawn path (whatever its routing), read from the canvas.
  const drawn = (() => {
    if (!scale || typeof document === 'undefined') return '';
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"] path.react-flow__edge-path`);
    const px = path?.getTotalLength?.();
    return px ? realLength(px, scale) : '';
  })();
  return (
    <div className="mb-2">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Length</span>
      <div className="flex gap-1">
        <input className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" value={data.length ?? ''} placeholder={drawn || 'e.g. 42 ft'}
          onFocus={snapshot} onChange={(e) => update(id, { length: e.target.value || undefined })} />
        {drawn && (
          <button className="shrink-0 rounded border border-gray-300 px-2 text-xs hover:bg-gray-50" onClick={() => { snapshot(); update(id, { length: drawn }); }} title="Use the length measured on the scaled drawing">
            Use {drawn}
          </button>
        )}
      </div>
      <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={!!data.showLength} onChange={(e) => { snapshot(); update(id, { showLength: e.target.checked || undefined }); }} /> Show length on the cable
      </label>
      {!scale && <p className="text-[10px] text-gray-400">Set the page scale (right panel, nothing selected) to measure runs from the drawing.</p>}
    </div>
  );
}

function CableProps({ edge }: { edge: CableEdge }) {
  const id = edge.id;
  const data = (edge.data ?? { cable: 'Cat6' }) as CableData;
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
      <CableColorEditor edges={[edge]} />
      <Field label="Label" value={data.label} onChange={(v) => update(id, { label: v })} />
      <CableLength id={id} data={data} />
      <Field label="VLAN(s)" value={data.vlan} onChange={(v) => update(id, { vlan: v })} mono />
      <div className="flex gap-2">
        <label className="mb-2 block flex-1">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Route</span>
          <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={data.route ?? 'step'} onChange={(e) => { snapshot(); update(id, { route: e.target.value as CableRoute }); }}>
            <option value="step">Right angles (around devices)</option>
            <option value="straight">Straight</option>
            <option value="curved">Curved</option>
          </select>
        </label>
        <label className="mb-2 block flex-1">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Arrows</span>
          <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={data.arrows ?? 'none'} onChange={(e) => { snapshot(); update(id, { arrows: e.target.value as CableArrows }); }}>
            <option value="none">None</option>
            <option value="end">At end</option>
            <option value="start">At start</option>
            <option value="both">Both ends</option>
          </select>
        </label>
      </div>
      <LayerSelect value={data.layer} onChange={(layer) => { snapshot(); update(id, { layer }); }} />
    </>
  );
}

const SWATCHES = ['transparent', '#ffffff', '#f3f4f6', '#dbeafe', '#dcfce7', '#fef9c3', '#fee2e2', '#ede9fe', '#93c5fd', '#374151', '#111827'];

function ShapeProps({ node }: { node: ShapeNode }) {
  const pageNodes = useCurrentPage().nodes;
  const update = useDiagram((s) => s.updateNodeData);
  const snapshot = useDiagram((s) => s.snapshot);
  const d = node.data;
  const set = (patch: Partial<ShapeData>) => { snapshot(); update(node.id, patch); };
  const swatchRow = (label: string, key: 'fill' | 'stroke' | 'textColor') => (
    <div className="mb-2">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {SWATCHES.filter((c) => key !== 'textColor' || c !== 'transparent').map((c) => (
          <button
            key={c}
            onClick={() => set({ [key]: c })}
            className={`h-5 w-5 rounded border ${d[key] === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-gray-300'}`}
            style={{ background: c === 'transparent' ? 'repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 0 0/8px 8px' : c }}
            aria-label={c === 'transparent' ? 'None' : c}
            title={c === 'transparent' ? 'None' : c}
          />
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">Shape · {d.kind}</div>
      {d.kind === 'table' ? (
        <p className="mb-2 text-[11px] text-gray-500">Double-click a cell to type in it (Tab = next cell). Add or delete rows and columns on the Shape tab.</p>
      ) : (
      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Text (or double-click the shape)</span>
        <textarea className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" rows={3} value={d.text} onFocus={snapshot} onChange={(e) => update(node.id, { text: e.target.value })} />
      </label>
      )}
      <label className="mb-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Text size: {d.fontSize}px</span>
        <input type="range" min={8} max={48} className="w-full" value={d.fontSize} onPointerDown={snapshot} onChange={(e) => update(node.id, { fontSize: Number(e.target.value) })} />
      </label>
      {d.kind !== 'text' && swatchRow('Fill', 'fill')}
      {d.kind !== 'text' && swatchRow('Border', 'stroke')}
      {swatchRow('Text color', 'textColor')}
      {d.kind !== 'text' && (
        <label className="mb-2 flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!d.dashed} onChange={(e) => set({ dashed: e.target.checked })} /> Dashed border</label>
      )}
      {d.kind === 'callout' && (
        <label className="mb-2 block">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Points to</span>
          <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={d.target ?? ''} onChange={(e) => set({ target: e.target.value || undefined })}>
            <option value="">Nothing (free text)</option>
            {pageNodes.filter((n) => n.id !== node.id && n.type !== 'backdrop' && n.type !== 'measure').map((n) => (
              <option key={n.id} value={n.id}>{n.type === 'device' ? n.data.name : n.type === 'zone' ? `Zone: ${n.data.title}` : n.type === 'shape' ? `Shape: ${n.data.text || n.data.kind}` : 'Note'}</option>
            ))}
          </select>
          <span className="text-[10px] text-gray-400">It moves along when you move what it points to.</span>
        </label>
      )}
      {d.kind === 'door' && (
        <div className="mb-2 flex gap-2">
          <label className="block flex-1">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Rotate</span>
            <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={d.rotation ?? 0} onChange={(e) => set({ rotation: Number(e.target.value) })}>
              <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
            </select>
          </label>
          <label className="mt-4 flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!d.flip} onChange={(e) => set({ flip: e.target.checked || undefined })} /> Swing the other way</label>
        </div>
      )}
      {d.kind !== 'door' && d.kind !== 'window' && d.kind !== 'callout' && (
        <div className="mb-2">
          <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Angle{d.kind === 'arrow' ? ' (0° points right)' : ''}</span>
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} max={359} className="w-20 rounded border border-gray-300 px-1.5 py-1 text-sm" value={Math.round(d.rotation ?? 0)}
              onFocus={() => useDiagram.getState().snapshot()}
              onChange={(e) => set({ rotation: ((Number(e.target.value) % 360) + 360) % 360 })}
            />
            <span className="text-sm text-gray-500">°</span>
            {[0, 90, 180, 270].map((a) => (
              <button key={a} className={`rounded border px-1.5 py-0.5 text-xs ${Math.round(d.rotation ?? 0) === a ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`} onClick={() => set({ rotation: a })}>{a}°</button>
            ))}
          </div>
          <span className="text-[10px] text-gray-400">Or drag the round handle above the selected shape (Shift: 15° steps).</span>
        </div>
      )}
      <LayerSelect value={d.layer} onChange={(layer) => set({ layer })} />
      <div className="mb-2"><PositionEditor id={node.id} /></div>
      <LinkField nodeId={node.id} value={d.link} />
      <p className="mt-2 text-[10px] text-gray-400">Drag from a blue dot on its edge to draw an arrow to another shape or device.</p>
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
      <ScaleProps />
    </>
  );
}

/** Drawing scale of the page, for dimension lines and cable lengths on floor plans. */
function ScaleProps() {
  const pg = useCurrentPage();
  const setPageScale = useDiagram((s) => s.setPageScale);
  const sc = pg.scale;
  // Per 100 diagram units, which is roughly one device width; easier to read than per pixel.
  const per100 = sc ? +(sc.perPx * 100).toPrecision(4) : '';
  return (
    <div className="mt-3">
      <span className="mb-1 block text-[11px] font-medium text-gray-500">Drawing scale</span>
      {sc ? (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-1">
            100 units =
            <input className="w-16 rounded border border-gray-300 px-1 py-0.5" type="number" min={0} step="any" defaultValue={per100} key={`${per100}${sc.unit}`}
              onBlur={(e) => { const v = Number(e.target.value); if (v > 0) setPageScale({ ...sc, perPx: v / 100 }); }} aria-label="Real distance per 100 diagram units" />
            <select className="rounded border border-gray-300 px-1 py-0.5" value={sc.unit} onChange={(e) => setPageScale({ ...sc, unit: e.target.value as LengthUnit, perPx: e.target.value === sc.unit ? sc.perPx : e.target.value === 'm' ? sc.perPx * 0.3048 : sc.perPx / 0.3048 })} aria-label="Unit">
              <option value="ft">feet</option>
              <option value="m">metres</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button className="text-blue-600 hover:underline" onClick={() => window.dispatchEvent(new Event(SET_SCALE_EVENT))}>Set again from the drawing…</button>
            <button className="text-gray-500 hover:underline" onClick={() => setPageScale(null)}>Remove</button>
          </div>
        </div>
      ) : (
        <>
          <button className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => window.dispatchEvent(new Event(SET_SCALE_EVENT))}>
            Set scale… (click two points a known distance apart)
          </button>
          <p className="mt-1 text-[10px] text-gray-400">Lets dimension lines and cables show real lengths, e.g. for cable runs on a floor plan.</p>
        </>
      )}
    </div>
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
      <hr className="my-4 border-gray-200" />
      <TitleBlockProps />
      <hr className="my-4 border-gray-200" />
      <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Header &amp; footer</div>
      <HeaderFooterEditor />
    </>
  );
}

/** Title block printed along the bottom of every PDF and printed page. */
function TitleBlockProps() {
  const tb = useCurrentProject().titleBlock;
  const update = useDiagram((s) => s.updateTitleBlock);
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Title block</span>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input type="checkbox" checked={!!tb?.show} onChange={(e) => update({ show: e.target.checked })} />
          Show
        </label>
      </div>
      {tb?.show ? (
        <>
          <Field label="Prepared by (your company)" value={tb.preparedBy} onChange={(v) => update({ preparedBy: v })} />
          <div className="flex gap-2">
            <Field label="Drawn by" value={tb.author} onChange={(v) => update({ author: v })} />
            <Field label="Revision" value={tb.revision} onChange={(v) => update({ revision: v })} />
          </div>
          <label className="mb-2 block">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Date</span>
            <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500" value={tb.date ?? ''} placeholder="Day of printing" onChange={(e) => update({ date: e.target.value })} />
          </label>
          <p className="text-[10px] text-gray-400">Printed along the bottom of every PDF and printed page, with the client, site, drawing name and page number.</p>
        </>
      ) : (
        <p className="text-[10px] text-gray-400">Add a title block (client, site, drawing, prepared by, revision, date, page number) to PDF reports and printouts.</p>
      )}
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
    body = (
      <>
        <p className="mb-3 text-sm text-gray-500">{selNodes.length + selEdges.length} items selected</p>
        {selNodes.length > 1 && <ArrangeButtons />}
        {selNodes.some((n) => n.type === 'device') && (
          <div className="mt-4">
            <LabelEditor nodes={selNodes.filter((n): n is DeviceNode => n.type === 'device')} />
            <InfoBoxEditor nodes={selNodes.filter((n): n is DeviceNode => n.type === 'device')} />
          </div>
        )}
        {selEdges.length > 0 && <div className="mt-4"><CableColorEditor edges={selEdges} /></div>}
      </>
    );
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
        <PositionEditor id={z.id} />
        <p className="mt-3 text-xs text-gray-500">A zone is a container: dragging it moves everything inside it.</p>
        <button className="mt-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" onClick={() => useDiagram.getState().fitZoneToContents(z.id)}>
          Fit to contents
        </button>
        <div className="mt-3"><LinkField nodeId={z.id} value={z.data.link} /></div>
      </>
    );
  } else if (selNodes[0]?.type === 'note') {
    body = <p className="text-sm text-gray-500">Edit the note text directly on the canvas.</p>;
  } else if (selEdges[0]) {
    body = <CableProps edge={selEdges[0]} />;
  } else if (selNodes[0]?.type === 'shape') {
    body = <ShapeProps node={selNodes[0]} />;
  } else if (selNodes[0]?.type === 'measure') {
    const m = selNodes[0];
    const len = Math.hypot(m.data.dx, m.data.dy);
    body = (
      <>
        <div className="mb-3 text-[11px] uppercase tracking-wide text-gray-500">{m.data.variant === 'wall' ? 'Wall' : m.data.variant === 'line' ? 'Line' : 'Dimension line'}</div>
        <p className="mb-2 text-sm">{p.scale ? realLength(len, p.scale) : `${Math.round(len)} units (no scale set)`}</p>
        {m.data.variant === 'line' && (
          <div className="mb-2 space-y-2">
            <div className="flex flex-wrap gap-1">
              {['#374151', '#000000', '#2563eb', '#16a34a', '#dc2626', '#ea580c', '#7c3aed', '#9ca3af'].map((c) => (
                <button key={c} onClick={() => { useDiagram.getState().snapshot(); update(m.id, { color: c }); }} className={`h-6 w-6 rounded ${(m.data.color ?? '#374151') === c ? 'ring-2 ring-offset-1' : ''}`} style={{ background: c }} aria-label={c} />
              ))}
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Width: {m.data.thickness ?? 2}</span>
              <input type="range" min={1} max={12} className="w-full" value={m.data.thickness ?? 2} onPointerDown={() => useDiagram.getState().snapshot()} onChange={(e) => update(m.id, { thickness: Number(e.target.value) })} />
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!m.data.dashed} onChange={(e) => { useDiagram.getState().snapshot(); update(m.id, { dashed: e.target.checked || undefined }); }} /> Dashed</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!m.data.arrowStart} onChange={(e) => { useDiagram.getState().snapshot(); update(m.id, { arrowStart: e.target.checked || undefined }); }} /> Arrow at start</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!m.data.arrowEnd} onChange={(e) => { useDiagram.getState().snapshot(); update(m.id, { arrowEnd: e.target.checked || undefined }); }} /> Arrow at end</label>
            </div>
            <LayerSelect value={m.data.layer} onChange={(layer) => update(m.id, { layer })} />
          </div>
        )}
        {m.data.variant === 'wall' && (
          <label className="mb-2 block">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Thickness: {p.scale ? realLength(m.data.thickness ?? 8, p.scale) : `${m.data.thickness ?? 8} units`}</span>
            <input type="range" min={2} max={40} className="w-full" value={m.data.thickness ?? 8} onPointerDown={() => useDiagram.getState().snapshot()} onChange={(e) => update(m.id, { thickness: Number(e.target.value) })} />
          </label>
        )}
        <Field label="Label (optional)" value={m.data.label} onChange={(v) => update(m.id, { label: v || undefined })} />
        <p className="text-[10px] text-gray-400">Drag the line to move it; drag its blue ends to stretch it (hold Shift to keep it straight).</p>
        <hr className="my-4 border-gray-200" />
        <ScaleProps />
      </>
    );
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

  const lockedOne = selNodes.length === 1 && selNodes[0].type !== 'backdrop' && selNodes[0].data.locked;
  const title = selNodes.length + selEdges.length === 0 ? 'Page & Client' : selEdges.length && !selNodes.length ? 'Cable' : 'Shape Data';
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-gray-300 bg-white">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-gray-300 bg-[#f3f3f3] px-2 text-[12px] font-semibold text-gray-700">
        {title}
        <button className="rounded px-1 text-gray-500 hover:bg-gray-200" onClick={() => setPref('propsPane', false)} title="Close (View → Task Panes to reopen)" aria-label="Close pane">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {lockedOne && (
        <div className="mb-3 flex items-center justify-between rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
          Locked: it can&apos;t be moved or deleted.
          <button className="text-blue-600 hover:underline" onClick={() => useDiagram.getState().setSelectionLocked(false)}>Unlock</button>
        </div>
      )}
      {body}
      </div>
    </aside>
  );
}
