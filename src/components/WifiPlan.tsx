'use client';

import { Panel, ViewportPortal } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { isWall } from '@/lib/floorplan';
import { BANDS, coverageGrid, coverageStats, signalColour, suggestAps, TARGETS, WALL_MATERIALS, wifiModel, type Band, type WallMaterial } from '@/lib/wifi';
import type { DeviceNode, MeasureNode } from '@/lib/types';
import { getStencil, useCurrentPage, useDiagram } from '@/store/useDiagramStore';

/** People per access point on 5 GHz before it gets crowded (a planning rule of thumb). */
const PEOPLE_PER_AP = 25;
const pct = (x: number) => `${Math.round(x * 100)} %`;

/* ---------- the coverage map on the canvas ---------- */

/** The coverage estimate drawn behind the floor plan (Data → Wi-Fi Plan → Show coverage), with a legend. */
export function WifiOverlay() {
  const page = useCurrentPage();
  const show = !!page.wifi?.show && !!page.scale;
  const [img, setImg] = useState<{ url: string; x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!show) { setImg(null); return; }
    // Worked out a moment after the drawing stops changing (moving an access point re-draws the map once).
    const t = setTimeout(() => {
      const m = wifiModel(page, getStencil);
      const g = m && m.aps.length ? coverageGrid(m, 140) : null;
      if (!g) { setImg(null); return; }
      const c = document.createElement('canvas');
      c.width = g.cols; c.height = g.rows;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const data = ctx.createImageData(g.cols, g.rows);
      for (let i = 0; i < g.best.length; i++) {
        const [r, gr, b, a] = signalColour(g.best[i]);
        data.data.set([r, gr, b, g.floor[i] || !m!.rooms.length ? a : Math.round(a * 0.35)], i * 4);
      }
      ctx.putImageData(data, 0, 0);
      setImg({ url: c.toDataURL(), x: g.x, y: g.y, w: g.cols * g.cell, h: g.rows * g.cell });
    }, 250);
    return () => clearTimeout(t);
  }, [show, page]);
  if (!show || !img) return null;
  return (
    <>
      <ViewportPortal>
        {/* eslint-disable-next-line @next/next/no-img-element -- a picture made here (data: URL), nothing to optimise */}
        <img
          src={img.url} alt="" aria-hidden className="pointer-events-none absolute"
          style={{ left: img.x, top: img.y, width: img.w, height: img.h, zIndex: -20, imageRendering: 'auto' }}
        />
      </ViewportPortal>
      <Panel position="bottom-left">
        <div className="rounded border border-gray-200 bg-white/95 px-2 py-1.5 text-[10px] text-gray-700 shadow-sm">
          <div className="mb-0.5 font-semibold">Wi-Fi estimate</div>
          {[[TARGETS.voice, 'Voice / video (−67 dBm)'], [TARGETS.data, 'Good (−72)'], [-76, 'Slow (−76)'], [TARGETS.edge, 'Edge (−80)'], [-90, 'Weak or none']].map(([v, l]) => {
            const [r, g, b] = signalColour(v as number);
            return <div key={l} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: `rgb(${r},${g},${b})` }} />{l}</div>;
          })}
        </div>
      </Panel>
    </>
  );
}

/* ---------- Shape Data: wall material, access point band and power ---------- */

export function WallMaterialField({ node }: { node: MeasureNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Material (for the Wi-Fi estimate)</span>
      <select
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={node.data.material ?? 'drywall'}
        onChange={(e) => useDiagram.getState().setWallMaterial([node.id], e.target.value as WallMaterial)}
      >
        {WALL_MATERIALS.map((m) => <option key={m.value} value={m.value}>{m.label} (−{m.loss['5']} dB at 5 GHz)</option>)}
      </select>
    </label>
  );
}

export function ApWifiFields({ node }: { node: DeviceNode }) {
  const s = useDiagram.getState();
  const band = (node.data.wifi?.band ?? '5') as Band;
  const typical = BANDS.find((b) => b.value === band)!.eirp;
  const set = (patch: { band?: Band; eirp?: number }) => { s.snapshot(); s.updateNodeData(node.id, { wifi: { ...node.data.wifi, ...patch } }); };
  return (
    <div className="mb-2 flex gap-2">
      <label className="block flex-1">
        <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Wi-Fi band</span>
        <select className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" value={band} onChange={(e) => set({ band: e.target.value as Band, eirp: undefined })}>
          {BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </label>
      <label className="block flex-1">
        <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Power (EIRP, dBm)</span>
        <input
          type="number" min={0} max={36} className="w-full rounded border border-gray-300 px-1.5 py-1 text-sm" placeholder={String(typical)}
          value={node.data.wifi?.eirp ?? ''} onChange={(e) => set({ eirp: e.target.value === '' ? undefined : Math.max(0, Math.min(36, Number(e.target.value))) })}
        />
      </label>
    </div>
  );
}

/* ---------- Data → Wi-Fi Plan ---------- */

export function WifiDialog({ onClose }: { onClose: () => void }) {
  const page = useCurrentPage();
  const s = useDiagram.getState();
  const [people, setPeople] = useState(page.wifi?.people ? String(page.wifi.people) : '');
  const [placed, setPlaced] = useState('');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const m = useMemo(() => wifiModel(page, getStencil), [page]);
  const stats = useMemo(() => (m && m.aps.length ? coverageStats(coverageGrid(m, 90)!) : null), [m]);
  const extra = useMemo(() => (m ? suggestAps(m) : []), [m]);
  const walls = page.nodes.filter(isWall) as MeasureNode[];
  const byMaterial = WALL_MATERIALS.map((w) => ({ ...w, n: walls.filter((x) => (x.data.material ?? 'drywall') === w.value).length })).filter((w) => w.n);
  const aps = (m?.aps ?? []).map((a) => page.nodes.find((n) => n.id === a.id) as DeviceNode);
  const crowd = Number(people) > 0 ? Math.ceil(Number(people) / PEOPLE_PER_AP) : 0;
  const forCoverage = (m?.aps.length ?? 0) + extra.length;
  const needed = Math.max(forCoverage, crowd);
  const area = m && m.rooms.length ? m.rooms.reduce((t, r) => t + r.w * r.h, 0) * m.metresPerPx ** 2 : 0;
  const feet = page.scale?.unit === 'ft';
  const areaText = area ? (feet ? `${Math.round(area * 10.7639).toLocaleString('en-US')} sq ft` : `${Math.round(area).toLocaleString('en-US')} m²`) : '';

  const goTo = (id: string) => { s.selectIds([id]); onClose(); };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-[min(760px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Wi-Fi plan" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">Wi-Fi plan — {page.name}</h2>
            <p className="text-[11px] text-gray-500">An estimate from the access points, walls and rooms on this floor plan. Confirm with a site survey before you install.</p>
          </div>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-gray-700">
          {!page.scale ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              This page has no drawing scale yet. Set one first (<b>Design → Drawing Scale</b>, or Set Scale on a known length), so distances are real; then draw or import the walls and rooms.
            </p>
          ) : (
            <>
              <label className="mb-3 flex items-center gap-2">
                <input type="checkbox" checked={!!page.wifi?.show} onChange={(e) => s.setPageWifi({ show: e.target.checked })} />
                <span>Show the coverage map on this page</span>
              </label>

              <div className="mb-4 grid grid-cols-3 gap-2">
                {[['Voice and video', stats?.voice, '−67 dBm or better'], ['Good', stats?.data, '−72 dBm or better'], ['Any signal', stats?.edge, '−80 dBm or better']].map(([t, v, sub]) => (
                  <div key={t as string} className="rounded border border-gray-200 p-2">
                    <div className="text-xs text-gray-500">{t}</div>
                    <div className="text-xl font-semibold tabular-nums text-gray-900">{stats ? pct(v as number) : '—'}</div>
                    <div className="text-[10px] text-gray-400">{sub} · share of the {m?.rooms.length ? 'rooms' : 'floor'}</div>
                  </div>
                ))}
              </div>

              <div className="mb-4 rounded border border-blue-200 bg-blue-50 px-3 py-2">
                <div className="font-medium text-blue-900">
                  {m && !m.aps.length && !extra.length ? 'Draw the rooms (zones) or walls of the floor to get a suggestion.' : (
                    <>Suggested: <b>{needed}</b> access point{needed === 1 ? '' : 's'} on this floor{areaText && <> ({areaText})</>}</>
                  )}
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs text-blue-900/80">
                  <li>For coverage (−67 dBm on 95 % of the {m?.rooms.length ? 'rooms' : 'floor'}): {forCoverage} — {m?.aps.length ?? 0} drawn{extra.length ? `, ${extra.length} more` : ''}.</li>
                  <li className="flex flex-wrap items-center gap-1">
                    For the number of people (about {PEOPLE_PER_AP} per access point):
                    <input
                      type="number" min={0} className="w-20 rounded border border-blue-300 bg-white px-1 py-0.5 text-xs" value={people} placeholder="people"
                      onChange={(e) => setPeople(e.target.value)} onBlur={() => s.setPageWifi({ people: Number(people) > 0 ? Number(people) : undefined })} aria-label="People on this floor"
                    />
                    {crowd ? <span>→ {crowd}</span> : null}
                  </li>
                </ul>
                {extra.length > 0 && (
                  <button
                    type="button" className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    onClick={() => { const n = s.placeAccessPoints(extra); s.setPageWifi({ show: true }); setPlaced(`Placed ${n} access point${n === 1 ? '' : 's'} (status Planned). Move them where cabling allows; the map follows. Undo (Ctrl+Z) takes them back.`); }}
                  >
                    Place the {extra.length} suggested access point{extra.length === 1 ? '' : 's'} on the plan
                  </button>
                )}
                {placed && <p className="mt-1 text-xs text-green-800">{placed}</p>}
              </div>

              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Access points on this page ({aps.length})</h3>
              {aps.length ? (
                <table className="mb-4 w-full text-xs">
                  <thead><tr className="border-b border-gray-200 text-left text-gray-500"><th className="py-1 font-medium">Name</th><th className="font-medium">Band</th><th className="font-medium">Power (EIRP)</th><th /></tr></thead>
                  <tbody>
                    {aps.map((n) => (
                      <tr key={n.id} className="border-b border-gray-100">
                        <td className="py-1 font-medium text-gray-800">{n.data.name}</td>
                        <td>{BANDS.find((b) => b.value === (n.data.wifi?.band ?? '5'))?.label}</td>
                        <td>{n.data.wifi?.eirp ?? BANDS.find((b) => b.value === (n.data.wifi?.band ?? '5'))!.eirp} dBm</td>
                        <td className="text-right"><button type="button" className="text-blue-700 hover:underline" onClick={() => goTo(n.id)}>Show</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="mb-4 text-xs text-gray-500">None yet: drag access points from the Shapes window (Wireless), or place the suggested ones.</p>}

              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Walls ({walls.length})</h3>
              {walls.length ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  {byMaterial.map((w) => <span key={w.value} className="rounded bg-gray-100 px-1.5 py-0.5">{w.label}: {w.n}</span>)}
                  <label className="ml-auto flex items-center gap-1">Set all walls to
                    <select className="rounded border border-gray-300 px-1 py-0.5" value="" onChange={(e) => { if (e.target.value) s.setWallMaterial(walls.map((w) => w.id), e.target.value as WallMaterial); }}>
                      <option value="">…</option>
                      {WALL_MATERIALS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                  </label>
                </div>
              ) : <p className="mb-3 text-xs text-gray-500">No walls drawn: the estimate is for an open floor. Draw walls (Insert → Walls, or Convert to Walls on rooms) for a closer estimate.</p>}
              <p className="text-[11px] text-gray-500">Select a wall to set its own material in Shape Data, and an access point to set its band and power.</p>

              <details className="mt-3 text-[11px] text-gray-500">
                <summary className="cursor-pointer">How the estimate works</summary>
                <p className="mt-1">Signal = access point power − path loss − walls crossed. Path loss uses the loss at 1 m for the band and an indoor exponent of 3 (furniture and people). Each wall takes off its material&apos;s loss (a door or window in it less). Targets: −67 dBm for calls and video, −72 dBm for normal use, −80 dBm the edge. Real buildings vary: confirm with a survey.</p>
              </details>
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-gray-200 px-4 py-2.5">
          <button type="button" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
