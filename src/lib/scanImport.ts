import { newPage } from './project';
import type { AppNode, DeviceData, DeviceNode, Page, Project, StencilDef } from './types';

/*
 * Import a network scan: the hosts an IP scanner found (nmap XML, or a CSV / TSV export from Advanced IP Scanner,
 * Angry IP Scanner, Fing, a router's DHCP list…), each with a guessed kind of device, matched to the devices the
 * client already has (by MAC, then IP, then name). New hosts become devices laid out by kind; matched devices get
 * their missing details filled in and their IP corrected.
 */

export interface ScanHost {
  ip: string;
  mac?: string;
  vendor?: string;
  name?: string;
  os?: string;
  /** Open TCP / UDP ports. */
  ports: number[];
}

export interface ScanParse {
  hosts: ScanHost[];
  format: 'nmap' | 'table';
  /** Lines or hosts that could not be used (no IPv4 address, host down…). */
  skipped: number;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** MAC as 12 lowercase hex digits ("AA-BB-CC-..." and "aabb.ccdd.eeff" alike), or undefined. */
export function normMac(v?: string) {
  const hex = (v ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex : undefined;
}
/** MAC written the usual way: "AA:BB:CC:DD:EE:FF". */
const showMac = (hex: string) => hex.toUpperCase().match(/../g)!.join(':');

function parseNmap(xml: string): ScanParse {
  const hosts: ScanHost[] = [];
  let skipped = 0;
  for (const m of xml.matchAll(/<host\b[^>]*>([\s\S]*?)<\/host>/g)) {
    const body = m[1];
    const state = /<status\b[^>]*>/.exec(body)?.[0];
    if (state && attr(state, 'state') !== 'up') { skipped++; continue; }
    let ip: string | undefined, mac: string | undefined, vendor: string | undefined;
    for (const a of body.matchAll(/<address\b[^>]*>/g)) {
      const t = attr(a[0], 'addrtype');
      if (t === 'ipv4') ip = attr(a[0], 'addr');
      else if (t === 'mac') { mac = attr(a[0], 'addr'); vendor = attr(a[0], 'vendor'); }
    }
    if (!ip) { skipped++; continue; }
    const hn = /<hostname\b[^>]*>/.exec(body)?.[0];
    const ports: number[] = [];
    for (const p of body.matchAll(/<port\b([^>]*)>([\s\S]*?)<\/port>/g)) {
      const st = /<state\b[^>]*>/.exec(p[2])?.[0];
      if (st && attr(st, 'state') === 'open') ports.push(Number(attr(p[1], 'portid')));
    }
    const os = /<osmatch\b[^>]*>/.exec(body)?.[0];
    hosts.push({
      ip,
      mac: mac && normMac(mac) ? showMac(normMac(mac)!) : undefined,
      vendor: vendor ? unxml(vendor) : undefined,
      name: hn ? unxml(attr(hn, 'name') ?? '') || undefined : undefined,
      os: os ? unxml(attr(os, 'name') ?? '') || undefined : undefined,
      ports: ports.filter((n) => Number.isInteger(n) && n > 0),
    });
  }
  return { hosts, format: 'nmap', skipped };
}

/** One line of delimited text, with "quoted, fields". */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Column names scanners use for each detail. */
const COLUMNS: [keyof ScanHost, RegExp][] = [
  ['ip', /^(ip|ip ?address|ipv4|ipv4 address|address|host ?ip)$/i],
  ['mac', /^(mac|mac ?address|physical address|hardware address)$/i],
  ['vendor', /^(vendor|manufacturer|mac ?vendor|nic vendor|brand|maker)$/i],
  ['name', /^(name|host ?name|hostname|netbios ?name|dns ?name|device ?name|computer ?name|client ?name)$/i],
  ['os', /^(os|operating system|os ?name)$/i],
  ['ports', /^(ports|open ports|services|port)$/i],
];

function parseTable(text: string): ScanParse {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { hosts: [], format: 'table', skipped: 0 };
  // The separator is the one the header line uses most.
  const sep = [',', ';', '\t'].map((s) => [s, lines[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], sep);
  const col = new Map<keyof ScanHost, number>();
  head.forEach((h, i) => { const k = COLUMNS.find(([, re]) => re.test(h.replace(/[_.]+/g, ' ').trim()))?.[0]; if (k && !col.has(k)) col.set(k, i); });
  let rows = lines.slice(1).map((l) => splitLine(l, sep));
  // No IP column by name: no header at all, or an unusual one — find the column that holds addresses.
  if (!col.has('ip')) {
    const all = [head, ...rows];
    const idx = head.findIndex((_, i) => all.filter((r) => IPV4.test(r[i] ?? '')).length >= all.length / 2);
    if (idx < 0) return { hosts: [], format: 'table', skipped: lines.length };
    col.set('ip', idx);
    if (IPV4.test(head[idx])) rows = all;
  }
  const get = (r: string[], k: keyof ScanHost) => { const i = col.get(k); const v = i === undefined ? '' : (r[i] ?? '').trim(); return /^\[?n\/[as]\]?$|^-+$/i.test(v) ? '' : v; };
  const hosts: ScanHost[] = [];
  let skipped = 0;
  for (const r of rows) {
    const ip = get(r, 'ip').replace(/\s*\(.*\)$/, '');
    if (!IPV4.test(ip)) { skipped++; continue; }
    const mac = normMac(get(r, 'mac'));
    hosts.push({
      ip,
      mac: mac ? showMac(mac) : undefined,
      vendor: get(r, 'vendor') || undefined,
      name: get(r, 'name') || undefined,
      os: get(r, 'os') || undefined,
      ports: (get(r, 'ports').match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 65536),
    });
  }
  return { hosts, format: 'table', skipped };
}

/** Reads a scan export; one host per IP (the more detailed line wins). */
export function parseScan(text: string): ScanParse {
  const r = /<nmaprun\b/.test(text.slice(0, 4000)) || /^\s*<\?xml[\s\S]{0,400}<nmaprun/.test(text) ? parseNmap(text) : parseTable(text);
  const byIp = new Map<string, ScanHost>();
  for (const h of r.hosts) {
    const o = byIp.get(h.ip);
    byIp.set(h.ip, o ? { ...o, ...Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined && v !== '')), ports: [...new Set([...o.ports, ...h.ports])] } as ScanHost : h);
  }
  const hosts = [...byIp.values()].sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  return { ...r, hosts };
}
const ipNum = (ip: string) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);

/* ---------- what kind of device ---------- */

interface Rule { id: string; why: string; test: (h: ScanHost, text: string) => boolean }
const has = (h: ScanHost, ...ports: number[]) => ports.some((p) => h.ports.includes(p));
const RULES: Rule[] = [
  { id: 'firewall', why: 'firewall vendor or name', test: (_, t) => /fortinet|fortigate|sonicwall|palo ?alto|watchguard|sophos|pfsense|opnsense|checkpoint|check point|barracuda|\bfw\d*\b|firewall/.test(t) },
  { id: 'printer', why: 'printer ports or vendor', test: (h, t) => has(h, 9100, 515, 631) || /printer|\bmfp\b|\bprn\b|brother|canon|epson|xerox|lexmark|kyocera|ricoh|konica|sharp corp|oki data|zebra/.test(t) },
  { id: 'nvr', why: 'video recorder', test: (_, t) => /\bnvr\b|\bdvr\b/.test(t) },
  { id: 'camera', why: 'camera vendor or RTSP', test: (h, t) => has(h, 554) || /hikvision|dahua|axis comm|hanwha|amcrest|reolink|vivotek|bosch security|avigilon|\bcam\b|camera/.test(t) },
  { id: 'phone', why: 'VoIP phone', test: (h, t) => /polycom|yealink|grandstream|snom|mitel|avaya|poly\b|\bsep[0-9a-f]{12}\b|voip|phone/.test(t) || (has(h, 5060) && !has(h, 22, 3389, 445)) },
  { id: 'ip-pbx', why: 'phone system', test: (_, t) => /\bpbx\b|asterisk|freepbx|3cx/.test(t) },
  { id: 'ups', why: 'UPS vendor', test: (_, t) => /american power|\bapc\b|schneider|eaton|cyberpower|vertiv|liebert|tripp|\bups\b/.test(t) },
  { id: 'nas', why: 'NAS vendor', test: (_, t) => /synology|qnap|netgear readynas|buffalo|terramaster|asustor|truenas|\bnas\b/.test(t) },
  { id: 'access-point', why: 'wireless access point', test: (_, t) => /\b(u6|uap|unifi ap|ap\d*|wap)\b|ruckus|aruba.*\bap|meraki mr|access ?point|cambium|engenius/.test(t) },
  { id: 'switch-24', why: 'switch', test: (_, t) => /\b(sw|switch|usw|core)\d*\b|procurve|catalyst|meraki ms|unifi switch/.test(t) },
  { id: 'router', why: 'router / gateway name', test: (_, t) => /\b(router|gw|gateway|rtr|edgerouter|mikrotik|udm|usg)\b/.test(t) },
  { id: 'server', why: 'server name or services', test: (h, t) => /\b(srv|server|dc\d*|sql|exchange|hyper-?v|esxi|vmware|vcenter|proxmox|idrac|ilo)\b|windows server/.test(t) || has(h, 88, 389, 1433, 902) },
  { id: 'smartphone', why: 'phone or watch', test: (_, t) => /iphone|android|galaxy|pixel|oneplus/.test(t) },
  { id: 'tablet', why: 'tablet', test: (_, t) => /\bipad\b|tablet|surface go/.test(t) },
  { id: 'display', why: 'TV or display', test: (_, t) => /\btv\b|roku|chromecast|apple tv|samsung tv|\blg ?tv|display|screen/.test(t) },
  { id: 'laptop', why: 'laptop name', test: (_, t) => /laptop|\bnb\d*\b|notebook|macbook|\bmbp\b|thinkpad|latitude|elitebook/.test(t) },
  { id: 'workstation', why: 'Windows / Mac computer', test: (h, t) => has(h, 3389, 445, 139, 5900) || /desktop|\bpc\d*\b|\bws\d*\b|workstation|windows|imac|mac ?mini|optiplex/.test(t) },
  { id: 'iot-device', why: 'IoT vendor', test: (_, t) => /espressif|tuya|shelly|sonos|nest|ecobee|ring|philips|ikea|smart ?things|raspberry/.test(t) },
];

/** The kind of device a host most likely is, and why. */
export function guessStencil(h: ScanHost): { stencilId: string; why: string } {
  const text = [h.name, h.vendor, h.os].filter(Boolean).join(' ').toLowerCase();
  const hit = RULES.find((r) => r.test(h, text));
  if (hit) return { stencilId: hit.id, why: hit.why };
  // x.x.x.1 that answers on the web: most often the gateway.
  if (/\.1$/.test(h.ip) && has(h, 80, 443, 53)) return { stencilId: 'router', why: 'gateway address' };
  return { stencilId: 'workstation', why: 'nothing more specific known' };
}

/* ---------- matching the client's devices ---------- */

export interface ScanMatch { node: DeviceNode; by: 'MAC' | 'IP' | 'name' }

export function matchHost(h: ScanHost, devices: DeviceNode[]): ScanMatch | undefined {
  const mac = normMac(h.mac);
  if (mac) { const n = devices.find((d) => normMac(d.data.mac) === mac); if (n) return { node: n, by: 'MAC' }; }
  const n = devices.find((d) => (d.data.ip ?? '').split(/[\s,;/]+/).includes(h.ip));
  if (n) return { node: n, by: 'IP' };
  const name = h.name?.split('.')[0].toLowerCase();
  if (name) { const d = devices.find((x) => x.data.name.trim().toLowerCase() === name); if (d) return { node: d, by: 'name' }; }
  return undefined;
}

export interface ScanRow {
  host: ScanHost;
  stencilId: string;
  why: string;
  match?: ScanMatch;
  /** Add it / update the matched device / leave it out. */
  action: 'add' | 'update' | 'skip';
}

/** One row per host: its guessed kind, its match in the client, and what to do (update if matched, else add). */
export function planScan(p: Project, hosts: ScanHost[]): ScanRow[] {
  const devices = p.pages.flatMap((pg) => pg.nodes).filter((n): n is DeviceNode => n.type === 'device');
  const used = new Set<string>();
  return hosts.map((host) => {
    const g = guessStencil(host);
    const m = matchHost(host, devices.filter((d) => !used.has(d.id)));
    if (m) used.add(m.node.id);
    return { host, stencilId: m ? m.node.data.stencilId : g.stencilId, why: m ? `matched by ${m.by}` : g.why, match: m, action: m ? 'update' : 'add' };
  });
}

/** Devices with an IP that the scan didn't find (switched off, moved, or gone). */
export function notInScan(p: Project, hosts: ScanHost[], rows: ScanRow[]): DeviceNode[] {
  const matched = new Set(rows.filter((r) => r.match).map((r) => r.match!.node.id));
  const ips = new Set(hosts.map((h) => h.ip));
  return p.pages.flatMap((pg) => pg.nodes)
    .filter((n): n is DeviceNode => n.type === 'device' && !!n.data.ip?.trim() && !matched.has(n.id))
    .filter((n) => !(n.data.ip ?? '').split(/[\s,;/]+/).some((ip) => ips.has(ip)));
}

/* ---------- applying it ---------- */

export interface ScanApplyOptions {
  /** New devices go on a new page (named after the scan) or on the active page. */
  target: 'new-page' | 'active-page';
  pageName: string;
  /** Written as each found device's "Last seen". */
  date: string;
  id: () => string;
}

const extra = (d: DeviceData, label: string, value?: string) => {
  if (!value) return d.extraFields;
  const list = (d.extraFields ?? []).filter((f) => f.label !== label);
  return [...list, { label, value }];
};

/** The client's pages after the import, and the counts. Pure: the store commits the result as one undo step. */
export function applyScanRows(p: Project, rows: ScanRow[], o: ScanApplyOptions, stencil: (id: string) => StencilDef | undefined) {
  const updates = new Map(rows.filter((r) => r.action === 'update' && r.match).map((r) => [r.match!.node.id, r]));
  let pages: Page[] = p.pages.map((pg) => ({
    ...pg,
    nodes: pg.nodes.map((n) => {
      const r = n.type === 'device' ? updates.get(n.id) : undefined;
      if (!r || n.type !== 'device') return n;
      const h = r.host;
      let data: DeviceData = { ...n.data };
      // Fill what is missing; a device found by its MAC at another address gets the new IP.
      if (!data.ip?.trim() || r.match!.by === 'MAC') data.ip = h.ip;
      if (!data.mac?.trim() && h.mac) data.mac = h.mac;
      if (!data.model?.trim() && h.vendor) data.model = h.vendor;
      data = { ...data, extraFields: extra(data, 'Last seen', o.date) };
      if (h.os && !data.extraFields?.some((f) => f.label === 'OS')) data.extraFields = extra(data, 'OS', h.os);
      return { ...n, data };
    }),
  }));

  const adds = rows.filter((r) => r.action === 'add');
  const created: AppNode[] = [];
  let activePageId = p.activePageId;
  if (adds.length) {
    const target = o.target === 'new-page' ? newPage(o.pageName) : pages.find((pg) => pg.id === p.activePageId) ?? pages[0];
    const below = target.nodes.reduce((m, n) => Math.max(m, n.position.y + (n.measured?.height ?? n.height ?? 100)), 0) + (target.nodes.length ? 160 : 0);
    // One row per kind of device (firewalls and switches first, end devices last), wrapping every 8.
    const order = RULES.map((r) => r.id);
    const kinds = [...new Set(adds.map((r) => r.stencilId))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    let y = below;
    for (const kind of kinds) {
      const st = stencil(kind);
      const w = Math.max(120, (st?.width ?? 160) * (st?.scale ?? 1));
      const h = Math.max(90, (st?.height ?? 90) * (st?.scale ?? 1));
      adds.filter((r) => r.stencilId === kind).forEach((r, i) => {
        const host = r.host;
        const data: DeviceData = {
          ...(st?.defaults ?? {}),
          stencilId: kind,
          name: host.name?.split('.')[0] || host.ip,
          ip: host.ip,
          ...(host.mac ? { mac: host.mac } : {}),
          ...(host.vendor && !st?.defaults?.model ? { model: host.vendor } : {}),
          ...(host.ports.length ? { notes: `Open ports: ${host.ports.slice(0, 30).join(', ')}` } : {}),
        };
        data.extraFields = extra(data, 'Last seen', o.date);
        if (host.os) data.extraFields = extra(data, 'OS', host.os);
        created.push({ id: o.id(), type: 'device', position: { x: (i % 8) * (w + 80), y: y + Math.floor(i / 8) * (h + 110) }, data } as AppNode);
      });
      y += Math.ceil(adds.filter((r) => r.stencilId === kind).length / 8) * (h + 110) + 40;
    }
    if (o.target === 'new-page') {
      pages = [...pages, { ...target, nodes: created }];
      activePageId = target.id;
    } else {
      pages = pages.map((pg) => (pg.id === target.id ? { ...pg, nodes: [...pg.nodes, ...created] } : pg));
    }
  }
  return { pages, activePageId, created: created.length, updated: updates.size };
}
