import { fmtRuntime, rackPower } from './rackPower';
import { expandHF, hasHeaderFooter } from './headerFooter';
import { patchRows, rackCables, rackPortStates } from './rackPatching';
import { allPaths, pathLength, type TraceHop } from './trace';
import { bomRows, quotedBom } from './bom';
import { deviceIps, ipPlanProblems, subnetUsage, vlanOfIp } from './ipam';
import { circuitRows, LIFE_STATES, lifecycleRows, whenText } from './lifecycle';
import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RackElevation, rackSize } from '@/components/RackElevation';
import { getStencil } from '@/store/useDiagramStore';
import { libraryNameFromFile } from './libraries';
import { deviceListRows } from './dataImport';
import { DEFAULT_DISPLAY, displayColors } from './display';
import { allDevices } from './project';
import { PROJECT_FILE_VERSION, sanitizeProject, sanitizeStencils } from './sanitize';
import { rackLabel } from './rack';
import { documentedPort, portMap, portMapDevices } from './portMap';
import { changeKindLabel, changeTime } from './changeLog';
import { SITE_TABLE, siteSummaries, siteTableRows } from './sites';
import { edgeRole, roleLabel } from './cableRole';
import { isRackdrawPackage, packRackdraw, RACKDRAW_EXT, RACKDRAW_MIME, RackdrawFileError, unpackRackdraw } from './rackdrawFile';
import { FRAME_COLOR, isDocumented, portLink, type AppNode, type CableData, type Page, type Project, type Rack, type StencilDef, type StencilLibraryFile } from './types';
import { safeColor } from './safe';
import { borderHasTitle, borderLayout, borderText, type BorderPart } from './borders';
import { csvOf } from './csv';

/* ---------- helpers ---------- */

/** jsPDF's built-in fonts only draw Latin-1: arrows, ≈, × and the like become their plain-text equivalents. */
export function pdfText(s: string) {
  return s
    .replace(/[→⟶➝]/g, '->').replace(/[←]/g, '<-').replace(/[↔]/g, '<->').replace(/≈/g, '~').replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/•/g, '-').replace(/⤷/g, '>')
    .replace(/[^\x00-\xff]/g, '?');
}

function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

export type DownloadResult = 'saved' | 'cancelled' | 'failed' | 'started';

/**
 * Runs `start` (which downloads one file) and tells how it ended. The desktop app reports whether the file was really
 * saved (its Save dialog can be cancelled, the disk can be full); a browser only says the download started.
 */
export async function withDownloadResult<T>(start: () => T | Promise<T>): Promise<{ value: T; result: DownloadResult }> {
  const d = typeof window === 'undefined' ? undefined
    : (window as unknown as { rackdrawDesktop?: { onDownloadDone?: (cb: (r: { state: string }) => void) => () => void } }).rackdrawDesktop;
  if (!d?.onDownloadDone) return { value: await start(), result: 'started' };
  let off = () => {};
  const done = new Promise<DownloadResult>((resolve) => {
    off = d.onDownloadDone!((r) => resolve(r.state === 'completed' ? 'saved' : r.state === 'cancelled' ? 'cancelled' : 'failed'));
  });
  try {
    const value = await start();
    return { value, result: await done };
  } finally {
    off();
  }
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  download(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a client or page name: letters of any language kept ("Café Río" → "Café-Río"). */
export function safeName(s: string) {
  return s.normalize('NFC').replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 120) || 'diagram';
}

function nodeName(n: AppNode | undefined) {
  if (!n) return '?';
  if (n.type === 'device') return n.data.name;
  if (n.type === 'zone') return n.data.title;
  return 'Note';
}

function portName(n: AppNode | undefined, portId?: string | null) {
  if (!n || n.type !== 'device' || !portId) return portId ?? '';
  const def = getStencil(n.data.stencilId)?.ports.find((p) => p.id === portId);
  return n.data.ports?.[portId]?.label || def?.label || portId;
}

export interface ConnectionRow {
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  cable: string;
  /** What the cable is for (WAN uplink, Uplink, Access…), chosen or worked out from its ends. */
  role: string;
  vlan: string;
  label: string;
  length: string;
  page: string;
}

export function connectionRows(p: Project): ConnectionRow[] {
  return p.pages.flatMap((pg) => {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    return pg.edges.map((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      const d = (e.data ?? { cable: 'Cat6' }) as CableData;
      return {
        page: pg.name,
        fromDevice: nodeName(a), fromPort: portName(a, e.sourceHandle),
        toDevice: nodeName(b), toPort: portName(b, e.targetHandle),
        cable: d.cable, role: roleLabel(edgeRole(pg.nodes, e, getStencil)) ?? '', vlan: d.vlan ?? '', label: d.label ?? '', length: d.length ?? '',
      };
    });
  });
}

/** "Rack A U12–U13" for each mounted device. */
function rackPositions(p: Project) {
  const pos = new Map<string, string>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) pos.set(it.nodeId, `${r.name} ${rackLabel(it)}`);
  return pos;
}

export function deviceRows(p: Project) {
  const pos = rackPositions(p);
  return p.pages.flatMap((pg) => pg.nodes.flatMap((n) => (n.type === 'device' ? [{ n, page: pg.name }] : []))).map(({ n, page }) => ({
    page,
    name: n.data.name,
    type: getStencil(n.data.stencilId)?.name ?? n.data.stencilId,
    model: n.data.model ?? '',
    ip: n.data.ip ?? '',
    serial: n.data.serial ?? '',
    assetTag: n.data.assetTag ?? '',
    rack: pos.get(n.id) ?? '',
    location: n.data.location ?? '',
    powerW: n.data.powerW ?? '',
    notes: n.data.notes ?? '',
  }));
}

/** Every port someone documented (connected device, IP, VLAN, uplink, notes), for the PDF/print/CSV "Port notes" table. */
export function portRows(p: Project) {
  return p.pages.flatMap((pg) => {
    const byId = new Map(pg.nodes.map((n) => [n.id, n]));
    // What a cable on this page plugs each port into, when the port has no "connected to" written.
    const peer = new Map<string, string>();
    for (const e of pg.edges) {
      peer.set(`${e.source}|${e.sourceHandle}`, `${nodeName(byId.get(e.target))} ${portName(byId.get(e.target), e.targetHandle)}`.trim());
      peer.set(`${e.target}|${e.targetHandle}`, `${nodeName(byId.get(e.source))} ${portName(byId.get(e.source), e.sourceHandle)}`.trim());
    }
    return pg.nodes.flatMap((n) => {
      if (n.type !== 'device') return [];
      const ports = getStencil(n.data.stencilId)?.ports ?? [];
      const order = new Map(ports.map((pt, i) => [pt.id, i]));
      return Object.entries(n.data.ports ?? {})
        .filter(([, pd]) => isDocumented(pd))
        .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
        .map(([pid, pd]) => ({
          page: pg.name,
          device: n.data.name,
          port: portName(n, pid),
          uplink: pd.uplink ? 'Uplink' : '',
          link: portLink(pd),
          connectedTo: pd.description || peer.get(`${n.id}|${pid}`) || '',
          ip: pd.ip ?? '',
          vlan: pd.vlan ?? '',
          notes: pd.notes ?? '',
        }));
    });
  });
}

export const PORT_MAP_TABLE = ['Device', 'Port', 'Connected to', 'Via', 'VLAN', 'PoE', 'Status', 'Label'];
/** Port maps as one table: every port in use on each switch, patch panel, firewall and router. */
export function portMapTableRows(p: Project): string[][] {
  return portMapDevices(p, getStencil).flatMap((d) => {
    const m = portMap(p, d.id, getStencil);
    return m ? m.rows.filter(documentedPort).map((r) => [m.name, `${r.label}${r.uplink ? ' (uplink)' : ''}`, r.to || r.note, r.via, r.vlan, r.poe, r.status ?? '', r.cableLabel]) : [];
  });
}

/** Sites as table rows, when the client has more than one (one site says nothing the other tables don't). */
export function siteRowsForReport(p: Project): { header: string[]; rows: string[][] } {
  const { sites } = siteSummaries(p, getStencil);
  return { header: SITE_TABLE, rows: sites.length > 1 ? siteTableRows(sites) : [] };
}

export const CHANGE_TABLE = ['When', 'Kind', 'What', 'Change'];
/** The change log's last `days` days, newest first (at most `max` rows), for the reports. */
export function recentChangeRows(p: Project, days = 90, max = 400): string[][] {
  const from = Date.now() - days * 86_400_000;
  return (p.changeLog ?? []).filter((e) => e.at >= from).slice(-max).reverse().map((e) => [changeTime(e.at), changeKindLabel(e.kind), e.kind === 'note' ? '' : e.target, e.detail]);
}

/** Bill of materials and port capacity as table rows (shared by the PDF, print and Word report). */
export function bomTableRows(p: Project) {
  const { sections, capacity } = quotedBom(p, getStencil);
  return {
    bom: bomRows(sections).map((r) => [String(r[0]), String(r[3]), String(r[4]), String(r[1]), String(r[2])]),
    capacity: capacity.map((c) => [c.device, c.model, String(c.ports), String(c.used), String(c.free), c.poeBudgetW ? `${c.poeW} / ${c.poeBudgetW}` : '', c.warning]),
  };
}

/** Each rack's power, heat, weight, circuit load and UPS runtime. */
export function rackPowerRows(p: Project) {
  return (p.racks ?? []).map((r) => {
    const pw = rackPower(p, r, getStencil);
    return {
      rack: r.name, power: pw.totalW ? `${pw.totalW} W` : '', heat: pw.btu ? `${pw.btu} BTU/h` : '', weight: pw.weightLb ? `${pw.weightLb} lb` : '',
      circuit: pw.circuit ? `${pw.circuit.amps} A / ${pw.circuit.volts} V${pw.circuit.redundant ? ' A+B' : ''}: ${Math.round(pw.circuit.pct * 100)}%` : '',
      ups: pw.ups.map((u) => `${u.name} ${Math.round(u.pct * 100)}%, ~${fmtRuntime(u.runtimeMin)}`).join('; '),
    };
  });
}

/** Data → Lifecycle as table rows: devices with a date (most urgent first), and circuits. */
export function lifecycleTableRows(p: Project) {
  const rank = { expired: 0, soon: 1, ok: 2, unknown: 3 };
  return {
    devices: lifecycleRows(p).filter((r) => r.purchase || r.warrantyEnd || r.endOfLife).sort((a, b) => rank[a.state] - rank[b.state] || a.device.localeCompare(b.device))
      .map((r) => ({ device: r.device, model: r.model, serial: r.serial, purchase: r.purchase, warranty: [r.warrantyEnd, whenText(r.warrantyDays) && `(${whenText(r.warrantyDays)})`].filter(Boolean).join(' '), eol: [r.endOfLife, whenText(r.eolDays) && `(${whenText(r.eolDays)})`].filter(Boolean).join(' '), state: LIFE_STATES.find((x) => x.value === r.state)!.label })),
    circuits: circuitRows(p).map((c) => ({ device: c.device, carrier: c.carrier ?? '', circuitId: c.circuitId ?? '', kind: c.kind ?? '', bandwidth: c.bandwidth ?? '', support: c.supportPhone ?? '', contractEnd: c.contractEnd ?? '', monthly: c.monthlyCost ?? '' })),
  };
}

/** Data → IP Plan as table rows: each VLAN / subnet with its use, and every device IP with its VLAN. */
export function ipPlanRows(p: Project) {
  const vlans = p.vlans ?? [];
  const problems = ipPlanProblems(p);
  return {
    plan: subnetUsage(p).map((u) => ({
      vlan: u.vlan.vlan, name: u.vlan.name, subnet: u.vlan.subnet ?? '', gateway: u.vlan.gateway ?? '',
      dhcp: u.vlan.dhcpStart && u.vlan.dhcpEnd ? `${u.vlan.dhcpStart} - ${u.vlan.dhcpEnd}` : '',
      use: u.subnet ? `${u.used} static, ${u.dhcp} DHCP, ${u.free} free of ${u.subnet.hosts}` : '', next: u.next ?? '', notes: u.vlan.notes ?? '',
    })),
    ips: deviceIps(p).sort((a, b) => a.n - b.n).map((x) => {
      const v = vlanOfIp(x.ip, vlans);
      return { ip: x.ip, device: x.device.data.name, vlan: v ? `${v.vlan} ${v.name}`.trim() : '', check: problems.filter((pr) => pr.deviceId === x.device.id).map((pr) => pr.rule).join('; ') };
    }),
  };
}

export function rackRows(p: Project) {
  const devices = new Map(allDevices(p).map((n) => [n.id, n] as const));
  return (p.racks ?? []).flatMap((r) =>
    [...r.items].sort((a, b) => b.u - a.u).map((it) => {
      const d = it.nodeId ? devices.get(it.nodeId)?.data : undefined;
      return {
        rack: r.name,
        position: rackLabel(it),
        height: `${it.height}U`,
        depth: it.depth === 'full' ? 'Full' : it.depth === 'front' ? 'Front' : 'Rear',
        item: it.kind === 'device' ? d?.name ?? 'Missing device' : it.label ?? it.kind,
        model: d?.model ?? '',
        serial: d?.serial ?? '',
        assetTag: d?.assetTag ?? '',
        powerW: d?.powerW ?? '',
      };
    }),
  );
}

/** Every rack's patching schedule: each cable from mounted equipment, port to port, with where the far end is. */
export function patchingRows(p: Project) {
  return (p.racks ?? []).flatMap((r) => patchRows(p, r, getStencil).map((x) => ({
    rack: r.name, fromPosition: x.from.position, fromDevice: x.from.device, fromPort: x.from.port,
    toDevice: x.to.device, toPort: x.to.port, toWhere: x.to.where ? x.to.where : x.to.position, cable: x.cable, vlan: x.vlan, length: x.length,
  })));
}

/** End-to-end cable paths through patch panels: from, via (panel ports), to, with jack notes and cable types. */
export function cablePathRows(p: Project) {
  const label = (h: TraceHop) => [h.name, h.portLabel].filter(Boolean).join(' ');
  return allPaths(p, getStencil).map((t) => {
    const ends = t.hops.filter((h) => !h.passThrough);
    const via = t.hops.filter((h) => h.passThrough);
    return {
      from: ends[0] ? label(ends[0]) : label(t.hops[0]),
      via: via.map((h) => label(h) + (h.where ? ` (${h.where})` : '')).join(' → '),
      to: ends.length > 1 ? label(ends[ends.length - 1]) : '(not connected)',
      notes: via.map((h) => h.note).filter(Boolean).join('; '),
      cables: [[...new Set(t.links.map((l) => l.data?.cable).filter(Boolean))].join(', '), pathLength(t) && `${pathLength(t)} total`].filter(Boolean).join(' · '),
    };
  });
}

/* ---------- rack elevations ---------- */

/** Renders a rack's front and rear elevations side by side into a PNG, using the same component as the screen. */
export async function renderRack(p: Project, rack: Rack) {
  const devices = new Map(allDevices(p).map((n) => [n.id, n]));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        createElement(
          'div',
          null,
          createElement(RackElevation, { rack, face: 'front', devices, stencil: getStencil, portStates: rackPortStates(p), cables: rackCables(p, rack) }),
          createElement(RackElevation, { rack, face: 'rear', devices, stencil: getStencil, portStates: rackPortStates(p) }),
        ),
      ),
    );
    const size = rackSize(rack);
    const gap = 40;
    const k = 2; // print resolution
    const canvas = document.createElement('canvas');
    canvas.width = (size.width * 2 + gap) * k;
    canvas.height = size.height * k;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const faces = [...(host.firstElementChild?.children ?? [])] as SVGSVGElement[];
    for (const [i, svg] of faces.entries()) {
      const markup = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await img.decode();
      ctx.drawImage(img, i * (size.width + gap) * k, 0, size.width * k, size.height * k);
    }
    return { url: canvas.toDataURL('image/png'), width: canvas.width / k, height: canvas.height / k };
  } finally {
    root.unmount();
    host.remove();
  }
}

/* ---------- image export ---------- */

/** What a "selection only" picture keeps: these items, and the cables between them. */
export interface Only { nodes: Set<string>; edges: Set<string> }

async function renderViewport(kind: 'png' | 'svg', bounds: Rect, only?: Only) {
  const pad = 60;
  const width = Math.max(800, Math.ceil(bounds.width + pad * 2));
  const height = Math.max(500, Math.ceil(bounds.height + pad * 2));
  const vp = getViewportForBounds(bounds, width, height, 0.2, 2, `${pad}px`);
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('Canvas not found');
  // The page colour (Design → Backgrounds), as drawn on the sheet.
  const sheetBg = document.querySelector<HTMLElement>('.nc-page-sheet')?.style.backgroundColor || '#ffffff';
  const opts = {
    backgroundColor: sheetBg,
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    // Leave out resize handles and connection dots (shown on selected items).
    // Non-printing layers (Layer Properties → Print) are tagged nc-noprint; their cables are SVG elements.
    filter: (node: Element) => !(node instanceof Element && node.classList?.contains('nc-noprint')) && !(node instanceof HTMLElement && (node.classList?.contains('react-flow__resize-control') || node.classList?.contains('react-flow__handle') || node.classList?.contains('react-flow__node-toolbar') || node.classList?.contains('nc-page-sheet')))
  };
  // Selection outlines and editing handles stay out of the picture; for "selection only", everything else is made
  // invisible (not removed, so nothing shifts) while the picture is taken.
  const hidden: Element[] = [];
  if (only) {
    for (const n of el.querySelectorAll<HTMLElement>('.react-flow__node')) if (!only.nodes.has(n.dataset.id ?? '')) hidden.push(n);
    for (const g of el.querySelectorAll('g.react-flow__edge')) if (!only.edges.has(g.getAttribute('data-id') ?? '')) hidden.push(g.closest('svg') ?? g);
    for (const l of document.querySelectorAll('[data-edge-label]')) if (!only.edges.has(l.getAttribute('data-edge-label') ?? '')) hidden.push(l);
    hidden.forEach((h) => h.classList.add('nc-export-hide'));
  }
  document.body.classList.add('nc-exporting');
  try {
    return { url: kind === 'png' ? await toPng(el, opts) : await toSvg(el, opts), width, height, vp };
  } finally {
    document.body.classList.remove('nc-exporting');
    hidden.forEach((h) => h.classList.remove('nc-export-hide'));
  }
}

export async function exportImage(kind: 'png' | 'svg', p: Project, bounds: Rect, pageName?: string, only?: Only) {
  const { url } = await renderViewport(kind, bounds, only);
  const suffix = only ? '-selection' : p.pages.length > 1 && pageName ? `-${safeName(pageName)}` : '';
  download(`${safeName(p.name)}${suffix}.${kind}`, url);
}

/* ---------- title block ---------- */

/** Cells of the drawing title block (Visio-style border/title), left to right. "Page" is filled in per sheet. */
export function titleBlockCells(p: Project, sheetTitle: string): { label: string; value: string; weight: number }[] {
  const tb = p.titleBlock;
  return [
    { label: 'Client', value: p.name, weight: 1.3 },
    { label: 'Site', value: [p.site, p.address].filter(Boolean).join(', '), weight: 1.5 },
    { label: 'Drawing', value: sheetTitle, weight: 1.5 },
    { label: 'Prepared by', value: tb?.preparedBy ?? '', weight: 1.1 },
    { label: 'Drawn by', value: tb?.author ?? '', weight: 0.9 },
    { label: 'Rev', value: tb?.revision ?? '', weight: 0.4 },
    { label: 'Date', value: tb?.date || new Date().toLocaleDateString(), weight: 0.8 },
  ];
}

/* ---------- PDF ---------- */

/** Captures the canvas for one page (the editor switches to it first), or null if the page is empty. */
export type PageRenderer = (page: Page) => Promise<{ url: string; width: number; height: number } | null>;

/** Captures the live canvas showing `bounds`. */
export const renderCanvasPng = (bounds: Rect) => renderViewport('png', bounds);

/** Captures the live canvas as SVG, with the transform used (to place things on the picture). */
export const renderCanvasSvg = (bounds: Rect) => renderViewport('svg', bounds);

export async function exportPdf(p: Project, renderPage: PageRenderer) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 36;
  // Room kept free at the bottom of every sheet for the title block.
  const tbH = p.titleBlock?.show ? 30 : 0;
  // Design → Borders & Titles: a design that writes the title replaces the report's own heading, and its bands are
  // kept clear of the content.
  const look = p.display;
  const frame = look?.frame ?? 'none';
  const fc = safeColor(look?.frameColor, FRAME_COLOR);
  const titled = borderHasTitle(frame);
  const ins = borderLayout(frame, W, H, fc, borderText({ title: '', client: '' })).inset;
  const L = Math.max(m, ins.left + 10), R = W - Math.max(m, ins.right + 10);
  const pictureTop = titled ? Math.max(m, ins.top + 12) : m + 28;
  const tableTop = titled ? Math.max(m, ins.top + 22) : m + 40;
  const bottom = Math.min(H - m - (tbH ? tbH + 8 : 0), H - ins.bottom - 10);
  /** Sheet title of each PDF page, for its title block. */
  const sheetTitles: string[] = [];
  let pages = 0;
  const newPage = () => {
    if (pages++) doc.addPage();
  };

  const header = (title: string) => {
    sheetTitles[doc.getNumberOfPages() - 1] = title;
    // Design → Backgrounds.
    if (look?.pageColor && look.pageColor.toLowerCase() !== '#ffffff') { doc.setFillColor(safeColor(look.pageColor, '#ffffff')); doc.rect(0, 0, W, H, 'F'); }
    // The border design writes the title (drawn once every sheet exists, for "Page n of m").
    if (titled) return;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(pdfText(p.name), L, m);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    const sub = [p.site, p.address, title, new Date().toLocaleDateString()].filter(Boolean).join('  ·  ');
    doc.text(pdfText(sub), L, m + 14);
    doc.setTextColor(0);
  };

  const picture = (title: string, img: { url: string; width: number; height: number }) => {
    newPage();
    header(title);
    const top = pictureTop;
    const ratio = Math.min((R - L) / img.width, (bottom - top) / img.height);
    doc.addImage(img.url, 'PNG', L, top, img.width * ratio, img.height * ratio, undefined, 'FAST');
  };

  // Legend for data colors, drawn in the top-right corner of each diagram page.
  const colors = displayColors(p);
  const settings = p.display ?? DEFAULT_DISPLAY;
  const legendGroups = [
    { title: colors.deviceTitle, items: colors.deviceLegend },
    { title: colors.cableTitle, items: settings.cableColor === 'vlan' ? colors.cableLegend : [] },
  ].filter((g) => g.title && g.items.length);
  const legend = () => {
    if (!settings.showLegend || !legendGroups.length) return;
    let x = W - m;
    for (const g of [...legendGroups].reverse()) {
      const width = Math.max(doc.getTextWidth(g.title.toUpperCase()), ...g.items.map((i) => doc.getTextWidth(i.label) + 12)) + 10;
      x -= width;
      doc.setFontSize(7);
      doc.setTextColor(110);
      doc.text(g.title.toUpperCase(), x, m - 4);
      g.items.forEach((it, i) => {
        const y = m + 4 + i * 9;
        doc.setDrawColor(it.color);
        doc.setFillColor(it.color);
        doc.rect(x, y - 5, 6, 6, it.dashed ? 'S' : 'F');
        doc.setTextColor(40);
        doc.text(it.label, x + 9, y);
      });
    }
    doc.setTextColor(0);
  };

  for (const pg of p.pages) {
    const img = await renderPage(pg);
    if (!img) continue;
    picture(p.pages.length > 1 ? `${pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: ${pg.name}` : 'Network diagram', img);
    legend();
  }
  for (const rack of p.racks ?? []) {
    picture(['Rack elevation', rack.name, rack.location].filter(Boolean).join(': '), await renderRack(p, rack));
  }

  const table = (title: string, cols: string[], widths: number[], rows: string[][]) => {
    if (!rows.length) return;
    newPage();
    header(title);
    let y = tableTop;
    // Every line of a long cell is printed (the row grows to fit), in characters the built-in PDF font can draw.
    const lines = (cells: string[]) => cells.map((c, i) => doc.splitTextToSize(pdfText(c), widths[i] - 6) as string[]);
    const row = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      const ls = lines(cells);
      const n = Math.max(1, ...ls.map((l) => l.length));
      let x = L;
      ls.forEach((l, i) => {
        doc.text(l, x + 3, y);
        x += widths[i];
      });
      doc.setDrawColor(220);
      doc.line(L, y + 5 + (n - 1) * 11, R, y + 5 + (n - 1) * 11);
      y += 16 + (n - 1) * 11;
    };
    row(cols, true);
    for (const r of rows) {
      doc.setFontSize(9);
      const n = Math.max(1, ...lines(r).map((l) => l.length));
      if (y + (n - 1) * 11 > bottom) {
        doc.addPage();
        header(`${title} (cont.)`);
        y = tableTop;
        row(cols, true);
      }
      row(r, false);
    }
  };

  const avail = R - L;
  table('Devices', ['Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack'], [0.18, 0.16, 0.14, 0.12, 0.13, 0.1, 0.17].map((f) => f * avail),
    deviceRows(p).map((d) => [d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack || d.location]));
  table('Rack contents', ['Rack', 'Position', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power'], [0.13, 0.1, 0.07, 0.2, 0.15, 0.14, 0.11, 0.1].map((f) => f * avail),
    rackRows(p).map((r) => [r.rack, r.position, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW === '' ? '' : `${r.powerW} W`]));
  table('Rack power', ['Rack', 'Power', 'Heat', 'Weight', 'Circuit load', 'UPS load and runtime'], [0.17, 0.1, 0.12, 0.1, 0.2, 0.31].map((f) => f * avail),
    rackPowerRows(p).map((r) => [r.rack, r.power, r.heat, r.weight, r.circuit, r.ups]));
  table('Patching', ['Rack', 'Position', 'Device', 'Port', 'To device', 'Port', 'Where', 'Cable', 'VLAN'], [0.11, 0.08, 0.17, 0.07, 0.17, 0.07, 0.13, 0.1, 0.1].map((f) => f * avail),
    patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan]));
  table('Cable paths', ['From', 'Via (patch panels)', 'To', 'Jack / notes', 'Cables'], [0.2, 0.3, 0.2, 0.15, 0.15].map((f) => f * avail),
    cablePathRows(p).map((r) => [r.from, r.via, r.to, r.notes, r.cables]));
  {
    const { sections, capacity } = quotedBom(p, getStencil);
    table('Bill of materials', ['Section', 'Qty', 'Unit', 'Item', 'Detail'], [0.15, 0.07, 0.06, 0.35, 0.37].map((f) => f * avail),
      bomRows(sections).map((r) => [String(r[0]), String(r[3]), String(r[4]), String(r[1]), String(r[2])]));
    table('Port capacity', ['Device', 'Model', 'Ports', 'Used', 'Free', 'PoE W / budget', 'Check'], [0.18, 0.24, 0.07, 0.07, 0.07, 0.12, 0.25].map((f) => f * avail),
      capacity.map((c) => [c.device, c.model, String(c.ports), String(c.used), String(c.free), c.poeBudgetW ? `${c.poeW} / ${c.poeBudgetW}` : '', c.warning]));
  }
  { const st = siteRowsForReport(p); table('Sites', st.header, [0.12, 0.06, 0.06, 0.06, 0.07, 0.12, 0.09, 0.04, 0.08, 0.16, 0.07, 0.07].map((f) => f * avail), st.rows); }
  table('Port maps (ports in use)', PORT_MAP_TABLE, [0.16, 0.08, 0.22, 0.18, 0.06, 0.07, 0.08, 0.15].map((f) => f * avail), portMapTableRows(p));
  table('Recent changes (90 days)', CHANGE_TABLE, [0.14, 0.08, 0.28, 0.5].map((f) => f * avail), recentChangeRows(p));
  if (p.vlans?.length) {
    const ip = ipPlanRows(p);
    table('IP plan', ['VLAN', 'Name', 'Subnet', 'Gateway', 'DHCP range', 'Use', 'Next free', 'Notes'], [0.06, 0.13, 0.13, 0.1, 0.18, 0.2, 0.09, 0.11].map((f) => f * avail),
      ip.plan.map((r) => [r.vlan, r.name, r.subnet, r.gateway, r.dhcp, r.use, r.next, r.notes]));
    table('IP addresses', ['IP', 'Device', 'VLAN', 'Check'], [0.15, 0.35, 0.25, 0.25].map((f) => f * avail), ip.ips.map((r) => [r.ip, r.device, r.vlan, r.check]));
  }
  {
    const lc = lifecycleTableRows(p);
    table('Lifecycle', ['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'End of life', 'State'], [0.17, 0.17, 0.12, 0.1, 0.16, 0.16, 0.12].map((f) => f * avail),
      lc.devices.map((r) => [r.device, r.model, r.serial, r.purchase, r.warranty, r.eol, r.state]));
    table('Circuits', ['On', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Support phone', 'Contract ends', 'Monthly'], [0.15, 0.15, 0.13, 0.15, 0.1, 0.12, 0.12, 0.08].map((f) => f * avail),
      lc.circuits.map((r) => [r.device, r.carrier, r.circuitId, r.kind, r.bandwidth, r.support, r.contractEnd, r.monthly === '' ? '' : String(r.monthly)]));
  }
  table('Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'Function', 'VLAN', 'Length', 'Label'], [0.09, 0.15, 0.07, 0.15, 0.07, 0.08, 0.1, 0.07, 0.08, 0.14].map((f) => f * avail),
    connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.role, c.vlan, c.length, c.label]));
  table('Port notes', ['Device', 'Port', 'Uplink', 'Link', 'Connected to', 'IP', 'VLAN', 'Notes'], [0.15, 0.07, 0.07, 0.13, 0.2, 0.11, 0.06, 0.21].map((f) => f * avail),
    portRows(p).map((r) => [r.device, r.port, r.uplink, r.link, r.connectedTo, r.ip, r.vlan, r.notes]));

  // Borders & Titles, on every sheet, now that the number of sheets is known.
  if (frame !== 'none') {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const text = borderText({
        title: sheetTitles[i - 1] ?? '', client: p.name, site: p.site,
        date: look?.frameDate === false ? false : p.titleBlock?.date,
        page: look?.framePage === false ? undefined : i, pages: total,
      });
      drawBorderPdf(doc, borderLayout(frame, W, H, fc, { ...text, title: pdfText(text.title), client: pdfText(text.client) }).parts);
    }
  }

  // Header and footer (Design / Print → Header & Footer), on every sheet.
  const hf = p.headerFooter;
  if (hasHeaderFooter(hf)) {
    const total = doc.getNumberOfPages();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90);
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const ctx = { page: i, pages: total, sheet: sheetTitles[i - 1] ?? '' };
      ([[hf!.header, 20], [hf!.footer, H - 14]] as const).forEach(([parts, y]) => {
        parts.forEach((t, k) => {
          const s = expandHF(t, p, ctx);
          if (s) doc.text(s, k === 0 ? m : k === 1 ? W / 2 : W - m, y, { align: k === 0 ? 'left' : k === 1 ? 'center' : 'right' });
        });
      });
    }
    doc.setTextColor(0);
  }

  if (tbH) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      drawTitleBlock(doc, [...titleBlockCells(p, sheetTitles[i - 1] ?? ''), { label: 'Page', value: `${i} of ${total}`, weight: 0.6 }], m, H - m - tbH, W - m * 2, tbH);
    }
  }

  doc.save(`${safeName(p.name)}.pdf`);
}

type Pdf = InstanceType<typeof import('jspdf').jsPDF>;

/** Draws a Borders & Titles design on the current PDF page (sizes in points). */
function drawBorderPdf(doc: Pdf, parts: BorderPart[]) {
  for (const p of parts) {
    if (p.t === 'rect') {
      if (p.fill) doc.setFillColor(p.fill);
      if (p.stroke) { doc.setDrawColor(p.stroke); doc.setLineWidth(p.width ?? 1); }
      const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S';
      if (p.r) doc.roundedRect(p.x, p.y, p.w, p.h, p.r, p.r, style);
      else doc.rect(p.x, p.y, p.w, p.h, style);
    } else if (p.t === 'line') {
      doc.setDrawColor(p.stroke);
      doc.setLineWidth(p.width);
      doc.line(p.x1, p.y1, p.x2, p.y2);
    } else {
      doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
      doc.setFontSize(p.size);
      doc.setTextColor(p.color);
      doc.text(p.text, p.x, p.y, p.up ? { angle: 90 } : { align: p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left' });
    }
  }
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
}

/** A one-row bordered title block: small grey labels over values. */
function drawTitleBlock(doc: Pdf, cells: { label: string; value: string; weight: number }[], x: number, y: number, w: number, h: number) {
  const total = cells.reduce((s, c) => s + c.weight, 0);
  doc.setDrawColor(80);
  doc.setLineWidth(0.8);
  doc.rect(x, y, w, h);
  let cx = x;
  cells.forEach((c, i) => {
    const cw = (c.weight / total) * w;
    if (i) doc.line(cx, y, cx, y + h);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120);
    doc.text(c.label.toUpperCase(), cx + 4, y + 8);
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(20);
    doc.text(doc.splitTextToSize(c.value, cw - 8)[0] ?? '', cx + 4, y + h - 8);
    cx += cw;
  });
  doc.setTextColor(0);
  doc.setLineWidth(0.2);
}

/* ---------- CSV (opens in Excel) ---------- */

const csv = (rows: (string | number)[][]) => csvOf(rows);

export function exportCsv(p: Project) {
  const conns = connectionRows(p);
  const lines = [
    ['Client', p.name], ['Site', p.site ?? ''], [],
    ['DEVICES'], ['Page', 'Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack position', 'Location', 'Power (W)', 'Notes'],
    ...deviceRows(p).map((d) => [d.page, d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack, d.location, d.powerW, d.notes]),
    [],
    ['CONNECTIONS'], ['Page', 'From device', 'From port', 'To device', 'To port', 'Cable', 'Function', 'VLAN', 'Length', 'Label'],
    ...conns.map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.role, c.vlan, c.length, c.label]),
    [],
    ['RACKS'], ['Rack', 'Position', 'Height', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power (W)'],
    ...rackRows(p).map((r) => [r.rack, r.position, r.height, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW]),
    [],
    ['RACK POWER'], ['Rack', 'Power', 'Heat', 'Weight', 'Circuit load', 'UPS load and runtime'],
    ...rackPowerRows(p).map((r) => [r.rack, r.power, r.heat, r.weight, r.circuit, r.ups]),
    [],
    ['PATCHING'], ['Rack', 'Position', 'Device', 'Port', 'To device', 'To port', 'Where', 'Cable', 'VLAN', 'Length'],
    ...patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan, r.length]),
    [],
    ['CABLE PATHS'], ['From', 'Via (patch panels)', 'To', 'Jack / notes', 'Cables'],
    ...cablePathRows(p).map((r) => [r.from, r.via, r.to, r.notes, r.cables]),
    [],
    ['IP PLAN'], ['VLAN', 'Name', 'Subnet', 'Gateway', 'DHCP range', 'Use', 'Next free IP', 'Notes'],
    ...ipPlanRows(p).plan.map((r) => [r.vlan, r.name, r.subnet, r.gateway, r.dhcp, r.use, r.next, r.notes]),
    [],
    ['IP ADDRESSES'], ['IP', 'Device', 'VLAN', 'Check'],
    ...ipPlanRows(p).ips.map((r) => [r.ip, r.device, r.vlan, r.check]),
    [],
    ['LIFECYCLE'], ['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'End of life', 'State'],
    ...lifecycleTableRows(p).devices.map((r) => [r.device, r.model, r.serial, r.purchase, r.warranty, r.eol, r.state]),
    [],
    ['CIRCUITS'], ['On', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Support phone', 'Contract ends', 'Monthly cost'],
    ...lifecycleTableRows(p).circuits.map((r) => [r.device, r.carrier, r.circuitId, r.kind, r.bandwidth, r.support, r.contractEnd, r.monthly]),
    [],
    ['BILL OF MATERIALS'], ['Section', 'Item', 'Detail', 'Qty', 'Unit'],
    ...bomRows(quotedBom(p, getStencil).sections),
    [],
    ['PORT NOTES'], ['Page', 'Device', 'Port', 'Uplink', 'Link', 'Connected to', 'IP', 'VLAN', 'Notes'],
    ...portRows(p).map((r) => [r.page, r.device, r.port, r.uplink, r.link, r.connectedTo, r.ip, r.vlan, r.notes]),
  ];
  // BOM so Excel reads UTF-8 correctly.
  downloadBlob(`${safeName(p.name)}.csv`, new Blob(['\ufeff' + csv(lines)], { type: 'text/csv;charset=utf-8' }));
}

/** One flat device sheet (with RackDraw IDs) meant to be edited in Excel and imported back. */
export function exportDeviceList(p: Project) {
  const rows = deviceListRows(p, (id) => getStencil(id)?.name ?? id);
  downloadBlob(`${safeName(p.name)}-devices.csv`, new Blob(['﻿' + csv(rows)], { type: 'text/csv;charset=utf-8' }));
}

/* ---------- project files ---------- */

/** What a client file holds: the client, and the custom stencils it uses (so it opens on any computer). */
export function projectFilePayload(p: Project) {
  const clean: Project = {
    ...p,
    pages: p.pages.map((pg) => ({
      ...pg,
      nodes: pg.nodes.map((n) => ({ ...n, selected: false })),
      edges: pg.edges.map((e) => ({ ...e, selected: false })),
    })),
  };
  const used = new Set(allDevices(p).map((n) => n.data.stencilId));
  const stencils = [...used].map(getStencil).filter((s): s is StencilDef => !!s?.custom);
  return { format: 'netcraft', version: 3, project: clean, stencils };
}

/** The client as a .rackdraw file (see lib/rackdrawFile.ts). */
export function projectFileBytes(p: Project): Uint8Array {
  return packRackdraw(projectFilePayload(p), { name: p.name });
}

/** Downloads the client as a .rackdraw file (the browser version's Save; a copy before deleting a client). */
export function saveProjectFile(p: Project) {
  downloadBlob(`${safeName(p.name)}${RACKDRAW_EXT}`, new Blob([projectFileBytes(p) as BlobPart], { type: RACKDRAW_MIME }));
}

export async function readProjectFile(file: File): Promise<{ project: Project; stencils: StencilDef[]; dropped: number }> {
  let json: { format?: string; version?: number; project?: unknown; stencils?: unknown };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isRackdrawPackage(bytes)) {
    // A .rackdraw package (RackDraw 0.108 and later).
    try {
      json = unpackRackdraw(bytes).payload as typeof json;
    } catch (e) {
      throw new Error(e instanceof RackdrawFileError ? e.message : 'This file could not be read: it is not a RackDraw drawing, or it is damaged.');
    }
  } else {
    // The older .rackdraw.json / .netcraft.json text files.
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('This file could not be read: it is not a RackDraw drawing, or it is damaged.');
    }
  }
  if (json?.format === 'netcraft-stencils') throw new Error('This is a stencil library. Use "Import library" in the shapes palette.');
  if (json?.format === 'rackdraw-backup') throw new Error('This is a full backup. Use File → Restore from backup.');
  if (typeof json?.version === 'number' && json.version > PROJECT_FILE_VERSION) throw new Error('This diagram was saved by a newer version of RackDraw. Update RackDraw to open it.');
  // Checked and repaired here (files saved by v0.2 and earlier have one diagram, which becomes a page).
  const { project, report } = sanitizeProject(json?.project ?? json, file.name.replace(/\.(rackdraw|netcraft)\.json$|\.json$|\.rackdraw$/i, ''));
  return {
    project,
    stencils: sanitizeStencils(json.stencils),
    /** Damaged items left out (the file itself is not changed). */
    dropped: report.droppedNodes + report.droppedEdges,
  };
}

/* ---------- stencil libraries ---------- */

export function saveStencilLibrary(stencils: StencilDef[], name = 'my-stencils', library?: string) {
  const file: StencilLibraryFile = { format: 'netcraft-stencils', version: 1, ...(library ? { name: library } : {}), stencils };
  downloadBlob(`${safeName(name)}.rackdraw-stencils.json`, new Blob([JSON.stringify(file)], { type: 'application/json' }));
}

/**
 * Reads a library or project file. `library` is where stencils without their own library name go:
 * the file's library name, else a name made from the file name (project files: undefined → "My stencils").
 */
export async function readStencilLibrary(file: File): Promise<{ stencils: StencilDef[]; library?: string }> {
  const json = JSON.parse(await file.text());
  // A project file also carries the custom stencils it uses, so accept either.
  const list = json?.stencils;
  if (!Array.isArray(list)) throw new Error('No stencils found in this file.');
  const stencils = sanitizeStencils(list);
  if (!stencils.length) throw new Error('No usable stencils found in this file.');
  if (json?.format !== 'netcraft-stencils') return { stencils };
  const named = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : undefined;
  return { stencils, library: named ?? libraryNameFromFile(file.name) };
}
