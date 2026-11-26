/**
 * Device look "Icons" (Design → Device Look): on a logical network page, devices drawn from front-panel art
 * (switches, firewalls, servers, imported vendor faceplates) are shown as compact network symbols instead, the way
 * Visio's network diagrams look. The faceplates stay in the rack view. Each symbol fills its box, so cables meet
 * its edge; which edge a cable leaves from is worked out from where the other end is (see `logicalPorts`).
 */
import type { AppNode, CableEdge, Page, StencilDef } from './types';

export type LogicalKind = 'switch' | 'patch' | 'firewall' | 'router' | 'server' | 'storage' | 'ups' | 'pdu' | 'ap' | 'generic';

/** Symbol sizes in diagram units. */
export const LOGICAL_SIZE: Record<LogicalKind, { w: number; h: number }> = {
  switch: { w: 120, h: 40 },
  patch: { w: 120, h: 28 },
  firewall: { w: 96, h: 52 },
  router: { w: 76, h: 48 },
  server: { w: 50, h: 66 },
  storage: { w: 64, h: 60 },
  ups: { w: 52, h: 64 },
  pdu: { w: 120, h: 26 },
  ap: { w: 70, h: 40 },
  generic: { w: 96, h: 50 },
};

/** What kind of network symbol a shape is drawn as. */
export function logicalKind(s: Pick<StencilDef, 'name' | 'category'>): LogicalKind {
  const n = s.name;
  if (/patch\s*panel|keystone/i.test(n)) return 'patch';
  if (/\bpdu\b|power\s*strip|power\s*distribution/i.test(n)) return 'pdu';
  if (/\bups\b|uninterruptible|smart-?ups/i.test(n)) return 'ups';
  if (s.category === 'Firewalls' || /firewall|sonicwall|fortigate|palo\s*alto|\bpfsense\b|\basa\b/i.test(n)) return 'firewall';
  if (/\b(nas|san)\b|storage|synology|qnap|powervault|disk\s*array/i.test(n)) return 'storage';
  if (/router|gateway|\bsd-?wan\b|\bedge\b/i.test(n) || s.category === 'WAN') return 'router';
  if (/access\s*point|\bap\b|wi-?fi/i.test(n) || s.category === 'Wireless') return 'ap';
  if (s.category === 'Servers' || /server|poweredge|proliant|thinksystem|\bhost\b|hypervisor/i.test(n)) return 'server';
  if (s.category === 'Switching' || /switch/i.test(n)) return 'switch';
  return 'generic';
}

/** Whether a device with this shape is drawn as a symbol on a page with this look (icon shapes always are). */
export const drawsAsSymbol = (look: Page['look'], s: StencilDef | undefined) => look === 'icons' && !!s && s.style !== 'icon';

const STROKE = '#1e3a8a';

/** The symbol as SVG markup, `w`×`h`, filling its box. */
export function logicalSvg(kind: LogicalKind, w: number, h: number): string {
  const sw = 2;
  const box = (fill: string, stroke = STROKE, r = 5) => `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  let body = '';
  switch (kind) {
    case 'switch': {
      // The usual switch symbol: a flat box with two pairs of opposed arrows.
      const cy = h / 2, a = (y: number, l2r: boolean) => {
        const x0 = w * 0.3, x1 = w * 0.7, hx = l2r ? x1 : x0, d = l2r ? -6 : 6;
        return `<path d="M${x0} ${y} H${x1} M${hx + d} ${y - 4} L${hx} ${y} L${hx + d} ${y + 4}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      };
      body = box('#2563eb', STROKE) + a(cy - 7, true) + a(cy + 7, false);
      break;
    }
    case 'patch': {
      const n = 12, gap = (w - 20) / n;
      body = box('#e5e7eb', '#4b5563', 3) + Array.from({ length: n }, (_, i) => `<rect x="${10 + i * gap + gap * 0.15}" y="${h / 2 - 5}" width="${gap * 0.7}" height="10" rx="1.5" fill="#374151"/>`).join('');
      break;
    }
    case 'firewall': {
      // A brick wall.
      const rows = 4, rh = (h - sw) / rows;
      let bricks = '';
      for (let r = 1; r < rows; r++) bricks += `<path d="M${sw} ${sw / 2 + r * rh} H${w - sw}" stroke="#fff" stroke-width="1.6"/>`;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? w / 8 : 0;
        for (let x = off + w / 4; x < w - 4; x += w / 4) bricks += `<path d="M${x} ${sw / 2 + r * rh} V${sw / 2 + (r + 1) * rh}" stroke="#fff" stroke-width="1.6"/>`;
      }
      body = box('#dc2626', '#7f1d1d', 4) + bricks;
      break;
    }
    case 'router': {
      // Cylinder with crossing arrows (the classic router symbol), seen from the side.
      const ry = 8;
      body = `<path d="M${sw} ${ry + 1} V${h - ry - 1} A${w / 2 - sw} ${ry} 0 0 0 ${w - sw} ${h - ry - 1} V${ry + 1}" fill="#0891b2" stroke="${STROKE}" stroke-width="${sw}"/>` +
        `<ellipse cx="${w / 2}" cy="${ry + 1}" rx="${w / 2 - sw}" ry="${ry}" fill="#67e8f9" stroke="${STROKE}" stroke-width="${sw}"/>` +
        `<path d="M${w * 0.3} ${h * 0.5} L${w * 0.7} ${h * 0.75} M${w * 0.7} ${h * 0.5} L${w * 0.3} ${h * 0.75}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
      break;
    }
    case 'server': {
      const slot = (y: number) => `<rect x="${w * 0.18}" y="${y}" width="${w * 0.64}" height="6" rx="1.5" fill="#cbd5e1"/><circle cx="${w * 0.74}" cy="${y + 3}" r="1.6" fill="#22c55e"/>`;
      body = box('#334155', '#0f172a', 4) + slot(h * 0.16) + slot(h * 0.32) + slot(h * 0.48) + `<circle cx="${w / 2}" cy="${h * 0.8}" r="3.5" fill="none" stroke="#cbd5e1" stroke-width="1.6"/>`;
      break;
    }
    case 'storage': {
      const ry = 6, layer = (y: number) => `<path d="M${sw} ${y} A${w / 2 - sw} ${ry} 0 0 0 ${w - sw} ${y}" fill="none" stroke="#fff" stroke-width="1.6"/>`;
      body = `<path d="M${sw} ${ry + 1} V${h - ry - 1} A${w / 2 - sw} ${ry} 0 0 0 ${w - sw} ${h - ry - 1} V${ry + 1}" fill="#7c3aed" stroke="#3b0764" stroke-width="${sw}"/>` +
        `<ellipse cx="${w / 2}" cy="${ry + 1}" rx="${w / 2 - sw}" ry="${ry}" fill="#c4b5fd" stroke="#3b0764" stroke-width="${sw}"/>` + layer(h * 0.42) + layer(h * 0.66);
      break;
    }
    case 'ups': {
      body = box('#f1f5f9', '#334155', 4) + `<rect x="${w * 0.18}" y="${h * 0.12}" width="${w * 0.64}" height="${h * 0.2}" rx="2" fill="#0f766e"/>` +
        `<path d="M${w * 0.56} ${h * 0.4} L${w * 0.38} ${h * 0.66} H${w * 0.52} L${w * 0.44} ${h * 0.9} L${w * 0.66} ${h * 0.6} H${w * 0.52} Z" fill="#eab308" stroke="#713f12" stroke-width="1.2" stroke-linejoin="round"/>`;
      break;
    }
    case 'pdu': {
      const n = 6, gap = (w - 24) / n;
      body = box('#1f2937', '#030712', 3) + Array.from({ length: n }, (_, i) => `<rect x="${16 + i * gap}" y="${h / 2 - 5}" width="${gap * 0.55}" height="10" rx="2" fill="#e5e7eb"/>`).join('') +
        `<path d="M${w - 10} ${h * 0.25} L${w - 14} ${h / 2 + 1} H${w - 9} L${w - 12} ${h * 0.78}" fill="none" stroke="#facc15" stroke-width="1.6" stroke-linejoin="round"/>`;
      break;
    }
    case 'ap': {
      body = `<path d="M${sw} ${h - sw} Q${sw} ${h * 0.35} ${w / 2} ${h * 0.35} Q${w - sw} ${h * 0.35} ${w - sw} ${h - sw} Z" fill="#f1f5f9" stroke="${STROKE}" stroke-width="${sw}"/>` +
        `<path d="M${w * 0.32} ${h * 0.24} Q${w / 2} ${h * 0.02} ${w * 0.68} ${h * 0.24} M${w * 0.4} ${h * 0.3} Q${w / 2} ${h * 0.18} ${w * 0.6} ${h * 0.3}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>` +
        `<circle cx="${w / 2}" cy="${h * 0.7}" r="3" fill="#2563eb"/>`;
      break;
    }
    default:
      body = box('#e2e8f0', '#334155', 6) + `<rect x="${w * 0.15}" y="${h * 0.4}" width="${w * 0.7}" height="${h * 0.2}" rx="2" fill="#94a3b8"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

const symbolUrls = new Map<LogicalKind, string>();
/** The symbol as a data URL (for <img> and exports). */
export function logicalSrc(kind: LogicalKind): string {
  let u = symbolUrls.get(kind);
  if (!u) {
    const { w, h } = LOGICAL_SIZE[kind];
    u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logicalSvg(kind, w, h));
    symbolUrls.set(kind, u);
  }
  return u;
}

const symbolStencils = new WeakMap<StencilDef, StencilDef>();
/**
 * The shape as its symbol: a picture shape the size of the symbol, keeping the shape's ports (all of them at the
 * middle, as exports have no cable-by-cable edge to put them on). Used where a plain shape is needed (exports, sizes).
 */
export function symbolStencil(s: StencilDef): StencilDef {
  let out = symbolStencils.get(s);
  if (!out) {
    const kind = logicalKind(s);
    const { w, h } = LOGICAL_SIZE[kind];
    out = { ...s, style: 'image', image: logicalSrc(kind), width: w, height: h, scale: 1, back: undefined, ports: s.ports.map((p) => ({ ...p, x: w / 2 - 4, y: h / 2 - 4, w: 8, h: 8, side: 'bottom' })) };
    symbolStencils.set(s, out);
  }
  return out;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';
export interface PortSpot { x: number; y: number; side: Side }
type Box = { x: number; y: number; w: number; h: number };

/**
 * Where each port of a device drawn as a symbol sits: every cable leaves from the edge facing the device at its
 * other end (top / bottom when they are above or below each other, else left / right), and the cables on one edge
 * are spread along it in the order of their other ends, so they don't cross. Unused ports sit at the bottom middle.
 * `edges` are the cables as drawn (after rack-only devices are taken out). Positions are within the w×h box.
 */
export function logicalPorts(id: string, ports: string[], w: number, h: number, edges: Pick<CableEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>[], boxOf: (id: string) => Box | undefined): Record<string, PortSpot> {
  const me = boxOf(id);
  const out: Record<string, PortSpot> = {};
  const bySide: Record<Side, { port: string; key: number }[]> = { top: [], bottom: [], left: [], right: [] };
  const used = new Set<string>();
  if (me) {
    const cx = me.x + me.w / 2, cy = me.y + me.h / 2;
    for (const e of edges) {
      const mine = e.source === id ? e.sourceHandle : e.target === id ? e.targetHandle : null;
      if (!mine || used.has(mine) || e.source === e.target) continue;
      const other = boxOf(e.source === id ? e.target : e.source);
      if (!other) continue;
      used.add(mine);
      const ox = other.x + other.w / 2, oy = other.y + other.h / 2;
      const apart = Math.abs(oy - cy) > (me.h + other.h) / 2;
      const side: Side = apart ? (oy < cy ? 'top' : 'bottom') : ox < cx ? 'left' : 'right';
      bySide[side].push({ port: mine, key: side === 'top' || side === 'bottom' ? ox : oy });
    }
  }
  const order = new Map(ports.map((p, i) => [p, i]));
  for (const side of Object.keys(bySide) as Side[]) {
    const list = bySide[side].sort((a, b) => a.key - b.key || (order.get(a.port) ?? 0) - (order.get(b.port) ?? 0));
    const n = list.length;
    const along = side === 'top' || side === 'bottom' ? w : h;
    // Spread over the middle of the edge; one cable leaves from the middle.
    const span = Math.min(along * 0.8, Math.max(0, n - 1) * 14);
    list.forEach((it, i) => {
      const t = along / 2 - span / 2 + (n > 1 ? (span * i) / (n - 1) : 0);
      out[it.port] = side === 'top' ? { x: t, y: 0, side } : side === 'bottom' ? { x: t, y: h, side } : side === 'left' ? { x: 0, y: t, side } : { x: w, y: t, side };
    });
  }
  for (const p of ports) if (!out[p]) out[p] = { x: w / 2, y: h, side: 'bottom' };
  return out;
}

/** A node's box on the diagram (top-left, measured size), for `logicalPorts`. */
export function nodeBox(n: AppNode | undefined): Box | undefined {
  if (!n) return undefined;
  const st = n.style as { width?: number; height?: number } | undefined;
  return { x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? st?.width ?? 60, h: n.measured?.height ?? n.height ?? st?.height ?? 60 };
}
