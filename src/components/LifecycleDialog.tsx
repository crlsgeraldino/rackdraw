'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadBlob, safeName } from '@/lib/export';
import { circuitRows, LIFE_STATES, lifecycleRows, SOON_DAYS, whenText, type LifeState } from '@/lib/lifecycle';
import { FORECAST_HEADER, forecastRows, replacementForecast, type Forecast } from '@/lib/forecast';
import { money, parsePrice, QUOTE_DEFAULTS } from '@/lib/quote';
import { writeXlsx } from '@/lib/xlsx';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { usePriceBook } from './usePriceBook';
import { csvOf } from '@/lib/csv';

const DEV_HEADER = ['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'Warranty', 'End of life', 'End of life in', 'State'];
const CIR_HEADER = ['Device', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Static IPs', 'Support phone', 'Account', 'Contract ends', 'Monthly cost'];
type Filter = 'attention' | 'all' | 'nodate';

/** Data → Lifecycle: warranties and end-of-life dates (what to renew or replace), and the client's circuits. */
export function LifecycleDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const selectIds = useDiagram((s) => s.selectIds);
  const openPage = useDiagram((s) => s.setActivePage);
  const rows = useMemo(() => lifecycleRows(project), [project]);
  const circuits = useMemo(() => circuitRows(project), [project]);
  const [tab, setTab] = useState<'devices' | 'circuits' | 'budget'>('devices');
  const { prices, savePrice } = usePriceBook();
  const forecast = useMemo(() => replacementForecast(project, getStencil, prices), [project, prices]);
  const [filter, setFilter] = useState<Filter>(() => (rows.some((r) => r.state === 'expired' || r.state === 'soon') ? 'attention' : 'all'));
  const currency = project.quote?.currency ?? QUOTE_DEFAULTS.currency;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const rank: Record<LifeState, number> = { expired: 0, soon: 1, ok: 2, unknown: 3 };
  const shown = rows
    .filter((r) => (filter === 'attention' ? r.state === 'expired' || r.state === 'soon' : filter === 'nodate' ? !r.warrantyEnd && !r.endOfLife : true))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.warrantyDays ?? 1e9) - (b.warrantyDays ?? 1e9) || a.device.localeCompare(b.device));
  const count = (s: LifeState) => rows.filter((r) => r.state === s).length;
  const monthly = circuits.reduce((t, c) => t + (c.monthlyCost ?? 0), 0);

  const devRows = shown.map((r) => [r.device, r.model, r.serial, r.purchase, r.warrantyEnd, whenText(r.warrantyDays), r.endOfLife, whenText(r.eolDays), LIFE_STATES.find((x) => x.value === r.state)!.label]);
  const cirRows = circuits.map((c) => [c.device, c.carrier ?? '', c.circuitId ?? '', c.kind ?? '', c.bandwidth ?? '', c.staticIps ?? '', c.supportPhone ?? '', c.accountNumber ?? '', c.contractEnd ?? '', c.monthlyCost ?? '']);
  const [header, data] = tab === 'devices' ? [DEV_HEADER, devRows] : tab === 'circuits' ? [CIR_HEADER, cirRows] : [FORECAST_HEADER, forecastRows(forecast)];
  const file = `${safeName(project.name)}-${tab === 'devices' ? 'lifecycle' : tab === 'circuits' ? 'circuits' : 'replacement-forecast'}`;
  const toExcel = () => downloadBlob(`${file}.xlsx`, new Blob([writeXlsx(tab === 'devices' ? 'Lifecycle' : tab === 'circuits' ? 'Circuits' : 'Replacement forecast', header, data) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const toCsv = () => downloadBlob(`${file}.csv`, new Blob(['﻿' + csvOf([header, ...data])], { type: 'text/csv;charset=utf-8' }));
  const goTo = (deviceId: string) => {
    const pg = project.pages.find((x) => x.nodes.some((n) => n.id === deviceId));
    if (!pg) return;
    openPage(pg.id);
    selectIds([deviceId]);
    onClose();
  };

  const btn = 'rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50';
  const chip = (f: Filter, label: string) => (
    <button className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === f ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>{label}</button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-[min(1120px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="Lifecycle and circuits">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Lifecycle &amp; circuits</h2>
          <span className="ml-3 text-xs text-gray-500">Set the dates and circuit details in Shape Data. &quot;Soon&quot; means within {SOON_DAYS} days.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex items-center gap-1 border-b border-gray-200 px-4 py-1.5" role="tablist">
          {([['devices', `Devices (${rows.length})`], ['circuits', `Circuits (${circuits.length})`], ['budget', 'Replacement budget']] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-50 font-medium text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setTab(t)}>{label}</button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button className={btn} onClick={toCsv}>CSV</button>
            <button className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700" onClick={toExcel}>Excel</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'devices' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                {LIFE_STATES.map((s) => (
                  <span key={s.value} className="flex items-center gap-1 text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}: <b className="text-gray-900">{count(s.value)}</b></span>
                ))}
                <span className="ml-auto flex gap-1.5">{chip('attention', 'Needs attention')}{chip('all', 'All devices')}{chip('nodate', 'No dates yet')}</span>
              </div>
              {shown.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'End of life', ''].map((h, i) => <th key={i} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const st = LIFE_STATES.find((x) => x.value === r.state)!;
                      return (
                        <tr key={r.deviceId} className="border-b border-gray-100">
                          <td className="py-1 pr-3"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: st.color }} title={st.label} /><span className="font-medium text-gray-800">{r.device}</span></td>
                          <td className="py-1 pr-3 text-xs text-gray-600">{r.model}</td>
                          <td className="py-1 pr-3 font-mono text-xs text-gray-600">{r.serial}</td>
                          <td className="py-1 pr-3 font-mono text-xs">{r.purchase}</td>
                          <td className="py-1 pr-3 font-mono text-xs">{r.warrantyEnd}{r.warrantyDays !== undefined && <span className="ml-1.5 font-sans text-gray-500">({whenText(r.warrantyDays)})</span>}</td>
                          <td className="py-1 pr-3 font-mono text-xs">{r.endOfLife}{r.eolDays !== undefined && <span className="ml-1.5 font-sans text-gray-500">({whenText(r.eolDays)})</span>}</td>
                          <td className="py-1 text-right"><button className="rounded px-1.5 text-xs text-blue-700 hover:bg-blue-50" onClick={() => goTo(r.deviceId)}>Show</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-500">{filter === 'attention' ? `Nothing expires within ${SOON_DAYS} days.` : filter === 'nodate' ? 'Every device has a warranty or end-of-life date.' : 'No devices yet.'}</p>
              )}
            </>
          )}

          {tab === 'budget' && <BudgetTab forecast={forecast} currency={currency} savePrice={savePrice} goTo={goTo} />}

          {tab === 'circuits' && (circuits.length ? (
            <>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{['On', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Support phone', 'Contract ends', 'Monthly'].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {circuits.map((c) => (
                    <tr key={c.deviceId} className="border-b border-gray-100">
                      <td className="py-1 pr-3 font-medium text-gray-800">{c.device}</td>
                      <td className="py-1 pr-3">{c.carrier}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{c.circuitId}</td>
                      <td className="py-1 pr-3 text-xs text-gray-600">{c.kind}</td>
                      <td className="py-1 pr-3">{c.bandwidth}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{c.supportPhone}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{c.contractEnd}{c.contractDays !== undefined && <span className="ml-1.5 font-sans text-gray-500">({whenText(c.contractDays)})</span>}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{c.monthlyCost !== undefined ? money(c.monthlyCost, currency) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {circuits.some((c) => c.monthlyCost !== undefined)
                ? <p className="mt-3 text-right text-sm text-gray-700">Monthly total: <b>{money(monthly, currency)}</b> <span className="text-xs text-gray-500">(also in the Bill of Materials quote as monthly recurring)</span></p>
                : <p className="mt-3 text-right text-xs text-gray-500">Add each circuit&apos;s monthly cost in Shape Data → Circuit to total them here and in the quote.</p>}
            </>
          ) : <p className="text-sm text-gray-500">No circuits yet. Select the Internet cloud, modem / ONT or router of a site and fill in its Circuit section in Shape Data.</p>)}
        </div>
      </div>
    </div>
  );
}

/** A unit price, typed like the Bill of Materials' (commits on Enter / leaving the box). */
function PriceCell({ value, currency, onSave }: { value?: number; currency: string; onSave: (v?: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    onSave(t ? parsePrice(t) : undefined);
    setDraft(null);
  };
  return (
    <input
      className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-blue-500"
      value={draft ?? (value !== undefined ? String(value) : '')} placeholder="price" aria-label="Unit price" inputMode="decimal"
      title={value !== undefined ? money(value, currency) : 'Unit price: the same price book as the Bill of Materials'}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }}
    />
  );
}

/** Replacement budget: what is due for replacement each year and what it costs, plus circuits as a yearly cost. */
function BudgetTab({ forecast, currency, savePrice, goTo }: { forecast: Forecast; currency: string; savePrice: (key: string, v?: number) => void; goTo: (id: string) => void }) {
  const [showUndated, setShowUndated] = useState(false);
  const cur = (n: number) => money(n, currency);
  const label = (y: number) => (y === 0 ? 'Overdue' : String(y));
  const grand = forecast.years.reduce((t, y) => t + y.total, 0);
  const anyPrice = forecast.items.some((i) => i.price !== undefined);
  return (
    <>
      <p className="mb-3 text-xs text-gray-500">
        Due for replacement at its <b>End of life</b> date, else its purchase date plus a typical service life for its kind (PCs 4 years,
        switches 7, servers and firewalls 5…), else its warranty end. Prices are per unit, from the same price book as the Bill of Materials:
        a price typed here applies to every device of that model.
      </p>
      <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        {forecast.years.map((y) => (
          <div key={y.year} className={`rounded-lg border p-2 ${y.year === 0 && y.items.length ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
            <div className={`text-xs font-semibold ${y.year === 0 && y.items.length ? 'text-red-700' : 'text-gray-600'}`}>{label(y.year)}</div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">{cur(y.total)}</div>
            <div className="text-[11px] text-gray-500">
              {y.items.length} to replace{y.unpriced ? <span className="text-amber-700"> · {y.unpriced} without price</span> : ''}
              {y.recurring ? <div>incl. circuits {cur(y.recurring)}</div> : null}
            </div>
          </div>
        ))}
      </div>
      {forecast.items.length ? (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{['Due', '', 'Device', 'Equipment / model', 'Basis', 'Unit price', ''].map((h, i) => <th key={i} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {forecast.years.flatMap((y) => y.items.map((i) => (
              <tr key={i.deviceId} className="border-b border-gray-100">
                <td className="py-1 pr-3 font-mono text-xs">{i.due}</td>
                <td className="py-1 pr-3 text-xs"><span className={`rounded px-1 ${y.year === 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>{label(y.year)}</span></td>
                <td className="py-1 pr-3 font-medium text-gray-800">{i.device}</td>
                <td className="py-1 pr-3 text-xs text-gray-600">{i.kind}{i.model ? <span className="text-gray-400"> · {i.model}</span> : ''}</td>
                <td className="py-1 pr-3 text-xs text-gray-600">{i.basis === 'Typical life' ? `typical life (${i.years} y)` : i.basis.toLowerCase()}</td>
                <td className="py-1 pr-3"><PriceCell value={i.price} currency={currency} onSave={(v) => savePrice(i.key, v)} /></td>
                <td className="py-1 text-right"><button className="rounded px-1.5 text-xs text-blue-700 hover:bg-blue-50" onClick={() => goTo(i.deviceId)}>Show</button></td>
              </tr>
            )))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-500">Nothing is due for replacement in the next {forecast.years.length - 1} years{forecast.undated.length ? ' among the devices with dates' : ''}.</p>
      )}
      {(anyPrice || forecast.recurringPerYear > 0) && (
        <p className="mt-3 text-right text-sm text-gray-700">
          {forecast.years.length - 1}-year total, with what is overdue: <b>{cur(grand)}</b>
          {forecast.recurringPerYear > 0 && <span className="text-xs text-gray-500"> (circuits {cur(forecast.recurringPerYear)} a year)</span>}
        </p>
      )}
      {forecast.undated.length > 0 && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <button type="button" className="font-medium hover:underline" onClick={() => setShowUndated(!showUndated)}>
            {showUndated ? '▾' : '▸'} {forecast.undated.length} device{forecast.undated.length === 1 ? ' has' : 's have'} no dates yet
          </button>{' '}
          — add a purchase date, warranty end or End of life in Shape Data (or the Device Table) to put {forecast.undated.length === 1 ? 'it' : 'them'} in the forecast.
          {showUndated && (
            <ul className="mt-1 columns-2 gap-6">
              {forecast.undated.map((u) => <li key={u.deviceId}><button type="button" className="text-left hover:underline" onClick={() => goTo(u.deviceId)}>{u.device}</button> <span className="text-amber-700">{u.kind}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
