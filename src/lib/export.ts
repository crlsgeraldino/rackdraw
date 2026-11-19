import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { STENCIL_MAP } from './stencils';
import type { AppNode, CableData, Project } from './types';

/* ---------- helpers ---------- */

function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  download(name, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(s: string) {
  return s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'diagram';
}

function nodeName(n: AppNode | undefined) {
  if (!n) return '?';
  if (n.type === 'device') return n.data.name;
  if (n.type === 'zone') return n.data.title;
  return 'Note';
}

function portName(n: AppNode | undefined, portId?: string | null) {
  if (!n || n.type !== 'device' || !portId) return portId ?? '';
  const def = STENCIL_MAP[n.data.stencilId]?.ports.find((p) => p.id === portId);
  return n.data.ports?.[portId]?.label || def?.label || portId;
}

export interface ConnectionRow {
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  cable: string;
  vlan: string;
  label: string;
}

export function connectionRows(p: Project): ConnectionRow[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  return p.edges.map((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    const d = (e.data ?? { cable: 'Cat6' }) as CableData;
    return {
      fromDevice: nodeName(a), fromPort: portName(a, e.sourceHandle),
      toDevice: nodeName(b), toPort: portName(b, e.targetHandle),
      cable: d.cable, vlan: d.vlan ?? '', label: d.label ?? '',
    };
  });
}

export function deviceRows(p: Project) {
  return p.nodes.flatMap((n) => (n.type === 'device' ? [n] : [])).map((n) => ({
    name: n.data.name,
    type: STENCIL_MAP[n.data.stencilId]?.name ?? n.data.stencilId,
    model: n.data.model ?? '',
    ip: n.data.ip ?? '',
    serial: n.data.serial ?? '',
    location: n.data.location ?? '',
    notes: n.data.notes ?? '',
  }));
}

/* ---------- image export ---------- */

async function renderViewport(kind: 'png' | 'svg', bounds: Rect) {
  const pad = 60;
  const width = Math.max(800, Math.ceil(bounds.width + pad * 2));
  const height = Math.max(500, Math.ceil(bounds.height + pad * 2));
  const vp = getViewportForBounds(bounds, width, height, 0.2, 2, `${pad}px`);
  const el = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!el) throw new Error('Canvas not found');
  const opts = {
    backgroundColor: '#ffffff',
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    filter: (node: Element) => !(node instanceof HTMLElement && node.classList?.contains('react-flow__resize-control')),
  };
  return { url: kind === 'png' ? await toPng(el, opts) : await toSvg(el, opts), width, height };
}

export async function exportImage(kind: 'png' | 'svg', p: Project, bounds: Rect) {
  const { url } = await renderViewport(kind, bounds);
  download(`${safeName(p.name)}.${kind}`, url);
}

/* ---------- PDF ---------- */

export async function exportPdf(p: Project, bounds: Rect) {
  const { jsPDF } = await import('jspdf');
  const { url, width, height } = await renderViewport('png', bounds);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 36;

  const header = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(p.name, m, m);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    const sub = [p.site, p.address, title, new Date().toLocaleDateString()].filter(Boolean).join('  ·  ');
    doc.text(sub, m, m + 14);
    doc.setTextColor(0);
  };

  header('Network diagram');
  const top = m + 28;
  const ratio = Math.min((W - m * 2) / width, (H - top - m) / height);
  doc.addImage(url, 'PNG', m, top, width * ratio, height * ratio, undefined, 'FAST');

  const table = (title: string, cols: string[], widths: number[], rows: string[][]) => {
    if (!rows.length) return;
    doc.addPage();
    header(title);
    let y = m + 40;
    const row = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      let x = m;
      cells.forEach((c, i) => {
        doc.text(doc.splitTextToSize(c, widths[i] - 6)[0] ?? '', x + 3, y);
        x += widths[i];
      });
      doc.setDrawColor(220);
      doc.line(m, y + 5, W - m, y + 5);
      y += 16;
    };
    row(cols, true);
    for (const r of rows) {
      if (y > H - m) {
        doc.addPage();
        header(`${title} (cont.)`);
        y = m + 40;
        row(cols, true);
      }
      row(r, false);
    }
  };

  const avail = W - m * 2;
  table('Devices', ['Name', 'Type', 'Model', 'IP', 'Serial', 'Location'], [0.2, 0.2, 0.16, 0.14, 0.15, 0.15].map((f) => f * avail),
    deviceRows(p).map((d) => [d.name, d.type, d.model, d.ip, d.serial, d.location]));
  table('Connections', ['From', 'Port', 'To', 'Port', 'Cable', 'VLAN', 'Label'], [0.2, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2].map((f) => f * avail),
    connectionRows(p).map((c) => [c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.label]));

  doc.save(`${safeName(p.name)}.pdf`);
}

/* ---------- CSV (opens in Excel) ---------- */

function csv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export function exportCsv(p: Project) {
  const conns = connectionRows(p);
  const lines = [
    ['Client', p.name], ['Site', p.site ?? ''], [],
    ['DEVICES'], ['Name', 'Type', 'Model', 'IP', 'Serial', 'Location', 'Notes'],
    ...deviceRows(p).map((d) => [d.name, d.type, d.model, d.ip, d.serial, d.location, d.notes]),
    [],
    ['CONNECTIONS'], ['From device', 'From port', 'To device', 'To port', 'Cable', 'VLAN', 'Label'],
    ...conns.map((c) => [c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.label]),
  ];
  // BOM so Excel reads UTF-8 correctly.
  downloadBlob(`${safeName(p.name)}.csv`, new Blob(['﻿' + csv(lines)], { type: 'text/csv;charset=utf-8' }));
}

/* ---------- project files ---------- */

export function saveProjectFile(p: Project) {
  const clean = {
    ...p,
    nodes: p.nodes.map((n) => ({ ...n, selected: false })),
    edges: p.edges.map((e) => ({ ...e, selected: false })),
  };
  downloadBlob(`${safeName(p.name)}.netcraft.json`, new Blob([JSON.stringify({ format: 'netcraft', version: 1, project: clean }, null, 2)], { type: 'application/json' }));
}

export async function readProjectFile(file: File): Promise<Project> {
  const json = JSON.parse(await file.text());
  const p = json?.project ?? json;
  if (!p || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) throw new Error('Not a NetCraft diagram file.');
  return { name: file.name.replace(/\.netcraft\.json$|\.json$/i, ''), createdAt: Date.now(), ...p };
}
