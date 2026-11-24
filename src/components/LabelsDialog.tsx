'use client';

import { useEffect, useMemo, useState } from 'react';
import { assetLabels, cableLabels, LABEL_CSS, LABEL_SHEETS, labelledCables, labelSheetsHtml, panelStrips, stripsHtml } from '@/lib/labels';
import { activePage } from '@/lib/project';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { useDisplay } from './useDisplay';

type Kind = 'cables' | 'assets' | 'strips';
const ROOT_ID = 'rd-label-print';

/** Prints the labels: a print-only copy of the sheets, at the label stock's real size, then the system print dialog. */
function printHtml(body: string, paper: 'letter' | 'a4') {
  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<style>
#${ROOT_ID} { display: none; }
@media print {
  @page { size: ${paper === 'letter' ? '8.5in 11in' : '210mm 297mm'}; margin: 0; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${LABEL_CSS}
}
</style>${body}`;
  document.body.appendChild(root);
  const done = () => { root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/** Data → Labels: cable labels, asset labels with a QR code, patch panel strips. */
export function LabelsDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const numberCables = useDiagram((s) => s.numberCables);
  const display = useDisplay();
  const [kind, setKind] = useState<Kind>('cables');
  const [sheetId, setSheetId] = useState('5160');
  const [thisPage, setThisPage] = useState(false);
  const [perEnd, setPerEnd] = useState(true);
  const [qr, setQr] = useState<'details' | 'link' | 'none'>('details');
  const [skip, setSkip] = useState(0);
  const [outlines, setOutlines] = useState(false);
  const sheet = LABEL_SHEETS.find((s) => s.id === sheetId)!;
  const pageId = thisPage ? activePage(project).id : undefined;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const unnumbered = useMemo(() => labelledCables(project, pageId).filter((c) => !c.e.data?.label?.trim()).length, [project, pageId]);
  const { html, count, sheets } = useMemo(() => {
    if (kind === 'strips') {
      const strips = panelStrips(project, getStencil, pageId);
      return { html: stripsHtml(strips), count: strips.reduce((n, s) => n + s.rows.length * 4, 0), sheets: 0 };
    }
    const labels = kind === 'cables'
      ? cableLabels(project, getStencil, { perEnd, pageId }, (d) => display.cable(d).color)
      : assetLabels(project, getStencil, { qr, pageId });
    const per = sheet.cols * sheet.rows;
    return { html: labelSheetsHtml(labels, sheet, { skip, outlines: true }), count: labels.length, sheets: Math.ceil((labels.length + skip) / per) };
  }, [kind, project, pageId, perEnd, qr, sheet, skip, display]);

  const print = () => {
    if (!count) return;
    const body = kind === 'strips' ? html : labelSheetsHtml(
      kind === 'cables' ? cableLabels(project, getStencil, { perEnd, pageId }, (d) => display.cable(d).color) : assetLabels(project, getStencil, { qr, pageId }),
      sheet, { skip, outlines },
    );
    printHtml(body, kind === 'strips' ? 'letter' : sheet.paper);
  };

  const pageW = sheet.paper === 'letter' ? 8.5 : 8.27;
  const sel = 'rounded-md border border-slate-300 px-1.5 py-1 text-sm';
  const radio = (k: Kind, label: string, sub: string) => (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${kind === k ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
      <input type="radio" name="label-kind" className="mt-1 accent-blue-600" checked={kind === k} onChange={() => setKind(k)} />
      <span><span className="block text-sm font-medium text-gray-900">{label}</span><span className="text-xs text-gray-500">{sub}</span></span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-[92vh] w-[min(1100px,96vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="Labels">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">Print labels</h2>
          <span className="ml-3 text-xs text-gray-500">Print at 100% (no “fit to page”) so labels line up with the sheet.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-80 shrink-0 space-y-3 overflow-y-auto border-r border-gray-200 p-3 text-sm">
            <div className="space-y-1.5" role="radiogroup" aria-label="Kind of label">
              {radio('cables', 'Cable labels', 'Cable number, both ends, type, VLAN, length')}
              {radio('assets', 'Asset labels', 'Name, model, serial, asset tag, IP, with a QR code')}
              {radio('strips', 'Patch panel strips', 'Port numbers and the jack or device each port serves')}
            </div>
            {kind !== 'strips' && (
              <label className="block">
                <span className="mb-0.5 block text-xs font-medium text-gray-500">Label sheet</span>
                <select className={`${sel} w-full`} value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
                  {LABEL_SHEETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-600" checked={thisPage} onChange={(e) => setThisPage(e.target.checked)} /> Only this page ({activePage(project).name})</label>
            {kind === 'cables' && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-600" checked={perEnd} onChange={(e) => setPerEnd(e.target.checked)} /> One label for each end (two per cable)</label>
                {unnumbered > 0 && (
                  <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                    {unnumbered} cable{unnumbered === 1 ? ' has' : 's have'} no label, so {unnumbered === 1 ? 'it gets' : 'they get'} a number (C-001…) here.
                    <button className="mt-1 block font-medium text-blue-700 hover:underline" onClick={() => numberCables(pageId)}>Write the numbers on the diagram too</button>
                    <span className="text-amber-800">so the diagram and the printed labels match.</span>
                  </div>
                )}
              </>
            )}
            {kind === 'assets' && (
              <label className="block">
                <span className="mb-0.5 block text-xs font-medium text-gray-500">QR code</span>
                <select className={`${sel} w-full`} value={qr} onChange={(e) => setQr(e.target.value as typeof qr)}>
                  <option value="details">Device details (client, name, model, serial, asset tag, IP)</option>
                  <option value="link">The device&apos;s web link (details if it has none)</option>
                  <option value="none">No QR code</option>
                </select>
              </label>
            )}
            {kind !== 'strips' && (
              <>
                <label className="block">
                  <span className="mb-0.5 block text-xs font-medium text-gray-500">Start at label (to reuse a partly used sheet)</span>
                  <input type="number" min={1} max={sheet.cols * sheet.rows} className={`${sel} w-20`} value={skip + 1} onChange={(e) => setSkip(Math.max(0, Math.min(sheet.cols * sheet.rows - 1, (Number(e.target.value) || 1) - 1)))} />
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-600" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> Print label outlines (to test on plain paper)</label>
              </>
            )}
            <div className="border-t border-gray-200 pt-3">
              <p className="mb-2 text-xs text-gray-600">{kind === 'strips' ? `${count} strip${count === 1 ? '' : 's'} of six ports` : `${count} label${count === 1 ? '' : 's'} on ${sheets} sheet${sheets === 1 ? '' : 's'}`}</p>
              <button className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40" disabled={!count} onClick={print}>Print…</button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
            {count ? (
              <div className="mx-auto origin-top shadow" style={{ width: `${pageW}in`, transform: 'scale(0.75)', transformOrigin: 'top center' }}>
                <style>{LABEL_CSS}</style>
                <div dangerouslySetInnerHTML={{ __html: kind === 'strips' ? `<div style="background:#fff">${html}</div>` : html.split('</section>')[0] + '</section>' }} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">{kind === 'strips' ? 'No patch panels here.' : kind === 'cables' ? 'No cables to label here.' : 'No devices to label here.'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
