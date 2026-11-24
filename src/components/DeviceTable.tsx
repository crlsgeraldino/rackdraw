'use client';

import { useReactFlow } from '@xyflow/react';
import { useMemo, useRef, useState } from 'react';
import { setPref } from '@/lib/prefs';
import { CABLE_STYLES, DEVICE_STATUSES, isDocumented, PORT_SPEEDS, POE_CLASSES, PORT_STATUSES, type AppNode, type CableData, type CableEdge, type CableType, type DeviceData, type DeviceNode, type PortData } from '@/lib/types';
import { getStencil, useCurrentProject, useDiagram, type ItemEdit } from '@/store/useDiagramStore';

const key = (s: string) => s.trim().toLowerCase();

/** A row of the table: a device or a cable, with the page it is on. */
type Row = { kind: 'node'; pageId: string; pageName: string; id: string; data: DeviceData; selected?: boolean }
  | { kind: 'edge'; pageId: string; pageName: string; id: string; data: CableData; from: string; fromPort: string; to: string; toPort: string; selected?: boolean }
  | { kind: 'port'; pageId: string; pageName: string; id: string; deviceId: string; portId: string; device: string; port: string; data: PortData; peer: string; selected?: boolean };

/**
 * A column: how to read a row's value as text, and (when editable) how a typed or pasted value changes the item.
 * `options` makes the cell a drop-down.
 */
interface Col {
  key: string;
  label: string;
  width: number;
  mono?: boolean;
  get: (r: Row) => string;
  set?: (r: Row, v: string, data: Record<string, unknown>) => Record<string, unknown> | null;
  options?: { value: string; label: string }[];
}

/* ---------- devices ---------- */

const extraValue = (d: DeviceData, label: string) => d.extraFields?.find((f) => key(f.label) === key(label))?.value ?? '';
function withExtra(d: Record<string, unknown>, label: string, v: string) {
  const list = (d.extraFields as DeviceData['extraFields']) ?? [];
  const has = list.some((f) => key(f.label) === key(label));
  const next = (has ? list.map((f) => (key(f.label) === key(label) ? { ...f, value: v } : f)) : [...list, { label, value: v }]).filter((f) => f.value !== '' || key(f.label) !== key(label));
  return { extraFields: next.length ? next : undefined };
}
const text = (k: keyof DeviceData, label: string, width: number, mono?: boolean): Col => ({
  key: String(k), label, width, mono,
  get: (r) => (r.kind === 'node' ? ((r.data[k] as string | undefined) ?? '') : ''),
  set: (_r, v) => ({ [k]: k === 'name' ? v : v || undefined }),
});
const statusCol: Col = {
  key: 'status', label: 'Status', width: 100,
  get: (r) => (r.kind === 'node' ? r.data.status ?? 'active' : ''),
  // Pasted text may be the label ("Planned") or the value ("planned").
  set: (_r, v) => { const s = DEVICE_STATUSES.find((x) => key(x.value) === key(v) || key(x.label) === key(v)); return s ? { status: s.value } : null; },
  options: DEVICE_STATUSES.map((s) => ({ value: s.value, label: s.label })),
};
const DEVICE_COLS: Col[] = [
  text('name', 'Name', 150), text('model', 'Model', 130), text('ip', 'IP', 110, true), text('mac', 'MAC', 130, true),
  text('serial', 'Serial', 110, true), text('location', 'Location', 110), statusCol, text('assetTag', 'Asset tag', 90),
  text('purchaseDate', 'Purchased', 95, true), text('warrantyEnd', 'Warranty ends', 105, true), text('endOfLife', 'End of life', 95, true),
];

/* ---------- cables ---------- */

const CABLE_TYPES = Object.keys(CABLE_STYLES) as CableType[];
const cableText = (k: 'vlan' | 'label' | 'length', label: string, width: number, mono?: boolean): Col => ({
  key: k, label, width, mono,
  get: (r) => (r.kind === 'edge' ? r.data[k] ?? '' : ''),
  set: (_r, v) => ({ [k]: v || undefined }),
});
const CABLE_COLS: Col[] = [
  { key: 'from', label: 'From', width: 140, get: (r) => (r.kind === 'edge' ? r.from : '') },
  { key: 'fromPort', label: 'Port', width: 70, mono: true, get: (r) => (r.kind === 'edge' ? r.fromPort : '') },
  { key: 'to', label: 'To', width: 140, get: (r) => (r.kind === 'edge' ? r.to : '') },
  { key: 'toPort', label: 'Port', width: 70, mono: true, get: (r) => (r.kind === 'edge' ? r.toPort : '') },
  {
    key: 'cable', label: 'Type', width: 90,
    get: (r) => (r.kind === 'edge' ? r.data.cable : ''),
    set: (_r, v) => { const t = CABLE_TYPES.find((c) => key(c) === key(v)); return t ? { cable: t } : null; },
    options: CABLE_TYPES.map((c) => ({ value: c, label: c })),
  },
  cableText('vlan', 'VLAN', 80, true), cableText('label', 'Label', 140), cableText('length', 'Length', 80),
];

/* ---------- ports ---------- */

const portText = (k: 'description' | 'vlan' | 'ip' | 'notes', label: string, width: number, mono?: boolean): Col => ({
  key: k, label, width, mono,
  get: (r) => (r.kind === 'port' ? r.data[k] ?? '' : ''),
  set: (_r, v) => ({ [k]: v || undefined }),
});
const PORT_COLS: Col[] = [
  { key: 'device', label: 'Device', width: 140, get: (r) => (r.kind === 'port' ? r.device : '') },
  { key: 'port', label: 'Port', width: 70, mono: true, get: (r) => (r.kind === 'port' ? r.port : '') },
  portText('description', 'Description', 170), portText('vlan', 'VLAN', 70, true), portText('ip', 'IP', 110, true),
  {
    key: 'uplink', label: 'Uplink', width: 65,
    get: (r) => (r.kind === 'port' && r.data.uplink ? 'Yes' : 'No'),
    set: (_r, v) => (/^(y|yes|true|1|x|uplink)$/i.test(v.trim()) ? { uplink: true } : /^(n|no|false|0|)$/i.test(v.trim()) ? { uplink: undefined } : null),
    options: [{ value: 'No', label: 'No' }, { value: 'Yes', label: 'Yes' }],
  },
  {
    key: 'speed', label: 'Speed', width: 70, mono: true,
    get: (r) => (r.kind === 'port' ? r.data.speed ?? '' : ''),
    set: (_r, v) => ({ speed: v.trim() || undefined }),
    options: [{ value: '', label: '—' }, ...PORT_SPEEDS.map((x) => ({ value: x, label: x }))],
  },
  {
    key: 'poe', label: 'PoE', width: 80,
    get: (r) => (r.kind === 'port' ? r.data.poe ?? '' : ''),
    set: (_r, v) => ({ poe: v.trim() || undefined }),
    options: [{ value: '', label: 'None' }, ...POE_CLASSES.map((x) => ({ value: x, label: x }))],
  },
  {
    key: 'status', label: 'Status', width: 80,
    get: (r) => (r.kind === 'port' ? PORT_STATUSES.find((x) => x.value === r.data.status)?.label ?? '' : ''),
    set: (_r, v) => { const t = v.trim(); if (!t) return { status: undefined }; const m = PORT_STATUSES.find((x) => x.value === t.toLowerCase() || x.label.toLowerCase() === t.toLowerCase()); return m ? { status: m.value } : null; },
    options: [{ value: '', label: '—' }, ...PORT_STATUSES.map((x) => ({ value: x.label, label: x.label }))],
  },
  portText('notes', 'Notes', 150),
  { key: 'peer', label: 'Cabled to', width: 170, get: (r) => (r.kind === 'port' ? r.peer : '') },
];

/** Port edits become device edits: every changed port of a device goes into its `ports` in one go. */
function toItemEdits(list: { row: Row; patch: Record<string, unknown> }[]): ItemEdit[] {
  const out = new Map<string, ItemEdit>();
  for (const { row, patch } of list) {
    if (row.kind !== 'port') {
      const k = `${row.pageId}|${row.kind}|${row.id}`;
      const cur = out.get(k);
      out.set(k, { pageId: row.pageId, kind: row.kind, id: row.id, patch: { ...(cur?.patch ?? {}), ...patch } });
      continue;
    }
    const k = `${row.pageId}|node|${row.deviceId}`;
    const st = useDiagram.getState();
    const dev = st.projects[st.currentId].pages.find((p) => p.id === row.pageId)?.nodes.find((n) => n.id === row.deviceId);
    if (dev?.type !== 'device') continue;
    const cur = out.get(k) ?? { pageId: row.pageId, kind: 'node' as const, id: row.deviceId, patch: { ports: { ...(dev.data.ports ?? {}) } } };
    const ports = cur.patch.ports as Record<string, PortData>;
    ports[row.portId] = { ...(ports[row.portId] ?? {}), ...patch } as PortData;
    out.set(k, cur);
  }
  return [...out.values()];
}

/** One editable cell: Enter / leaving saves; pasting several cells (from Excel) fills down and across. */
function Cell({ value, mono, onSave, onPasteGrid }: { value: string; mono?: boolean; onSave: (v: string) => void; onPasteGrid: (grid: string[][]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => { if (draft !== null && draft !== value) onSave(draft); setDraft(null); };
  return (
    <input
      className={`h-full w-full bg-transparent px-1.5 text-xs outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`}
      value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onPaste={(e) => {
        const t = e.clipboardData.getData('text/plain');
        if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return; // one value: an ordinary paste
        e.preventDefault();
        setDraft(null);
        onPasteGrid(t.replace(/\r?\n$/, '').split(/\r?\n/).map((line) => line.split('\t')));
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/**
 * View → Device Table (like Visio's External Data window): every device, or every cable, as a spreadsheet under the
 * drawing. Type or paste (from Excel) into the cells, sort, filter, copy the table, and go to an item.
 */
export function DeviceTable() {
  const project = useCurrentProject();
  const rf = useReactFlow<AppNode>();
  const [tab, setTab] = useState<'devices' | 'cables' | 'ports'>('devices');
  const [documentedOnly, setDocumentedOnly] = useState(false);
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [q, setQ] = useState('');
  const [height, setHeight] = useState(220);
  const [note, setNote] = useState('');
  const drag = useRef<{ y: number; h: number } | null>(null);

  const cols = useMemo(() => {
    if (tab === 'cables') return CABLE_COLS;
    if (tab === 'ports') return PORT_COLS;
    // The client's own fields (Define Shape Data, and any used on a device).
    const labels = new Map<string, string>();
    for (const d of project.fieldDefs ?? []) if (d.label.trim()) labels.set(key(d.label), d.label.trim());
    for (const pg of project.pages) for (const n of pg.nodes) if (n.type === 'device') for (const f of n.data.extraFields ?? []) if (f.label.trim() && !labels.has(key(f.label))) labels.set(key(f.label), f.label.trim());
    return [...DEVICE_COLS, ...[...labels.values()].map((l): Col => ({
      key: `x:${l}`, label: l, width: 110,
      get: (r) => (r.kind === 'node' ? extraValue(r.data, l) : ''),
      set: (_r, v, data) => withExtra(data, l, v),
    }))];
  }, [tab, project.fieldDefs, project.pages]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const pg of project.pages) {
      if (scope === 'page' && pg.id !== project.activePageId) continue;
      if (tab === 'devices') {
        for (const n of pg.nodes) if (n.type === 'device') out.push({ kind: 'node', pageId: pg.id, pageName: pg.name, id: n.id, data: n.data, selected: n.selected });
      } else if (tab === 'ports') {
        // Every port of every device (in the device's own port order), with what its cable goes to.
        const byId = new Map(pg.nodes.map((n) => [n.id, n]));
        const peerOf = (deviceId: string, portId: string) => {
          const e = pg.edges.find((x) => (x.source === deviceId && x.sourceHandle === portId) || (x.target === deviceId && x.targetHandle === portId));
          if (!e) return '';
          const mine = e.source === deviceId, o = byId.get(mine ? e.target : e.source), h = mine ? e.targetHandle : e.sourceHandle;
          const name = o?.type === 'device' ? o.data.name : o?.type === 'shape' ? o.data.text : '';
          const port = o?.type === 'device' ? o.data.ports?.[h ?? '']?.label || getStencil(o.data.stencilId)?.ports.find((p) => p.id === h)?.label || h || '' : '';
          return [name, port].filter(Boolean).join(' ');
        };
        for (const n of pg.nodes) {
          if (n.type !== 'device') continue;
          for (const pd of getStencil(n.data.stencilId)?.ports ?? []) {
            const data = n.data.ports?.[pd.id] ?? {};
            const peer = peerOf(n.id, pd.id);
            if (documentedOnly && !isDocumented(data) && !peer) continue;
            out.push({ kind: 'port', pageId: pg.id, pageName: pg.name, id: `${n.id}:${pd.id}`, deviceId: n.id, portId: pd.id, device: n.data.name, port: data.label || pd.label || pd.id, data, peer, selected: n.selected });
          }
        }
      } else {
        const byId = new Map(pg.nodes.map((n) => [n.id, n]));
        const nm = (id: string) => { const n = byId.get(id); return n?.type === 'device' ? n.data.name : n?.type === 'shape' ? n.data.text : n?.type === 'zone' ? n.data.title : ''; };
        const port = (id: string, h?: string | null) => { const n = byId.get(id) as DeviceNode | undefined; return n?.type === 'device' ? n.data.ports?.[h ?? '']?.label || h || '' : ''; };
        for (const e of pg.edges as CableEdge[]) {
          out.push({ kind: 'edge', pageId: pg.id, pageName: pg.name, id: e.id, data: (e.data ?? { cable: 'Cat6' }) as CableData, from: nm(e.source), fromPort: port(e.source, e.sourceHandle), to: nm(e.target), toPort: port(e.target, e.targetHandle), selected: e.selected });
        }
      }
    }
    const term = q.trim().toLowerCase();
    const shown = term ? out.filter((r) => cols.some((c) => c.get(r).toLowerCase().includes(term))) : out;
    const sc = cols.find((c) => c.key === sort.key) ?? cols[0];
    // Ties keep the device's own port order (stable sort).
    return [...shown].sort((a, b) => sc.get(a).localeCompare(sc.get(b), undefined, { numeric: true }) * sort.dir);
  }, [project.pages, project.activePageId, scope, q, sort, cols, tab, documentedOnly]);

  const s = useDiagram.getState();
  const go = (r: Row) => {
    const other = r.pageId !== project.activePageId;
    if (other) s.setActivePage(r.pageId);
    setTimeout(() => {
      const id = r.kind === 'port' ? r.deviceId : r.id;
      useDiagram.getState().selectItem(r.pageId, r.kind === 'edge' ? 'edge' : 'node', id);
      if (r.kind !== 'edge') void rf.fitView({ nodes: [{ id }], maxZoom: 1.2, padding: 1.5, duration: 200 });
    }, other ? 150 : 0);
  };
  const editOne = (r: Row, c: Col, v: string) => {
    const patch = c.set?.(r, v, r.data as Record<string, unknown>);
    if (patch) s.editItems(toItemEdits([{ row: r, patch }]));
  };
  // Paste a block (rows × columns) starting at this cell, in the table's current order; read-only columns are skipped.
  const pasteGrid = (r0: number, c0: number, grid: string[][]) => {
    const changes: { row: Row; patch: Record<string, unknown> }[] = [];
    let skipped = 0;
    grid.forEach((line, i) => {
      const r = rows[r0 + i];
      if (!r) { skipped++; return; }
      let data = { ...(r.data as Record<string, unknown>) };
      let patch: Record<string, unknown> = {};
      line.forEach((v, j) => {
        const c = cols[c0 + j];
        const p = c?.set?.(r, v.trim(), data);
        if (p) { data = { ...data, ...p }; patch = { ...patch, ...p }; }
      });
      if (Object.keys(patch).length) changes.push({ row: r, patch });
    });
    const list = changes;
    if (list.length) s.editItems(toItemEdits(list));
    setNote(`Pasted into ${list.length} row${list.length === 1 ? '' : 's'}${skipped ? ` (${skipped} line${skipped === 1 ? '' : 's'} past the last row left out)` : ''}.`);
    setTimeout(() => setNote(''), 4000);
  };
  const copyTable = () => {
    const head = [...(scope === 'all' ? ['Page'] : []), ...cols.map((c) => c.label)];
    const body = rows.map((r) => [...(scope === 'all' ? [r.pageName] : []), ...cols.map((c) => (c.key === 'status' ? DEVICE_STATUSES.find((x) => x.value === c.get(r))?.label ?? c.get(r) : c.get(r)))]);
    const tsv = [head, ...body].map((line) => line.map((v) => v.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
    void navigator.clipboard?.writeText(tsv).then(() => { setNote(`Copied ${rows.length} rows: paste them into Excel.`); setTimeout(() => setNote(''), 4000); }, () => alert('Could not use the clipboard.'));
  };

  const tabBtn = (t: 'devices' | 'cables' | 'ports', label: string) => (
    <button className={`rounded px-2 py-0.5 ${tab === t ? 'bg-blue-100 font-semibold text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => { setTab(t); setSort({ key: t === 'devices' ? 'name' : t === 'ports' ? 'device' : 'from', dir: 1 }); }}>{label}</button>
  );

  return (
    <div className="flex shrink-0 flex-col border-t border-gray-300 bg-white" style={{ height }}>
      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200"
        onPointerDown={(e) => { drag.current = { y: e.clientY, h: height }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setHeight(Math.max(110, Math.min(600, drag.current.h - (e.clientY - drag.current.y)))); }}
        onPointerUp={() => { drag.current = null; }}
        title="Drag to resize"
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-1 text-xs">
        {tabBtn('devices', 'Devices')}
        {tabBtn('cables', 'Cables')}
        {tabBtn('ports', 'Ports')}
        {tab === 'ports' && <label className="flex items-center gap-1 text-gray-600"><input type="checkbox" checked={documentedOnly} onChange={(e) => setDocumentedOnly(e.target.checked)} /> Documented or cabled only</label>}
        <select className="rounded border border-gray-300 px-1 py-0.5" value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'all')}>
          <option value="page">This page</option>
          <option value="all">All pages</option>
        </select>
        <input className="w-40 rounded border border-gray-300 px-1.5 py-0.5" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50" onClick={copyTable} title="Copy the table (as shown) to paste into Excel">Copy table</button>
        <span className="truncate text-gray-400">{note || `${rows.length} ${tab === 'devices' ? 'device' : tab === 'ports' ? 'port' : 'cable'}${rows.length === 1 ? '' : 's'} · type or paste from Excel into the cells`}</span>
        <button className="ml-auto rounded px-1.5 text-base leading-none text-gray-500 hover:bg-gray-100" onClick={() => setPref('deviceTable', false)} aria-label="Close the table">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: 28 + (scope === 'all' ? 110 : 0) + cols.reduce((w, c) => w + c.width, 0) }}>
          <thead className="sticky top-0 z-10 bg-gray-100">
            <tr>
              <th className="w-7 border border-gray-200" />
              {scope === 'all' && <th className="border border-gray-200 px-1.5 py-1 text-left font-medium text-gray-600" style={{ width: 110 }}>Page</th>}
              {cols.map((c) => (
                <th key={c.key} className="cursor-pointer select-none border border-gray-200 px-1.5 py-1 text-left font-medium text-gray-600 hover:bg-gray-200" style={{ width: c.width }}
                  onClick={() => setSort(sort.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`${r.pageId}|${r.id}`} className={r.selected && r.pageId === project.activePageId ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                <td className="border border-gray-200 text-center">
                  <button className="text-blue-600 hover:text-blue-800" title="Go to it" aria-label="Go to it" onClick={() => go(r)}>➜</button>
                </td>
                {scope === 'all' && <td className="truncate border border-gray-200 px-1.5 text-gray-500">{r.pageName}</td>}
                {cols.map((c, ci) => (
                  <td key={c.key} className={`h-6 border border-gray-200 p-0 ${c.set ? '' : 'bg-gray-50'}`}>
                    {!c.set ? (
                      <span className={`block truncate px-1.5 text-gray-600 ${c.mono ? 'font-mono' : ''}`}>{c.get(r)}</span>
                    ) : c.options ? (
                      <select className="h-full w-full bg-transparent px-1 text-xs outline-none" value={c.get(r)} onChange={(e) => editOne(r, c, e.target.value)}>
                        {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <Cell value={c.get(r)} mono={c.mono} onSave={(v) => editOne(r, c, v)} onPasteGrid={(grid) => pasteGrid(ri, ci, grid)} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 2} className="px-3 py-4 text-center text-gray-400">{q ? 'Nothing matches the filter.' : tab === 'devices' ? 'No devices here yet.' : tab === 'ports' ? 'No ports here yet.' : 'No cables here yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
