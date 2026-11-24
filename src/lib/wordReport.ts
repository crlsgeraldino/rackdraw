'use client';

import { writeDocx, type DocBlock } from './docx';
import { bomTableRows, cablePathRows, CHANGE_TABLE, connectionRows, deviceRows, ipPlanRows, lifecycleTableRows, patchingRows, PORT_MAP_TABLE, portMapTableRows, portRows, rackPowerRows, rackRows, recentChangeRows, renderRack, siteRowsForReport, type PageRenderer } from './export';
import { pageAlt, rackAlt } from './altText';
import type { Project } from './types';

/**
 * "Export to Word" (like Visio's): a documentation report the MSP can edit and send — client details, a picture
 * of every page, rack elevations, and the device, connection, rack and port tables.
 */

// Picture area in inches on a Letter page with margins and a heading: landscape for pages, portrait for racks.
const LAND = { w: 9.6, h: 6.2 }, PORT = { w: 7.1, h: 8.7 };

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fit(w: number, h: number, box = LAND) {
  const k = Math.min(box.w / (w / 96), box.h / (h / 96), 1.5);
  return { wIn: (w / 96) * k, hIn: (h / 96) * k };
}

export async function exportWordReport(p: Project, renderPage: PageRenderer): Promise<Uint8Array> {
  const blocks: DocBlock[] = [];
  const media: Record<string, Uint8Array> = {};
  const add = (url: string, w: number, h: number, box = LAND, alt?: string) => {
    const name = `image${Object.keys(media).length + 1}.png`;
    media[name] = dataUrlBytes(url);
    blocks.push({ kind: 'image', media: name, ...fit(w, h, box), alt });
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
    add(img.url, img.width, img.height, LAND, pageAlt(p, pg));
  }
  // Racks are tall: they go on portrait pages, like a Visio rack diagram; the tables go back to landscape.
  const racks = p.racks ?? [];
  for (const [i, rack] of racks.entries()) {
    const img = await renderRack(p, rack);
    blocks.push(i === 0 ? { kind: 'section', landscape: false } : { kind: 'pageBreak' }, { kind: 'h1', text: `Rack: ${[rack.name, rack.location].filter(Boolean).join(' – ')}` });
    add(img.url, img.width, img.height, PORT, rackAlt(p, rack));
  }
  let portrait = racks.length > 0;

  const table = (title: string, header: string[], rows: (string | number)[][], widths?: number[]) => {
    if (!rows.length) return;
    blocks.push(portrait ? { kind: 'section', landscape: true } : { kind: 'pageBreak' }, { kind: 'h1', text: title }, { kind: 'table', header, rows: rows.map((r) => r.map((c) => String(c ?? ''))), widths });
    portrait = false;
  };
  table('Devices', ['Page', 'Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack / location'],
    deviceRows(p).map((d) => [d.page, d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack || d.location]), [0.1, 0.16, 0.14, 0.13, 0.11, 0.13, 0.09, 0.14]);
  if (p.vlans?.length) {
    const ip = ipPlanRows(p);
    table('IP plan', ['VLAN', 'Name', 'Subnet', 'Gateway', 'DHCP range', 'Use', 'Next free'], ip.plan.map((r) => [r.vlan, r.name, r.subnet, r.gateway, r.dhcp, r.use, r.next]), [0.07, 0.15, 0.15, 0.12, 0.2, 0.2, 0.11]);
    table('IP addresses', ['IP', 'Device', 'VLAN', 'Check'], ip.ips.map((r) => [r.ip, r.device, r.vlan, r.check]), [0.15, 0.35, 0.25, 0.25]);
  }
  {
    const lc = lifecycleTableRows(p);
    table('Lifecycle', ['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'End of life', 'State'], lc.devices.map((r) => [r.device, r.model, r.serial, r.purchase, r.warranty, r.eol, r.state]), [0.17, 0.17, 0.12, 0.1, 0.16, 0.16, 0.12]);
    table('Circuits', ['On', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Support phone', 'Contract ends'], lc.circuits.map((r) => [r.device, r.carrier, r.circuitId, r.kind, r.bandwidth, r.support, r.contractEnd]), [0.16, 0.16, 0.14, 0.16, 0.1, 0.14, 0.14]);
  }
  table('Rack power', ['Rack', 'Power', 'Heat', 'Weight', 'Circuit load', 'UPS load and runtime'], rackPowerRows(p).map((r) => [r.rack, r.power, r.heat, r.weight, r.circuit, r.ups]), [0.16, 0.1, 0.12, 0.1, 0.2, 0.32]);
  table('Patching', ['Rack', 'Position', 'Device', 'Port', 'To device', 'Port', 'Where', 'Cable', 'VLAN'],
    patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan]), [0.11, 0.08, 0.17, 0.07, 0.17, 0.07, 0.13, 0.1, 0.1]);
  table('Cable paths', ['From', 'Via (patch panels)', 'To', 'Jack / notes', 'Cables'], cablePathRows(p).map((r) => [r.from, r.via, r.to, r.notes, r.cables]), [0.2, 0.3, 0.2, 0.15, 0.15]);
  table('Bill of materials', ['Section', 'Qty', 'Unit', 'Item', 'Detail'], bomTableRows(p).bom, [0.15, 0.07, 0.06, 0.35, 0.37]);
  table('Port capacity', ['Device', 'Model', 'Ports', 'Used', 'Free', 'PoE W / budget', 'Check'], bomTableRows(p).capacity, [0.18, 0.24, 0.07, 0.07, 0.07, 0.12, 0.25]);
  { const st = siteRowsForReport(p); table('Sites', st.header, st.rows, [0.12, 0.06, 0.06, 0.06, 0.07, 0.12, 0.09, 0.04, 0.08, 0.16, 0.07, 0.07]); }
  table('Port maps (ports in use)', PORT_MAP_TABLE, portMapTableRows(p), [0.16, 0.08, 0.22, 0.18, 0.06, 0.07, 0.08, 0.15]);
  table('Recent changes (90 days)', CHANGE_TABLE, recentChangeRows(p), [0.14, 0.08, 0.28, 0.5]);
  table('Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'VLAN', 'Length', 'Label'],
    connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.vlan, c.length, c.label]), [0.09, 0.17, 0.08, 0.17, 0.08, 0.08, 0.08, 0.09, 0.16]);
  table('Rack contents', ['Rack', 'Position', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power'],
    rackRows(p).map((r) => [r.rack, r.position, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW === '' ? '' : `${r.powerW} W`]));
  table('Port notes', ['Device', 'Port', 'Uplink', 'Link', 'Connected to', 'IP', 'VLAN', 'Notes'],
    portRows(p).map((r) => [r.device, r.port, r.uplink, r.link, r.connectedTo, r.ip, r.vlan, r.notes]), [0.14, 0.07, 0.07, 0.12, 0.2, 0.11, 0.06, 0.23]);

  return writeDocx({ blocks, media, title: p.name, landscape: true });
}
