'use client';

import type { ReactFlowInstance } from '@xyflow/react';
import { displayColors, hiddenLayers } from '../display';
import { DEFAULT_SETUP, pageBounds, PX_PER_IN, sheetSize } from '../pageSetup';
import { editableCopy } from '../shapeCopy';
import { realLength } from '../units';
import type { AppNode, CableData, Page, Project, StencilDef } from '../types';
import { writeVsdx, type VPage, type VPt, type VShape } from './vsdxWriter';

/**
 * "Save as Visio drawing": shows each page in turn and turns what is drawn into Visio shapes — devices as pictures
 * with their details as Shape Data, cables as lines along their routed path (with colour, dashes and arrows),
 * zones, notes, drawing shapes, dimension lines, labels and info boxes as native Visio shapes and text.
 */

const PNG_MAX = 1600;
const inch = (px: number) => px / PX_PER_IN;
const pt = (px: number) => px * 0.75;

/** Rasterizes a picture (any data URL: SVG, WebP, PNG…) to PNG bytes at about `w`×`h` pixels. */
async function toPng(src: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, PNG_MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a picture'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Ramer–Douglas–Peucker: keeps the corners of a sampled path, drops points on straight runs. */
function simplify(pts: VPt[], tol: number): VPt[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / (Math.hypot(b.y - a.y, b.x - a.x) || 1);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

export interface ExportContext {
  rf: ReactFlowInstance<AppNode>;
  stencilOf: (id: string) => StencilDef | undefined;
  /** Shows a page on the canvas and resolves once it is drawn. */
  showPage: (page: Page) => Promise<void>;
}

export async function exportVsdx(project: Project, ctx: ExportContext): Promise<Uint8Array> {
  const media: Record<string, Uint8Array> = {};
  const mediaFor = new Map<string, string>(); // picture key → file name
  const addMedia = async (key: string, src: string, w: number, h: number) => {
    if (!mediaFor.has(key)) {
      const name = `image${mediaFor.size + 1}.png`;
      media[name] = await toPng(src, w, h);
      mediaFor.set(key, name);
    }
    return mediaFor.get(key)!;
  };
  const colors = displayColors(project);
  const hidden = hiddenLayers(project);
  const pages: VPage[] = [];
  // Layers: the same list on every page; shapes refer to them by index.
  const layerList = project.layers ?? [];
  const vLayers = layerList.map((l) => ({ name: l.name, visible: l.visible, print: l.print !== false, lock: !!l.locked, active: !!l.active }));
  const layerIdx = (id?: string) => {
    const i = id ? layerList.findIndex((l) => l.id === id) : -1;
    return i >= 0 ? [i] : undefined;
  };
  // A background page and the pages using it share one page size, so Visio lines them up (bottom-left origin).
  const estimate = (pg: Page) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const n of pg.nodes) {
      const st = n.style as { width?: number; height?: number } | undefined;
      const w = n.measured?.width ?? n.width ?? st?.width ?? 100, h = n.measured?.height ?? n.height ?? st?.height ?? 100;
      a = Math.min(a, n.position.x); b = Math.min(b, n.position.y); c = Math.max(c, n.position.x + w); d = Math.max(d, n.position.y + h);
    }
    return a === Infinity ? null : { x: a, y: b, w: c - a, h: d - b };
  };
  const related = (pg: Page) => (pg.background
    ? project.pages.filter((x) => x.backgroundId === pg.id)
    : project.pages.filter((x) => x.id === pg.backgroundId && x.background));

  for (const pg of project.pages) {
    await ctx.showPage(pg);
    const { rf } = ctx;
    // Live geometry: what React Flow measured, so sizes match the screen.
    // Size from the drawn element (what you see), position from React Flow.
    const box = (id: string) => {
      const n = rf.getInternalNode(id);
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (!n) return null;
      return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: el?.offsetWidth ?? n.measured.width ?? 0, h: el?.offsetHeight ?? n.measured.height ?? 0 };
    };
    const domBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      const a = rf.screenToFlowPosition({ x: r.left, y: r.top }, { snapToGrid: false });
      const z = rf.screenToFlowPosition({ x: r.right, y: r.bottom }, { snapToGrid: false });
      return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
    };

    // Page: whole sheets around everything drawn (as on screen).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (b: { x: number; y: number; w: number; h: number } | null) => {
      if (!b) return;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    };
    pg.nodes.forEach((n) => grow(box(n.id)));
    related(pg).forEach((x) => grow(estimate(x)));
    document.querySelectorAll('.react-flow__viewport .nc-infobox, .react-flow__viewport .nc-device-label').forEach((el) => grow(domBox(el)));
    const sheet = sheetSize(pg.setup ?? DEFAULT_SETUP);
    const pb = pageBounds(x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, sheet);
    const X = (v: number) => inch(v - pb.x), Y = (v: number) => inch(v - pb.y);
    const ibox = (b: { x: number; y: number; w: number; h: number }) => ({ x: X(b.x), y: Y(b.y), w: inch(b.w), h: inch(b.h) });

    const back: VShape[] = [], zones: VShape[] = [], cables: VShape[] = [], front: VShape[] = [], texts: VShape[] = [];
    const ordered = [...pg.nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    for (const n of ordered) {
      const b = box(n.id);
      if (!b || !b.w || !b.h) continue;
      const layer = n.type === 'device' || n.type === 'shape' ? n.data.layer : undefined;
      if (layer && hidden.has(layer)) continue;
      const f0 = front.length, t0 = texts.length;
      switch (n.type) {
        case 'backdrop':
          back.push({ kind: 'image', name: 'Floor plan', box: ibox(b), media: await addMedia(`bd:${n.id}`, n.data.image, n.data.naturalWidth, n.data.naturalHeight) });
          break;
        case 'zone':
          zones.push({
            kind: 'rect', name: n.data.title, container: true, box: ibox(b), line: n.data.color, dashed: true, lineWeightPt: 1.5, fill: n.data.color, fillTransparency: 0.93, rounding: inch(8),
            text: { text: n.data.title.toUpperCase(), color: n.data.color, sizePt: 7, bold: true, align: 'left', valign: 'top' },
          });
          break;
        case 'note':
          front.push({ kind: 'rect', name: 'Note', box: ibox(b), fill: '#FEF3C7', line: '#E5C76B', lineWeightPt: 0.5, text: { text: n.data.text, sizePt: 7.5, align: 'left', valign: 'top' } });
          break;
        case 'shape': {
          const d = n.data;
          const style = { fill: d.fill === 'transparent' ? null : d.fill, line: d.stroke === 'transparent' ? null : d.stroke, dashed: d.dashed, lineWeightPt: 1.5 };
          const text = d.text ? { text: d.text, color: d.textColor, sizePt: pt(d.fontSize), bold: d.bold, italic: d.italic, underline: d.underline, align: d.align, valign: d.valign } : undefined;
          const bb = ibox(b);
          if (d.kind === 'ellipse') front.push({ kind: 'ellipse', box: bb, ...style, text });
          else if (d.kind === 'diamond') front.push({ kind: 'polygon', box: bb, points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }], ...style, text });
          else if (d.kind === 'arrow') {
            const head = Math.min(b.w * 0.4, b.h) / b.w;
            let pts: VPt[] = [{ x: 0, y: 0.28 }, { x: 1 - head, y: 0.28 }, { x: 1 - head, y: 0 }, { x: 1, y: 0.5 }, { x: 1 - head, y: 1 }, { x: 1 - head, y: 0.72 }, { x: 0, y: 0.72 }];
            const rot = ((d.rotation ?? 0) % 360 + 360) % 360;
            // The arrow is drawn rotated about its centre; turn the outline the same way.
            const turn = (p: VPt): VPt => (rot === 90 ? { x: 1 - p.y, y: p.x } : rot === 180 ? { x: 1 - p.x, y: 1 - p.y } : rot === 270 ? { x: p.y, y: 1 - p.x } : p);
            pts = pts.map(turn);
            front.push({ kind: 'polygon', box: bb, points: pts, ...style, text });
          } else if (d.kind === 'door') {
            // Leaf and swing as one line (arc sampled), in the shape's own rotation and swing.
            const r = Math.min(bb.w, bb.h);
            const local: VPt[] = [{ x: 0, y: 1 }, { x: 0, y: 1 - r / bb.h }];
            for (let k = 1; k <= 12; k++) { const t = (k / 12) * (Math.PI / 2); local.push({ x: (Math.sin(t) * r) / bb.w, y: 1 - (Math.cos(t) * r) / bb.h }); }
            const rot = ((d.rotation ?? 0) % 360 + 360) % 360;
            const turn = (p: VPt): VPt => {
              const q = d.flip ? { x: 1 - p.x, y: p.y } : p;
              return rot === 90 ? { x: 1 - q.y, y: q.x } : rot === 180 ? { x: 1 - q.x, y: 1 - q.y } : rot === 270 ? { x: q.y, y: 1 - q.x } : q;
            };
            front.push({ kind: 'line', name: 'Door', points: local.map(turn).map((p) => ({ x: bb.x + p.x * bb.w, y: bb.y + p.y * bb.h })), line: d.stroke === 'transparent' ? '#374151' : d.stroke, lineWeightPt: 1.5 });
          } else if (d.kind === 'window') {
            front.push({ kind: 'rect', name: 'Window', box: bb, fill: d.fill === 'transparent' ? null : d.fill, line: d.stroke, lineWeightPt: 1 });
            front.push({ kind: 'line', points: [{ x: bb.x, y: bb.y + bb.h / 2 }, { x: bb.x + bb.w, y: bb.y + bb.h / 2 }], line: d.stroke, lineWeightPt: 0.75 });
          } else if (d.kind === 'callout') {
            front.push({ kind: 'rect', name: 'Callout', box: bb, ...style, rounding: inch(6), text });
            const t = d.target ? box(d.target) : null;
            if (t) {
              // Leader from the callout box edge to the middle of the item it points to.
              const cx = b.x + b.w / 2, cy = b.y + b.h / 2, tx = t.x + t.w / 2, ty = t.y + t.h / 2;
              const dx = tx - cx, dy = ty - cy;
              const k = Math.min(Math.abs(dx) > 1e-6 ? b.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? b.h / 2 / Math.abs(dy) : Infinity, 1);
              cables.push({ kind: 'line', name: 'Callout leader', points: [{ x: X(cx + dx * k), y: Y(cy + dy * k) }, { x: X(tx), y: Y(ty) }], line: style.line ?? '#D97706', lineWeightPt: 1 });
            }
          } else if (d.kind === 'text') front.push({ kind: 'rect', box: bb, fill: null, line: null, text });
          else front.push({ kind: 'rect', box: bb, ...style, rounding: d.kind === 'rounded' ? Math.min(inch(16), bb.h / 3) : undefined, text });
          break;
        }
        case 'measure': {
          const a = { x: b.x, y: b.y };
          const z = { x: b.x + n.data.dx, y: b.y + n.data.dy };
          if (n.data.variant === 'wall') {
            front.push({ kind: 'line', name: 'Wall', points: [{ x: X(a.x), y: Y(a.y) }, { x: X(z.x), y: Y(z.y) }], line: '#4B5563', lineWeightPt: pt(n.data.thickness ?? 8) });
            break;
          }
          const len = Math.hypot(n.data.dx, n.data.dy);
          front.push({ kind: 'line', name: 'Dimension', points: [{ x: X(a.x), y: Y(a.y) }, { x: X(z.x), y: Y(z.y) }], line: '#334155', lineWeightPt: 1, arrowStart: true, arrowEnd: true });
          const label = [n.data.label, pg.scale ? realLength(len, pg.scale) : `${Math.round(len)}`].filter(Boolean).join(' ');
          const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
          texts.push({ kind: 'rect', box: { x: X(mid.x) - 0.5, y: Y(mid.y) - 0.09, w: 1, h: 0.18 }, fill: '#FFFFFF', line: null, text: { text: label, sizePt: 8, color: '#334155' } });
          break;
        }
        case 'device': {
          const d = n.data;
          const s = ctx.stencilOf(d.stencilId);
          if (!s) break;
          // One picture per shape, drawn at its native size (pictures are shared by every device using the shape).
          const src = s.style === 'image' && s.image ? s.image : editableCopy(s).image!;
          const name = await addMedia(`st:${s.id}`, src, s.width * (s.style === 'icon' ? 2 : 1), s.height * (s.style === 'icon' ? 2 : 1));
          const data: [string, string][] = [
            ['Name', d.name], ['Model', d.model ?? ''], ['IP', d.ip ?? ''], ['MAC', d.mac ?? ''], ['Serial', d.serial ?? ''],
            ['Asset tag', d.assetTag ?? ''], ['Location', d.location ?? ''], ['Status', d.status ?? 'active'], ['Type', s.name],
            ...(d.extraFields ?? []).filter((f) => f.value).map((f) => [f.label || 'Field', f.value] as [string, string]),
            ...(d.notes ? [['Notes', d.notes] as [string, string]] : []),
          ];
          // Ports become Visio connection points (named after the port), so cables can be glued to them in Visio.
          const k = b.w / (s.width * (s.style === 'icon' ? 1 : s.scale));
          const kk = (s.style === 'icon' ? 1 : s.scale) * k;
          const ports = s.ports.map((p) => ({ x: inch((p.x + p.w / 2) * kk), y: inch((p.y + p.h / 2) * kk), name: d.ports?.[p.id]?.label || p.label }));
          front.push({ kind: 'image', name: d.name, box: ibox(b), media: name, ports, data: data.filter(([, v]) => v !== '') });
          // Label and info box as drawn.
          const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
          const lab = el?.querySelector('.nc-device-label');
          if (lab) {
            const lines = [...lab.children].map((c) => c.textContent ?? '').filter(Boolean);
            texts.push({ kind: 'rect', name: `${d.name} label`, box: ibox(domBox(lab)), fill: null, line: null, text: { text: lines.join('\n'), sizePt: 8, bold: true, align: s.style === 'icon' ? 'center' : 'left' } });
          }
          const info = el?.querySelector('.nc-infobox');
          if (info) {
            const text = (info as HTMLElement).innerText.replace(/\t/g, '  ').replace(/\n{2,}/g, '\n').trim();
            texts.push({ kind: 'rect', name: `${d.name} info`, box: ibox(domBox(info)), fill: '#FFFFFF', line: '#9CA3AF', lineWeightPt: 0.75, text: { text, sizePt: 7, align: 'left', valign: 'top' } });
          }
          break;
        }
      }
      // Everything drawn for an item on a layer (picture, label, info box) goes on that Visio layer.
      const li = layerIdx(layer);
      if (li) [...front.slice(f0), ...texts.slice(t0)].forEach((v) => { v.layers = li; });
    }

    // Cables along their drawn path.
    for (const e of pg.edges) {
      const d = (e.data ?? { cable: 'Cat6' }) as CableData;
      if (d.layer && hidden.has(d.layer)) continue;
      const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(e.id)}"] path.react-flow__edge-path`);
      if (!path) continue;
      const total = path.getTotalLength();
      const raw: VPt[] = [];
      for (let s = 0; s <= total; s += 3) raw.push(path.getPointAtLength(s));
      raw.push(path.getPointAtLength(total));
      const pts = simplify(raw, 0.6).map((p) => ({ x: X(p.x), y: Y(p.y) }));
      const st = colors.cable(d);
      const arrows = d.arrows ?? 'none';
      const ends = [pg.nodes.find((x) => x.id === e.source), pg.nodes.find((x) => x.id === e.target)].map((x) => (x?.type === 'device' ? x.data.name : x?.type === 'shape' ? x.data.text : ''));
      cables.push({
        kind: 'line', name: `${d.cable} ${ends.join(' – ')}`, points: pts, layers: layerIdx(d.layer), line: st.color, lineWeightPt: pt(st.width), dashed: !!st.dash,
        arrowStart: arrows === 'start' || arrows === 'both', arrowEnd: arrows === 'end' || arrows === 'both',
        data: [['Cable', d.cable], ['From', ends[0] ?? ''], ['To', ends[1] ?? ''], ['VLAN', d.vlan ?? ''], ['Length', d.length ?? ''], ['Label', d.label ?? '']].filter(([, v]) => v !== '') as [string, string][],
      });
      const text = [d.label, d.vlan && `VLAN ${d.vlan}`, d.showLength && d.length].filter(Boolean).join(' · ');
      if (text) {
        const mid = path.getPointAtLength(total / 2);
        const w = Math.max(0.4, text.length * 0.055);
        texts.push({ kind: 'rect', box: { x: X(mid.x) - w / 2, y: Y(mid.y) - 0.08, w, h: 0.16 }, fill: '#FFFFFF', line: st.color, lineWeightPt: 0.5, text: { text, sizePt: 6.5, color: st.color } });
      }
    }

    pages.push({ name: pg.name, width: inch(pb.w), height: inch(pb.h), shapes: [...back, ...zones, ...cables, ...front, ...texts], layers: vLayers, background: pg.background });
  }
  // Background pages by index.
  project.pages.forEach((pg, i) => {
    const b = pg.backgroundId ? project.pages.findIndex((x) => x.id === pg.backgroundId && x.background) : -1;
    if (b >= 0 && !pg.background) pages[i].backPage = b;
  });
  return writeVsdx({ pages, media, title: project.name });
}
