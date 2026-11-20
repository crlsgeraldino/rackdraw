'use client';

import { useNodesStore, useViewport, ViewportPortal, type NodesStore } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETUP, pageBounds, rulerTicks, sheetSize } from '@/lib/pageSetup';
import { pxPerUnit, useUnits } from '@/lib/measure';
import { INFO_GAP, overlaySize, useOverlayVersion } from '@/lib/overlays';
import { usePref } from '@/lib/prefs';
import type { DeviceData } from '@/lib/types';
import { useCurrentPage } from '@/store/useDiagramStore';

export const RULER = 18;
const GRID = 20;

/** Bounding box of everything drawn, as a compact string so the sheet only re-renders when it changes. */
function contentKey(s: NodesStore) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of s.nodeLookup.values()) {
    if (n.hidden) continue;
    const { x, y } = n.internals.positionAbsolute;
    const w = n.measured?.width ?? 0, h = n.measured?.height ?? 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    if (n.type !== 'device') continue;
    // Info boxes and labels sit outside the device box; the page grows to hold them too.
    const d = n.data as DeviceData;
    const info = d.infoBox?.show ? overlaySize(`${n.id}|info`) : undefined;
    if (info) {
      const o = d.infoBox?.offset ?? { x: 0, y: 0 };
      x1 = Math.max(x1, x + w + INFO_GAP + o.x + info.w); y1 = Math.max(y1, y + o.y + info.h); y0 = Math.min(y0, y + o.y);
    }
    const label = overlaySize(`${n.id}|label`);
    if (label) {
      const o = d.labelOffset ?? { x: 0, y: 0 };
      y1 = Math.max(y1, y + h + 4 + o.y + label.h); y0 = Math.min(y0, y + h + 4 + o.y);
      x1 = Math.max(x1, x + o.x + label.w);
    }
  }
  return x0 === Infinity ? '' : `${Math.round(x0)},${Math.round(y0)},${Math.round(x1)},${Math.round(y1)}`;
}

/**
 * The white drawing page behind the diagram (Visio's page), sized from Page Setup and grown by whole sheets
 * to fit the content, with the grid inside it and dashed lines where printed sheets break.
 */
export function PageSheet() {
  const page = useCurrentPage();
  const grid = usePref('grid');
  const breaks = usePref('pageBreaks');
  useOverlayVersion(); // grow when an info box or label changes size
  const key = useNodesStore(contentKey);
  const sheet = sheetSize(page.setup ?? DEFAULT_SETUP);
  const [x0, y0, x1, y1] = key ? key.split(',').map(Number) : [];
  const b = pageBounds(key ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null, sheet);
  const mod = (v: number) => ((v % GRID) + GRID) % GRID;
  return (
    <ViewportPortal>
      <div
        className="nc-page-sheet pointer-events-none absolute bg-white"
        style={{
          left: b.x, top: b.y, width: b.w, height: b.h, zIndex: -30,
          boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
          backgroundImage: grid ? 'linear-gradient(#eef0f3 1px, transparent 1px), linear-gradient(90deg, #eef0f3 1px, transparent 1px)' : undefined,
          backgroundSize: `${GRID}px ${GRID}px`,
          backgroundPosition: `${-mod(b.x)}px ${-mod(b.y)}px`,
        }}
      >
        {breaks && (
          <svg className="absolute inset-0 overflow-visible" width={b.w} height={b.h} aria-hidden>
            {Array.from({ length: b.cols - 1 }, (_, i) => <line key={`c${i}`} x1={(i + 1) * sheet.w} y1={0} x2={(i + 1) * sheet.w} y2={b.h} stroke="#9ca3af" strokeDasharray="6 4" />)}
            {Array.from({ length: b.rows - 1 }, (_, i) => <line key={`r${i}`} x1={0} y1={(i + 1) * sheet.h} x2={b.w} y2={(i + 1) * sheet.h} stroke="#9ca3af" strokeDasharray="6 4" />)}
          </svg>
        )}
      </div>
    </ViewportPortal>
  );
}

/** Ruler units: the page's drawing scale (feet / metres) when set, else inches (cm on A-sizes). */
function useRulerUnit() {
  const page = useCurrentPage();
  const units = useUnits(page);
  if (page.scale) return { unitPx: 1 / page.scale.perPx, label: page.scale.unit === 'ft' ? 'ft' : 'm' };
  return { unitPx: pxPerUnit(units), label: units };
}

/** Top and left rulers that follow pan and zoom, like Visio's. */
export function Rulers() {
  const { x, y, zoom } = useViewport();
  const { unitPx, label } = useRulerUnit();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = host.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth - RULER, h: el.clientHeight - RULER }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = rulerTicks(size.w, x, zoom, unitPx);
  const left = rulerTicks(size.h, y, zoom, unitPx);
  const text = { fontSize: 9, fill: '#4b5563', fontFamily: 'Segoe UI, Arial, sans-serif' };
  return (
    <div ref={host} className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <div className="absolute left-0 top-0 flex items-center justify-center border-b border-r border-gray-300 bg-[#f3f3f3] text-[8px] text-gray-500" style={{ width: RULER, height: RULER }}>{label}</div>
      <svg className="absolute top-0 border-b border-gray-300 bg-[#f3f3f3]" style={{ left: RULER, height: RULER }} width={Math.max(0, size.w)} height={RULER}>
        {top.map((t, i) => (
          <g key={i}>
            <line x1={t.pos} x2={t.pos} y1={t.major ? 0 : RULER - 5} y2={RULER} stroke="#9ca3af" />
            {t.label && <text x={t.pos + 2} y={9} {...text}>{t.label}</text>}
          </g>
        ))}
      </svg>
      <svg className="absolute left-0 border-r border-gray-300 bg-[#f3f3f3]" style={{ top: RULER, width: RULER }} width={RULER} height={Math.max(0, size.h)}>
        {left.map((t, i) => (
          <g key={i}>
            <line y1={t.pos} y2={t.pos} x1={t.major ? 0 : RULER - 5} x2={RULER} stroke="#9ca3af" />
            {t.label && <text x={2} y={t.pos + 2} transform={`rotate(-90 2 ${t.pos + 2})`} {...text} textAnchor="end">{t.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
