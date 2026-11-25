import { bomTableRows, cablePathRows, CHANGE_TABLE, connectionRows, deviceRows, ipPlanRows, lifecycleTableRows, patchingRows, PORT_MAP_TABLE, portMapTableRows, portRows, rackPowerRows, rackRows, recentChangeRows, renderRack, siteRowsForReport, titleBlockCells, type PageRenderer } from './export';
import { FRAME_COLOR, type Project } from './types';
import { safeColor } from './safe';
import { borderHasTitle, borderLayout, borderSvg, borderText } from './borders';
import { hasHeaderFooter, hfCss } from './headerFooter';

import { PAPER, type PaperSize } from './pageSetup';

export { PAPER, type PaperSize };

export interface PrintOptions {
  paper: PaperSize;
  landscape: boolean;
  /** Ids of the diagram pages to print. */
  pageIds: string[];
  racks: boolean;
  tables: boolean;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ROOT_ID = 'nc-print-root';
const MARGIN = 0.4; // inches
const TITLE_H = 0.5; // inches

function titleBlockHtml(p: Project, sheet: string) {
  if (!p.titleBlock?.show) return '';
  const cells = titleBlockCells(p, sheet);
  const total = cells.reduce((s, c) => s + c.weight, 0);
  return `<div class="nc-tb">${cells
    .map((c, i) => `<div style="flex:${c.weight / total}"><span>${esc(c.label)}</span><b${i ? ' class="n"' : ''}>${esc(c.value)}</b></div>`)
    .join('')}</div>`;
}

function headerHtml(p: Project, title: string) {
  // Borders & Titles → banner: the sheet title big on a coloured band, the client under it.
  if (p.display?.frame === 'banner') {
    const sub = [p.name, p.site, p.address, new Date().toLocaleDateString()].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
    return `<header class="banner" style="background:${safeColor(p.display.frameColor, FRAME_COLOR)}"><h1>${esc(title)}</h1><div class="sub">${sub}</div></header>`;
  }
  const sub = [p.site, p.address, title, new Date().toLocaleDateString()].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  return `<header><h1>${esc(p.name)}</h1><div class="sub">${sub}</div></header>`;
}

/** Page colour and simple frame of a printed sheet (Design → Backgrounds / Borders & Titles). */
function sheetStyle(p: Project) {
  const d = p.display;
  const frame = safeColor(d?.frameColor, FRAME_COLOR);
  return [d?.pageColor ? `background:${safeColor(d.pageColor, '#ffffff')}` : '', d?.frame === 'simple' ? `border:2px solid ${frame};outline:1px solid ${frame};outline-offset:3px;padding:6pt` : ''].filter(Boolean).join(';');
}

function tableHtml(p: Project, title: string, cols: string[], rows: (string | number)[][]) {
  if (!rows.length) return '';
  const tb = titleBlockHtml(p, title);
  return `<section class="nc-tables">${headerHtml(p, title)}<table>
<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
${tb ? `<tfoot><tr><td colspan="${cols.length}">${tb}</td></tr></tfoot>` : ''}
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
}

/**
 * Prints the project like the PDF report: one sheet per chosen diagram page and rack, then the tables,
 * each with the title block. Builds a print-only copy of the content and opens the system print dialog.
 */
export async function printProject(p: Project, renderPage: PageRenderer, o: PrintOptions) {
  const paper = PAPER[o.paper];
  const [pw, ph] = o.landscape ? [paper.h, paper.w] : [paper.w, paper.h];
  // A sheet fills the printable area, less room for the page number in the bottom margin.
  const sheetH = ph - MARGIN * 2 - 0.05;
  const sheets: string[] = [];

  const frame = p.display?.frame ?? 'none';
  // The newer Borders & Titles designs are drawn as SVG over the sheet (the simple frame and banner use CSS).
  const drawn = borderHasTitle(frame) && frame !== 'banner';
  const sheetW = pw - MARGIN * 2;
  const picture = (title: string, url: string, n: number, total: number) => {
    if (!drawn) {
      return `<section class="nc-sheet" style="height:${sheetH}in;${sheetStyle(p)}">${headerHtml(p, title)}<div class="art"><img src="${url}" alt=""></div>${titleBlockHtml(p, title)}</section>`;
    }
    const Wpx = sheetW * 96, Hpx = sheetH * 96;
    const text = borderText({
      title, client: p.name, site: p.site,
      date: p.display?.frameDate === false ? false : p.titleBlock?.date,
      page: p.display?.framePage === false ? undefined : n, pages: total,
    });
    const lay = borderLayout(frame, Wpx, Hpx, safeColor(p.display?.frameColor, FRAME_COLOR), text);
    const pad = (v: number) => `${(v / 96 + 0.06).toFixed(3)}in`;
    const bg = p.display?.pageColor ? `background:${safeColor(p.display.pageColor, '#ffffff')};` : '';
    return `<section class="nc-sheet" style="height:${sheetH}in;position:relative;${bg}padding:${pad(lay.inset.top)} ${pad(lay.inset.right)} ${pad(lay.inset.bottom)} ${pad(lay.inset.left)}">`
      + `<div style="position:absolute;inset:0">${borderSvg(lay, Wpx, Hpx)}</div>`
      + `<div class="art"><img src="${url}" alt=""></div>${titleBlockHtml(p, title)}</section>`;
  };

  const pictures: { title: string; url: string }[] = [];
  for (const pg of p.pages) {
    if (!o.pageIds.includes(pg.id)) continue;
    const img = await renderPage(pg);
    if (img) pictures.push({ title: p.pages.length > 1 ? `${pg.kind === 'floorplan' ? 'Floor plan' : 'Diagram'}: ${pg.name}` : 'Network diagram', url: img.url });
  }
  if (o.racks) {
    for (const rack of p.racks ?? []) {
      const img = await renderRack(p, rack);
      pictures.push({ title: ['Rack elevation', rack.name, rack.location].filter(Boolean).join(': '), url: img.url });
    }
  }
  pictures.forEach((x, i) => sheets.push(picture(x.title, x.url, i + 1, pictures.length)));
  if (o.tables) {
    sheets.push(
      tableHtml(p, 'Devices', ['Page', 'Name', 'Type', 'Model', 'IP', 'Serial', 'Asset tag', 'Rack / location'],
        deviceRows(p).map((d) => [d.page, d.name, d.type, d.model, d.ip, d.serial, d.assetTag, d.rack || d.location])),
      tableHtml(p, 'Rack contents', ['Rack', 'Position', 'Depth', 'Item', 'Model', 'Serial', 'Asset tag', 'Power'],
        rackRows(p).map((r) => [r.rack, r.position, r.depth, r.item, r.model, r.serial, r.assetTag, r.powerW === '' ? '' : `${r.powerW} W`])),
      tableHtml(p, 'Rack power', ['Rack', 'Power', 'Heat', 'Weight', 'Circuit load', 'UPS load and runtime'],
        rackPowerRows(p).map((r) => [r.rack, r.power, r.heat, r.weight, r.circuit, r.ups])),
      tableHtml(p, 'Patching', ['Rack', 'Position', 'Device', 'Port', 'To device', 'Port', 'Where', 'Cable', 'VLAN'],
        patchingRows(p).map((r) => [r.rack, r.fromPosition, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.toWhere, r.cable, r.vlan])),
      tableHtml(p, 'Cable paths', ['From', 'Via (patch panels)', 'To', 'Jack / notes', 'Cables'],
        cablePathRows(p).map((r) => [r.from, r.via, r.to, r.notes, r.cables])),
      tableHtml(p, 'Bill of materials', ['Section', 'Qty', 'Unit', 'Item', 'Detail'], bomTableRows(p).bom),
      tableHtml(p, 'Port capacity', ['Device', 'Model', 'Ports', 'Used', 'Free', 'PoE W / budget', 'Check'], bomTableRows(p).capacity),
      tableHtml(p, 'Sites', siteRowsForReport(p).header, siteRowsForReport(p).rows),
      tableHtml(p, 'Port maps (ports in use)', PORT_MAP_TABLE, portMapTableRows(p)),
      tableHtml(p, 'Recent changes (90 days)', CHANGE_TABLE, recentChangeRows(p)),
      p.vlans?.length ? tableHtml(p, 'IP plan', ['VLAN', 'Name', 'Subnet', 'Gateway', 'DHCP range', 'Use', 'Next free', 'Notes'],
        ipPlanRows(p).plan.map((r) => [r.vlan, r.name, r.subnet, r.gateway, r.dhcp, r.use, r.next, r.notes])) : '',
      p.vlans?.length ? tableHtml(p, 'IP addresses', ['IP', 'Device', 'VLAN', 'Check'], ipPlanRows(p).ips.map((r) => [r.ip, r.device, r.vlan, r.check])) : '',
      tableHtml(p, 'Lifecycle', ['Device', 'Model', 'Serial', 'Purchased', 'Warranty ends', 'End of life', 'State'],
        lifecycleTableRows(p).devices.map((r) => [r.device, r.model, r.serial, r.purchase, r.warranty, r.eol, r.state])),
      tableHtml(p, 'Circuits', ['On', 'Carrier', 'Circuit ID', 'Type', 'Bandwidth', 'Support phone', 'Contract ends'],
        lifecycleTableRows(p).circuits.map((r) => [r.device, r.carrier, r.circuitId, r.kind, r.bandwidth, r.support, r.contractEnd])),
      tableHtml(p, 'Connections', ['Page', 'From', 'Port', 'To', 'Port', 'Cable', 'Function', 'VLAN', 'Length', 'Label'],
        connectionRows(p).map((c) => [c.page, c.fromDevice, c.fromPort, c.toDevice, c.toPort, c.cable, c.role, c.vlan, c.length, c.label])),
      tableHtml(p, 'Port notes', ['Device', 'Port', 'Uplink', 'Link', 'Connected to', 'IP', 'VLAN', 'Notes'],
        portRows(p).map((r) => [r.device, r.port, r.uplink, r.link, r.connectedTo, r.ip, r.vlan, r.notes])),
    );
  }
  const body = sheets.filter(Boolean).join('');
  if (!body) throw new Error('Nothing to print: choose at least one page, the racks or the tables.');

  // Page margins: the header / footer if set (Visio's Header & Footer), else "Page n of m" bottom right.
  const hf = p.headerFooter;
  const boxFont = "font: 8pt 'Segoe UI', Arial, sans-serif; color: #555;";
  const marginBoxes = hasHeaderFooter(hf)
    ? (['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const)
      .map((pos, i) => ({ pos, text: i < 3 ? hf!.header[i] : hf!.footer[i - 3] }))
      .filter((b) => b.text.trim())
      .map((b) => `@${b.pos} { content: ${hfCss(b.text, p)}; ${boxFont} }`).join(' ')
    : `@bottom-right { content: "Page " counter(page) " of " counter(pages); ${boxFont} }`;

  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<style>
#${ROOT_ID} { display: none; }
@media print {
  @page { size: ${pw}in ${ph}in; margin: ${MARGIN}in; ${marginBoxes} }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block; font-family: 'Segoe UI', Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #${ROOT_ID} section { break-after: page; }
  #${ROOT_ID} section:last-child { break-after: auto; }
  #${ROOT_ID} .nc-sheet { display: flex; flex-direction: column; overflow: hidden; }
  #${ROOT_ID} header h1 { font-size: 15pt; margin: 0; }
  #${ROOT_ID} header .sub { font-size: 8.5pt; color: #666; margin: 2pt 0 6pt; }
  #${ROOT_ID} header.banner { color: #fff; padding: 6pt 8pt 4pt; margin-bottom: 6pt; }
  #${ROOT_ID} header.banner .sub { color: #e5e7eb; margin-bottom: 0; }
  #${ROOT_ID} .nc-sheet { box-sizing: border-box; }
  #${ROOT_ID} .art { position: relative; flex: 1; min-height: 0; }
  #${ROOT_ID} .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  #${ROOT_ID} .nc-tb { display: flex; height: ${TITLE_H}in; margin-top: 6pt; border: 1px solid #555; box-sizing: border-box; }
  #${ROOT_ID} .nc-tb > div { border-left: 1px solid #555; padding: 2pt 4pt; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
  #${ROOT_ID} .nc-tb > div:first-child { border-left: 0; }
  #${ROOT_ID} .nc-tb span { font-size: 5.5pt; color: #777; text-transform: uppercase; letter-spacing: .04em; }
  #${ROOT_ID} .nc-tb b { font-size: 8.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #${ROOT_ID} .nc-tb b.n { font-weight: 400; }
  #${ROOT_ID} table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  #${ROOT_ID} th { text-align: left; border-bottom: 1.5px solid #333; padding: 3pt 4pt; }
  #${ROOT_ID} td { border-bottom: 1px solid #ddd; padding: 3pt 4pt; vertical-align: top; }
  #${ROOT_ID} tfoot td { border: 0; padding: 6pt 0 0; }
  #${ROOT_ID} tr { break-inside: avoid; }
}
</style>${body}`;
  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));

  const cleanup = () => root.remove();
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
