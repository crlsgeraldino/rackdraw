'use client';

import { useReactFlow } from '@xyflow/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_DISPLAY } from '@/lib/display';
import { DEFAULT_SETUP, PAPER, sheetSize, type PaperSize } from '@/lib/pageSetup';
import { openFind, paletteAction } from '@/lib/events';
import { downloadBlob, exportCsv, exportImage, exportPdf, readProjectFile, renderCanvasPng, renderCanvasSvg, safeName, saveProjectFile, type PageRenderer } from '@/lib/export';
import { buildWebPage, type WebHotspot, type WebPage } from '@/lib/webPage';
import { resolveLink } from '@/lib/links';
import { exportVsdx } from '@/lib/visio/vsdxExport';
import { exportWordReport } from '@/lib/wordReport';
import { exportDeck } from '@/lib/deck';
import { BomDialog } from '../BomDialog';
import { IpPlanDialog } from '../IpPlanDialog';
import { LifecycleDialog } from '../LifecycleDialog';
import { LabelsDialog } from '../LabelsDialog';
import { downloadBackup, readBackup, restoreBackup } from '@/lib/backup';
import { ReportDialog } from '../ReportDialog';
import { askText } from '../PromptHost';
import { deviceFieldValue, reportFields } from '@/lib/report';
import type { LayoutKind } from '@/lib/autolayout';
import { BUILT_IN_TEMPLATES } from '@/lib/templates';
import { HF_CODES } from '@/lib/headerFooter';
import { TABLE_PRESETS, activeCell, deleteCol, deleteRow, insertCol, insertRow, makeTable } from '@/lib/table';
import { openNumberShapes } from '../NumberShapesDialog';
import { SYMBOLS, insertSymbol } from '@/lib/symbols';
import { DefineShapeDataDialog } from '../DefineShapeDataDialog';
import { openChangeShape } from '../ChangeShapeDialog';
import { openVersions } from '../VersionsDialog';
import { THEMES, themeById, type Theme } from '@/lib/themes';
import { setPainter, setPresenting, setTool, usePainter, useTool } from '@/lib/tools';
import { SAVE_SELECTION_EVENT, SHORTCUTS_EVENT } from '@/lib/events';
import { importVsdx } from '@/lib/visio/vsdxImport';
import { loadImageFile } from '@/lib/imageImport';
import { insertPictureFile } from '@/lib/pictures';
import { parseDxf } from '@/lib/dxf';
import { insertPdfBackdrop } from '@/lib/insertPdf';
import { describeStep, type HistoryState } from '@/lib/history';
import { setPref, usePref } from '@/lib/prefs';
import { printProject, type PrintOptions } from '@/lib/print';
import { activePage, allNodes } from '@/lib/project';
import { SCALE_PRESETS, SET_SCALE_EVENT } from '@/lib/units';
import type { AppNode, CableColorBy, CalloutStyle, DeviceColorBy, LinePattern, Page, ShapeKind, ShapeNode, ZoneNode, ZoneStyle } from '@/lib/types';
import { allLinks, dashFor } from '@/lib/types';
import { getStencil, TEXT_DEFAULT_SIZE, useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { ALIGN, AlignIcon, useAutoArrange, useSelectionState } from '../ArrangeMenu';
import { OPEN_CHECK_EVENT } from '../CheckPanel';
import { openComments } from '../CommentsPanel';
import { editStencil } from '../ContextMenu';
import { DataMenu } from '../DataMenu';
import { PrintDialog } from '../PrintDialog';
import { ViewMenu } from '../ViewMenu';
import { Icon } from './icons';
import { Big, Check, Column, Drop, Group, Small, Swatches } from './parts';

type Tab = 'home' | 'insert' | 'design' | 'data' | 'review' | 'view' | 'shape';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'design', label: 'Design' },
  { id: 'data', label: 'Data' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
];

/* ------------------------------------------------------------------ */
/* Document commands (File tab, Quick Access Toolbar, Ctrl+P)          */
/* ------------------------------------------------------------------ */

/**
 * What to capture: the nodes (by id, so React Flow uses its live measurements rather than sizes saved in the
 * diagram), widened to take in device labels, info boxes and dimension lines that sit outside their node box.
 */
function contentBoundsOf(rf: ReturnType<typeof useReactFlow<AppNode>>, ids: string[], onlyTheirs = false) {
  const b = rf.getNodesBounds(ids);
  let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.width, b.y + b.height];
  // For a selection, only the labels / info boxes of the selected items count.
  const scope = onlyTheirs ? ids.map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`) : ['.react-flow__viewport'];
  document.querySelectorAll(scope.flatMap((s) => [`${s} .nc-infobox`, `${s} .nc-device-label`, `${s}.nc-measure, ${s} .nc-measure *`]).join(', ')).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const a = rf.screenToFlowPosition({ x: r.left, y: r.top }, { snapToGrid: false });
    const z = rf.screenToFlowPosition({ x: r.right, y: r.bottom }, { snapToGrid: false });
    [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, z.x), Math.max(y1, z.y)];
  });
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Design → Center Drawing (Visio): moves the whole drawing so it sits in the middle of the sheets it needs, with
 * equal space left and right, top and bottom.
 */
function centerDrawing(rf: ReturnType<typeof useReactFlow<AppNode>>) {
  const st = useDiagram.getState();
  const pg = activePage(st.projects[st.currentId]);
  const ids = pg.nodes.filter((n) => n.type !== 'backdrop').map((n) => n.id);
  if (!ids.length) return;
  const b = contentBoundsOf(rf, ids);
  const sheet = sheetSize(pg.setup ?? DEFAULT_SETUP);
  const cols = Math.max(1, Math.ceil((b.width + 48) / sheet.w)), rows = Math.max(1, Math.ceil((b.height + 48) / sheet.h));
  const dx = (cols * sheet.w - b.width) / 2 - b.x, dy = (rows * sheet.h - b.height) / 2 - b.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  st.moveDrawing(dx, dy);
  setTimeout(() => rf.fitView({ padding: 0.08, duration: 200 }), 50);
}

function useDocument() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const [busy, setBusy] = useState(false);

  /**
   * What to capture: the nodes (by id, so React Flow uses its live measurements rather than sizes saved in the
   * diagram), widened to take in device labels, info boxes and dimension lines that sit outside their node box.
   */
  const contentBounds = (ids: string[], onlyTheirs = false) => contentBoundsOf(rf, ids, onlyTheirs);

  /** For the PDF and printing: show each page in turn and capture it. */
  // Background pages print behind the pages that use them, not on their own (as in Visio).
  const withBackground = (pg: Page) => {
    const bg = pg.backgroundId ? project.pages.find((x) => x.id === pg.backgroundId) : undefined;
    return [...pg.nodes.map((n) => n.id), ...(bg?.nodes ?? []).map((n) => `bg:${n.id}`)];
  };
  const renderPage: PageRenderer = async (pg) => {
    if (!pg.nodes.length || pg.background) return null;
    useDiagram.getState().setActivePage(pg.id);
    await new Promise((r) => setTimeout(r, 700));
    return renderCanvasPng(contentBounds(withBackground(pg)));
  };

  const run = async (fn: () => Promise<void> | void, needsCanvas = true) => {
    if (!allNodes(project).length && !(project.racks ?? []).length) return alert('This client has no diagram or racks yet.');
    setBusy(true);
    try {
      // Picture exports capture the live canvas, so show the diagram first.
      if (needsCanvas && useDiagram.getState().view !== 'diagram') {
        useDiagram.getState().setView('diagram');
        await new Promise((r) => setTimeout(r, 500));
      }
      await fn();
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const back = () => useDiagram.getState().setActivePage(project.activePageId);

  return {
    busy,
    pdf: () => run(async () => { try { await exportPdf(project, renderPage); } finally { back(); } }),
    png: () => run(() => (page.nodes.length ? exportImage('png', project, contentBounds(withBackground(page)), page.name) : alert('This page is empty.'))),
    svg: () => run(() => (page.nodes.length ? exportImage('svg', project, contentBounds(withBackground(page)), page.name) : alert('This page is empty.'))),
    csv: () => run(() => exportCsv(project), false),
    selection: (kind: 'png' | 'svg') => run(() => {
      const nodes = page.nodes.filter((n) => n.selected && n.type !== 'backdrop').map((n) => n.id);
      if (!nodes.length) return alert('Select the devices and shapes to put in the picture first.');
      const set = new Set(nodes);
      // The selected cables, and any cable between two selected items.
      const edges = new Set(page.edges.filter((e) => e.selected || (set.has(e.source) && set.has(e.target))).map((e) => e.id));
      return exportImage(kind, project, contentBounds(nodes, true), page.name, { nodes: set, edges });
    }),
    pptx: () => run(async () => {
      try {
        const bytes = await exportDeck(project, renderPage);
        downloadBlob(`${safeName(project.name)}.pptx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      } finally {
        back();
      }
    }),
    docx: () => run(async () => {
      try {
        const bytes = await exportWordReport(project, renderPage);
        downloadBlob(`${safeName(project.name)}.docx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      } finally {
        back();
      }
    }),
    web: () => run(async () => {
      try {
        const fields = reportFields(project).filter((f) => !['page', 'rack', 'connections', 'documentedPorts', 'notes', 'link', 'name'].includes(f.key));
        const pages: WebPage[] = [];
        for (const pg of project.pages) {
          if (pg.background || !pg.nodes.length) continue;
          useDiagram.getState().setActivePage(pg.id);
          await new Promise((r) => setTimeout(r, 800));
          const shot = await renderCanvasSvg(contentBounds(withBackground(pg)));
          const byId = new Map(pg.nodes.map((n) => [n.id, n]));
          const hotspots: WebHotspot[] = [];
          for (const n of pg.nodes) {
            if (n.type !== 'device') continue;
            const inode = rf.getInternalNode(n.id);
            if (!inode) continue;
            const { x, y } = inode.internals.positionAbsolute;
            const w = inode.measured.width ?? 0, h = inode.measured.height ?? 0;
            const d = n.data;
            const rows: [string, string][] = fields.map((f) => [f.label, deviceFieldValue(d, f.key)] as [string, string]).filter(([, v]) => v);
            if (d.alt?.trim()) rows.unshift(['Description', d.alt.trim()]);
            // Who it is cabled to, port to port.
            const portName = (id: string, port?: string | null) => { const o = byId.get(id); return o?.type === 'device' ? (o.data.ports?.[port ?? '']?.label || port || '') : ''; };
            const links = pg.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => {
              const mine = e.source === n.id, other = byId.get(mine ? e.target : e.source);
              const otherName = other?.type === 'device' ? other.data.name : other?.type === 'shape' ? other.data.text : '';
              return `${portName(n.id, mine ? e.sourceHandle : e.targetHandle)} → ${otherName} ${portName(mine ? e.target : e.source, mine ? e.targetHandle : e.sourceHandle)}`.replace(/\s+/g, ' ').trim();
            });
            if (links.length) rows.push(['Connected to', links.join('; ')]);
            if (d.notes) rows.push(['Notes', d.notes]);
            hotspots.push({
              x: (shot.vp.x + x * shot.vp.zoom) / shot.width, y: (shot.vp.y + y * shot.vp.zoom) / shot.height,
              w: (w * shot.vp.zoom) / shot.width, h: (h * shot.vp.zoom) / shot.height,
              title: d.name || 'Device', summary: [d.ip, d.model].filter(Boolean).join(' · '), rows,
              links: allLinks(d).flatMap((l) => { const t = resolveLink(l.address); return t?.kind === 'url' ? [{ label: l.label || t.url, url: t.url }] : []; }),
            });
          }
          pages.push({ name: pg.name, image: shot.url, width: shot.width, height: shot.height, hotspots });
        }
        if (!pages.length) return alert('There is nothing to put on a web page yet.');
        const html = buildWebPage({ name: project.name, site: project.site, date: new Date().toLocaleDateString() }, pages);
        downloadBlob(`${safeName(project.name)}.html`, new Blob([html], { type: 'text/html' }));
      } finally {
        back();
      }
    }),
    vsdx: () => run(async () => {
      try {
        const bytes = await exportVsdx(project, {
          rf,
          stencilOf: getStencil,
          showPage: async (pg) => { useDiagram.getState().setActivePage(pg.id); await new Promise((r) => setTimeout(r, 800)); },
        });
        downloadBlob(`${safeName(project.name)}.vsdx`, new Blob([bytes as BlobPart], { type: 'application/vnd.ms-visio.drawing' }));
      } finally {
        back();
      }
    }),
    print: (o: PrintOptions) => run(async () => { try { await printProject(project, renderPage, o); } finally { back(); } }, o.pageIds.length > 0),
    save: () => saveProjectFile(project),
    open: async (f?: File) => {
      if (!f) return;
      try {
        // Visio drawings, and Visio templates (.vstx: a new drawing from the template, as Visio opens them).
        if (/\.vs[dt]x$/i.test(f.name)) {
          setBusy(true);
          try {
            const { project: p, stencils, summary } = await importVsdx(f);
            useDiagram.getState().importProject(p, stencils);
            setTimeout(() => rf.fitView({ padding: 0.2 }), 80);
            const notes = [...new Set(summary.warnings)];
            alert(
              `Opened ${f.name}: ${summary.pages} page${summary.pages === 1 ? '' : 's'}, ${summary.devices} devices, ${summary.cables} cables, ${summary.shapes} other shapes.` +
              (summary.skippedLines ? `\n${summary.skippedLines} line${summary.skippedLines === 1 ? ' was' : 's were'} not connected to two shapes and ${summary.skippedLines === 1 ? 'was' : 'were'} left out.` : '') +
              (stencils.length ? `\nIts shapes are in the "${stencils[0].library}" library.` : '') +
              (notes.length ? `\n\nNotes:\n• ${notes.join('\n• ')}` : ''),
            );
          } finally {
            setBusy(false);
          }
          return;
        }
        const { project: p, stencils } = await readProjectFile(f);
        useDiagram.getState().importProject(p, stencils);
        setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
      } catch (e) {
        alert((e as Error).message);
      }
    },
  };
}

/** Diagram point at the middle of the visible canvas (where Insert commands drop things). */
function useCanvasCenter() {
  const rf = useReactFlow<AppNode>();
  return () => {
    const el = document.querySelector('.react-flow');
    const r = el?.getBoundingClientRect();
    return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
  };
}

/* ------------------------------------------------------------------ */
/* Undo / Redo lists (Quick Access Toolbar)                           */
/* ------------------------------------------------------------------ */

/**
 * The ▾ beside Undo / Redo (like Office and Visio): the recent steps in plain words; clicking one undoes (or redoes)
 * every step down to it.
 */
function HistoryMenu({ kind, disabled }: { kind: 'undo' | 'redo'; disabled: boolean }) {
  const [hover, setHover] = useState(-1);
  const list = () => {
    const st = useDiagram.getState();
    const p = st.projects[st.currentId];
    const now: HistoryState = { pages: p.pages, racks: p.racks ?? [], activePageId: p.activePageId };
    if (kind === 'undo') {
      // Newest first: past[i] → (past[i + 1] or now).
      const states = [...st.past, now];
      return st.past.map((_, i) => describeStep(states[i], states[i + 1])).reverse().slice(0, 30);
    }
    const states = [now, ...st.future];
    return st.future.map((_, i) => describeStep(states[i], states[i + 1])).slice(0, 30);
  };
  return (
    <Drop width={260} trigger={(open) => (
      <button className="-ml-1 flex h-6 w-3 items-center justify-center rounded text-[9px] text-white/80 hover:bg-white/15 disabled:opacity-40" onClick={open} disabled={disabled} title={kind === 'undo' ? 'Undo several steps' : 'Redo several steps'} aria-label={kind === 'undo' ? 'Undo list' : 'Redo list'}>▾</button>
    )}>
      {(close) => {
        const steps = list();
        return (
          <div className="py-1 text-xs text-gray-800" onMouseLeave={() => setHover(-1)}>
            {steps.map((label, i) => (
              <button key={i} className={`block w-full truncate px-3 py-1 text-left ${i <= hover ? 'bg-blue-100' : 'hover:bg-blue-50'}`} onMouseEnter={() => setHover(i)}
                onClick={() => { const s = useDiagram.getState(); for (let k = 0; k <= i; k++) (kind === 'undo' ? s.undo : s.redo)(); setHover(-1); close(); }}>
                {label}
              </button>
            ))}
            <div className="border-t border-gray-100 px-3 pt-1 text-[10px] text-gray-500">{hover >= 0 ? `${kind === 'undo' ? 'Undo' : 'Redo'} ${hover + 1} step${hover ? 's' : ''}` : kind === 'undo' ? 'Pick how far back to go' : 'Pick how far forward to go'}</div>
          </div>
        );
      }}
    </Drop>
  );
}

/* ------------------------------------------------------------------ */
/* The ribbon                                                          */
/* ------------------------------------------------------------------ */

export function Ribbon() {
  const project = useCurrentProject();
  const projects = useDiagram((s) => s.projects);
  const view = useDiagram((s) => s.view);
  const canUndo = useDiagram((s) => s.past.length > 0);
  const canRedo = useDiagram((s) => s.future.length > 0);
  const { openProject, undo, redo } = useDiagram.getState();
  const rf = useReactFlow<AppNode>();
  const doc = useDocument();
  // Right-click → Save selection as picture (the export code lives here).
  const saveSelection = useRef(doc.selection);
  saveSelection.current = doc.selection;
  useEffect(() => {
    const on = (e: Event) => saveSelection.current((e as CustomEvent).detail === 'svg' ? 'svg' : 'png');
    window.addEventListener(SAVE_SELECTION_EVENT, on);
    return () => window.removeEventListener(SAVE_SELECTION_EVENT, on);
  }, []);
  const collapsed = usePref('ribbonCollapsed');
  const [tab, setTab] = useState<Tab>('home');
  const [file, setFile] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [peek, setPeek] = useState(false); // collapsed ribbon shown temporarily after clicking a tab
  const openRef = useRef<HTMLInputElement>(null);
  const page = useCurrentPage();
  const hasSelection = view === 'diagram' && (page.nodes.some((n) => n.selected && n.type !== 'backdrop') || page.edges.some((e) => e.selected));
  const active: Tab = tab === 'shape' && !hasSelection ? 'home' : tab;

  // Ctrl+P prints; Ctrl+F1 collapses the ribbon (as in Office).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPrinting(true); }
      if (mod && e.key === 'F1') { e.preventDefault(); setPref('ribbonCollapsed', !collapsed); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed]);

  // Installed app: open .rackdraw.json / .netcraft.json files double-clicked in Explorer (File Handling API).
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer: (cb: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      for (const h of files) await doc.open(await h.getFile());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));
  const showBody = !collapsed || peek;
  const qat = 'flex h-6 w-6 items-center justify-center rounded text-white/90 hover:bg-white/15 disabled:opacity-40';

  // Office-style fit: when the tab is wider than the window, groups drop their small buttons' labels one at a time,
  // starting from the right, until it fits (the tooltips still name them); widening the window brings them back.
  // If it still doesn't fit (Design's drop-downs), the tab scrolls sideways (the mouse wheel works too).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const fit = () => {
      const groups = [...el.querySelectorAll<HTMLElement>('.ribbon-group')];
      groups.forEach((g) => g.removeAttribute('data-compact'));
      for (let i = groups.length - 1; i >= 0 && el.scrollWidth > el.clientWidth + 1; i--) groups[i].setAttribute('data-compact', '');
      setScroll(el.scrollWidth > el.clientWidth + 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [active, showBody]);

  return (
    <header className="relative z-40 shrink-0 select-none border-b border-slate-200 bg-white" onMouseLeave={() => collapsed && setPeek(false)}>
      {/* Title bar with the Quick Access Toolbar */}
      <div className="flex h-8 items-center gap-1 bg-gradient-to-r from-[#2d4a99] via-[#3653a8] to-[#3d5cb6] px-2 text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6.5h4.5V14" /></svg>
        <button className={qat} onClick={doc.save} title="Save to a file (.rackdraw.json)" aria-label="Save"><Icon name="save" size={15} /></button>
        <button className={qat} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" size={15} /></button>
        <HistoryMenu kind="undo" disabled={!canUndo} />
        <button className={qat} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" size={15} /></button>
        <HistoryMenu kind="redo" disabled={!canRedo} />
        <div className="mx-auto flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden font-semibold sm:inline">RackDraw</span>
          <span className="text-white/60">—</span>
          <select
            className="max-w-56 rounded bg-white/15 px-1.5 py-0.5 text-sm text-white outline-none hover:bg-white/25 [&>option]:text-gray-900"
            value={project.id}
            onChange={(e) => { openProject(e.target.value); setTimeout(() => rf.fitView({ padding: 0.2 }), 50); }}
            title="Client"
          >
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {doc.busy && <span className="text-xs text-white/80">Working…</span>}
      </div>

      {/* Tab row */}
      <div className="flex h-9 items-center gap-0.5 bg-white px-1.5 text-[12.5px]" role="tablist">
        <button className="mr-1 rounded-md bg-[#3653a8] px-3.5 py-1 font-medium text-white shadow-sm transition-colors hover:bg-[#2d4a99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70" onClick={() => setFile(true)}>File</button>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id && showBody}
            onClick={() => { setTab(t.id); if (collapsed) setPeek(true); }}
            className={`relative rounded-md px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${active === t.id && showBody ? 'font-semibold text-[#2f55c4] after:absolute after:inset-x-2.5 after:-bottom-[5px] after:h-[3px] after:rounded-full after:bg-[#2f55c4]' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
        {hasSelection && (
          <button
            role="tab"
            aria-selected={active === 'shape'}
            onClick={() => { setTab('shape'); if (collapsed) setPeek(true); }}
            className={`relative rounded-md px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 ${active === 'shape' && showBody ? 'font-semibold text-amber-700 after:absolute after:inset-x-2.5 after:-bottom-[5px] after:h-[3px] after:rounded-full after:bg-amber-500' : 'text-amber-700 hover:bg-amber-50 hover:text-amber-900'}`}
            title="Commands for the selected shape"
          >
            Shape
          </button>
        )}
        <button className="ml-auto rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" onClick={() => { setPref('ribbonCollapsed', !collapsed); setPeek(false); }} title={collapsed ? 'Pin the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)'} aria-label="Collapse ribbon">
          <Icon name={collapsed ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
      </div>

      {/* Ribbon body */}
      {showBody && (
        <div
          ref={bodyRef}
          onWheel={(e) => { if (scroll && e.deltaY && bodyRef.current) bodyRef.current.scrollLeft += e.deltaY; }}
          className={`ribbon-body flex h-[90px] items-stretch ${scroll ? 'ribbon-scroll overflow-x-auto overflow-y-hidden' : ''} border-t border-slate-200 bg-white px-1 py-1 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${collapsed ? 'absolute inset-x-0 top-full shadow-lg' : ''}`} onClick={() => collapsed && setTimeout(() => setPeek(false), 0)}>
          {active === 'home' && <HomeTab />}
          {active === 'insert' && <InsertTab />}
          {active === 'design' && <DesignTab />}
          {active === 'data' && <DataTab />}
          {active === 'review' && <ReviewTab />}
          {active === 'view' && <ViewTab />}
          {active === 'shape' && <ShapeTab />}
        </div>
      )}

      {file && (
        <FileView
          onClose={() => setFile(false)}
          onNew={() => { setFile(false); setNaming(''); }}
          onOpen={() => { setFile(false); openRef.current?.click(); }}
          onSave={() => { setFile(false); doc.save(); }}
          onPrint={() => { setFile(false); setPrinting(true); }}
          onExport={(kind) => { setFile(false); ({ pdf: doc.pdf, png: doc.png, svg: doc.svg, csv: doc.csv, vsdx: doc.vsdx, docx: doc.docx, pptx: doc.pptx, selPng: () => doc.selection('png'), selSvg: () => doc.selection('svg'), web: doc.web })[kind](); }}
        />
      )}
      <input ref={openRef} type="file" accept=".json,application/json,.vsdx,.vstx" hidden onChange={(e) => { doc.open(e.target.files?.[0]); e.target.value = ''; }} />
      {printing && <PrintDialog onPrint={(o) => { setPrinting(false); doc.print(o); }} onClose={() => setPrinting(false)} />}
      {naming !== null && <NewClientDialog value={naming} onChange={setNaming} onClose={() => setNaming(null)} />}
    </header>
  );
}

/** File → New: client name and a template (Blank, the built-in starters, or My templates), like Visio's gallery. */
function NewClientDialog({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  const mine = Object.values(useDiagram((s) => s.templates));
  const [pick, setPick] = useState<string>('blank');
  const all = [...BUILT_IN_TEMPLATES, ...mine];
  const create = () => {
    const name = value.trim();
    if (!name) return;
    const t = all.find((x) => x.id === pick);
    if (t) useDiagram.getState().newFromTemplate(name, t);
    else useDiagram.getState().newProject(name);
    onClose();
  };
  const card = (id: string, title: string, sub: string, del?: () => void) => (
    <div key={id} className={`group relative cursor-pointer rounded border p-2 text-left ${pick === id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-blue-300'}`} onClick={() => setPick(id)} onDoubleClick={() => { setPick(id); setTimeout(create, 0); }}>
      <div className="text-sm font-medium text-gray-900">{title}</div>
      <div className="text-[11px] text-gray-500">{sub}</div>
      {del && <button type="button" className="absolute right-1 top-1 hidden rounded px-1 text-xs text-gray-400 hover:text-red-600 group-hover:block" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete the template "${title}"?`)) { del(); if (pick === id) setPick('blank'); } }} aria-label={`Delete template ${title}`}>✕</button>}
    </div>
  );
  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/30 pt-24" onMouseDown={onClose}>
      <form
        className="w-[min(640px,94vw)] rounded-lg bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); create(); }}
      >
        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="nc-client-name">New client</label>
        <input id="nc-client-name" autoFocus className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500" placeholder="Client name"
          value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Start from</div>
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
          {card('blank', 'Blank drawing', 'One empty network page.')}
          {BUILT_IN_TEMPLATES.map((t) => card(t.id, t.name, t.description))}
        </div>
        {mine.length > 0 && (
          <>
            <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">My templates</div>
            <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto">
              {mine.map((t) => card(t.id, t.name, t.description || `${t.project.pages.length} page${t.project.pages.length === 1 ? '' : 's'}`, () => useDiagram.getState().deleteTemplate(t.id)))}
            </div>
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!value.trim()} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create</button>
        </div>
      </form>
    </div>
  );
}

/** The File tab's full-window page (Office "backstage"). */
function FileView({ onClose, onNew, onOpen, onSave, onPrint, onExport }: {
  onClose: () => void; onNew: () => void; onOpen: () => void; onSave: () => void; onPrint: () => void;
  onExport: (kind: 'pdf' | 'png' | 'svg' | 'csv' | 'vsdx' | 'docx' | 'pptx' | 'selPng' | 'selSvg' | 'web') => void;
}) {
  const project = useCurrentProject();
  const restoreRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const item = (icon: string, label: string, run: () => void, danger = false) => (
    <button key={label} className={`flex w-full items-center gap-3 px-5 py-2 text-left text-sm hover:bg-white/15 ${danger ? 'text-red-200' : ''}`} onClick={run}>
      <Icon name={icon} size={18} /> {label}
    </button>
  );
  const exp = (icon: string, title: string, sub: string, kind: 'pdf' | 'png' | 'svg' | 'csv' | 'vsdx' | 'docx' | 'pptx' | 'selPng' | 'selSvg' | 'web') => (
    <button key={kind} className="flex items-start gap-3 rounded border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50" onClick={() => onExport(kind)}>
      <Icon name={icon} size={28} className="shrink-0 text-gray-700" />
      <span><span className="block text-sm font-medium text-gray-900">{title}</span><span className="text-xs text-gray-500">{sub}</span></span>
    </button>
  );
  return (
    <div className="fixed inset-0 z-[1800] flex bg-white" role="dialog" aria-label="File">
      <nav className="flex w-56 shrink-0 flex-col bg-[#3955a3] py-3 text-white">
        <button className="mb-3 flex items-center gap-2 px-5 py-1 text-sm hover:bg-white/15" onClick={onClose}><Icon name="goBack" size={22} /> Back</button>
        {item('new', 'New client…', onNew)}
        {item('open', 'Open… (RackDraw, Visio .vsdx or template .vstx)', onOpen)}
        {item('save', 'Save', onSave)}
        {item('visio', 'Save as Visio drawing…', () => onExport('vsdx'))}
        {item('open', 'Version History…', () => { onClose(); openVersions(); })}
        {item('titleBlock', 'Save as template…', () => void saveTemplate())}
        {item('print', 'Print…', onPrint)}
        <div className="my-2 border-t border-white/20" />
        {item('save', 'Back up everything…', () => void downloadBackup().then((n) => alert(`Backed up ${n} client${n === 1 ? '' : 's'}, your stencils, templates, Version History and price book to one file. Keep it somewhere safe (another drive or the cloud).`)))}
        {item('open', 'Restore from backup…', () => restoreRef.current?.click())}
        <input
          ref={restoreRef} type="file" accept=".json" className="hidden" aria-hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const b = await readBackup(f);
              const n = Object.keys(b.projects).length;
              if (!confirm(`Restore ${n} client${n === 1 ? '' : 's'} from the backup of ${new Date(b.createdAt).toLocaleString()}?

Nothing here is replaced: clients you already have stay as they are, and a client that is already here comes back as a copy named "(restored)".`)) return;
              const r = await restoreBackup(b);
              alert(`Restored ${r.clients} client${r.clients === 1 ? '' : 's'}${r.copies ? ` (${r.copies} as copies)` : ''}, ${r.stencils} stencil${r.stencils === 1 ? '' : 's'} and ${r.templates} template${r.templates === 1 ? '' : 's'}.`);
            } catch (err) {
              alert((err as Error).message);
            }
          }}
        />
        <div className="my-2 border-t border-white/20" />
        {item('delete', 'Delete this client…', () => {
          if (!confirm(`Delete "${project.name}" from this computer?

A copy is downloaded first (${safeName(project.name)}.rackdraw.json), so you can open it again with File → Open. Its Version History is deleted.`)) return;
          saveProjectFile(project);
          useDiagram.getState().deleteProject(project.id);
          onClose();
        }, true)}
      </nav>
      <section className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-1 text-2xl font-light text-gray-900">{project.name}</h1>
        <p className="mb-6 text-sm text-gray-500">{[project.site, project.address].filter(Boolean).join(' · ') || 'Client diagram'} · {project.pages.length} page{project.pages.length === 1 ? '' : 's'}</p>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Export</h2>
        <div className="grid max-w-3xl grid-cols-2 gap-3">
          {exp('visio', 'Visio drawing (.vsdx)', 'Every page as a Visio drawing: devices with their Shape Data, cables, zones, labels and info boxes', 'vsdx')}
          {exp('fullscreen', 'PowerPoint slides (.pptx)', 'A title slide, then one slide per page and per rack, for client reviews', 'pptx')}
          {exp('page', 'Word report (.docx)', 'An editable report: client details, every page, rack elevations and all the tables', 'docx')}
          {exp('pdf', 'PDF report', 'Every page, rack elevations and the device, connection and port tables, with the title block', 'pdf')}
          {exp('image', 'PNG picture of this page', 'For Word documents and email', 'png')}
          {exp('exportFile', 'SVG drawing of this page', 'Scalable vector picture for Office and Visio', 'svg')}
          {exp('image', 'Selection as PNG', 'Only the selected devices and the cables between them, for a ticket or email', 'selPng')}
          {exp('exportFile', 'Selection as SVG', 'The selected items as a scalable picture', 'selSvg')}
          {exp('exportFile', 'Web page (.html)', 'One file anyone can open in a browser: every page, zoom, device details on hover and click, search', 'web')}
          {exp('csv', 'CSV tables', 'Devices, connections, racks and port notes for Excel', 'csv')}
        </div>
        <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Save and share</h2>
        <p className="max-w-3xl text-sm text-gray-600">Save writes a <code>.rackdraw.json</code> file with the whole client (pages, racks, custom shapes) that opens on any computer with RackDraw. Your diagrams are also kept automatically on this computer.</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function HomeTab() {
  const tool = useTool((x) => x.tool);
  const st = useSelectionState();
  const s = useDiagram.getState();
  const autoArrange = useAutoArrange();
  const center = useCanvasCenter();
  const page = useCurrentPage();
  const anyEdge = page.edges.some((e) => e.selected);
  const fmt = s.formatKind();
  const shapeSel = page.nodes.filter((n): n is ShapeNode => !!n.selected && n.type === 'shape');
  // Everything with text of its own: drawing shapes, device labels, zone titles, notes and cable labels.
  const looks = textLooks(page);
  const fmtOn = (k: 'bold' | 'italic' | 'underline' | 'strike') => looks.length > 0 && looks.every((l) => !!l[k]);
  const anyText = looks.length > 0;
  const shadowOn = shapeSel.length > 0 && shapeSel.every((n) => !!n.data.shadow);
  const dirOf = shapeSel[0]?.data.textDir ?? 'across';
  const spacingOf = shapeSel[0]?.data.lineSpacing ?? 1.2;
  const marginOf = shapeSel[0]?.data.textMargin;
  return (
    <>
      <Group label="Clipboard">
        <Big icon="paste" label="Paste" onClick={() => s.paste()} title="Paste (Ctrl+V)" />
        <Column>
          <Small icon="cut" label="Cut" onClick={() => { if (!document.execCommand('cut')) s.cutSelected(); }} disabled={!st.count} title="Cut (Ctrl+X)" />
          <Small icon="copy" label="Copy" onClick={() => { if (!document.execCommand('copy')) s.copySelected(); }} disabled={!st.count} title="Copy (Ctrl+C)" />
          <Small icon="duplicate" label="Duplicate" onClick={s.duplicateSelected} disabled={!st.count} title="Duplicate (Ctrl+D)" />
        </Column>
        <Column>
          <PainterButton disabled={!st.count && !anyEdge} />
          <Small icon="painter" label="Paste format" onClick={() => { if (!s.pasteFormat()) alert('Select the items to paste the format onto.'); }} disabled={!fmt} title={fmt ? `Paste the copied ${fmt} format onto the selection (Ctrl+Shift+V)` : 'Copy a format first'} />
        </Column>
      </Group>
      <Group label="Tools">
        <Column>
          <Small icon="pointer" label="Pointer" active={!tool} onClick={() => setTool(null)} title="Pointer tool: select and move (Esc)" />
          <Small icon="lineTool" label="Line" active={tool === 'line'} onClick={() => setTool(tool === 'line' ? null : 'line')} title="Line tool: drag to draw lines (Shift = straight)" />
          <Small icon="pencil" label="Pencil" active={tool === 'pencil'} onClick={() => setTool(tool === 'pencil' ? null : 'pencil')} title="Pencil tool: drag to draw freehand" />
          <Small icon="lasso" label="Lasso Select" active={tool === 'lasso'} onClick={() => setTool(tool === 'lasso' ? null : 'lasso')} title="Lasso Select: draw a loop round the items to select (Shift adds to the selection)" />
        </Column>
        <Column>
          <Small icon="connector" label="Connector" active={tool === 'connector'} onClick={() => setTool(tool === 'connector' ? null : 'connector')} title="Connector tool (Ctrl+3): drag from one device or shape to another to connect them (nearest free ports)" />
          <Small icon="rectTool" label="Rectangle" active={tool === 'rect'} onClick={() => setTool(tool === 'rect' ? null : 'rect')} title="Rectangle tool (Ctrl+8): drag to draw; Shift for a square" />
          <Small icon="ellipseTool" label="Ellipse" active={tool === 'ellipse'} onClick={() => setTool(tool === 'ellipse' ? null : 'ellipse')} title="Ellipse tool (Ctrl+9): drag to draw; Shift for a circle" />
        </Column>
        <Column>
          <Small icon="text" label="Text" onClick={() => s.addShape('text', center())} title="Add a text box in the middle of the view" />
          <Small icon="dimension" label="Dimension" onClick={() => { const c = center(); s.addMeasure({ x: c.x - 100, y: c.y }); }} title="Add a dimension line" />
          <Small icon="zone" label="Zone" onClick={() => (st.count ? s.wrapInZone() : s.addZone(center()))} title="Add a zone / room; with items selected, the zone goes round them" />
        </Column>
      </Group>
      <Group label="Font">
        <div className="flex flex-col gap-0.5 py-0.5">
        <div className="flex gap-0.5">
          <FontBox disabled={!anyText} value={looks.length && looks.every((l) => (l.fontFamily ?? '') === (looks[0].fontFamily ?? '')) ? looks[0].fontFamily ?? '' : null}
            onPick={(f) => s.styleSelection({ text: { fontFamily: f || undefined } })} />
          <SizeBox disabled={!anyText} value={looks.length && looks.every((l) => l.size === looks[0].size) ? looks[0].size : null}
            onPick={(z) => s.styleSelection({ text: { fontSize: z } })} />
        </div>
        <div className="flex gap-px">
          <FmtBtn label="Bold (Ctrl+B)" active={fmtOn('bold')} disabled={!anyText} onClick={() => s.styleSelection({ text: { bold: !fmtOn('bold') } })}><b>B</b></FmtBtn>
          <FmtBtn label="Italic (Ctrl+I)" active={fmtOn('italic')} disabled={!anyText} onClick={() => s.styleSelection({ text: { italic: !fmtOn('italic') } })}><i className="font-serif">I</i></FmtBtn>
          <FmtBtn label="Underline (Ctrl+U)" active={fmtOn('underline')} disabled={!anyText} onClick={() => s.styleSelection({ text: { underline: !fmtOn('underline') } })}><u>U</u></FmtBtn>
          <FmtBtn label="Strikethrough" active={fmtOn('strike')} disabled={!anyText} onClick={() => s.styleSelection({ text: { strike: !fmtOn('strike') } })}><s>ab</s></FmtBtn>
          <FmtBtn label="Larger text (Ctrl+Shift+>)" disabled={!anyText} onClick={() => s.styleSelection({ text: { sizeDelta: 2 } })}>A<sup>+</sup></FmtBtn>
          <FmtBtn label="Smaller text (Ctrl+Shift+<)" disabled={!anyText} onClick={() => s.styleSelection({ text: { sizeDelta: -2 } })}>A<sup>−</sup></FmtBtn>
          <Drop trigger={(open) => (
            <FmtBtn label="Font Color" disabled={!anyText} onClick={open}>
              <span className="flex flex-col items-center leading-none"><span className="text-[11px] font-semibold">A</span><span className="mt-px h-[3px] w-3.5 rounded-sm" style={{ background: looks[0]?.textColor ?? '#dc2626' }} /></span>
            </FmtBtn>
          )}>
            {(close) => <Swatches auto="Automatic" onPick={(c) => { s.styleSelection({ textColor: c ?? null }); close(); }} />}
          </Drop>
        </div>
        </div>
      </Group>
      <Group label="Paragraph">
        <div className="flex gap-1.5 py-0.5">
        <div className="grid grid-cols-3 content-start gap-px">
          {(['left', 'center', 'right'] as const).map((a) => (
            <FmtBtn key={a} label={`Align ${a}`} active={shapeSel.length > 0 && shapeSel.every((n) => (n.data.align ?? 'center') === a)} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { align: a } })}>
              <AlignGlyph h={a} />
            </FmtBtn>
          ))}
          {(['top', 'middle', 'bottom'] as const).map((v) => (
            <FmtBtn key={v} label={`${v[0].toUpperCase()}${v.slice(1)} of the shape`} active={shapeSel.length > 0 && shapeSel.every((n) => (n.data.valign ?? 'middle') === v)} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { valign: v } })}>
              <AlignGlyph v={v} />
            </FmtBtn>
          ))}
        </div>
        <div className="grid grid-cols-2 content-start gap-px">
          {(['bullet', 'number'] as const).map((l) => {
            const on = shapeSel.length > 0 && shapeSel.every((n) => n.data.list === l);
            return (
              <FmtBtn key={l} label={l === 'bullet' ? 'Bullets' : 'Numbering'} active={on} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { list: on ? null : l } })}>
                <span className="text-[10px] leading-none">{l === 'bullet' ? '•≡' : '1≡'}</span>
              </FmtBtn>
            );
          })}
          <FmtBtn label={`Text direction: ${dirOf === 'down' ? 'reads down' : dirOf === 'up' ? 'reads up' : 'across'} (click to change)`} active={dirOf !== 'across'} disabled={!shapeSel.length}
            onClick={() => s.styleSelection({ text: { textDir: dirOf === 'across' ? 'up' : dirOf === 'up' ? 'down' : 'across' } })}>
            <span className="text-[10px] font-semibold leading-none" style={{ writingMode: dirOf === 'across' ? undefined : 'vertical-rl', transform: dirOf === 'up' ? 'rotate(180deg)' : undefined }}>A↕</span>
          </FmtBtn>
          <Drop width={150} trigger={(open) => (
            <FmtBtn label="Line spacing" disabled={!shapeSel.length} onClick={open}><span className="text-[11px] leading-none">≡↕</span></FmtBtn>
          )}>
            {(close) => (
              <div className="py-1 text-xs">
                {[1, 1.15, 1.5, 2].map((v) => (
                  <button key={v} className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-blue-50 ${spacingOf === v ? 'bg-blue-50' : ''}`} onClick={() => { s.styleSelection({ text: { lineSpacing: v } }); close(); }}>
                    <span>{v.toFixed(v === 1.15 ? 2 : 1)}</span>{spacingOf === v && <span className="text-blue-600">✓</span>}
                  </button>
                ))}
                <div className="mt-1 border-t border-gray-100 px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Text margins</div>
                {([['None', 0], ['Narrow', 3], ['Normal', undefined], ['Wide', 14]] as const).map(([label, m]) => (
                  <button key={label} className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-blue-50 ${marginOf === m ? 'bg-blue-50' : ''}`} onClick={() => { s.styleSelection({ text: { textMargin: m ?? null } }); close(); }}>
                    <span>{label}</span>{marginOf === m && <span className="text-blue-600">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </Drop>
        </div>
        </div>
      </Group>
      <Group label="Shape Style">
        <Column>
          <Drop trigger={(open) => <Small icon="fill" label="Fill ▾" onClick={open} disabled={!st.count} title="Fill colour of the selected shapes" />}>
            {(close) => <><Swatches none onPick={(c) => { s.styleSelection({ fill: c ?? 'transparent' }); close(); }} /><FillOptions close={close} /></>}
          </Drop>
          <Drop trigger={(open) => <Small icon="line" label="Line ▾" onClick={open} disabled={!st.count && !anyEdge} title="Line colour of the selected cables, shapes and zones" />}>
            {(close) => <><Swatches auto="Automatic" onPick={(c) => { s.styleSelection({ line: c ?? null }); close(); }} /><LineOptions close={close} /></>}
          </Drop>
          <Drop width={170} trigger={(open) => <Small icon="weight" label="Weight ▾" onClick={open} disabled={!st.count && !anyEdge} title="Line weight of the selected cables, shapes and lines" />}>
            {(close) => (
              <div className="py-1">
                {[0.5, 1, 1.5, 2, 3, 4.5, 6].map((w) => (
                  <button key={w} className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-blue-50" onClick={() => { s.styleSelection({ weight: w }); close(); }}>
                    <span className="w-10 text-gray-600">{w} px</span>
                    <span className="h-0 flex-1 border-t border-gray-800" style={{ borderTopWidth: w }} />
                  </button>
                ))}
                <button className="w-full px-3 py-1 text-left text-xs text-gray-600 hover:bg-blue-50" onClick={() => { s.styleSelection({ weight: null }); close(); }}>Automatic</button>
              </div>
            )}
          </Drop>
        </Column>
        <Column>
          <QuickStyles disabled={!shapeSel.length} />
          <Small icon="shadow" label="Shadow" active={shadowOn} onClick={() => s.styleSelection({ shadow: !shadowOn })} disabled={!shapeSel.length} title="Drop shadow on the selected shapes" />
        </Column>
      </Group>
      <Group label="Arrange">
        <div className="grid grid-cols-4 content-start gap-px py-0.5">
          {ALIGN.slice(0, 3).map((a) => <AlignBtn key={a.mode} label={a.label} mode={a.mode} disabled={st.movable < 2} onClick={() => s.alignSelected(a.mode)} />)}
          <AlignBtn label="Distribute horizontally" mode="dist-h" disabled={st.movable < 3} onClick={() => s.distributeSelected('h')} />
          {ALIGN.slice(3).map((a) => <AlignBtn key={a.mode} label={a.label} mode={a.mode} disabled={st.movable < 2} onClick={() => s.alignSelected(a.mode)} />)}
          <AlignBtn label="Distribute vertically" mode="dist-v" disabled={st.movable < 3} onClick={() => s.distributeSelected('v')} />
        </div>
        <SpaceMenu disabled={st.movable < 2} />
        <Column>
          <Drop width={190} trigger={(open) => <Small icon="front" label="Bring ▾" onClick={open} disabled={!st.count} title="Bring to Front (Ctrl+Shift+F) or Bring Forward one step" />}>
            {(close) => (
              <div className="py-1 text-xs">
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.orderSelected('front'); close(); }}>Bring to Front <span className="text-gray-400">Ctrl+Shift+F</span></button>
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.orderStep('forward'); close(); }}>Bring Forward</button>
              </div>
            )}
          </Drop>
          <Drop width={190} trigger={(open) => <Small icon="back" label="Send ▾" onClick={open} disabled={!st.count} title="Send to Back (Ctrl+Shift+B) or Send Backward one step" />}>
            {(close) => (
              <div className="py-1 text-xs">
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.orderSelected('back'); close(); }}>Send to Back <span className="text-gray-400">Ctrl+Shift+B</span></button>
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.orderStep('backward'); close(); }}>Send Backward</button>
              </div>
            )}
          </Drop>
          <Small icon="arrange" label="Auto-arrange" onClick={() => autoArrange()} title="Lay out devices top-down by cabling (selection, or whole page)" />
        </Column>
        <Column>
          <Small icon="group" label="Group" onClick={s.groupSelected} disabled={st.count < 2} title="Group (Ctrl+G)" />
          <Small icon="ungroup" label="Ungroup" onClick={s.ungroupSelected} disabled={!st.grouped} title="Ungroup (Ctrl+Shift+G)" />
          {st.locked
            ? <Small icon="unlock" label="Unlock" onClick={() => s.setSelectionLocked(false)} />
            : <Small icon="lock" label="Lock" onClick={() => s.setSelectionLocked(true)} disabled={!st.unlocked} title="Lock position: can't be moved, resized or deleted" />}
        </Column>
        <Column>
          <Small icon="rotateRight" label="Rotate Right" onClick={() => s.rotateSelection(90)} disabled={!st.count} title="Rotate the selection right 90°" />
          <Small icon="rotateLeft" label="Rotate Left" onClick={() => s.rotateSelection(-90)} disabled={!st.count} title="Rotate the selection left 90°" />
          <Drop width={210} trigger={(open) => <Small icon="flipH" label="Flip ▾" onClick={open} disabled={!st.count} title="Flip the selection (mirror it)" />}>
            {(close) => (
              <div className="py-1 text-xs">
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.flipSelection('h'); close(); }}>Flip Horizontal</button>
                <button className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.flipSelection('v'); close(); }}>Flip Vertical</button>
              </div>
            )}
          </Drop>
        </Column>
        <Column>
          <Drop width={230} trigger={(open) => <Small icon="sameSize" label="Size ▾" onClick={open} disabled={st.count < 2} title="Make the selected items the same width, height or size" />}>
            {(close) => (
              <div className="py-1 text-xs">
                {(['largest', 'smallest'] as const).map((like) => (
                  <div key={like}>
                    <div className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Like the {like}</div>
                    {(['width', 'height', 'both'] as const).map((w) => (
                      <button key={w} className="block w-full px-3 py-1 text-left hover:bg-blue-50" onClick={() => { s.sameSize(w, like); close(); }}>
                        {w === 'both' ? 'Same Size' : w === 'width' ? 'Same Width' : 'Same Height'}
                      </button>
                    ))}
                  </div>
                ))}
                <p className="px-3 pt-1 text-[10px] text-gray-400">Devices and pictures keep their proportions.</p>
              </div>
            )}
          </Drop>
          <ProtectionMenu count={st.count} />
        </Column>
      </Group>
      <Group label="Editing">
        <Column>
          <Small icon="find" label="Find" onClick={() => openFind(false)} title="Find (Ctrl+F)" />
          <Small icon="replace" label="Replace" onClick={() => openFind(true)} title="Replace (Ctrl+H)" />
          <Small icon="numbering" label="Number Shapes" onClick={openNumberShapes} title="Number the selected devices or shapes in reading order, e.g. AP-01, AP-02 (like Visio's Number Shapes)" />
          <Drop width={230} trigger={(open) => <Small icon="selectAll" label="Select ▾" onClick={open} title="Select all, or select by type (like Visio)" />}>
            {(close) => {
              const pick = (w: Parameters<typeof s.selectWhere>[0]) => { s.selectWhere(w); close(); };
              const layers = useDiagram.getState().projects[useDiagram.getState().currentId].layers ?? [];
              const btn = (label: string, run: () => void, disabled = false) => (
                <button key={label} disabled={disabled} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-blue-50 disabled:opacity-40" onClick={run}>{label}</button>
              );
              return (
                <div className="py-1">
                  {btn('Select All (Ctrl+A)', () => { s.selectAll(); close(); })}
                  <div className="my-1 border-t border-gray-100" />
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Select by type</div>
                  {btn('Same type as selected', () => pick('same'), !st.count)}
                  {btn('All devices', () => pick('devices'))}
                  {btn('All cables and lines', () => pick('cables'))}
                  {btn('All drawing shapes and notes', () => pick('shapes'))}
                  {btn('All text', () => pick('text'))}
                  {btn('All zones', () => pick('zones'))}
                  {layers.length > 0 && <div className="mt-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">On layer</div>}
                  {layers.map((l) => btn(l.name, () => pick(`layer:${l.id}`)))}
                </div>
              );
            }}
          </Drop>
        </Column>
      </Group>
    </>
  );
}

function FmtBtn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`flex h-[22px] w-[24px] items-center justify-center rounded text-[12px] text-gray-800 hover:bg-blue-50 disabled:opacity-40 ${active ? 'bg-blue-100 ring-1 ring-blue-300' : ''}`} disabled={disabled} onClick={onClick} title={label} aria-label={label} aria-pressed={active}>
      {children}
    </button>
  );
}

/** Lines showing horizontal (h) or vertical (v) text alignment. */
function AlignGlyph({ h, v }: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'middle' | 'bottom' }) {
  if (h) {
    const x = (w: number) => (h === 'left' ? 2 : h === 'right' ? 14 - w : 8 - w / 2);
    return <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>{[12, 8, 12, 6].map((w, i) => <rect key={i} x={x(w)} y={1 + i * 3.3} width={w} height="1.6" fill="#374151" />)}</svg>;
  }
  const y = v === 'top' ? 2 : v === 'bottom' ? 9 : 5.5;
  return <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden><rect x="1" y="0.5" width="14" height="13" fill="none" stroke="#9ca3af" /><rect x="4" y={y} width="8" height="1.6" fill="#374151" /><rect x="5" y={y + 2.4} width="6" height="1.6" fill="#374151" /></svg>;
}

function AlignBtn({ label, mode, disabled, onClick }: { label: string; mode: Parameters<typeof AlignIcon>[0]['mode']; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="flex h-[22px] w-[24px] items-center justify-center rounded hover:bg-blue-50 disabled:opacity-40" disabled={disabled} onClick={onClick} title={label} aria-label={label}>
      <AlignIcon mode={mode} />
    </button>
  );
}

function InsertTab() {
  const s = useDiagram.getState();
  const center = useCanvasCenter();
  const pictureRef = useRef<HTMLInputElement>(null);
  const shapePicRef = useRef<HTMLInputElement>(null);
  const cadRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const project = useCurrentProject();
  const n = project.pages.length + 1;
  const shape = (kind: ShapeKind) => s.addShape(kind, center());
  const rfi = useReactFlow<AppNode>();
  const page = useCurrentPage();
  /** Callout up and to the right of the selected item, pointing at it. */
  const insertCallout = () => {
    const sel = page.nodes.find((n) => n.selected && n.type !== 'backdrop');
    const b = sel && rfi.getInternalNode(sel.id);
    if (sel && b) s.addCallout({ x: b.internals.positionAbsolute.x + (b.measured.width ?? 0) + 40, y: b.internals.positionAbsolute.y - 80 }, sel.id);
    else { const c = center(); s.addCallout({ x: c.x - 80, y: c.y - 28 }); }
  };
  return (
    <>
      <Group label="Pages">
        <Big icon="page" label="New Page" onClick={() => s.addPage(`Network ${n}`, 'network')} title="Add a network diagram page" />
        <Big icon="floorplan" label="Floor Plan" onClick={() => s.addPage(`Floor plan ${n}`, 'floorplan')} title="Add a floor plan page" />
      </Group>
      <Group label="Illustrations">
        <Big icon="picture" label="Picture" onClick={() => shapePicRef.current?.click()} title="A picture on the page: a logo, a photo of the rack, a screenshot (you can also paste with Ctrl+V or drag a file in)" />
        <Column>
          <Small icon="picture" label="Background Picture" onClick={() => pictureRef.current?.click()} title="Put a floor plan or site photo behind this page" />
          <Small icon="dimension" label="CAD Drawing" onClick={() => cadRef.current?.click()} title="A floor plan from AutoCAD (.dxf) behind this page, with its real-world scale (like Visio's Insert CAD Drawing)" />
          <Small icon="floorplan" label="PDF Floor Plan" onClick={() => pdfRef.current?.click()} title="A page of a PDF (an architect's or building owner's plan) behind this page, at its printed size and scale" />
          <Small icon="device" label="Image as Device" onClick={() => paletteAction('import-image')} title="Import a picture and mark its ports" />
          <Small icon="visio" label="Visio Stencil" onClick={() => paletteAction('import-visio')} title="Import shapes from a Visio stencil (.vssx)" />
          <Small icon="library" label="Stencil Library" onClick={() => paletteAction('import-library')} title="Import a .rackdraw-stencils.json library" />
        </Column>
        <input ref={pdfRef} type="file" hidden accept=".pdf,application/pdf" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { await insertPdfBackdrop(f); } catch (err) { alert((err as Error).message); }
        }} />
        <input ref={cadRef} type="file" hidden accept=".dxf,.dwg" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (/\.dwg$/i.test(f.name)) return alert('DWG files cannot be read directly. In AutoCAD (or the free DWG TrueView / ODA File Converter), save the drawing as DXF and insert that.');
          try {
            const r = parseDxf(await f.text());
            const st = useDiagram.getState();
            st.setBackdrop(r.dataUrl, r.width, r.height);
            // The picture was sized to fit the page: carry its real-world scale over to the page (Visio's drawing scale).
            const bd = activePage(useDiagram.getState().projects[st.currentId]).nodes.find((n) => n.type === 'backdrop');
            if (r.scale && bd?.width) st.setPageScale({ perPx: (r.scale.perPx * r.width) / bd.width, unit: r.scale.unit });
            alert(r.scale
              ? `Inserted "${f.name}" (${r.entities} items, drawn in ${r.units}). The page scale is set from it, so dimension lines and cable lengths measure in ${r.scale.unit === 'ft' ? 'feet' : 'metres'}.`
              : `Inserted "${f.name}" (${r.entities} items). The file doesn't say what units it uses: use Design → Set Scale on a known length (a door is about 3 ft / 0.9 m).`);
          } catch (err) {
            alert((err as Error).message);
          }
        }} />
        <input ref={shapePicRef} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/*" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void insertPictureFile(f, center());
        }} />
        <input ref={pictureRef} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.svg,image/*" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { const img = await loadImageFile(f); s.setBackdrop(img.dataUrl, img.width, img.height); } catch (err) { alert((err as Error).message); }
        }} />
      </Group>
      <Group label="Shapes">
        <Column>
          <Small icon="text" label="Text" onClick={() => shape('text')} />
          <Small icon="shapes" label="Box" onClick={() => shape('rect')} />
          <Small icon="shapes" label="Rounded" onClick={() => shape('rounded')} />
        </Column>
        <Column>
          <Small icon="shapes" label="Ellipse" onClick={() => shape('ellipse')} />
          <Small icon="shapes" label="Diamond" onClick={() => shape('diamond')} />
          <Small icon="dimension" label="Arrow" onClick={() => shape('arrow')} />
        </Column>
      </Group>
      <Group label="Floor Plan">
        <Column>
          <Small icon="line" label="Wall" onClick={() => { const c = center(); s.addMeasure({ x: c.x - 150, y: c.y }, 'wall'); }} title="A wall; drag its ends" />
          <Small icon="page" label="Door" onClick={() => shape('door')} />
          <Small icon="grid" label="Window" onClick={() => shape('window')} />
        </Column>
        <Column>
          <Small icon="dimension" label="Wall Lengths" onClick={() => { const pg = activePage(useDiagram.getState().projects[useDiagram.getState().currentId]); const walls = pg.nodes.filter((n) => n.type === 'measure' && n.data.variant === 'wall'); const pick = walls.some((w) => w.selected) ? walls.filter((w) => w.selected) : walls; const on = !pick.every((w) => w.type === 'measure' && w.data.showLength); if (!s.setWallLengths(on)) alert('There are no walls on this page yet.'); else if (!pg.scale) alert('Wall lengths show once the page has a drawing scale (Design → Drawing Scale).'); }} title="Show or hide the real length beside the selected walls (or every wall on the page)" />
          <Small icon="zone" label="Convert to Walls" onClick={() => { if (!s.convertToWalls()) alert('Select the rooms (zones) or rectangles to turn into walls first.'); }} title="Walls round the selected zones and rectangles (rectangles are replaced; zones stay as rooms), like Visio's Convert to Walls" />
        </Column>
      </Group>
      <Group label="Tables">
        <TablePicker at={center} />
      </Group>
      <Group label="Diagram Parts">
        <Big icon="zone" label="Zone" onClick={() => { const sel = activePage(useDiagram.getState().projects[useDiagram.getState().currentId]).nodes.some((n) => n.selected && n.type !== 'backdrop'); if (sel) s.wrapInZone(); else s.addZone(center()); }} title="A room, rack or area outline; with items selected, it goes round them (like Visio's container from selection)" />
        <Big icon="note" label="Note" onClick={() => s.addNote(center())} />
        <OffPageMenu at={center} />
        <Big icon="info" label="Callout" onClick={() => insertCallout()} title="A callout pointing at the selected item (or a free one)" />
        <Big icon="dimension" label="Dimension" onClick={() => { const c = center(); s.addMeasure({ x: c.x - 100, y: c.y }); }} title="Dimension line (uses the page scale)" />
      </Group>
      <Group label="Text">
        <div className="flex items-start pt-1">
          <Drop width={230} trigger={(open) => <Big icon="text" label="Field" onClick={open} title="Put a live value (client, date, page…) into the selected text box, or a new one" />}>
            {(close) => (
              <div className="py-1">
                {HF_CODES.map((c) => (
                  <button key={c.code} className="flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs hover:bg-blue-50" onClick={() => { insertField(c.code); close(); }}>
                    <span>{c.label}</span><span className="font-mono text-[10px] text-gray-400">{c.code}</span>
                  </button>
                ))}
                <p className="px-3 pt-1 text-[10px] text-gray-400">Shows the current value; double-click the text to see the codes.</p>
              </div>
            )}
          </Drop>
        </div>
        <div className="flex items-start pt-1">
          <Drop width={268} trigger={(open) => <Big icon="symbol" label="Symbol" onClick={open} title="Insert a symbol (°, ±, Ω, µ, arrows, ✓…) into the selected text box or shape" />}>
            {(close) => (
              <div className="p-2">
                {SYMBOLS.map((g) => (
                  <div key={g.group} className="mb-1.5">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-gray-400">{g.group}</div>
                    <div className="grid grid-cols-10 gap-0.5">
                      {g.chars.map((c) => (
                        <button key={c} className="h-6 rounded border border-gray-200 text-sm hover:border-blue-400 hover:bg-blue-50" title={`U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}
                          onClick={() => { if (!insertSymbol(c)) alert('Select a text box or drawing shape first.'); else close(); }}>{c}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-gray-400">Goes where the cursor was when you last edited the text, or at the end.</p>
              </div>
            )}
          </Drop>
        </div>
        <Big icon="screenTip" label="ScreenTip" onClick={() => editScreenTip()} title="Text shown when you hover the selected items" />
        <Big icon="text" label="Alt Text" onClick={() => editAltText()} title="A description of the selected items for screen readers and exports (like Visio's Alt Text)" />
      </Group>
    </>
  );
}

/** Data → Data Graphics: which fields show as tags or icons on every device of the client. */
function DataGraphicsMenu() {
  const project = useCurrentProject();
  const s = useDiagram.getState();
  const list = project.display?.dataGraphics ?? [];
  const fields = reportFields(project).filter((f) => !['page', 'rack', 'connections', 'documentedPorts', 'notes', 'link'].includes(f.key));
  const [field, setField] = useState('model');
  const [style, setStyle] = useState<'tag' | 'icon'>('tag');
  const save = (next: typeof list) => s.setDisplay({ dataGraphics: next.length ? next : undefined });
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k.replace(/^x:/, '');
  return (
    <div className="flex items-start pt-1">
      <Drop width={280} trigger={(open, isOpen) => <Big icon="dataGraphics" label="Data Graphics" onClick={open} active={isOpen || list.length > 0} title="Show fields as tags or icons on every device (like Visio's Data Graphics)" />}>
        {() => (
          <div className="p-2 text-xs">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">On every device</div>
            {list.length === 0 && <p className="mb-2 text-gray-400">Nothing yet. Pick a field below, e.g. Firmware as a tag, or Under contract as an icon.</p>}
            <ul className="mb-2 space-y-1">
              {list.map((g, i) => (
                <li key={`${g.field}${i}`} className="flex items-center gap-1">
                  <span className="flex-1 truncate">{label(g.field)}</span>
                  <select className="rounded border border-gray-300 px-1 py-0.5" value={g.style} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, style: e.target.value as 'tag' | 'icon' } : x)))}>
                    <option value="tag">Text tag</option><option value="icon">Icon</option>
                  </select>
                  <button className="px-1 text-gray-400 hover:text-red-600" onClick={() => save(list.filter((_, j) => j !== i))} aria-label={`Remove ${label(g.field)}`}>×</button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-1 border-t border-gray-100 pt-2">
              <select className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5" value={field} onChange={(e) => setField(e.target.value)}>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select className="rounded border border-gray-300 px-1 py-0.5" value={style} onChange={(e) => setStyle(e.target.value as 'tag' | 'icon')}>
                <option value="tag">Text tag</option><option value="icon">Icon</option>
              </select>
              <button className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700" onClick={() => save([...list.filter((g) => g.field !== field), { field, style }])}>Add</button>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">Icons: ✔ / ✘ for Yes / No values, a coloured dot for Status; other values show as text. They print and export with the diagram.</p>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** File → Save as template: the current client's drawing becomes a starting point in File → New. */
async function saveTemplate() {
  const st = useDiagram.getState();
  const p = st.projects[st.currentId];
  const name = (await askText('Save as template\nName it, e.g. "Standard branch office". Client details (site, address, contact) are left out.', `${p.name} template`))?.trim();
  if (!name) return;
  const description = (await askText('Description (optional)', '')) ?? '';
  st.saveAsTemplate(name, description.trim());
  alert(`Saved. Choose "${name}" under File → New client.`);
}

/** Fill ▾: transparency and gradient for the selected drawing shapes (Visio's Format Shape → Fill). */
function FillOptions({ close }: { close: () => void }) {
  const s = useDiagram.getState();
  const sel = useCurrentPage().nodes.find((n) => n.selected && n.type === 'shape');
  const d = sel?.type === 'shape' ? sel.data : undefined;
  return (
    <div className="mt-2 border-t border-gray-100 pt-1 text-xs">
      <div className="px-1 pb-1 text-[11px] text-gray-500">Transparency</div>
      <div className="flex gap-1 px-1">
        {[0, 25, 50, 75].map((t) => (
          <button key={t} className={`flex-1 rounded border px-1 py-0.5 ${(d?.fillTransparency ?? 0) === t ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
            onClick={() => { s.styleSelection({ format: { fillTransparency: t || undefined } }); close(); }}>{t}%</button>
        ))}
      </div>
      <button className="mt-1 w-full rounded px-1 py-1 text-left hover:bg-blue-50" onClick={() => { s.styleSelection({ format: { gradient: !d?.gradient || undefined } }); close(); }}>
        {d?.gradient ? '✓ ' : ''}Gradient fill
      </button>
    </div>
  );
}

/** Line ▾: dash patterns for the selected shapes and lines. */
function LineOptions({ close }: { close: () => void }) {
  const s = useDiagram.getState();
  const pats: { value: LinePattern; label: string }[] = [{ value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dash' }, { value: 'dot', label: 'Dot' }, { value: 'dashdot', label: 'Dash-dot' }];
  return (
    <div className="mt-2 border-t border-gray-100 pt-1 text-xs">
      {pats.map((p) => (
        <button key={p.value} className="flex w-full items-center gap-2 rounded px-1 py-1 hover:bg-blue-50" onClick={() => { s.styleSelection({ format: { linePattern: p.value } }); close(); }}>
          <span className="w-14 text-left text-gray-600">{p.label}</span>
          <svg className="flex-1" height="6"><line x1="2" y1="3" x2="200" y2="3" stroke="#1f2937" strokeWidth="2" {...dashFor(p.value, 2)} /></svg>
        </button>
      ))}
    </div>
  );
}

/** Insert → Off-page Reference: pick the page it leads to (or a new one); its partner appears there. */
function OffPageMenu({ at }: { at: () => { x: number; y: number } }) {
  const project = useCurrentProject();
  const others = project.pages.filter((p) => p.id !== project.activePageId && !p.background);
  const add = (target: { pageId: string } | { newName: string }) => useDiagram.getState().addOffPageRef(at(), target);
  return (
    <div className="flex items-start pt-1">
      <Drop width={220} trigger={(open) => <Big icon="offpage" label="Off-page Ref" onClick={open} title="A pair of shapes linking this page and another, like Visio's Off-page Reference (double-click one to jump to the other)" />}>
        {(close) => (
          <div className="py-1 text-xs">
            <div className="px-3 pb-1 text-[11px] text-gray-500">Leads to</div>
            {others.map((p) => (
              <button key={p.id} className="block w-full truncate px-3 py-1 text-left hover:bg-blue-50" onClick={() => { add({ pageId: p.id }); close(); }}>{p.name}</button>
            ))}
            <button className="mt-1 block w-full border-t border-gray-100 px-3 py-1.5 text-left text-blue-700 hover:bg-blue-50" onClick={async () => {
              close();
              const name = await askText('New page\nThe off-page reference leads to a new page with this name.', `Page ${project.pages.length + 1}`);
              if (name !== null) add({ newName: name });
            }}>New page…</button>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** Insert → Table: pick the size on a grid (like Office), or a ready-made network table. */
function TablePicker({ at }: { at: () => { x: number; y: number } }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const page = useCurrentPage();
  const add = (cells: string[][]) => useDiagram.getState().addTable(at(), cells);
  const devices = page.nodes.filter((n) => n.type === 'device');
  return (
    <div className="flex items-start pt-1">
      <Drop width={232} trigger={(open) => <Big icon="table" label="Table" onClick={open} title="A table on the page, e.g. VLANs, circuits or an IP plan" />}>
        {(close) => (
          <div className="p-2 text-xs">
            <div className="mb-1 text-gray-600">{hover[0] ? `${hover[1]} × ${hover[0]} table` : 'Insert Table'}</div>
            <div className="grid grid-cols-8 gap-[3px]" onMouseLeave={() => setHover([0, 0])}>
              {Array.from({ length: 64 }, (_, i) => {
                const r = Math.floor(i / 8) + 1, c = (i % 8) + 1;
                const on = r <= hover[0] && c <= hover[1];
                return <button key={i} aria-label={`${c} by ${r}`} className={`h-[22px] w-[22px] border ${on ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white'}`}
                  onMouseEnter={() => setHover([r, c])} onClick={() => { add(makeTable(r, c)); close(); }} />;
              })}
            </div>
            <div className="mt-2 border-t border-gray-100 pt-1">
              {TABLE_PRESETS.map((p) => (
                <button key={p.id} className="block w-full rounded px-2 py-1 text-left hover:bg-blue-50" onClick={() => { add(p.cells()); close(); }}>{p.label}</button>
              ))}
              <button className="block w-full rounded px-2 py-1 text-left hover:bg-blue-50 disabled:opacity-40" disabled={!devices.length} title="A snapshot of this page's devices (it doesn't update)"
                onClick={() => {
                  add([['Device', 'Model', 'IP', 'Location'], ...devices.map((n) => (n.type === 'device' ? [n.data.name ?? '', n.data.model ?? '', n.data.ip ?? '', n.data.location ?? ''] : []))]);
                  close();
                }}>IP plan from this page&apos;s devices</button>
            </div>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** Contextual Picture group: Crop (how much of each side to cut off) and Reset. */
function PictureGroup({ node }: { node: ShapeNode }) {
  const s = useDiagram.getState();
  const c = node.data.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const side = (k: 'l' | 't' | 'r' | 'b', label: string) => {
    const other = k === 'l' ? c.r : k === 'r' ? c.l : k === 't' ? c.b : c.t;
    return (
      <label key={k} className="flex items-center gap-2">
        <span className="w-12 text-gray-600">{label}</span>
        <input type="range" min={0} max={Math.round((0.9 - other) * 100)} value={Math.round(c[k] * 100)} className="flex-1"
          onPointerDown={() => s.snapshot()} onKeyDown={() => s.snapshot()}
          onChange={(e) => s.cropPicture(node.id, { ...c, [k]: Number(e.target.value) / 100 })} />
        <span className="w-8 text-right text-gray-500">{Math.round(c[k] * 100)}%</span>
      </label>
    );
  };
  return (
    <Group label="Picture">
      <div className="flex items-start pt-1">
        <Drop width={250} trigger={(open, isOpen) => <Big icon="crop" label="Crop" onClick={open} active={isOpen || !!node.data.crop} title="Cut off the edges of the picture (like Visio's Crop tool)" />}>
          {() => (
            <div className="space-y-1.5 p-2 text-xs">
              {side('l', 'Left')}{side('t', 'Top')}{side('r', 'Right')}{side('b', 'Bottom')}
              <p className="text-[10px] text-gray-400">The picture keeps its size; only the cut-off part goes. Reset brings it all back.</p>
            </div>
          )}
        </Drop>
      </div>
      <Column>
        <Small icon="undo" label="Reset Picture" disabled={!node.data.crop} onClick={() => { s.snapshot(); s.cropPicture(node.id, null); }} title="Undo the crop" />
      </Column>
    </Group>
  );
}

const ZONE_STYLES: { value: ZoneStyle; label: string }[] = [
  { value: 'dashed', label: 'Dashed outline' }, { value: 'solid', label: 'Solid outline' }, { value: 'header', label: 'Heading band' },
  { value: 'band', label: 'Side band' }, { value: 'filled', label: 'Filled' },
];

/** Contextual Container group for a zone (Visio's Container tab): style gallery, Fit to Contents, Select Contents. */
function ContainerGroup({ node }: { node: ZoneNode }) {
  const s = useDiagram.getState();
  const cur = node.data.style ?? 'dashed';
  const c = node.data.color;
  return (
    <Group label="Container">
      <div className="flex items-start pt-1">
        <Drop width={230} trigger={(open, isOpen) => <Big icon="zone" label="Container Style" onClick={open} active={isOpen} title="How the zone is drawn (like Visio's container styles)" />}>
          {(close) => (
            <div className="grid grid-cols-2 gap-1.5 p-2 text-[11px]">
              {ZONE_STYLES.map((z) => (
                <button key={z.value} className={`rounded border p-1 text-left hover:border-blue-400 ${cur === z.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                  onClick={() => { s.snapshot(); s.updateNodeData(node.id, { style: z.value === 'dashed' ? undefined : z.value }); close(); }}>
                  <span className={`mb-1 flex h-9 overflow-hidden rounded-sm border-2 ${z.value === 'dashed' ? 'border-dashed' : ''}`} style={{ borderColor: c, background: `${c}${z.value === 'filled' ? '30' : '12'}` }}>
                    {z.value === 'header' && <span className="h-2.5 w-full" style={{ background: c }} />}
                    {z.value === 'band' && <span className="h-full w-2.5" style={{ background: c }} />}
                  </span>
                  {z.label}
                </button>
              ))}
            </div>
          )}
        </Drop>
      </div>
      <Column>
        <Small icon="zone" label="Fit to Contents" onClick={() => s.fitZoneToContents(node.id)} title="Resize the zone round what it holds" />
        <Small icon="selectAll" label="Select Contents" onClick={() => s.selectZoneContents(node.id)} title="Select everything inside the zone" />
        <Check label="Show Area" checked={!!node.data.showArea} onChange={(v) => { s.snapshot(); s.updateNodeData(node.id, { showArea: v || undefined }); }} title="Show the room's floor area after its title (set a drawing scale first), like Visio's space shapes" />
      </Column>
    </Group>
  );
}

const CALLOUT_STYLES: { value: CalloutStyle; label: string }[] = [
  { value: 'box', label: 'Box' }, { value: 'rounded', label: 'Rounded' }, { value: 'oval', label: 'Oval' }, { value: 'line', label: 'Line (underline)' },
];

/** Contextual Callout group: the callout's look. */
function CalloutGroup({ node }: { node: ShapeNode }) {
  const s = useDiagram.getState();
  const cur = node.data.calloutStyle ?? 'box';
  return (
    <Group label="Callout">
      <div className="flex items-start pt-1">
        <Drop width={190} trigger={(open, isOpen) => <Big icon="info" label="Callout Style" onClick={open} active={isOpen} title="Box, rounded, oval or a plain underline (like Visio's callout styles)" />}>
          {(close) => (
            <div className="py-1 text-xs">
              {CALLOUT_STYLES.map((c) => (
                <button key={c.value} className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-blue-50 ${cur === c.value ? 'bg-blue-50' : ''}`}
                  onClick={() => { s.snapshot(); s.updateNodeData(node.id, { calloutStyle: c.value === 'box' ? undefined : c.value }); close(); }}>
                  <svg width="34" height="18" className="shrink-0">
                    {c.value === 'oval' ? <ellipse cx="17" cy="9" rx="15" ry="7.5" fill="#fef3c7" stroke="#d97706" />
                      : c.value === 'line' ? <line x1="2" y1="16" x2="32" y2="16" stroke="#d97706" strokeWidth="1.5" />
                      : <rect x="2" y="2" width="30" height="14" rx={c.value === 'rounded' ? 7 : 2} fill="#fef3c7" stroke="#d97706" />}
                  </svg>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </Drop>
      </div>
    </Group>
  );
}

/** Contextual Table group: rows and columns at the cell last clicked. */
function TableGroup({ node }: { node: ShapeNode }) {
  const s = useDiagram.getState();
  const cells = node.data.cells?.length ? node.data.cells : [['']];
  const run = (fn: (t: string[][], r: number, c: number) => string[][], grow?: 'w' | 'h' | '-w' | '-h') => {
    const { r, c } = activeCell(node.id, cells);
    const next = fn(cells, r, c);
    if (next === cells) return;
    const nc = Math.max(1, ...cells.map((x) => x.length));
    const w = node.width ?? node.measured?.width ?? 300, h = node.height ?? node.measured?.height ?? 100;
    // Keep the rows and columns the same size: the table grows or shrinks by one of them.
    const nw = grow === 'w' ? w + w / nc : grow === '-w' ? w - w / nc : w;
    const nh = grow === 'h' ? h + h / cells.length : grow === '-h' ? h - h / cells.length : h;
    s.snapshot();
    s.updateNodeData(node.id, { cells: next });
    s.setNodeBox(node.id, node.position, Math.round(nw), Math.round(nh));
  };
  return (
    <Group label="Table">
      <Column>
        <Small icon="table" label="Row Above" onClick={() => run((t, r) => insertRow(t, r), 'h')} />
        <Small icon="table" label="Row Below" onClick={() => run((t, r) => insertRow(t, r + 1), 'h')} />
        <Small icon="delete" label="Delete Row" onClick={() => run((t, r) => deleteRow(t, r), '-h')} disabled={cells.length < 2} />
      </Column>
      <Column>
        <Small icon="table" label="Column Left" onClick={() => run((t, _r, c) => insertCol(t, c), 'w')} />
        <Small icon="table" label="Column Right" onClick={() => run((t, _r, c) => insertCol(t, c + 1), 'w')} />
        <Small icon="delete" label="Delete Column" onClick={() => run((t, _r, c) => deleteCol(t, c), '-w')} disabled={Math.max(...cells.map((x) => x.length)) < 2} />
      </Column>
      <Column>
        <Check label="Header Row" checked={!!node.data.headerRow} onChange={(v) => { s.snapshot(); s.updateNodeData(node.id, { headerRow: v || undefined }); }} />
      </Column>
    </Group>
  );
}

/** Insert → Field: adds a field code to the selected text box / shape, or a new text box with it. */
function insertField(code: string) {
  const st = useDiagram.getState();
  const pg = activePage(st.projects[st.currentId]);
  const shape = pg.nodes.find((n) => n.selected && n.type === 'shape' && n.data.kind !== 'table' && n.data.kind !== 'image');
  if (shape && shape.type === 'shape') {
    st.snapshot();
    st.updateNodeData(shape.id, { text: shape.data.text ? `${shape.data.text} ${code}` : code });
    return;
  }
  st.addShape('text', { x: 200, y: 120 });
  const made = activePage(useDiagram.getState().projects[st.currentId]).nodes.at(-1);
  if (made?.type === 'shape') st.updateNodeData(made.id, { text: code });
}

/** Insert → ScreenTip: asks for the hover text of the selected items. */
/** Alt Text (Visio's Format Shape → Alt Text): a description of the selected items for screen readers. */
export async function editAltText() {
  const st = useDiagram.getState();
  const pg = activePage(st.projects[st.currentId]);
  const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
  if (!sel.length) return alert('Select the item(s) to describe first.');
  const first = sel[0].type !== 'backdrop' ? sel[0].data.alt ?? '' : '';
  const alt = await askText('Alt Text\nDescribe the item for someone who cannot see the drawing (screen readers, accessible exports). Leave empty to use its name. (Ctrl+Enter = OK)', first, { multiline: true });
  if (alt !== null) st.setAltOnSelection(alt);
}

export async function editScreenTip() {
  const st = useDiagram.getState();
  const pg = activePage(st.projects[st.currentId]);
  const sel = pg.nodes.filter((n) => n.selected && n.type !== 'backdrop');
  if (!sel.length) return alert('Select the item(s) to add a ScreenTip to first.');
  const first = sel[0].type !== 'backdrop' ? sel[0].data.tip ?? '' : '';
  const tip = await askText('ScreenTip\nShown when the pointer rests on the item. Leave empty to remove it. (Ctrl+Enter = OK)', first, { multiline: true });
  if (tip !== null) st.setTipOnSelection(tip);
}

const DEVICE_COLOR: { value: DeviceColorBy; label: string }[] = [
  { value: 'none', label: 'No colour' }, { value: 'status', label: 'Status' }, { value: 'location', label: 'Location' }, { value: 'model', label: 'Model' }, { value: 'layer', label: 'Layer' }, { value: 'warranty', label: 'Warranty' },
];

/** Mixes a colour with white: amount 0 = the colour, 1 = white. */
const tint = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};

/** Home → Shape Style → Quick Styles (Visio): ready-made fill / line / text combinations in the theme's colours. */
function QuickStyles({ disabled }: { disabled: boolean }) {
  const project = useCurrentProject();
  const colors = (themeById(project.theme) ?? THEMES[0]).zones.slice(0, 6);
  const s = useDiagram.getState();
  const STYLES = [
    { name: 'Subtle', make: (c: string) => ({ fill: tint(c, 0.85), line: c, textColor: '#111827' }) },
    { name: 'Light', make: (c: string) => ({ fill: tint(c, 0.6), line: c, textColor: '#111827' }) },
    { name: 'Moderate', make: (c: string) => ({ fill: tint(c, 0.25), line: c, textColor: '#ffffff' }) },
    { name: 'Intense', make: (c: string) => ({ fill: c, line: c, textColor: '#ffffff' }) },
    { name: 'Outline', make: (c: string) => ({ fill: '#ffffff', line: c, textColor: c }) },
  ];
  return (
    <Drop width={236} trigger={(open) => <Small icon="fill" label="Quick Styles ▾" onClick={open} disabled={disabled} title="Ready-made fill, line and text colours for the selected shapes" />}>
      {(close) => (
        <div className="p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quick Styles</div>
          <div className="grid grid-cols-6 gap-1">
            {STYLES.flatMap((st) => colors.map((c) => {
              const v = st.make(c);
              return (
                <button key={`${st.name}${c}`} title={`${st.name}`} className="flex h-7 items-center justify-center rounded border-2 text-[11px] font-semibold hover:scale-110"
                  style={{ background: v.fill, borderColor: v.line, color: v.textColor }}
                  onClick={() => { s.styleSelection({ fill: v.fill, line: v.line, textColor: v.textColor }); close(); }}
                >Abc</button>
              );
            }))}
          </div>
          <p className="mt-1.5 text-[10px] text-gray-400">Colours follow Design → Themes.</p>
        </div>
      )}
    </Drop>
  );
}

/**
 * Format Painter like Office / Visio: click, then click the item to paint (its format and text look); double-click to
 * keep painting several items, Esc (or clicking it again) to stop.
 */
function PainterButton({ disabled }: { disabled: boolean }) {
  const painter = usePainter();
  const start = (sticky: boolean) => {
    if (painter.on && !sticky) return setPainter(false);
    if (!useDiagram.getState().copyFormat()) return alert('Select one item to copy its format from.');
    setPainter(true, sticky);
  };
  return (
    <span onDoubleClick={() => start(true)}>
      <Small icon="painter" label={painter.on ? (painter.sticky ? 'Painting… (Esc)' : 'Click an item') : 'Format Painter'} active={painter.on} disabled={disabled && !painter.on}
        onClick={() => start(false)} title="Format Painter (Ctrl+Shift+C): copy the selected item's format, then click the item to paint. Double-click to paint several; Esc to stop." />
    </span>
  );
}

const PAGE_COLORS = ['#ffffff', '#f8fafc', '#f1f5f9', '#fefce8', '#fdf6e3', '#eff6ff', '#ecfdf5', '#fdf2f8', '#f5f3ff', '#e5e7eb'];
const FRAME_COLORS = ['#1e3a8a', '#0f766e', '#334155', '#7c2d12', '#6d28d9', '#b91c1c', '#000000'];

/** Design → Backgrounds (page colour) and Borders & Titles (frame / title banner), for the whole client. */
function PageLookMenus() {
  const project = useCurrentProject();
  const d = project.display;
  const set = (patch: Partial<NonNullable<typeof d>>) => { useDiagram.getState().snapshot(); useDiagram.getState().setDisplay(patch); };
  const frame = d?.frame ?? 'none';
  return (
    <>
      <div className="flex items-start pt-1">
        <Drop width={196} trigger={(open, isOpen) => <Big icon="page" label="Page Color" onClick={open} active={isOpen || !!(d?.pageColor && d.pageColor !== '#ffffff')} title="Background colour of the drawing page (prints and pictures too)" />}>
          {(close) => (
            <div className="grid grid-cols-5 gap-1 p-2">
              {PAGE_COLORS.map((c) => (
                <button key={c} className={`h-7 rounded border ${(d?.pageColor ?? '#ffffff') === c ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-300'}`} style={{ background: c }} title={c === '#ffffff' ? 'White (none)' : c} aria-label={c}
                  onClick={() => { set({ pageColor: c === '#ffffff' ? undefined : c }); close(); }} />
              ))}
            </div>
          )}
        </Drop>
      </div>
      <div className="flex items-start pt-1">
        <Drop width={236} trigger={(open, isOpen) => <Big icon="titleBlock" label="Borders & Titles" onClick={open} active={isOpen || frame !== 'none'} title="A frame round the page, or a title banner with the page name and client (like Visio's Borders & Titles)" />}>
          {(close) => (
            <div className="p-2 text-xs">
              {([['none', 'None'], ['simple', 'Simple frame'], ['banner', 'Title banner']] as const).map(([v, label]) => (
                <button key={v} className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-blue-50 ${frame === v ? 'bg-blue-50' : ''}`} onClick={() => { set({ frame: v === 'none' ? undefined : v }); close(); }}>
                  <span className="relative h-7 w-10 shrink-0 rounded-sm border border-gray-300 bg-white">
                    {v === 'simple' && <span className="absolute inset-[3px] border" style={{ borderColor: d?.frameColor ?? '#1e3a8a' }} />}
                    {v === 'banner' && <span className="absolute inset-x-0 top-0 h-2" style={{ background: d?.frameColor ?? '#1e3a8a' }} />}
                  </span>
                  {label}
                </button>
              ))}
              <div className="mt-1 border-t border-gray-100 pt-1.5 text-[10px] uppercase tracking-wide text-gray-400">Colour</div>
              <div className="mt-1 flex gap-1">
                {FRAME_COLORS.map((c) => (
                  <button key={c} className={`h-5 w-5 rounded-sm border ${(d?.frameColor ?? '#1e3a8a') === c ? 'ring-2 ring-blue-400' : 'border-gray-300'}`} style={{ background: c }} aria-label={c} onClick={() => set({ frameColor: c === '#1e3a8a' ? undefined : c })} />
                ))}
              </div>
            </div>
          )}
        </Drop>
      </div>
    </>
  );
}

/** Arrange → Space Shapes (Visio): an exact gap between neighbouring selected items. */
function SpaceMenu({ disabled }: { disabled: boolean }) {
  const [gap, setGap] = useState(40);
  const s = useDiagram.getState();
  return (
    <div className="flex items-start pt-0.5">
      <Drop width={210} trigger={(open) => <FmtBtn label="Space Shapes: an exact gap between the selected items" disabled={disabled} onClick={open}><span className="text-[11px] leading-none">|↔|</span></FmtBtn>}>
        {(close) => (
          <div className="space-y-2 p-2 text-xs">
            <label className="flex items-center gap-2">Gap
              <input type="number" min={0} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} /> px
            </label>
            <div className="flex gap-1">
              <button className="flex-1 rounded border border-gray-300 px-2 py-1 hover:bg-blue-50" onClick={() => { s.spaceSelected('h', gap); close(); }}>Side by side</button>
              <button className="flex-1 rounded border border-gray-300 px-2 py-1 hover:bg-blue-50" onClick={() => { s.spaceSelected('v', gap); close(); }}>Stacked</button>
            </div>
            <p className="text-[10px] text-gray-400">The first item stays put; the others line up after it with this gap.</p>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** Arrange → Protection (Visio's shape protection): lock text, make items unselectable, and undo that for the page. */
function ProtectionMenu({ count }: { count: number }) {
  const s = useDiagram.getState();
  const page = useCurrentPage();
  const sel = page.nodes.filter((n) => n.selected && n.type !== 'backdrop');
  const textOn = sel.length > 0 && sel.every((n) => n.type !== 'backdrop' && !!n.data.lockText);
  const protectedCount = page.nodes.filter((n) => n.type !== 'backdrop' && n.data.noSelect).length;
  return (
    <Drop width={250} trigger={(open) => <Small icon="lock" label="Protection ▾" onClick={open} title="Protect the selection: lock its text, or stop it being selected (like Visio's shape protection)" />}>
      {(close) => (
        <div className="py-1 text-xs">
          <button className="block w-full px-3 py-1 text-left hover:bg-blue-50 disabled:opacity-40" disabled={!count} onClick={() => { s.setProtection({ lockText: !textOn }); close(); }}>
            {textOn ? '✓ ' : ''}Lock text <span className="text-gray-400">(no editing on the drawing)</span>
          </button>
          <button className="block w-full px-3 py-1 text-left hover:bg-blue-50 disabled:opacity-40" disabled={!count} onClick={() => { s.setProtection({ noSelect: true }); close(); }}>
            Make unselectable <span className="text-gray-400">(clicks go through)</span>
          </button>
          <button className="mt-1 block w-full border-t border-gray-100 px-3 py-1.5 text-left hover:bg-blue-50 disabled:opacity-40" disabled={!protectedCount} onClick={() => { s.allowSelectAll(); close(); }}>
            Allow selecting all{protectedCount ? ` (${protectedCount} on this page)` : ''}
          </button>
          <p className="px-3 pt-1 text-[10px] text-gray-400">Lock (beside Group) stops moving, resizing and deleting.</p>
        </div>
      )}
    </Drop>
  );
}

/** Design → Fonts (Visio's theme fonts): one font for all the client's text that has no font of its own. */
function FontsMenu() {
  const project = useCurrentProject();
  const cur = project.display?.font;
  const pick = (f?: string) => { useDiagram.getState().snapshot(); useDiagram.getState().setDisplay({ font: f }); };
  return (
    <div className="flex items-start pt-1">
      <Drop width={240} trigger={(open, isOpen) => <Big icon="text" label="Fonts" onClick={open} active={isOpen || !!cur} title="One font for the whole client's diagram: labels, shapes, zones, notes and cables (like Visio's theme fonts)" />}>
        {(close) => (
          <div className="max-h-80 overflow-y-auto py-1">
            {[undefined, ...FONTS].map((f) => (
              <button key={f ?? 'default'} className={`flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-blue-50 ${cur === f ? 'bg-blue-50' : ''}`} onClick={() => { pick(f); close(); }}>
                <span className="w-8 text-xl leading-none" style={{ fontFamily: f }}>Aa</span>
                <span className="text-xs" style={{ fontFamily: f }}>{f ?? 'App default (Segoe UI)'}</span>
                {cur === f && <span className="ml-auto text-blue-600">✓</span>}
              </button>
            ))}
            <p className="px-3 pt-1 text-[10px] text-gray-400">Items with their own font (Home → Font) keep it. Prints, PDFs, pictures and Visio exports use it too.</p>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** The font settings of everything selected that has text (for showing the current font, size and B/I/U). */
function textLooks(page: Page) {
  const out: { fontFamily?: string; textColor?: string; size: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }[] = [];
  for (const n of page.nodes) {
    if (!n.selected) continue;
    if (n.type === 'shape') out.push({ ...n.data, size: n.data.fontSize });
    else if (n.type === 'device' || n.type === 'zone' || n.type === 'note') out.push({ ...n.data, size: n.data.fontSize ?? TEXT_DEFAULT_SIZE[n.type] });
  }
  for (const e of page.edges) if (e.selected) out.push({ ...(e.data ?? {}), size: e.data?.fontSize ?? TEXT_DEFAULT_SIZE.cable });
  return out;
}

const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

/** Font size box: pick from the list or type any size (6–144) and press Enter, like Office. */
function SizeBox({ value, disabled, onPick }: { value: number | null; disabled: boolean; onPick: (z: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = (v: string) => {
    const z = Math.round(Number(v));
    if (z >= 6 && z <= 144 && z !== value) onPick(z);
    setText(null);
  };
  return (
    <>
      <input list="nc-font-sizes" className="h-[22px] w-12 rounded border border-gray-300 bg-white px-1 text-[11px] disabled:opacity-40" disabled={disabled} title="Font size (type a size and press Enter)" aria-label="Font size"
        value={text ?? (value ?? '')} placeholder={disabled ? '' : '—'}
        onChange={(e) => {
          const v = e.target.value;
          // Picked from the list: apply at once. Typed: wait for Enter / leaving the box.
          if ((e.nativeEvent as InputEvent).inputType === undefined || (e.nativeEvent as InputEvent).inputType === 'insertReplacementText') commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } if (e.key === 'Escape') setText(null); }}
        onBlur={(e) => { if (text !== null) commit(e.target.value); }} />
      <datalist id="nc-font-sizes">{SIZES.map((z) => <option key={z} value={z} />)}</datalist>
    </>
  );
}

/** The fonts installed on this computer (Chromium's Local Font Access), loaded once when the font box is first used. */
let localFonts: string[] | null = null;
async function loadLocalFonts(): Promise<string[]> {
  if (localFonts) return localFonts;
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    localFonts = q ? [...new Set((await q()).map((f) => f.family))].sort((a, b) => a.localeCompare(b)) : [];
  } catch {
    localFonts = [];
  }
  return localFonts;
}

/** Font box: the common fonts, plus every font installed on this computer; type a name and press Enter for others. */
function FontBox({ value, disabled, onPick }: { value: string | null; disabled: boolean; onPick: (f: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const all = [...new Set([...FONTS, ...installed])];
  const commit = (v: string) => {
    const f = v.trim();
    const match = f === '' || f === '(Default)' ? '' : all.find((x) => x.toLowerCase() === f.toLowerCase()) ?? f;
    if (match !== (value ?? '')) onPick(match);
    setText(null);
  };
  return (
    <>
      <input list="nc-fonts" className="h-[22px] w-32 rounded border border-gray-300 bg-white px-1 text-[11px] disabled:opacity-40" disabled={disabled} title="Font (pick one, or type a font name and press Enter)" aria-label="Font"
        value={text ?? (value === null ? '' : value || '(Default)')} placeholder={disabled ? '' : '—'}
        style={{ fontFamily: value || undefined }}
        onFocus={() => { void loadLocalFonts().then((f) => { if (f.length) setInstalled(f); }); }}
        onChange={(e) => {
          const v = e.target.value;
          if ((e.nativeEvent as InputEvent).inputType === undefined || (e.nativeEvent as InputEvent).inputType === 'insertReplacementText') commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } if (e.key === 'Escape') setText(null); }}
        onBlur={(e) => { if (text !== null) commit(e.target.value); }} />
      <datalist id="nc-fonts">
        <option value="(Default)" />
        {all.map((f) => <option key={f} value={f} />)}
      </datalist>
    </>
  );
}

const FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

const LAYOUTS: { kind: LayoutKind; label: string; sub: string; glyph: string }[] = [
  { kind: 'top-down', label: 'Top to bottom', sub: 'ISP at the top, endpoints at the bottom', glyph: 'M10 2v4M10 6 4 11M10 6l6 5M4 11v3M16 11v3' },
  { kind: 'left-right', label: 'Left to right', sub: 'Layers in columns', glyph: 'M2 10h4M6 10l5-6M6 10l5 6M11 4h3M11 16h3' },
  { kind: 'compact', label: 'Compact tree', sub: 'What hangs off each device, listed below it', glyph: 'M3 3h5M5 3v14M5 8h4M5 12h4M5 16h4' },
  { kind: 'radial', label: 'Radial', sub: 'Core in the middle, rings outward', glyph: 'M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 2v4M10 14v4M2 10h4M14 10h4' },
  { kind: 'circular', label: 'Circular', sub: 'Every device on one ring', glyph: 'M10 2a8 8 0 1 0 0.01 0' },
];

/** Design → Re-Layout Page (Visio): lay the selection (or the whole page) out in one of several styles. */
function ReLayoutPage() {
  const arrange = useAutoArrange();
  const [spacing, setSpacing] = useState(1);
  return (
    <div className="flex items-start pt-1">
      <Drop width={250} trigger={(open, isOpen) => <Big icon="arrange" label="Re-Layout Page" onClick={open} active={isOpen} title="Lay out devices by how they are cabled (the selection, or the whole page)" />}>
        {(close) => (
          <div className="p-1 text-xs">
            {LAYOUTS.map((l) => (
              <button key={l.kind} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-blue-50" onClick={() => { arrange(l.kind, spacing); close(); }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-gray-700"><path d={l.glyph} /></svg>
                <span><span className="block font-medium text-gray-900">{l.label}</span><span className="text-[10px] text-gray-500">{l.sub}</span></span>
              </button>
            ))}
            <label className="mt-1 flex items-center gap-2 border-t border-gray-100 px-2 pt-2 text-gray-600">
              Spacing
              <select className="rounded border border-gray-300 px-1 py-0.5" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))}>
                <option value={0.6}>Tight</option><option value={1}>Normal</option><option value={1.6}>Wide</option>
              </select>
            </label>
            <p className="px-2 pt-1 text-[10px] text-gray-400">Devices under one switch are put in the order of the ports they use, so their cables don&apos;t cross. Undo with Ctrl+Z.</p>
          </div>
        )}
      </Drop>
    </div>
  );
}

/** Design → Themes: a row of theme swatches; click applies to this page, the menu applies to every page. */
function ThemeGallery() {
  const project = useCurrentProject();
  const { applyTheme } = useDiagram.getState();
  const swatch = (t: Theme, big: boolean) => (
    <span className={`grid ${big ? 'h-9 w-12' : 'h-6 w-8'} grid-cols-3 overflow-hidden rounded border`} style={{ borderColor: t.line, background: t.fill }}>
      <span className="col-span-3" style={{ background: t.zones[0], opacity: 0.85 }} />
      <span style={{ background: t.zones[1] }} /><span style={{ background: t.calloutLine }} /><span style={{ background: t.zones[2] }} />
    </span>
  );
  return (
    <div className="flex items-center gap-1 pt-1">
      {THEMES.slice(0, 4).map((t) => (
        <button key={t.id} className={`flex flex-col items-center rounded p-0.5 text-[10px] hover:bg-blue-50 ${project.theme === t.id ? 'bg-blue-100' : ''}`} title={`${t.name}: apply to this page`} onClick={() => applyTheme(t.id, false)}>
          {swatch(t, true)}
          <span>{t.name}</span>
        </button>
      ))}
      <Drop width={260} trigger={(open, isOpen) => <button className={`self-stretch rounded px-1 text-xs text-gray-600 hover:bg-gray-100 ${isOpen ? 'bg-gray-100' : ''}`} onClick={open} title="All themes">▾</button>}>
        {(close) => (
          <div className="p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Themes</div>
            <div className="grid grid-cols-3 gap-1">
              {THEMES.map((t) => (
                <button key={t.id} className={`flex flex-col items-center rounded p-1 text-[11px] hover:bg-blue-50 ${project.theme === t.id ? 'bg-blue-100' : ''}`} onClick={() => { applyTheme(t.id, false); close(); }}>
                  {swatch(t, true)}
                  {t.name}
                </button>
              ))}
            </div>
            <div className="mt-2 border-t border-gray-100 pt-1.5 text-[11px] text-gray-500">Apply to every page:</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {THEMES.map((t) => (
                <button key={t.id} className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] hover:bg-gray-50" onClick={() => { applyTheme(t.id, true); close(); }}>{t.name}</button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-400">Recolours drawing shapes, callouts and zones; new ones use the theme. Devices and cables keep their colours.</p>
          </div>
        )}
      </Drop>
    </div>
  );
}

function DesignTab() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const s = useDiagram.getState();
  const d = project.display ?? DEFAULT_DISPLAY;
  const tb = project.titleBlock;
  const page = useCurrentPage();
  const setup = page.setup ?? DEFAULT_SETUP;
  const unitsPref = usePref('units');
  const sel = 'rounded border border-gray-300 bg-white px-1 py-0 text-[11px]';
  return (
    <>
      <Group label="Page Setup">
        <Column>
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]">Size
            <select className={sel} value={setup.paper} onChange={(e) => s.setPageSetup({ ...setup, paper: e.target.value as PaperSize })}>
              {(Object.keys(PAPER) as PaperSize[]).map((k) => <option key={k} value={k}>{PAPER[k].label}</option>)}
            </select>
          </label>
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]" title="Measurement units for the rulers, Size & Position and the status bar">Units
            <select className={sel} value={unitsPref} onChange={(e) => setPref('units', e.target.value as typeof unitsPref)}>
              <option value="auto">Automatic</option><option value="in">Inches</option><option value="cm">Centimetres</option><option value="px">Pixels</option>
            </select>
          </label>
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]">Orientation
            <select className={sel} value={setup.landscape ? 'l' : 'p'} onChange={(e) => s.setPageSetup({ ...setup, landscape: e.target.value === 'l' })}>
              <option value="l">Landscape</option>
              <option value="p">Portrait</option>
            </select>
          </label>
        </Column>
        <Big icon="center" label="Center Drawing" onClick={() => centerDrawing(rf)} title="Move the whole drawing to the middle of its page" />
        <div className="flex items-start pt-1">
          <Drop width={230} trigger={(open, isOpen) => <Big icon="scale" label="Drawing Scale" onClick={open} active={isOpen || !!page.scale} title="The page's drawing scale: measure it from two points, or pick a standard scale (like Visio's Page Setup)" />}>
            {(close) => (
              <div className="py-1 text-xs">
                <button className="block w-full px-3 py-1.5 text-left font-medium text-blue-700 hover:bg-blue-50" onClick={() => { close(); window.dispatchEvent(new Event(SET_SCALE_EVENT)); }}>Measure two points…</button>
                <div className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Architectural</div>
                <div className="grid grid-cols-2">
                  {SCALE_PRESETS.filter((x) => x.scale.unit === 'ft').map((x) => (
                    <button key={x.label} className={`px-3 py-1 text-left hover:bg-blue-50 ${page.scale && Math.abs(page.scale.perPx - x.scale.perPx) < 1e-9 ? 'bg-blue-50 font-medium' : ''}`} onClick={() => { s.setPageScale(x.scale); close(); }}>{x.label}</button>
                  ))}
                </div>
                <div className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Metric</div>
                <div className="grid grid-cols-3">
                  {SCALE_PRESETS.filter((x) => x.scale.unit === 'm').map((x) => (
                    <button key={x.label} className={`px-3 py-1 text-left hover:bg-blue-50 ${page.scale && Math.abs(page.scale.perPx - x.scale.perPx) < 1e-12 ? 'bg-blue-50 font-medium' : ''}`} onClick={() => { s.setPageScale(x.scale); close(); }}>{x.label}</button>
                  ))}
                </div>
                <button className="mt-1 block w-full border-t border-gray-100 px-3 py-1.5 text-left hover:bg-blue-50 disabled:opacity-40" disabled={!page.scale} onClick={() => { s.setPageScale(null); close(); }}>No scale</button>
              </div>
            )}
          </Drop>
        </div>
        <Big icon="titleBlock" label="Title Block" active={!!tb?.show} onClick={() => s.updateTitleBlock({ show: !tb?.show })} title="Title block on every printed / PDF sheet (edit it in the panel with nothing selected)" />
      </Group>
      <Group label="Layout">
        <ReLayoutPage />
      </Group>
      <Group label="Themes">
        <ThemeGallery />
        <FontsMenu />
      </Group>
      <Group label="Backgrounds">
        <PageLookMenus />
      </Group>
      <Group label="Connectors">
        <Column>
          <Check label="Line jumps" checked={d.lineJumps !== false} onChange={(v) => s.setDisplay({ lineJumps: v })} title="Cables hop where they cross" />
          <Drop width={200} trigger={(open) => <Small icon="connector" label="Jump Style ▾" onClick={open} disabled={d.lineJumps === false} title="How cables hop where they cross (like Visio's line jump style)" />}>
            {(close) => (
              <div className="py-1 text-xs">
                {(['arc', 'gap', 'square'] as const).map((j) => (
                  <button key={j} className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-blue-50 ${(d.jumpStyle ?? 'arc') === j ? 'bg-blue-50' : ''}`} onClick={() => { s.setDisplay({ jumpStyle: j }); close(); }}>
                    <svg width="44" height="14" className="shrink-0"><path d={j === 'gap' ? 'M2 9 H16 M28 9 H42' : j === 'square' ? 'M2 9 H16 V3 H28 V9 H42' : 'M2 9 H16 A6 6 0 0 1 28 9 H42'} fill="none" stroke="#1f2937" strokeWidth="1.5" /><path d="M22 1 V13" stroke="#9ca3af" strokeWidth="1.5" /></svg>
                    <span className="capitalize">{j}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-gray-100 px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-gray-400">Size</div>
                {([['Small', 3.5], ['Medium', 5], ['Large', 8]] as const).map(([label, v]) => (
                  <button key={label} className={`block w-full px-3 py-1 text-left hover:bg-blue-50 ${(d.jumpSize ?? 5) === v ? 'bg-blue-50' : ''}`} onClick={() => { s.setDisplay({ jumpSize: v }); close(); }}>{label}</button>
                ))}
              </div>
            )}
          </Drop>
          <Drop width={190} trigger={(open) => <Small icon="lineTool" label="Corners ▾" onClick={open} title="Corners of right-angle cables: square or rounded" />}>
            {(close) => (
              <div className="py-1 text-xs">
                {([['Square', 0], ['Rounded', 8], ['Very rounded', 18]] as const).map(([label, v]) => (
                  <button key={label} className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-blue-50 ${(d.cableCorners ?? 8) === v ? 'bg-blue-50' : ''}`} onClick={() => { s.setDisplay({ cableCorners: v }); close(); }}>
                    <svg width="22" height="16" className="shrink-0"><path d={v ? `M2 14 V${2 + v / 2} Q2 2 ${2 + v / 2} 2 H20` : 'M2 14 V2 H20'} fill="none" stroke="#1f2937" strokeWidth="1.5" /></svg>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Drop>
        </Column>
      </Group>
      <Group label="Data Graphics">
        <Column>
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]">Devices by
            <select className={sel} value={d.deviceColor} onChange={(e) => s.setDisplay({ deviceColor: e.target.value as DeviceColorBy })}>
              {DEVICE_COLOR.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]">Cables by
            <select className={sel} value={d.cableColor} onChange={(e) => s.setDisplay({ cableColor: e.target.value as CableColorBy })}>
              <option value="type">Cable type</option>
              <option value="vlan">VLAN</option>
            </select>
          </label>
          <Check label="Legend" checked={d.showLegend} onChange={(v) => s.setDisplay({ showLegend: v })} />
        </Column>
      </Group>
      <Group label="Info Boxes">
        <Column>
          <Small icon="info" label="Show on all devices" onClick={() => s.mapAllDevices((x) => ({ infoBox: { ...x.infoBox, show: true } }))} />
          <Small icon="close" label="Hide on all devices" onClick={() => s.mapAllDevices((x) => (x.infoBox ? { infoBox: { ...x.infoBox, show: false } } : {}))} />
        </Column>
      </Group>
    </>
  );
}

function DataTab() {
  const propsPane = usePref('propsPane');
  const table = usePref('deviceTable');
  const quick = usePref('quickInfo');
  const [reports, setReports] = useState(false);
  const [bom, setBom] = useState(false);
  const [ipPlan, setIpPlan] = useState(false);
  const [lifecycle, setLifecycle] = useState(false);
  const [labels, setLabels] = useState(false);
  const [defining, setDefining] = useState(false);
  return (
    <>
      {reports && <ReportDialog onClose={() => setReports(false)} />}
      {bom && <BomDialog onClose={() => setBom(false)} />}
      {ipPlan && <IpPlanDialog onClose={() => setIpPlan(false)} />}
      {lifecycle && <LifecycleDialog onClose={() => setLifecycle(false)} />}
      {labels && <LabelsDialog onClose={() => setLabels(false)} />}
      {defining && <DefineShapeDataDialog onClose={() => setDefining(false)} />}
      <Group label="Show/Hide">
        <Big icon="panes" label="Shape Data" active={propsPane} onClick={() => setPref('propsPane', !propsPane)} title="Show or hide the Shape Data pane" />
        <Big icon="defineData" label="Define Shape Data" onClick={() => setDefining(true)} title="Fields every device of this client has: text, number, date, pick list, yes/no; required fields" />
        <Column>
          <Check label="Quick info on hover" checked={quick} onChange={(v) => setPref('quickInfo', v)} />
        </Column>
      </Group>
      <Group label="Device Table">
        <Big icon="table" label="Device Table" active={table} onClick={() => setPref('deviceTable', !table)} title="Every device as an editable spreadsheet under the drawing: type in cells, sort, filter, go to a device" />
      </Group>
      <Group label="External Data">
        <DataMenu />
      </Group>
      <Group label="Layers & Colours">
        <ViewMenu label="Layers" />
      </Group>
      <Group label="Data Graphics">
        <DataGraphicsMenu />
      </Group>
      <Group label="Planning">
        <Big icon="ipPlan" label="IP Plan" onClick={() => setIpPlan(true)} title="VLANs and subnets of this client: gateway, DHCP range, how full each subnet is, the next free IP, and every device IP checked against them" />
        <Big icon="lifecycle" label="Lifecycle" onClick={() => setLifecycle(true)} title="Warranties and end-of-life dates (what to renew or replace in the next 90 days), and the client's ISP / carrier circuits with their monthly cost" />
      </Group>
      <Group label="Reports">
        <Big icon="excel" label="Reports" onClick={() => setReports(true)} title="Device reports with the fields you pick, to Excel, Word or CSV (like Visio's Report wizard)" />
        <Big icon="label" label="Labels" onClick={() => setLabels(true)} title="Print cable labels (both ends), asset labels with a QR code, and patch panel port strips on Avery sheets" />
        <Big icon="csv" label="Bill of Materials" onClick={() => setBom(true)} title="What to order: equipment by model, cable runs and patch cords by length, transceivers, jacks, racks and accessories, circuits; and free ports per switch" />
      </Group>
      <Group label="Validate">
        <Big icon="check" label="Check Diagram" onClick={() => window.dispatchEvent(new Event(OPEN_CHECK_EVENT))} title="Find duplicate IPs, unconnected uplinks, missing details…" />
      </Group>
    </>
  );
}

function ReviewTab() {
  const page = useCurrentPage();
  const hasSel = page.nodes.some((n) => n.selected && n.type !== 'backdrop');
  return (
    <>
      <Group label="Proofing">
        <Big icon="check" label="Check Diagram" onClick={() => window.dispatchEvent(new Event(OPEN_CHECK_EVENT))} />
      </Group>
      <Group label="Comments">
        <Big icon="note" label="New Comment" onClick={() => openComments(true)} title="Comment on the selected item" disabled={!hasSel} />
        <Big icon="panes" label="Comments" onClick={() => openComments(false)} title="Show every comment in this client" />
      </Group>
      <Group label="Find">
        <Big icon="find" label="Find" onClick={() => openFind(false)} title="Find (Ctrl+F)" />
        <Big icon="replace" label="Replace" onClick={() => openFind(true)} title="Replace (Ctrl+H)" />
      </Group>
    </>
  );
}

function ViewTab() {
  const rf = useReactFlow<AppNode>();
  const view = useDiagram((s) => s.view);
  const setView = useDiagram((s) => s.setView);
  const project = useCurrentProject();
  const minimap = usePref('minimap');
  const shapes = usePref('shapesPane');
  const table = usePref('deviceTable');
  const props = usePref('propsPane');
  const quick = usePref('quickInfo');
  const rulers = usePref('rulers');
  const dynamicGrid = usePref('dynamicGrid');
  const snapGrid = usePref('snapToGrid');
  const gridSizePref = usePref('gridSize') || 20;
  const navPane = usePref('navPane');
  const grid = usePref('grid');
  const breaks = usePref('pageBreaks');
  const d = project.display ?? DEFAULT_DISPLAY;
  const diagram = view === 'diagram';
  return (
    <>
      <Group label="Views">
        <Big icon="keyboard" label="Shortcuts" onClick={() => window.dispatchEvent(new Event(SHORTCUTS_EVENT))} title="Keyboard shortcuts (F1)" />
        <Big icon="fullscreen" label="Full Screen" onClick={() => { setView('diagram'); setPresenting(true); }} title="Show the drawing alone, page by page (F5); arrow keys change page, Esc ends" />
        <Big icon="diagram" label="Diagram" active={diagram} onClick={() => setView('diagram')} />
        <Big icon="racks" label={`Racks${project.racks?.length ? ` (${project.racks.length})` : ''}`} active={!diagram} onClick={() => setView('racks')} />
        <Big
          icon="racks" label="Rack from Diagram"
          title="Mount this page's rack equipment (firewall, patch panels, switches, servers, UPS) in a new rack, laid out like a real one; its cables show as patch cords"
          onClick={() => { if (!useDiagram.getState().buildRackFromDiagram()) alert('Nothing to mount: this page has no rack-mountable devices that aren\'t already in a rack.'); }}
        />
      </Group>
      <Group label="Zoom">
        <Big icon="fit" label="Fit Page" onClick={() => rf.fitView({ padding: 0.2, duration: 200 })} disabled={!diagram} title="Fit the whole page in the window" />
        <Column>
          <Small icon="zoomIn" label="Zoom In" onClick={() => rf.zoomIn({ duration: 150 })} disabled={!diagram} />
          <Small icon="zoomOut" label="Zoom Out" onClick={() => rf.zoomOut({ duration: 150 })} disabled={!diagram} />
          <Small icon="hundred" label="100%" onClick={() => rf.zoomTo(1, { duration: 150 })} disabled={!diagram} />
          <Small icon="find" label="Selection" onClick={() => { const ids = rf.getNodes().filter((n) => n.selected).map((n) => ({ id: n.id })); if (ids.length) void rf.fitView({ nodes: ids, padding: 0.4, maxZoom: 2, duration: 200 }); }} disabled={!diagram} title="Zoom to the selected items" />
        </Column>
      </Group>
      <Group label="Show">
        <Column>
          <Check label="Rulers" checked={rulers} onChange={(v) => setPref('rulers', v)} />
          <Check label="Grid" checked={grid} onChange={(v) => setPref('grid', v)} />
          <Check label="Page Breaks" checked={breaks} onChange={(v) => setPref('pageBreaks', v)} />
        </Column>
        <Column>
          <Check label="Pan & Zoom" checked={minimap} onChange={(v) => setPref('minimap', v)} />
          <Check label="Legend" checked={d.showLegend} onChange={(v) => useDiagram.getState().setDisplay({ showLegend: v })} />
          <Check label="Dynamic grid" checked={dynamicGrid} onChange={(v) => setPref('dynamicGrid', v)} title="While dragging, snap into line with other shapes and show guides" />
        </Column>
        <Column>
          <Check label="Snap to grid" checked={snapGrid} onChange={(v) => setPref('snapToGrid', v)} title="Moved items land on the grid (every half square)" />
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]" title="Grid spacing (like Visio's Ruler & Grid): snapping follows it">Grid
            <select className="rounded border border-gray-300 bg-white px-1 py-0 text-[11px]" value={gridSizePref} onChange={(e) => setPref('gridSize', Number(e.target.value))}>
              <option value={10}>Fine</option><option value={20}>Normal</option><option value={40}>Coarse</option>
            </select>
          </label>
          <Check label="Navigation" checked={navPane} onChange={(v) => setPref('navPane', v)} title="Pages and everything on them; click to go to an item (like Visio's Drawing Explorer)" />
          <Check label="Quick info" checked={quick} onChange={(v) => setPref('quickInfo', v)} />
        </Column>
      </Group>
      <Group label="Task Panes">
        <Column>
          <Check label="Shapes" checked={shapes} onChange={(v) => setPref('shapesPane', v)} />
          <Check label="Shape Data" checked={props} onChange={(v) => setPref('propsPane', v)} />
          <Check label="Device Table" checked={table} onChange={(v) => setPref('deviceTable', v)} title="Every device as an editable spreadsheet under the drawing (like Visio's External Data window)" />
        </Column>
      </Group>
    </>
  );
}

/** Contextual tab for the selection (Visio "Shape Format"). */
function ShapeTab() {
  const page = useCurrentPage();
  const s = useDiagram.getState();
  const st = useSelectionState();
  const node = page.nodes.find((n) => n.selected && n.type !== 'backdrop');
  const device = node?.type === 'device' ? node : undefined;
  const stencil = device ? getStencil(device.data.stencilId) : undefined;
  return (
    <>
      {device && (
        <Group label="Device">
          <Big icon="edit" label="Edit Shape" onClick={() => stencil && editStencil(stencil.id, device.id)} disabled={!stencil} title="Edit the shape's picture and ports (double-click a device)" />
          <Big icon="info" label="Info Box" active={!!device.data.infoBox?.show} onClick={() => s.mapDevices([device.id], (x) => ({ infoBox: { ...x.infoBox, show: !x.infoBox?.show } }))} title="Show or hide the info box beside the device" />
          <Big icon="changeShape" label="Change Shape" onClick={openChangeShape} title="Swap the picture for another shape, keeping the device's details and cables (like Visio's Change Shape)" />
        </Group>
      )}
      {node?.type === 'shape' && node.data.kind === 'table' && <TableGroup node={node} />}
      {node?.type === 'shape' && node.data.kind === 'image' && <PictureGroup node={node} />}
      {node?.type === 'zone' && <ContainerGroup node={node} />}
      {node?.type === 'shape' && node.data.kind === 'callout' && <CalloutGroup node={node} />}
      {page.nodes.filter((n) => n.selected && n.type === 'shape').length >= 2 && (
        <Group label="Operations">
          <div className="flex items-start pt-1">
            <Drop width={250} trigger={(open) => <Big icon="group" label="Operations" onClick={open} title="Union, Combine, Intersect or Subtract the selected drawing shapes (like Visio's shape operations)" />}>
              {(close) => (
                <div className="py-1 text-xs">
                  {([['union', 'Union', 'One outline round them all'], ['combine', 'Combine', 'One shape; where they overlap becomes a hole'], ['intersect', 'Intersect', 'Only where they all overlap'], ['subtract', 'Subtract', 'The first selected, with the others cut out']] as const).map(([op, label, sub]) => (
                    <button key={op} className="block w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => {
                      close();
                      const r = s.shapeOperation(op);
                      if (r === 0) alert('Select two or more drawing shapes (rectangles, ellipses, diamonds, arrows, freehand shapes).');
                      else if (r === -1) alert('Nothing is left: the shapes do not overlap.');
                    }}>
                      <b className="font-medium">{label}</b><span className="block text-[10px] text-gray-500">{sub}</span>
                    </button>
                  ))}
                  <p className="px-3 pt-1 text-[10px] text-gray-400">The result takes the first shape&apos;s fill and line. Undo with Ctrl+Z.</p>
                </div>
              )}
            </Drop>
          </div>
        </Group>
      )}
      {!device && node?.type === 'shape' && node.data.kind !== 'table' && (
        <Group label="Shape">
          <div className="flex items-start pt-1">
            <Drop width={180} trigger={(open) => <Big icon="changeShape" label="Change Shape" onClick={open} title="Turn the selected drawing shapes into another kind" />}>
              {(close) => (
                <div className="py-1">
                  {(['rect', 'rounded', 'ellipse', 'diamond', 'text', 'arrow', 'callout'] as const).map((k) => (
                    <button key={k} className="block w-full px-3 py-1 text-left text-xs capitalize hover:bg-blue-50" onClick={() => { s.changeShapeKind(k); close(); }}>
                      {k === 'rect' ? 'Rectangle' : k === 'rounded' ? 'Rounded rectangle' : k}
                    </button>
                  ))}
                </div>
              )}
            </Drop>
          </div>
        </Group>
      )}
      <Group label="Style">
        <Column>
          <Drop trigger={(open) => <Small icon="fill" label="Fill ▾" onClick={open} disabled={!st.count} />}>
            {(close) => <><Swatches none onPick={(c) => { s.styleSelection({ fill: c ?? 'transparent' }); close(); }} /><FillOptions close={close} /></>}
          </Drop>
          <Drop trigger={(open) => <Small icon="line" label="Line ▾" onClick={open} />}>
            {(close) => <><Swatches auto="Automatic" onPick={(c) => { s.styleSelection({ line: c ?? null }); close(); }} /><LineOptions close={close} /></>}
          </Drop>
        </Column>
      </Group>
      <Group label="Arrange">
        <Column>
          <Small icon="front" label="Bring to Front" onClick={() => s.orderSelected('front')} disabled={!st.count} />
          <Small icon="back" label="Send to Back" onClick={() => s.orderSelected('back')} disabled={!st.count} />
          {st.locked ? <Small icon="unlock" label="Unlock" onClick={() => s.setSelectionLocked(false)} /> : <Small icon="lock" label="Lock" onClick={() => s.setSelectionLocked(true)} disabled={!st.unlocked} />}
        </Column>
        <Column>
          <Small icon="rotateRight" label="Rotate Right" onClick={() => s.rotateSelection(90)} disabled={!st.count} />
          <Small icon="rotateLeft" label="Rotate Left" onClick={() => s.rotateSelection(-90)} disabled={!st.count} />
        </Column>
      </Group>
      <Group label="Delete">
        <Big icon="delete" label="Delete" onClick={s.deleteSelected} title="Delete the selection (Del)" />
      </Group>
    </>
  );
}
