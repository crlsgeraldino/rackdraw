'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadBlob, safeName } from '@/lib/export';
import { GROUP_LABEL, NO_SITE, SITE_TABLE, siteSummaries, siteTableRows, type EquipmentGroup } from '@/lib/sites';
import { getStencil, useCurrentProject } from '@/store/useDiagramStore';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Data → Sites: the client's network place by place, and the links between places. */
export function SitesDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const { sites, links } = useMemo(() => siteSummaries(project, getStencil), [project]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const totals = useMemo(() => ({
    devices: sites.reduce((n, s) => n + s.devices, 0),
    monthly: sites.reduce((n, s) => n + s.monthlyCost, 0),
    free: sites.reduce((n, s) => n + s.ports.free, 0),
    power: sites.reduce((n, s) => n + s.powerW, 0),
  }), [sites]);

  const table = () => [SITE_TABLE, ...siteTableRows(sites), [], ['Link from', 'To', 'Cables', 'Types'], ...links.map((l) => [l.a, l.b, String(l.cables), l.types])];
  const csv = () => {
    const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    downloadBlob(`${safeName(project.name)} sites.csv`, new Blob(['﻿' + table().map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(table().map((r) => r.join('\t')).join('\n'));
      setMsg('Copied: paste it into Excel.');
    } catch {
      alert('The clipboard is blocked here. Use CSV instead.');
    }
  };

  const only = sites.length === 1 && sites[0].site === NO_SITE;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="flex h-[min(780px,94vh)] w-[min(1100px,96vw)] flex-col rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Sites" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <div>
            <h2 className="font-semibold text-gray-900">Sites — {project.name}</h2>
            <p className="text-[11px] text-gray-500">
              By each device&apos;s Location (or its rack&apos;s). A device with no location counts at the site it is cabled to.
              {sites.length > 1 && <> · {sites.length} sites, {totals.devices} devices, {totals.free} free switch ports{totals.power ? `, ${Math.round(totals.power).toLocaleString('en-US')} W in racks` : ''}{totals.monthly ? `, circuits ${money(totals.monthly)}/month` : ''}</>}
            </p>
          </div>
          <button type="button" className="text-xl leading-none text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!sites.length && <p className="py-10 text-center text-sm text-gray-500">No devices in this client yet.</p>}
          {only && (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No locations yet. Type a <b>Location</b> on the main equipment (firewall, switches, or a rack&apos;s Location) — &quot;HQ&quot;, &quot;Branch 2&quot;, &quot;IDF-1&quot; — and the devices cabled to them follow.
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            {sites.map((s) => (
              <section key={s.site} className={`rounded-lg border p-3 text-xs ${s.site === NO_SITE ? 'border-dashed border-gray-300' : 'border-gray-200 shadow-sm'}`}>
                <h3 className="mb-1 truncate text-sm font-semibold text-gray-900" title={s.site}>{s.site}</h3>
                <p className="mb-2 text-gray-600">
                  <b className="text-gray-900">{s.devices}</b> device{s.devices === 1 ? '' : 's'}
                  {(Object.keys(GROUP_LABEL) as EquipmentGroup[]).filter((g) => s.groups[g]).map((g) => ` · ${s.groups[g]} ${GROUP_LABEL[g].toLowerCase()}`)}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-gray-700">
                  {s.racks.length > 0 && <><dt className="text-gray-500">Racks</dt><dd className="truncate" title={s.racks.join(', ')}>{s.racks.join(', ')}</dd></>}
                  {s.ports.total > 0 && <><dt className="text-gray-500">Switch ports</dt><dd>{s.ports.used} used, <b>{s.ports.free} free</b> of {s.ports.total}{s.ports.poe ? ` · ${s.ports.poe} PoE` : ''}</dd></>}
                  {s.powerW > 0 && <><dt className="text-gray-500">Rack power</dt><dd>{Math.round(s.powerW).toLocaleString('en-US')} W</dd></>}
                  {s.vlans.length > 0 && <><dt className="text-gray-500">VLANs</dt><dd className="truncate" title={s.vlans.join(', ')}>{s.vlans.join(', ')}</dd></>}
                  {s.circuits.length > 0 && (
                    <>
                      <dt className="text-gray-500">Circuits</dt>
                      <dd>
                        {s.circuits.map((c, i) => <div key={i} className="truncate" title={c.name}>{c.name}{c.bandwidth ? ` · ${c.bandwidth}` : ''}{c.monthly ? ` · ${money(c.monthly)}` : ''}</div>)}
                        {s.monthlyCost > 0 && <div className="font-medium">{money(s.monthlyCost)} / month</div>}
                      </dd>
                    </>
                  )}
                  {(s.warranty.expired > 0 || s.warranty.soon > 0) && (
                    <>
                      <dt className="text-gray-500">Warranty</dt>
                      <dd>
                        {s.warranty.expired > 0 && <span className="text-red-700">{s.warranty.expired} expired</span>}
                        {s.warranty.expired > 0 && s.warranty.soon > 0 && ', '}
                        {s.warranty.soon > 0 && <span className="text-amber-700">{s.warranty.soon} ending in 90 days</span>}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            ))}
          </div>

          {links.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Links between sites</h3>
              <table className="w-full border-collapse text-xs">
                <thead className="text-left text-[11px] text-gray-500"><tr><th className="border-b px-2 py-1 font-medium">From</th><th className="border-b px-2 py-1 font-medium">To</th><th className="border-b px-2 py-1 font-medium">Cables</th><th className="border-b px-2 py-1 font-medium">Types</th></tr></thead>
                <tbody>{links.map((l) => <tr key={`${l.a}-${l.b}`} className="border-b border-gray-100"><td className="px-2 py-0.5">{l.a}</td><td className="px-2 py-0.5">{l.b}</td><td className="px-2 py-0.5">{l.cables}</td><td className="px-2 py-0.5">{l.types}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-gray-200 px-4 py-2.5 text-sm">
          {msg && <span className="text-xs text-green-700">{msg}</span>}
          <span className="flex-1" />
          <button type="button" disabled={!sites.length} className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" onClick={copy}>Copy</button>
          <button type="button" disabled={!sites.length} className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" onClick={csv}>CSV</button>
          <button type="button" className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
