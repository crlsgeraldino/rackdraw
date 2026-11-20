'use client';

import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_DISPLAY } from '@/lib/display';
import { DEFAULT_SETUP, PAPER, type PaperSize } from '@/lib/pageSetup';
import { openFind, paletteAction } from '@/lib/events';
import { downloadBlob, exportCsv, exportImage, exportPdf, readProjectFile, renderCanvasPng, safeName, saveProjectFile, type PageRenderer } from '@/lib/export';
import { exportVsdx } from '@/lib/visio/vsdxExport';
import { exportWordReport } from '@/lib/wordReport';
import { ReportDialog } from '../ReportDialog';
import { askText } from '../PromptHost';
import { reportFields } from '@/lib/report';
import type { LayoutKind } from '@/lib/autolayout';
import { BUILT_IN_TEMPLATES } from '@/lib/templates';
import { DefineShapeDataDialog } from '../DefineShapeDataDialog';
import { THEMES, type Theme } from '@/lib/themes';
import { setPresenting, setTool, useTool } from '@/lib/tools';
import { importVsdx } from '@/lib/visio/vsdxImport';
import { loadImageFile } from '@/lib/imageImport';
import { setPref, usePref } from '@/lib/prefs';
import { printProject, type PrintOptions } from '@/lib/print';
import { activePage, allNodes } from '@/lib/project';
import { SET_SCALE_EVENT } from '@/lib/units';
import type { AppNode, CableColorBy, DeviceColorBy, Page, ShapeKind, ShapeNode } from '@/lib/types';
import { getStencil, useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
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

function useDocument() {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const [busy, setBusy] = useState(false);

  /**
   * What to capture: the nodes (by id, so React Flow uses its live measurements rather than sizes saved in the
   * diagram), widened to take in device labels, info boxes and dimension lines that sit outside their node box.
   */
  const contentBounds = (ids: string[]) => {
    const b = rf.getNodesBounds(ids);
    let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.width, b.y + b.height];
    document.querySelectorAll('.react-flow__viewport .nc-infobox, .react-flow__viewport .nc-device-label, .react-flow__viewport .nc-measure *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const a = rf.screenToFlowPosition({ x: r.left, y: r.top }, { snapToGrid: false });
      const z = rf.screenToFlowPosition({ x: r.right, y: r.bottom }, { snapToGrid: false });
      [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, z.x), Math.max(y1, z.y)];
    });
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

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
    docx: () => run(async () => {
      try {
        const bytes = await exportWordReport(project, renderPage);
        downloadBlob(`${safeName(project.name)}.docx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
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
        if (/\.vsdx$/i.test(f.name)) {
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

  // Installed app: open .netcraft.json files double-clicked in Explorer (File Handling API).
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

  return (
    <header className="relative z-40 shrink-0 select-none border-b border-gray-300 bg-white" onMouseLeave={() => collapsed && setPeek(false)}>
      {/* Title bar with the Quick Access Toolbar */}
      <div className="flex h-8 items-center gap-1 bg-[#3955a3] px-2 text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6.5h4.5V14" /></svg>
        <button className={qat} onClick={doc.save} title="Save to a file (.netcraft.json)" aria-label="Save"><Icon name="save" size={15} /></button>
        <button className={qat} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" size={15} /></button>
        <button className={qat} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" size={15} /></button>
        <div className="mx-auto flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden font-semibold sm:inline">NetCraft</span>
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
      <div className="flex h-7 items-end gap-0.5 bg-white px-1 text-[12px]" role="tablist">
        <button className="mb-0.5 rounded-sm bg-[#3955a3] px-3 py-0.5 text-white hover:bg-[#2e468a]" onClick={() => setFile(true)}>File</button>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id && showBody}
            onClick={() => { setTab(t.id); if (collapsed) setPeek(true); }}
            className={`rounded-t px-3 py-1 ${active === t.id && showBody ? 'border border-b-white border-gray-300 bg-white font-medium text-[#3955a3]' : 'text-gray-700 hover:text-[#3955a3]'}`}
          >
            {t.label}
          </button>
        ))}
        {hasSelection && (
          <button
            role="tab"
            aria-selected={active === 'shape'}
            onClick={() => { setTab('shape'); if (collapsed) setPeek(true); }}
            className={`rounded-t px-3 py-1 ${active === 'shape' && showBody ? 'border border-b-white border-amber-300 bg-amber-50 font-medium text-amber-800' : 'text-amber-700 hover:text-amber-900'}`}
            title="Commands for the selected shape"
          >
            Shape
          </button>
        )}
        <button className="mb-1 ml-auto rounded p-0.5 text-gray-500 hover:bg-gray-100" onClick={() => { setPref('ribbonCollapsed', !collapsed); setPeek(false); }} title={collapsed ? 'Pin the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)'} aria-label="Collapse ribbon">
          <Icon name={collapsed ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
      </div>

      {/* Ribbon body */}
      {showBody && (
        <div className={`flex h-[86px] items-stretch border-t border-gray-300 bg-[#f8f9fb] px-1 py-1 ${collapsed ? 'absolute inset-x-0 top-full shadow-lg' : ''}`} onClick={() => collapsed && setTimeout(() => setPeek(false), 0)}>
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
          onExport={(kind) => { setFile(false); ({ pdf: doc.pdf, png: doc.png, svg: doc.svg, csv: doc.csv, vsdx: doc.vsdx, docx: doc.docx })[kind](); }}
        />
      )}
      <input ref={openRef} type="file" accept=".json,application/json,.vsdx" hidden onChange={(e) => { doc.open(e.target.files?.[0]); e.target.value = ''; }} />
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
  onExport: (kind: 'pdf' | 'png' | 'svg' | 'csv' | 'vsdx' | 'docx') => void;
}) {
  const project = useCurrentProject();
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
  const exp = (icon: string, title: string, sub: string, kind: 'pdf' | 'png' | 'svg' | 'csv' | 'vsdx' | 'docx') => (
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
        {item('open', 'Open… (NetCraft or Visio .vsdx)', onOpen)}
        {item('save', 'Save', onSave)}
        {item('visio', 'Save as Visio drawing…', () => onExport('vsdx'))}
        {item('titleBlock', 'Save as template…', () => void saveTemplate())}
        {item('print', 'Print…', onPrint)}
        <div className="my-2 border-t border-white/20" />
        {item('delete', 'Delete this client…', () => { if (confirm(`Delete "${project.name}" from this computer? This cannot be undone.`)) { useDiagram.getState().deleteProject(project.id); onClose(); } }, true)}
      </nav>
      <section className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-1 text-2xl font-light text-gray-900">{project.name}</h1>
        <p className="mb-6 text-sm text-gray-500">{[project.site, project.address].filter(Boolean).join(' · ') || 'Client diagram'} · {project.pages.length} page{project.pages.length === 1 ? '' : 's'}</p>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Export</h2>
        <div className="grid max-w-3xl grid-cols-2 gap-3">
          {exp('visio', 'Visio drawing (.vsdx)', 'Every page as a Visio drawing: devices with their Shape Data, cables, zones, labels and info boxes', 'vsdx')}
          {exp('page', 'Word report (.docx)', 'An editable report: client details, every page, rack elevations and all the tables', 'docx')}
          {exp('pdf', 'PDF report', 'Every page, rack elevations and the device, connection and port tables, with the title block', 'pdf')}
          {exp('image', 'PNG picture of this page', 'For Word documents and email', 'png')}
          {exp('exportFile', 'SVG drawing of this page', 'Scalable vector picture for Office and Visio', 'svg')}
          {exp('csv', 'CSV tables', 'Devices, connections, racks and port notes for Excel', 'csv')}
        </div>
        <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Save and share</h2>
        <p className="max-w-3xl text-sm text-gray-600">Save writes a <code>.netcraft.json</code> file with the whole client (pages, racks, custom shapes) that opens on any computer with NetCraft. Your diagrams are also kept automatically on this computer.</p>
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
  const fmtOn = (k: 'bold' | 'italic' | 'underline') => shapeSel.length > 0 && shapeSel.every((n) => !!n.data[k]);
  const shadowOn = shapeSel.length > 0 && shapeSel.every((n) => !!n.data.shadow);
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
          <Small icon="painter" label="Copy format" onClick={() => { if (!s.copyFormat()) alert('Select one cable, shape or device to copy its format.'); }} disabled={!st.count && !anyEdge} title="Format Painter: copy the format of the selected item" />
          <Small icon="painter" label={`Paste format${fmt ? '' : ''}`} onClick={() => { if (!s.pasteFormat()) alert('Select items of the same kind to paste the format onto.'); }} disabled={!fmt} title={fmt ? `Paste the copied ${fmt} format onto the selection` : 'Copy a format first'} />
        </Column>
      </Group>
      <Group label="Tools">
        <Column>
          <Small icon="pointer" label="Pointer" active={!tool} onClick={() => setTool(null)} title="Pointer tool: select and move (Esc)" />
          <Small icon="lineTool" label="Line" active={tool === 'line'} onClick={() => setTool(tool === 'line' ? null : 'line')} title="Line tool: drag to draw lines (Shift = straight)" />
          <Small icon="pencil" label="Pencil" active={tool === 'pencil'} onClick={() => setTool(tool === 'pencil' ? null : 'pencil')} title="Pencil tool: drag to draw freehand" />
        </Column>
        <Column>
          <Small icon="connector" label="Connector" active={tool === 'connector'} onClick={() => setTool(tool === 'connector' ? null : 'connector')} title="Connector tool: drag from one device or shape to another to connect them (nearest free ports)" />
        </Column>
        <Column>
          <Small icon="text" label="Text" onClick={() => s.addShape('text', center())} title="Add a text box in the middle of the view" />
          <Small icon="dimension" label="Dimension" onClick={() => { const c = center(); s.addMeasure({ x: c.x - 100, y: c.y }); }} title="Add a dimension line" />
          <Small icon="zone" label="Zone" onClick={() => s.addZone(center())} title="Add a zone / room" />
        </Column>
      </Group>
      <Group label="Font">
        <div className="flex flex-col gap-0.5 py-0.5">
        <div className="flex gap-0.5">
          <select
            className="h-[22px] w-28 rounded border border-gray-300 bg-white px-0.5 text-[11px] disabled:opacity-40" disabled={!shapeSel.length} title="Font"
            value={shapeSel.length && shapeSel.every((n) => (n.data.fontFamily ?? '') === (shapeSel[0].data.fontFamily ?? '')) ? shapeSel[0].data.fontFamily ?? '' : '*'}
            onChange={(e) => s.styleSelection({ text: { fontFamily: e.target.value || undefined } })}
          >
            <option value="*" disabled hidden>—</option>
            <option value="">(Default)</option>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
          <select
            className="h-[22px] w-12 rounded border border-gray-300 bg-white px-0.5 text-[11px] disabled:opacity-40" disabled={!shapeSel.length} title="Font size"
            value={shapeSel.length && shapeSel.every((n) => n.data.fontSize === shapeSel[0].data.fontSize) ? String(shapeSel[0].data.fontSize) : '*'}
            onChange={(e) => s.styleSelection({ text: { fontSize: Number(e.target.value) } })}
          >
            <option value="*" disabled hidden>—</option>
            {[...new Set([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, ...shapeSel.map((n) => n.data.fontSize)])].sort((a, b) => a - b).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="flex gap-px">
          <FmtBtn label="Bold" active={fmtOn('bold')} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { bold: !fmtOn('bold') } })}><b>B</b></FmtBtn>
          <FmtBtn label="Italic" active={fmtOn('italic')} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { italic: !fmtOn('italic') } })}><i className="font-serif">I</i></FmtBtn>
          <FmtBtn label="Underline" active={fmtOn('underline')} disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { underline: !fmtOn('underline') } })}><u>U</u></FmtBtn>
          <FmtBtn label="Larger text" disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { sizeDelta: 2 } })}>A<sup>+</sup></FmtBtn>
          <FmtBtn label="Smaller text" disabled={!shapeSel.length} onClick={() => s.styleSelection({ text: { sizeDelta: -2 } })}>A<sup>−</sup></FmtBtn>
        </div>
        </div>
      </Group>
      <Group label="Paragraph">
        <div className="grid grid-cols-3 content-start gap-px py-0.5">
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
      </Group>
      <Group label="Shape Style">
        <Column>
          <Drop trigger={(open) => <Small icon="fill" label="Fill ▾" onClick={open} disabled={!st.count} title="Fill colour of the selected shapes" />}>
            {(close) => <Swatches none onPick={(c) => { s.styleSelection({ fill: c ?? 'transparent' }); close(); }} />}
          </Drop>
          <Drop trigger={(open) => <Small icon="line" label="Line ▾" onClick={open} disabled={!st.count && !anyEdge} title="Line colour of the selected cables, shapes and zones" />}>
            {(close) => <Swatches auto="Automatic" onPick={(c) => { s.styleSelection({ line: c ?? null }); close(); }} />}
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
        <Column>
          <Small icon="front" label="Bring to Front" onClick={() => s.orderSelected('front')} disabled={!st.count} title="Bring to front (Ctrl+Shift+F)" />
          <Small icon="back" label="Send to Back" onClick={() => s.orderSelected('back')} disabled={!st.count} title="Send to back (Ctrl+Shift+B)" />
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
        </Column>
      </Group>
      <Group label="Editing">
        <Column>
          <Small icon="find" label="Find" onClick={() => openFind(false)} title="Find (Ctrl+F)" />
          <Small icon="replace" label="Replace" onClick={() => openFind(true)} title="Replace (Ctrl+H)" />
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
        <Big icon="picture" label="Picture" onClick={() => pictureRef.current?.click()} title="Put a floor plan or site photo behind this page" />
        <Column>
          <Small icon="device" label="Image as Device" onClick={() => paletteAction('import-image')} title="Import a picture and mark its ports" />
          <Small icon="visio" label="Visio Stencil" onClick={() => paletteAction('import-visio')} title="Import shapes from a Visio stencil (.vssx)" />
          <Small icon="library" label="Stencil Library" onClick={() => paletteAction('import-library')} title="Import a .netcraft-stencils.json library" />
        </Column>
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
      </Group>
      <Group label="Diagram Parts">
        <Big icon="zone" label="Zone" onClick={() => s.addZone(center())} title="A room, rack or area outline" />
        <Big icon="note" label="Note" onClick={() => s.addNote(center())} />
        <Big icon="info" label="Callout" onClick={() => insertCallout()} title="A callout pointing at the selected item (or a free one)" />
        <Big icon="dimension" label="Dimension" onClick={() => { const c = center(); s.addMeasure({ x: c.x - 100, y: c.y }); }} title="Dimension line (uses the page scale)" />
      </Group>
      <Group label="Text">
        <Big icon="screenTip" label="ScreenTip" onClick={() => editScreenTip()} title="Text shown when you hover the selected items" />
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

/** Insert → ScreenTip: asks for the hover text of the selected items. */
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
  { value: 'none', label: 'No colour' }, { value: 'status', label: 'Status' }, { value: 'location', label: 'Location' }, { value: 'model', label: 'Model' }, { value: 'layer', label: 'Layer' },
];

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
  const project = useCurrentProject();
  const s = useDiagram.getState();
  const d = project.display ?? DEFAULT_DISPLAY;
  const tb = project.titleBlock;
  const page = useCurrentPage();
  const setup = page.setup ?? DEFAULT_SETUP;
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
          <label className="flex h-[22px] items-center gap-1 px-1 text-[11px]">Orientation
            <select className={sel} value={setup.landscape ? 'l' : 'p'} onChange={(e) => s.setPageSetup({ ...setup, landscape: e.target.value === 'l' })}>
              <option value="l">Landscape</option>
              <option value="p">Portrait</option>
            </select>
          </label>
        </Column>
        <Big icon="scale" label="Set Scale" onClick={() => window.dispatchEvent(new Event(SET_SCALE_EVENT))} title={page.scale ? 'Set the drawing scale again' : 'Set the drawing scale from two points on a floor plan'} active={!!page.scale} />
        <Big icon="titleBlock" label="Title Block" active={!!tb?.show} onClick={() => s.updateTitleBlock({ show: !tb?.show })} title="Title block on every printed / PDF sheet (edit it in the panel with nothing selected)" />
      </Group>
      <Group label="Layout">
        <ReLayoutPage />
      </Group>
      <Group label="Themes">
        <ThemeGallery />
      </Group>
      <Group label="Connectors">
        <Column>
          <Check label="Line jumps" checked={d.lineJumps !== false} onChange={(v) => s.setDisplay({ lineJumps: v })} title="Cables hop where they cross" />
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
  const quick = usePref('quickInfo');
  const [reports, setReports] = useState(false);
  const [defining, setDefining] = useState(false);
  return (
    <>
      {reports && <ReportDialog onClose={() => setReports(false)} />}
      {defining && <DefineShapeDataDialog onClose={() => setDefining(false)} />}
      <Group label="Show/Hide">
        <Big icon="panes" label="Shape Data" active={propsPane} onClick={() => setPref('propsPane', !propsPane)} title="Show or hide the Shape Data pane" />
        <Big icon="defineData" label="Define Shape Data" onClick={() => setDefining(true)} title="Fields every device of this client has: text, number, date, pick list, yes/no; required fields" />
        <Column>
          <Check label="Quick info on hover" checked={quick} onChange={(v) => setPref('quickInfo', v)} />
        </Column>
      </Group>
      <Group label="External Data">
        <div className="flex items-start pt-1"><DataMenu /></div>
      </Group>
      <Group label="Layers & Colours">
        <div className="flex items-start pt-1"><ViewMenu label="Layers" /></div>
      </Group>
      <Group label="Data Graphics">
        <DataGraphicsMenu />
      </Group>
      <Group label="Reports">
        <Big icon="excel" label="Reports" onClick={() => setReports(true)} title="Device reports with the fields you pick, to Excel, Word or CSV (like Visio's Report wizard)" />
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
  const props = usePref('propsPane');
  const quick = usePref('quickInfo');
  const rulers = usePref('rulers');
  const dynamicGrid = usePref('dynamicGrid');
  const snapGrid = usePref('snapToGrid');
  const grid = usePref('grid');
  const breaks = usePref('pageBreaks');
  const d = project.display ?? DEFAULT_DISPLAY;
  const diagram = view === 'diagram';
  return (
    <>
      <Group label="Views">
        <Big icon="fullscreen" label="Full Screen" onClick={() => { setView('diagram'); setPresenting(true); }} title="Show the drawing alone, page by page (F5); arrow keys change page, Esc ends" />
        <Big icon="diagram" label="Diagram" active={diagram} onClick={() => setView('diagram')} />
        <Big icon="racks" label={`Racks${project.racks?.length ? ` (${project.racks.length})` : ''}`} active={!diagram} onClick={() => setView('racks')} />
      </Group>
      <Group label="Zoom">
        <Big icon="fit" label="Fit Page" onClick={() => rf.fitView({ padding: 0.2, duration: 200 })} disabled={!diagram} title="Fit the whole page in the window" />
        <Column>
          <Small icon="zoomIn" label="Zoom In" onClick={() => rf.zoomIn({ duration: 150 })} disabled={!diagram} />
          <Small icon="zoomOut" label="Zoom Out" onClick={() => rf.zoomOut({ duration: 150 })} disabled={!diagram} />
          <Small icon="hundred" label="100%" onClick={() => rf.zoomTo(1, { duration: 150 })} disabled={!diagram} />
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
          <Check label="Snap to grid" checked={snapGrid} onChange={(v) => setPref('snapToGrid', v)} title="Moved items land on the 10px grid" />
          <Check label="Quick info" checked={quick} onChange={(v) => setPref('quickInfo', v)} />
        </Column>
      </Group>
      <Group label="Task Panes">
        <Column>
          <Check label="Shapes" checked={shapes} onChange={(v) => setPref('shapesPane', v)} />
          <Check label="Shape Data" checked={props} onChange={(v) => setPref('propsPane', v)} />
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
        </Group>
      )}
      <Group label="Style">
        <Column>
          <Drop trigger={(open) => <Small icon="fill" label="Fill ▾" onClick={open} disabled={!st.count} />}>
            {(close) => <Swatches none onPick={(c) => { s.styleSelection({ fill: c ?? 'transparent' }); close(); }} />}
          </Drop>
          <Drop trigger={(open) => <Small icon="line" label="Line ▾" onClick={open} />}>
            {(close) => <Swatches auto="Automatic" onPick={(c) => { s.styleSelection({ line: c ?? null }); close(); }} />}
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
