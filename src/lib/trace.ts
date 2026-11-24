import { totalLength } from './length';
import { rackLabel } from './rack';
import type { CableData, CableEdge, DeviceNode, Project, StencilDef } from './types';

/*
 * End-to-end cable paths. A patch panel port carries two cables: the patch cord on its front (to a switch) and the
 * permanent run on its back (to a desk, wall jack or another rack's panel). Tracing walks cable by cable and passes
 * through patch panels until it reaches real equipment at both ends, e.g.
 *   Core switch 14 → Patch panel A 7 → (back) → Front desk PC
 */

/** Patch panels (and other pass-through equipment): a port's two cables continue one another. */
const PASS_THROUGH_IDS = /^(patch-panel|wall-jack|splice-closure)/;
const PASS_THROUGH_TEXT = /\bpatch\s*panel\b|\bkeystone\b|\bwall\s*(jack|plate)\b|\bfaceplate\b|\bcoupler\b|\bsplice\b/i;

/**
 * A patch panel, wall jack, splice… (its ports carry a cable in and a cable out). Decided by what the device IS —
 * its stencil, or for an imported stencil its stencil name / model — never by the name the user gave the device
 * ("Patch Panel Room PC" is a PC).
 */
export function isPassThrough(d: DeviceNode | undefined, stencil?: StencilDef) {
  if (!d) return false;
  if (stencil && !stencil.custom) return PASS_THROUGH_IDS.test(stencil.id);
  return PASS_THROUGH_TEXT.test(`${stencil?.name ?? ''} ${stencil?.defaults?.model ?? ''} ${d.data.model ?? ''}`);
}

export interface TraceHop {
  nodeId: string;
  name: string;
  port?: string;
  portLabel: string;
  /** Where it is mounted ("Rack A U31"), if it is. */
  where: string;
  /** What the port notes say is plugged in (a wall jack number, a desk). */
  note: string;
  passThrough: boolean;
}

export interface TraceLink {
  edgeId: string;
  pageId: string;
  data?: CableData;
}

export interface Trace {
  hops: TraceHop[];
  /** links[i] joins hops[i] and hops[i + 1]. */
  links: TraceLink[];
}

type Stencils = (id: string) => StencilDef | undefined;

function index(p: Project) {
  const devices = new Map<string, DeviceNode>();
  const byPort = new Map<string, { e: CableEdge; pageId: string }[]>();
  for (const pg of p.pages) {
    for (const n of pg.nodes) if (n.type === 'device') devices.set(n.id, n as DeviceNode);
    for (const e of pg.edges) {
      for (const [n, h] of [[e.source, e.sourceHandle], [e.target, e.targetHandle]] as const) {
        const k = `${n}|${h ?? ''}`;
        byPort.set(k, [...(byPort.get(k) ?? []), { e, pageId: pg.id }]);
      }
    }
  }
  const mounts = new Map<string, string>();
  for (const r of p.racks ?? []) for (const it of r.items) if (it.nodeId) mounts.set(it.nodeId, `${r.name} ${rackLabel(it)}`);
  return { devices, byPort, mounts };
}

function hop(ix: ReturnType<typeof index>, stencil: Stencils, nodeId: string, port: string | undefined): TraceHop {
  const d = ix.devices.get(nodeId);
  const st = d ? stencil(d.data.stencilId) : undefined;
  const pd = port ? d?.data.ports?.[port] : undefined;
  return {
    nodeId, name: d?.data.name ?? 'Item', port,
    portLabel: port ? pd?.label || st?.ports.find((q) => q.id === port)?.label || port : '',
    where: ix.mounts.get(nodeId) ?? '', note: pd?.description ?? '', passThrough: isPassThrough(d, st),
  };
}

/** One direction: from a port, out along `first` (or its only cable), through patch panels, to the end. */
function walk(ix: ReturnType<typeof index>, stencil: Stencils, nodeId: string, port: string | undefined, skip?: string) {
  const hops: TraceHop[] = [];
  const links: TraceLink[] = [];
  const seen = new Set<string>();
  let at = { nodeId, port };
  let from = skip;
  for (let guard = 0; guard < 64; guard++) {
    const out = (ix.byPort.get(`${at.nodeId}|${at.port ?? ''}`) ?? []).find((x) => x.e.id !== from && !seen.has(x.e.id));
    if (!out) break;
    seen.add(out.e.id);
    const [nid, h] = out.e.source === at.nodeId && (out.e.sourceHandle ?? undefined) === at.port ? [out.e.target, out.e.targetHandle ?? undefined] : [out.e.source, out.e.sourceHandle ?? undefined];
    links.push({ edgeId: out.e.id, pageId: out.pageId, data: out.e.data });
    const next = hop(ix, stencil, nid, h);
    hops.push(next);
    if (!next.passThrough) break;
    at = { nodeId: nid, port: h };
    from = out.e.id;
  }
  return { hops, links };
}

/**
 * The whole path through a port: both directions from it, joined, so tracing from the middle (a patch panel port)
 * gives the same end-to-end path as tracing from either end.
 */
export function tracePath(p: Project, nodeId: string, port: string | undefined, stencil: Stencils): Trace {
  const ix = index(p);
  const start = hop(ix, stencil, nodeId, port);
  const cables = ix.byPort.get(`${nodeId}|${port ?? ''}`) ?? [];
  if (!cables.length) return { hops: [start], links: [] };
  const a = walk(ix, stencil, nodeId, port, start.passThrough ? cables[1]?.e.id : undefined);
  if (!start.passThrough || cables.length < 2) return { hops: [start, ...a.hops], links: a.links };
  const b = walk(ix, stencil, nodeId, port, cables[0].e.id);
  return { hops: [...b.hops.reverse(), start, ...a.hops], links: [...b.links.reverse(), ...a.links] };
}

/** Total length of a path when every cable has one ("85 ft" + "3 ft" → "88 ft"; mixed units add up in feet), else ''. */
export function pathLength(t: Trace) {
  return totalLength(t.links.map((l) => l.data?.length));
}

/** "Core switch 14 → Patch panel A 7 → Front desk PC" */
export function pathText(t: Trace) {
  return t.hops.map((h) => [h.name, h.portLabel].filter(Boolean).join(' ')).join(' → ');
}

/** Every end-to-end path that passes through a patch panel (each once), for the Cable paths table. */
export function allPaths(p: Project, stencil: Stencils): Trace[] {
  const ix = index(p);
  const done = new Set<string>();
  const out: Trace[] = [];
  for (const [k, list] of ix.byPort) {
    const [nid, port] = k.split('|');
    const d = ix.devices.get(nid);
    if (!d || !isPassThrough(d, stencil(d.data.stencilId)) || list.every((x) => done.has(x.e.id))) continue;
    const t = tracePath(p, nid, port || undefined, stencil);
    t.links.forEach((l) => done.add(l.edgeId));
    // Read from real equipment: a path that ends at an unpatched panel port starts at its other end.
    if (t.hops[0].passThrough && !t.hops[t.hops.length - 1].passThrough) { t.hops.reverse(); t.links.reverse(); }
    if (t.hops.length >= 2) out.push(t);
  }
  return out;
}
