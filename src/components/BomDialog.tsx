'use client';

import { useMemo, useRef, useState } from 'react';
import { billOfMaterials, ON_SITE_SECTION, onSiteQty, type BomRow, type OnSite } from '@/lib/bom';
import { writeDocx } from '@/lib/docx';
import { downloadBlob, safeName } from '@/lib/export';
import { setPref } from '@/lib/prefs';
import { usePriceBook } from './usePriceBook';
import { LABOR_TASKS, money, parsePrice, priceQuote, QUOTE_DEFAULTS, QUOTE_HEADER, quoteRows, type QuoteSettings } from '@/lib/quote';
import { writeXlsx } from '@/lib/xlsx';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { useEscape } from '@/lib/useEscape';
import { csvOf } from '@/lib/csv';

const CAP_HEADER = ['Device', 'Model', 'Ports', 'Used', 'Free', 'PoE ports', 'PoE W', 'PoE budget W', 'Check'];
type Tab = 'bom' | 'quote' | 'capacity';

/** A price cell: edits locally, saves to the price book on Enter / leaving the cell. */
function PriceInput({ value, onSave, label }: { value?: number; onSave: (v?: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    onSave(parsePrice(text));
    setText(null);
  };
  return (
    <input
      className={`w-24 rounded border px-1.5 py-0.5 text-right text-sm tabular-nums ${value === undefined && text === null ? 'border-amber-300 bg-amber-50' : 'border-gray-300'}`}
      inputMode="decimal"
      placeholder="price"
      aria-label={`Unit price: ${label}`}
      value={text ?? (value === undefined ? '' : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.preventDefault(); setText(null); } }}
    />
  );
}

/** Data → Bill of Materials: what to order, what it costs (price book, labor, markup, tax), and port capacity. */
export function BomDialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const project = useCurrentProject();
  const updateProject = useDiagram((s) => s.updateProject);
  const { prices, book, savePrice } = usePriceBook();
  // Recounted when the drawing changes (pages, racks), not when a quote setting is typed.
  const pages = project.pages, racks = project.racks;
  const { sections, capacity, work } = useMemo(() => billOfMaterials({ ...project, pages, racks }, getStencil), [pages, racks]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs: QuoteSettings = useMemo(() => project.quote ?? {}, [project.quote]);
  const set = { ...QUOTE_DEFAULTS, ...qs };
  const q = useMemo(() => priceQuote(sections, work, prices, qs), [sections, work, prices, qs]);
  const [tab, setTab] = useState<Tab>('bom');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = (n: number) => money(n, set.currency);
  const setQuote = (patch: Partial<QuoteSettings>) => updateProject({ quote: { ...qs, ...patch } });
  // What the client already has: a count, or 'all' (stays the whole line when the diagram changes).
  const setOnSite = (rows: BomRow[], have: (r: BomRow) => number | 'all') => {
    const next: OnSite = { ...qs.onSite };
    for (const r of rows) {
      const v = have(r);
      if (v === 'all' || v >= r.qty) next[r.key] = 'all';
      else if (v > 0) next[r.key] = v;
      else delete next[r.key];
    }
    setQuote({ onSite: next });
  };
  const allRows = sections.flatMap((s) => s.rows);

  const capRows = capacity.map((c) => [c.device, c.model, c.ports, c.used, c.free, c.poePorts || '', c.poeW || '', c.poeBudgetW || '', c.warning]);
  const file = `${safeName(project.name)}-${tab === 'capacity' ? 'port-capacity' : 'quote'}`;
  const [header, rows] = tab === 'capacity' ? [CAP_HEADER, capRows] : [QUOTE_HEADER, quoteRows(q, qs)];

  const toExcel = () => downloadBlob(`${file}.xlsx`, new Blob([writeXlsx(tab === 'capacity' ? 'Port capacity' : 'Quote', header, rows) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const toCsv = () => {
    const csv = csvOf([header, ...rows]);
    downloadBlob(`${file}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([header, ...rows].map((r) => r.map((c) => String(c ?? '').replace(/[\t\n]+/g, ' ')).join('\t')).join('\n'));
    } catch {
      alert('Copying was blocked by the system. Click inside RackDraw and press Copy again, or use CSV / Excel.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const toWord = () => {
    const today = new Date();
    const valid = new Date(today.getTime() + set.validDays * 86400000);
    const sub = [project.site, project.address].filter(Boolean).join(' · ');
    const tableFor = (title: string) => {
      const ls = q.lines.filter((l) => l.section === title);
      return ls.length ? [
        { kind: 'h2' as const, text: title },
        { kind: 'table' as const, header: ['Qty', 'Item', 'Detail', 'Unit price', 'Amount'], widths: [0.08, 0.36, 0.3, 0.13, 0.13], rows: ls.map((l) => [`${l.qty.toLocaleString()} ${l.unit === 'each' ? '' : l.unit}`.trim(), l.item, l.detail, l.price !== undefined ? cur(l.price) : '—', l.price !== undefined ? cur(l.amount) : '—']) },
      ] : [];
    };
    const totals = [
      ['Materials', cur(q.materials)], [`Markup (${set.markupPct}%)`, cur(q.markup)], ...(set.taxPct ? [[`Tax (${set.taxPct}%)`, cur(q.tax)]] : []),
      [`Labor (${Math.round(q.laborHours * 10) / 10} h at ${cur(set.laborRate)}/h)`, cur(q.labor$)], ['Total (one-time)', cur(q.oneTime)],
      ...(q.monthly ? [['Monthly recurring (circuits & services)', cur(q.monthly)]] : []),
    ];
    const bytes = writeDocx({
      title: `${project.name} – Quote`,
      landscape: false,
      media: {},
      blocks: [
        { kind: 'title', text: `Quote: ${project.name}` },
        { kind: 'para', text: [sub, `Date ${today.toLocaleDateString()}`, `Valid until ${valid.toLocaleDateString()}`].filter(Boolean).join('  ·  '), color: '#6B7280' },
        ...[...new Set(q.lines.filter((l) => !l.monthly).map((l) => l.section))].flatMap(tableFor),
        ...(q.onSite.length ? [
          { kind: 'h2' as const, text: ON_SITE_SECTION },
          { kind: 'para' as const, text: 'The client already has these. They are reused and are not part of this quote.', color: '#6B7280' },
          { kind: 'table' as const, header: ['Qty', 'Item', 'Detail'], widths: [0.1, 0.4, 0.5], rows: q.onSite.map((r) => [`${r.qty.toLocaleString()} ${r.unit === 'each' ? '' : r.unit}`.trim(), r.item, r.detail]) },
        ] : []),
        ...(q.labor.length ? [
          { kind: 'h2' as const, text: 'Labor' },
          { kind: 'table' as const, header: ['Hours', 'Task', 'Quantity', 'Rate', 'Amount'], widths: [0.08, 0.42, 0.2, 0.15, 0.15], rows: q.labor.map((l) => [String(l.hours), l.label, `${l.qty} ${l.unit}${l.qty === 1 ? '' : 's'} × ${l.hoursEach} h`, cur(set.laborRate), cur(l.amount)]) },
        ] : []),
        ...tableFor('Circuits & services'),
        { kind: 'h2', text: 'Total' },
        { kind: 'table', header: ['', 'Amount'], widths: [0.7, 0.3], rows: totals },
        ...(qs.notes?.trim() ? [{ kind: 'h2' as const, text: 'Notes' }, { kind: 'para' as const, text: qs.notes.trim() }] : []),
      ],
    });
    downloadBlob(`${safeName(project.name)}-quote.docx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  };
  const exportBook = () => downloadBlob('price-book.rackdraw-prices.json', new Blob([JSON.stringify({ format: 'rackdraw-price-book', version: 1, prices: book }, null, 1)], { type: 'application/json' }));
  const importBook = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const prices = (j?.prices ?? j) as Record<string, unknown>;
      const clean = Object.fromEntries(Object.entries(prices).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
      if (!Object.keys(clean).length) throw new Error('No prices found in that file.');
      setPref('priceBook', { ...book, ...clean });
      alert(`Imported ${Object.keys(clean).length} prices.`);
    } catch (e) {
      alert(`Couldn't read the price book: ${(e as Error).message}`);
    }
  };

  const btn = 'rounded border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50';
  const num = 'w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm tabular-nums';
  const numIn = (v: number, on: (n: number) => void, label: string, step = 1) => (
    <input type="number" min={0} step={step} className={num} value={v} aria-label={label} onChange={(e) => on(Math.max(0, Number(e.target.value) || 0))} />
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-[min(1060px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-label="Bill of materials">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Bill of materials &amp; quote</h2>
          <span className="ml-3 text-xs text-gray-500">Counted from every page and rack of {project.name}. Prices are kept in your price book and used for every client.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex items-center gap-1 border-b border-gray-200 px-4 py-1.5">
          {([['bom', 'Materials'], ['quote', 'Labor & quote'], ['capacity', `Port capacity (${capacity.length})`]] as const).map(([t, label]) => (
            <button key={t} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-50 font-medium text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setTab(t)}>{label}</button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button className={btn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button className={btn} onClick={toCsv}>CSV</button>
            {tab !== 'capacity' && <button className={btn} onClick={toWord} title="The quote as a Word document: materials by section, labor, totals, notes">Quote (Word)</button>}
            <button className="rounded bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700" onClick={toExcel}>Excel</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'bom' && (
            sections.length ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                  <span className="font-medium text-gray-700">What does this job supply?</span>
                  <button className={btn} onClick={() => setQuote({ onSite: {} })} title="Quote every line: a new installation">Everything is new</button>
                  <button className={btn} onClick={() => setOnSite(allRows, () => 'all')} title="Quote nothing yet, then mark what you are replacing or adding as New">Client has everything</button>
                  <span className="text-xs text-gray-500">Then switch single lines: New is quoted, Client has it is reused and not quoted (with labor only for what is new).</span>
                </div>
                {sections.map((s) => (
                  <section key={s.title} className="mb-4">
                    <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {s.title}{s.title === 'Circuits & services' ? ' (monthly)' : ''}
                      <span className="ml-auto flex gap-2 font-normal normal-case tracking-normal">
                        <button className="text-blue-700 hover:underline" onClick={() => setOnSite(s.rows, () => 0)} aria-label={`${s.title}: all new`}>all new</button>
                        <button className="text-blue-700 hover:underline" onClick={() => setOnSite(s.rows, () => 'all')} aria-label={`${s.title}: client has all`}>client has all</button>
                      </span>
                    </h3>
                    <table className="w-full text-sm">
                      <tbody>
                        {s.rows.map((r) => {
                          const price = r.price ?? prices[r.key];
                          const have = onSiteQty(r, qs.onSite);
                          const order = r.qty - have;
                          return (
                            <tr key={r.key} className={`border-b border-gray-100 ${order ? '' : 'bg-gray-50'}`}>
                              <td className="w-28 py-1 pr-2">
                                <button type="button" aria-label={`${r.item}: ${have === 0 ? 'new' : order ? 'client has some' : 'client has it'}`}
                                  title={have === 0 ? 'Quoted. Click if the client already has it' : 'Not quoted (the client has it). Click to quote it as new'}
                                  onClick={() => setOnSite([r], () => (have ? 0 : 'all'))}
                                  className={`w-full rounded-full border px-2 py-0.5 text-xs font-medium ${have === 0 ? 'border-green-300 bg-green-50 text-green-800' : order ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-300 bg-white text-gray-500'}`}>
                                  {have === 0 ? 'New' : order ? 'Partly new' : 'Client has it'}
                                </button>
                              </td>
                              <td className={`w-16 py-1 pr-3 text-right font-semibold tabular-nums ${order ? 'text-gray-900' : 'text-gray-400'}`}>{(order || r.qty).toLocaleString()}</td>
                              <td className="w-10 py-1 pr-3 text-xs text-gray-500">{r.unit}</td>
                              <td className={`py-1 pr-3 ${order ? 'text-gray-800' : 'text-gray-400'}`}>{r.item}</td>
                              <td className="py-1 pr-3 text-xs text-gray-500">
                                {r.detail}
                                {have > 0 && r.qty > 1 && (
                                  <span className="ml-1 whitespace-nowrap">
                                    {r.detail ? '· ' : ''}client has{' '}
                                    <input type="number" min={0} max={r.qty} value={have} aria-label={`How many the client has: ${r.item}`}
                                      className="w-16 rounded border border-gray-300 px-1 py-0 text-right text-xs tabular-nums"
                                      onChange={(e) => setOnSite([r], () => Math.max(0, Math.round(Number(e.target.value) || 0)))} /> of {r.qty.toLocaleString()}
                                  </span>
                                )}
                              </td>
                              <td className="w-28 py-1 pr-2 text-right">
                                {r.price !== undefined
                                  ? <span className="text-xs text-gray-500" title="The monthly cost recorded on the circuit (Shape Data → Circuit)">{cur(r.price)}</span>
                                  : r.key.startsWith('circuit|')
                                    ? <span className="text-[11px] text-amber-700" title="Select the device and fill in Circuit → Monthly cost in Shape Data">set on the circuit</span>
                                    : <PriceInput value={price} label={r.item} onSave={(v) => savePrice(r.key, v)} />}
                              </td>
                              <td className="w-28 py-1 text-right tabular-nums text-gray-800">{price !== undefined && order ? cur(price * order) : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                ))}
                <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-2 text-sm">
                  <span className="text-gray-600">Materials <b className="text-gray-900">{cur(q.materials)}</b></span>
                  {q.monthly > 0 && <span className="text-gray-600">Monthly <b className="text-gray-900">{cur(q.monthly)}</b></span>}
                  {q.unpriced > 0 && <span className="text-xs text-amber-700">{q.unpriced} item{q.unpriced === 1 ? '' : 's'} without a price</span>}
                  {q.onSite.length > 0 && <span className="text-xs text-gray-500">{q.onSite.length} line{q.onSite.length === 1 ? '' : 's'} already on site, not quoted</span>}
                  <span className="ml-auto flex gap-1.5">
                    <button className={btn} onClick={exportBook} title="Save your price book to a file (back it up or share it with other techs)">Export prices</button>
                    <button className={btn} onClick={() => fileRef.current?.click()} title="Add prices from a price book file">Import prices</button>
                    <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { void importBook(e.target.files?.[0]); e.target.value = ''; }} />
                  </span>
                </div>
              </>
            ) : <p className="text-sm text-gray-500">Nothing to count yet: add devices, cables or racks.</p>
          )}

          {tab === 'quote' && (
            <div className="grid gap-6 md:grid-cols-[1fr_300px]">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Labor estimate</h3>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500"><th className="py-1 font-medium">Task</th><th className="py-1 text-right font-medium">Qty</th><th className="py-1 pl-3 font-medium">Hours each</th><th className="py-1 text-right font-medium">Hours</th><th className="py-1 text-right font-medium">Amount</th></tr></thead>
                  <tbody>
                    {LABOR_TASKS.map((t) => {
                      const l = q.labor.find((x) => x.key === t.key);
                      const each = qs.hours?.[t.key] ?? t.hours;
                      return (
                        <tr key={t.key} className={`border-b border-gray-100 ${q.work[t.key] ? '' : 'text-gray-400'}`}>
                          <td className="py-1 pr-3">{t.label}</td>
                          <td className="py-1 text-right tabular-nums">{q.work[t.key]} <span className="text-xs text-gray-400">{t.unit}{q.work[t.key] === 1 ? '' : 's'}</span></td>
                          <td className="py-1 pl-3">{numIn(each, (n) => setQuote({ hours: { ...qs.hours, [t.key]: n } }), `Hours per ${t.unit}`, 0.1)}</td>
                          <td className="py-1 text-right tabular-nums">{l?.hours ?? 0}</td>
                          <td className="py-1 text-right tabular-nums">{cur(l?.amount ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-500" htmlFor="quote-notes">Notes / terms on the quote</label>
                <textarea id="quote-notes" className="mt-1 h-24 w-full rounded border border-gray-300 p-2 text-sm" placeholder="e.g. Prices exclude permits and after-hours work. 50% deposit on acceptance." value={qs.notes ?? ''} onChange={(e) => setQuote({ notes: e.target.value })} />
              </div>
              <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <span className="text-gray-600">Currency</span>
                  <select className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" value={set.currency} onChange={(e) => setQuote({ currency: e.target.value })} aria-label="Currency">
                    {['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN', 'DOP', 'COP', 'BRL', 'INR', 'JPY'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <span className="text-gray-600">Labor rate / hour</span>{numIn(set.laborRate, (n) => setQuote({ laborRate: n }), 'Labor rate per hour')}
                  <span className="text-gray-600">Markup on materials %</span>{numIn(set.markupPct, (n) => setQuote({ markupPct: n }), 'Markup percent')}
                  <span className="text-gray-600">Tax on materials %</span>{numIn(set.taxPct, (n) => setQuote({ taxPct: n }), 'Tax percent', 0.1)}
                  <span className="text-gray-600">Quote valid (days)</span>{numIn(set.validDays, (n) => setQuote({ validDays: n }), 'Days the quote is valid')}
                </div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-gray-200 pt-2 tabular-nums">
                  <dt className="text-gray-600">Materials</dt><dd className="text-right">{cur(q.materials)}</dd>
                  <dt className="text-gray-600">Markup ({set.markupPct}%)</dt><dd className="text-right">{cur(q.markup)}</dd>
                  {set.taxPct > 0 && <><dt className="text-gray-600">Tax ({set.taxPct}%)</dt><dd className="text-right">{cur(q.tax)}</dd></>}
                  <dt className="text-gray-600">Labor ({Math.round(q.laborHours * 10) / 10} h)</dt><dd className="text-right">{cur(q.labor$)}</dd>
                  <dt className="border-t border-gray-300 pt-1 font-semibold text-gray-900">Total (one-time)</dt><dd className="border-t border-gray-300 pt-1 text-right font-semibold text-gray-900">{cur(q.oneTime)}</dd>
                  {q.monthly > 0 && <><dt className="text-gray-600">Monthly recurring</dt><dd className="text-right">{cur(q.monthly)}</dd></>}
                </dl>
                {q.unpriced > 0 && <p className="text-xs text-amber-700">{q.unpriced} material item{q.unpriced === 1 ? ' has' : 's have'} no price yet (Materials tab).</p>}
              </div>
            </div>
          )}

          {tab === 'capacity' && (capacity.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{CAP_HEADER.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {capacity.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 pr-3 font-medium text-gray-800">{c.device}</td>
                    <td className="py-1 pr-3 text-xs text-gray-500">{c.model}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.ports}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.used}</td>
                    <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                      <span className="inline-block h-1.5 w-14 overflow-hidden rounded bg-gray-200 align-middle"><span className={`block h-full ${c.used / Math.max(1, c.ports) >= 0.8 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${(c.used / Math.max(1, c.ports)) * 100}%` }} /></span>
                      <span className="ml-2">{c.free}</span>
                    </td>
                    <td className="py-1 pr-3 tabular-nums">{c.poePorts || ''}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.poeW || ''}</td>
                    <td className="py-1 pr-3 tabular-nums">{c.poeBudgetW || ''}</td>
                    <td className="py-1 text-xs text-amber-700">{c.warning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No switches, firewalls or patch panels yet.</p>)}
        </div>
      </div>
    </div>
  );
}
