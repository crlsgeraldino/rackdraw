'use client';

import { writeDocx, type DocBlock } from './docx';
import { connectionRows, deviceRows, portRows, rackRows, renderRack, type PageRenderer } from './export';
import type { Project } from './types';

/**
 * "Export to Word" (like Visio's): a documentation report the MSP can edit and send — client details, a picture
 * of every page, rack elevations, and the device, connection, rack and port tables.
 */

const MAX_W = 9.6, MAX_H = 6.2; // inches on a landscape Letter page with margins and a heading

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fit(w: number, h: number) {
  const k = Math.min(MAX_W / (w / 96), MAX_H / (h / 96), 1.5);
  return { wIn: (w / 96) * k, hIn: (h / 96) * k };
}

export async function exportWordReport(p: Project, renderPage: PageRenderer): Promise<Uint8Array> {
  const blocks: DocBlock[] = [];
  const media: Record<string, Uint8Array> = {};
  const add = (url: string, w: number, h: number) => {
    const name = `image${Object.keys(media).length + 1}.png`;
    media[name] = dataUrlBytes(url);
    blocks.push({ kind: 'image', media: name, ...fit(w, h) });
  };

  blocks.push({ kind: 'title', text: p.name });
  const details: [string, string | undefined][] = [
    ['Site', p.site], ['Address', p.address], ['On-site contact', p.contact],
    ['Prepared by', p.titleBlock?.preparedBy], ['Drawn by', p.titleBlock?.author], ['Revision', p.titleBlock?.revision],
    ['Date', p.titleBlock?.date || new Date().toLocaleDateString()],
  ];
  blocks.push({ kind: 'table', header: ['Detail', 'Value'], rows: details.filter(([, v]) => v).map(([k, v]) => [k, v!]), widths: [0.25, 0.75] });
  if (p.notes) blocks.push({ kind: 'para', text: p.notes });

  for (const pg of p.pages) {
    const img = await renderPage(pg);
    if (!img) continue;
    blocks.push({ kind: 'pageBreak' }, { kind: 'h1', text: `${pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: ${pg.name}` });
    add(img.url, img.width, img.height);
  }
  for (const rack of p.racks ?? []) {
    const img = await renderRack(p, rack);
    blocks.push({ kind: 'pageBreak' }, { kind: 'h1', text: `Rack: ${[rack.name, rack.location].filter(Boolean).join(' – ')}` });
    add(img.url, img.width, img.height);
  }

  const table = (title: string, header: string[], rows: (string | number)[][], widths?: number[]) => {
    if (!rows.length) return;
    blocks.push({ kind: 'pageBreak' }, { kind: 'h1', text: title }, { kind: 'table', header, rows: rows.map((r) => r.map((c) => String(c ?? ''))), widths });
  };
  table('Devices', ['Page', 'Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack / location'],
    deviceRows(p).map((d) => [d.page, d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack || d.location]), [0.1, 0.16, 0.14, 0.13, 0.11, 0.13, 0.09, 0.14]);
  table('Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'VLAN', 'Length', 'Label'],
    connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.length, c.label]), [0.09, 0.17, 0.08, 0.17, 0.08, 0.08, 0.08, 0.09, 0.16]);
  table('Rack contents', ['Rack', 'Position', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power'],
    rackRows(p).map((r) => [r.rack, r.position, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW === '' ? '' : `${r.powerW} W`]));
  table('Port notes', ['Device', 'Port', 'Uplink', 'Connected to', 'IP', 'VLAN', 'Notes'],
    portRows(p).map((r) => [r.device, r.port, r.uplink, r.connectedTo, r.ip, r.vlan, r.notes]), [0.15, 0.07, 0.07, 0.22, 0.12, 0.07, 0.3]);

  return writeDocx({ blocks, media, title: p.name, landscape: true });
}
