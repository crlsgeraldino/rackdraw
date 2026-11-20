'use client';

import { portLines } from '@/lib/portSummary';
import { DEFAULT_INFO_FIELDS, type DeviceData, type DeviceNode } from '@/lib/types';
import { getStencil, useCurrentPage, useDiagram } from '@/store/useDiagramStore';
import { useDragOffset } from './useDragOffset';

const FIELD_LABELS: Record<string, string> = { model: 'Model', ip: 'IP', mac: 'MAC', serial: 'S/N', assetTag: 'Asset', location: 'Location' };
const MONO = new Set(['ip', 'mac', 'serial']);

/**
 * Printable details beside a device (Visio-style data callout): chosen fields, the user's own fields
 * (WAN IP, LAN subnet…) and what its ports connect to. Part of the diagram, so it prints and exports.
 * Drag it to move it.
 */
export function DeviceInfoBox({ id, data }: { id: string; data: DeviceData }) {
  const page = useCurrentPage();
  const update = useDiagram((s) => s.updateNodeData);
  const box = data.infoBox;
  const drag = useDragOffset(box?.offset, (offset) => update(id, { infoBox: { ...box!, offset } }), !!data.locked);
  if (!box?.show) return null;

  const fields = box.fields ?? DEFAULT_INFO_FIELDS;
  const rows: { k: string; label: string; value: string }[] = [];
  for (const f of fields) {
    if (f === 'extra') {
      (data.extraFields ?? []).forEach((x, i) => x.value && rows.push({ k: `x${i}`, label: x.label || 'Field', value: x.value }));
    } else if (f !== 'notes') {
      const v = data[f];
      if (v) rows.push({ k: f, label: FIELD_LABELS[f], value: String(v) });
    }
  }
  const mode = box.ports ?? 'used';
  const node = page.nodes.find((n): n is DeviceNode => n.id === id && n.type === 'device');
  const ports = mode === 'none' || !node ? [] : portLines(node, page, getStencil, mode === 'uplinks');
  const off = box.offset ?? { x: 0, y: 0 };

  return (
    <div
      className="nc-infobox nodrag nopan absolute left-full top-0 ml-3 w-max min-w-36 max-w-72 cursor-move select-none rounded border border-gray-400 bg-white/95 px-2 py-1.5 text-[10px] leading-snug text-gray-800 shadow-sm"
      style={{ translate: `${off.x}px ${off.y}px` }}
      title={data.locked ? undefined : 'Drag to move the info box'}
      {...drag}
    >
      <div className="mb-0.5 truncate border-b border-gray-200 pb-0.5 text-[11px] font-semibold text-gray-900">{data.name}</div>
      {rows.length > 0 && (
        <table className="w-full">
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="align-top">
                <td className="whitespace-nowrap pr-2 text-gray-500">{r.label}</td>
                <td className={`break-words ${MONO.has(r.k) ? 'font-mono' : ''}`}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ports.length > 0 && (
        <div className={rows.length ? 'mt-1 border-t border-gray-200 pt-1' : ''}>
          {ports.map((p) => (
            <div key={p.id} className="flex gap-1.5 whitespace-nowrap">
              <span className="w-7 shrink-0 font-mono font-semibold">{p.label}</span>
              {p.uplink && <span className="shrink-0 font-semibold text-orange-600">UP</span>}
              <span className="min-w-0">
                {[p.to && `→ ${p.to}`, p.ip, p.vlan && `VLAN ${p.vlan}`].filter(Boolean).join(' · ') || p.notes}
              </span>
            </div>
          ))}
        </div>
      )}
      {fields.includes('notes') && data.notes && <p className="mt-1 whitespace-pre-wrap border-t border-gray-200 pt-1 text-gray-600">{data.notes}</p>}
    </div>
  );
}
