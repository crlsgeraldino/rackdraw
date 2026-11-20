'use client';

import { NodeToolbar, Position } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { resolveLink } from '@/lib/links';
import { usePref } from '@/lib/prefs';
import { rackLabel } from '@/lib/rack';
import { DEVICE_STATUSES, isDocumented, type DeviceData, type StencilDef } from '@/lib/types';
import { useCurrentPage, useCurrentProject } from '@/store/useDiagramStore';
import { useFollowLink } from './NodeBadges';

const SHOW_DELAY = 350;
const HIDE_DELAY = 200;

/**
 * Hover intent for the quick-info card: opens after a short pause on the device, stays open while the pointer
 * is on the device or the card, and closes shortly after it leaves both.
 */
export function useQuickInfoHover(disabled: boolean) {
  const enabled = usePref('quickInfo');
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => clearTimeout(timer.current);
  const enter = () => {
    clear();
    if (!enabled || disabled) return;
    timer.current = setTimeout(() => setOpen(true), open ? 0 : SHOW_DELAY);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(() => setOpen(false), HIDE_DELAY);
  };
  useEffect(() => clear, []);
  const visible = open && enabled && !disabled;
  return { visible, bind: { onMouseEnter: enter, onMouseLeave: leave }, card: { onMouseEnter: enter, onMouseLeave: leave } };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">{children}</dd>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ml-1 rounded px-1 text-[10px] text-blue-600 hover:bg-blue-50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // Clipboard blocked; the text can still be selected by hand.
        }
      }}
      title={`Copy ${text}`}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Floating card with a device's details, shown on hover (View → Quick info on hover). */
export function DeviceQuickInfo({ id, data, stencil, visible, card }: {
  id: string;
  data: DeviceData;
  stencil?: StencilDef;
  visible: boolean;
  card: { onMouseEnter: () => void; onMouseLeave: () => void };
}) {
  return (
    <NodeToolbar nodeId={id} isVisible={visible} position={Position.Right} offset={12} align="start">
      {visible && <Card id={id} data={data} stencil={stencil} card={card} />}
    </NodeToolbar>
  );
}

function Card({ id, data, stencil, card }: { id: string; data: DeviceData; stencil?: StencilDef; card: { onMouseEnter: () => void; onMouseLeave: () => void } }) {
  const project = useCurrentProject();
  const page = useCurrentPage();
  const follow = useFollowLink();
  const status = DEVICE_STATUSES.find((s) => s.value === (data.status ?? 'active'))!;
  const mount = (project.racks ?? []).flatMap((r) => r.items.filter((it) => it.nodeId === id).map((it) => `${r.name} · ${rackLabel(it)}`))[0];
  const layer = (project.layers ?? []).find((l) => l.id === data.layer)?.name;
  const used = new Set(page.edges.flatMap((e) => [e.source === id ? e.sourceHandle : null, e.target === id ? e.targetHandle : null]).filter(Boolean));
  const ports = stencil?.ports.length ?? 0;
  const ipUrl = data.ip ? resolveLink(data.ip.trim()) : null;
  const link = resolveLink(data.link);

  return (
    <div
      className="nodrag nopan w-64 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl"
      onMouseEnter={card.onMouseEnter}
      onMouseLeave={card.onMouseLeave}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: status.color }} title={status.label} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900" title={data.name}>{data.name}</div>
          <div className="truncate text-[11px] text-gray-500">{[stencil?.name, status.label].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {data.model && <Row label="Model">{data.model}</Row>}
        {data.ip && (
          <Row label="IP">
            <span className="font-mono">{data.ip}</span>
            <CopyButton text={data.ip} />
            {ipUrl?.kind === 'url' && (
              <button type="button" className="rounded px-1 text-[10px] text-blue-600 hover:bg-blue-50" onClick={() => follow(data.ip)} title={`Open ${ipUrl.url}`}>Open</button>
            )}
          </Row>
        )}
        {data.mac && <Row label="MAC"><span className="font-mono">{data.mac}</span><CopyButton text={data.mac} /></Row>}
        {data.serial && <Row label="Serial"><span className="font-mono">{data.serial}</span><CopyButton text={data.serial} /></Row>}
        {data.assetTag && <Row label="Asset tag">{data.assetTag}</Row>}
        {data.location && <Row label="Location">{data.location}</Row>}
        {mount && <Row label="Rack">{mount}</Row>}
        {layer && <Row label="Layer">{layer}</Row>}
        {data.powerW !== undefined && <Row label="Power">{data.powerW} W</Row>}
        {ports > 0 && <Row label="Ports">{used.size} of {ports} connected</Row>}
        {link && (
          <Row label="Link">
            <button type="button" className="text-left text-blue-600 hover:underline" onClick={() => follow(data.link)}>
              {link.kind === 'url' ? link.url : `Page: ${project.pages.find((p) => p.id === link.pageId)?.name ?? '?'}`}
            </button>
          </Row>
        )}
      </dl>
      {(() => {
        const noted = (stencil?.ports ?? []).filter((pt) => isDocumented(data.ports?.[pt.id]));
        if (!noted.length) return null;
        // Uplinks first, then in port order.
        const list = [...noted.filter((pt) => data.ports?.[pt.id]?.uplink), ...noted.filter((pt) => !data.ports?.[pt.id]?.uplink)];
        return (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Port notes</div>
            <ul className="space-y-0.5">
              {list.slice(0, 10).map((pt) => {
                const pd = data.ports![pt.id];
                return (
                  <li key={pt.id} className="flex gap-1.5" title={pd.notes}>
                    <span className="w-8 shrink-0 font-mono font-medium">{pd.label || pt.label}</span>
                    {pd.uplink && <span className="shrink-0 rounded bg-orange-100 px-1 text-[9px] font-semibold leading-4 text-orange-700">UP</span>}
                    <span className="min-w-0 flex-1 truncate">{[pd.description, pd.ip, pd.vlan && `VLAN ${pd.vlan}`].filter(Boolean).join(' · ') || pd.notes}</span>
                  </li>
                );
              })}
              {list.length > 10 && <li className="text-gray-400">…and {list.length - 10} more</li>}
            </ul>
          </div>
        );
      })()}
      {data.notes && <p className="mt-2 line-clamp-3 whitespace-pre-wrap border-t border-gray-100 pt-2 text-gray-600">{data.notes}</p>}
      {!data.model && !data.ip && !data.serial && !data.location && !data.notes && (
        <p className="mt-1 text-gray-400">No details yet. Select the device to fill them in.</p>
      )}
    </div>
  );
}
