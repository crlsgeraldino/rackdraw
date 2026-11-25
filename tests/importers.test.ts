/*
 * Damaged or hostile files must end quickly, with a clear message at worst: never freeze the app or run it out of
 * memory. Each case is an input the pre-public audit found to hang or crash a reader, plus a seeded mutation fuzz.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDxf } from '../src/lib/dxf';
import { parseCsv, readTable } from '../src/lib/dataImport';
import { parseScan } from '../src/lib/scanImport';
import { emfToSvg, bmpToRgba } from '../src/lib/visio/emf';
import { imageDims } from '../src/lib/imageImport';
import { sanitizeProject } from '../src/lib/sanitize';
import { BUILT_IN_TEMPLATES, projectFromTemplate } from '../src/lib/templates';
import { STENCIL_MAP } from '../src/lib/stencils';
import { checkProject } from '../src/lib/check';
import { billOfMaterials } from '../src/lib/bom';
import { subnetUsage, ipPlanProblems } from '../src/lib/ipam';
import { lifecycleRows, circuitRows } from '../src/lib/lifecycle';
import { portMapDevices, portMap, portFaceSvg } from '../src/lib/portMap';
import { cableLabels } from '../src/lib/labels';
import { rackPower } from '../src/lib/rackPower';
import type { Project } from '../src/lib/types';

/** Runs `f` and fails if it takes longer than `ms` (a hang shows up as a slow test, not a stuck run). */
function quick<T>(ms: number, f: () => T): T {
  const t = Date.now();
  const r = f();
  assert.ok(Date.now() - t < ms, `took ${Date.now() - t} ms`);
  return r;
}

const dxfDoc = (ents: string, blocks = '') => `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents}0\nENDSEC\n0\nEOF\n`;

test('DXF: absurd arc and ellipse angles finish', () => {
  for (const e of [
    '0\nARC\n10\n0\n20\n0\n40\n5\n50\n0\n51\n1e300\n',
    '0\nARC\n10\n0\n20\n0\n40\n5\n50\n-1e300\n51\n0\n',
    '0\nARC\n10\n0\n20\n0\n40\n5\n50\n0\n51\n1e9\n',
    '0\nARC\n10\n0\n20\n0\n40\n5\n50\n-2147483649\n51\n2147483648\n',
    '0\nELLIPSE\n10\n0\n20\n0\n11\n5\n21\n0\n40\n0.5\n41\n1e300\n42\n0\n',
    '0\nARC\n10\n0\n20\n0\n40\n5\n50\nnan\n51\ninf\n',
  ]) {
    const r = quick(1000, () => parseDxf(dxfDoc(e)));
    assert.ok(r.width > 0);
  }
});

test('DXF: an ordinary arc keeps its shape', () => {
  // A quarter circle from 0° to 90°: its bounds are a square.
  const r = parseDxf(dxfDoc('0\nARC\n10\n0\n20\n0\n40\n10\n50\n0\n51\n90\n'));
  assert.equal(r.width, r.height);
});

test('DXF: a large drawing (over 300k points) is inserted', () => {
  let e = '';
  for (let i = 0; i < 3000; i++) e += `0\nCIRCLE\n10\n${i}\n20\n${i % 50}\n40\n0.4\n`;
  for (let i = 0; i < 100000; i++) e += `0\nLINE\n10\n${i % 300}\n20\n${i % 77}\n11\n${(i % 300) + 1}\n21\n${i % 77}\n`;
  const r = quick(5000, () => parseDxf(dxfDoc(e)));
  assert.ok(r.width > 1000);
});

test('DXF: blocks nested many times stop with a clear message', () => {
  let blocks = '';
  for (let lvl = 0; lvl < 6; lvl++) {
    blocks += `0\nBLOCK\n2\nB${lvl}\n10\n0\n20\n0\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n`;
    if (lvl < 5) for (let i = 0; i < 40; i++) blocks += `0\nINSERT\n2\nB${lvl + 1}\n10\n${i}\n20\n0\n`;
    blocks += '0\nENDBLK\n';
  }
  assert.throws(() => quick(3000, () => parseDxf(dxfDoc('0\nINSERT\n2\nB0\n10\n0\n20\n0\n', blocks))), /too large or too complex/);
});

test('CSV: 200,000 rows are read', async () => {
  const text = 'Name,IP\n' + Array.from({ length: 200000 }, (_, i) => `host${i},10.0.${(i >> 8) & 255}.${i & 255}`).join('\n');
  const t = await readTable(new File([text], 'big.csv'));
  assert.equal(t.rows.length, 200000);
});

test('Network scan: unclosed <host> tags finish quickly', () => {
  const r = quick(2000, () => parseScan('<nmaprun>' + '<host>'.repeat(200000)));
  assert.equal(r.hosts.length, 0);
});

test('Network scan: hosts and open ports are still read', () => {
  const xml = `<nmaprun><host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/><hostnames><hostname name="pc1"/></hostnames>
    <ports><port protocol="tcp" portid="22"><state state="open"/></port><port protocol="tcp" portid="23"><state state="closed"/></port></ports></host>
    <host><status state="down"/><address addr="10.0.0.6" addrtype="ipv4"/></host></nmaprun>`;
  const r = parseScan(xml);
  assert.equal(r.hosts.length, 1);
  assert.deepEqual(r.hosts[0].ports, [22]);
  assert.equal(r.hosts[0].name, 'pc1');
});

/** An EMF with one STRETCHDIBITS record holding a w×h 32-bit bitmap; `src` overrides the source rectangle. */
function emfWithBitmap(w: number, h: number, src?: [number, number, number, number]) {
  const head = 88, bmi = 40, bits = w * h * 4, rec = 80 + bmi + bits;
  const buf = new ArrayBuffer(head + rec + 20);
  const v = new DataView(buf);
  v.setUint32(0, 1, true); v.setUint32(4, head, true); v.setInt32(16, 100, true); v.setInt32(20, 100, true);
  const o = head;
  v.setUint32(o, 81, true); v.setUint32(o + 4, rec, true);
  const [sx, sy, sw, sh] = src ?? [0, 0, w, h];
  v.setInt32(o + 32, sx, true); v.setInt32(o + 36, sy, true); v.setInt32(o + 40, sw, true); v.setInt32(o + 44, sh, true);
  v.setUint32(o + 48, 80, true); v.setUint32(o + 52, bmi, true); v.setUint32(o + 56, 80 + bmi, true); v.setUint32(o + 60, bits, true);
  v.setUint32(o + 68, 0x00cc0020, true); v.setInt32(o + 72, 10, true); v.setInt32(o + 76, 10, true);
  v.setUint32(o + 80, 40, true); v.setInt32(o + 84, w, true); v.setInt32(o + 88, h, true); v.setUint16(o + 92, 1, true); v.setUint16(o + 94, 32, true);
  for (let i = 0; i < w * h; i++) v.setUint32(o + 80 + bmi + i * 4, 0xff3366cc, true);
  v.setUint32(o + rec, 14, true); v.setUint32(o + rec + 4, 20, true);
  return new Uint8Array(buf);
}

test('EMF: a normal bitmap is drawn', () => {
  const sizes: [number, number][] = [];
  emfToSvg(emfWithBitmap(4, 3), (w, h) => { sizes.push([w, h]); return 'data:,'; });
  assert.deepEqual(sizes, [[4, 3]]);
});

test('EMF: a crop rectangle bigger than the bitmap allocates no more than the bitmap', () => {
  let asked = 0;
  emfToSvg(emfWithBitmap(1, 1, [-20000, -20000, 20000, 20000]), (_w, _h, rgba) => { asked = rgba.length; return 'data:,'; });
  assert.ok(asked <= 4, `asked for ${asked} bytes`);
});

test('EMF: bitmaps pointing outside their record are skipped', () => {
  // 200 records sharing one 4000×4000 bitmap placed after them: each would decode 16 M pixels.
  const W = 4000, H = 4000, stride = Math.ceil(W / 32) * 4, bits = stride * H;
  const recs = 200, recSize = 80, head = 88, bmiAt = head + recs * recSize + 20, bitsAt = bmiAt + 48;
  const buf = new ArrayBuffer(bitsAt + bits + 20);
  const v = new DataView(buf);
  v.setUint32(0, 1, true); v.setUint32(4, head, true);
  for (let i = 0; i < recs; i++) {
    const o = head + i * recSize;
    v.setUint32(o, 81, true); v.setUint32(o + 4, recSize, true);
    v.setUint32(o + 48, bmiAt - o, true); v.setUint32(o + 52, 48, true); v.setUint32(o + 56, bitsAt - o, true);
    v.setUint32(o + 68, 0x00cc0020, true); v.setInt32(o + 72, 100, true); v.setInt32(o + 76, 100, true);
  }
  v.setUint32(head + recs * recSize, 14, true); v.setUint32(head + recs * recSize + 4, 20, true);
  v.setUint32(bmiAt, 40, true); v.setInt32(bmiAt + 4, W, true); v.setInt32(bmiAt + 8, H, true); v.setUint16(bmiAt + 14, 1, true);
  let pixels = 0;
  quick(2000, () => emfToSvg(new Uint8Array(buf), (w, h) => { pixels += w * h; return 'data:,'; }));
  assert.equal(pixels, 0);
});

test('Picture sizes are read from the header without decoding', () => {
  const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 30000); new DataView(png.buffer).setUint32(20, 40000);
  assert.deepEqual(imageDims(png), { width: 30000, height: 40000 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]);
  assert.deepEqual(imageDims(gif), { width: 16, height: 32 });
  // JPEG: SOI, an APP0 segment, then SOF0 with height 600, width 800.
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0]);
  assert.deepEqual(imageDims(jpg), { width: 800, height: 600 });
  assert.equal(imageDims(new Uint8Array([1, 2, 3])), null);
});

/* ------------------------------------------------------------------ */
/*  Seeded mutation fuzz                                               */
/* ------------------------------------------------------------------ */

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

/** A few random byte flips, inserts, deletes, repeats or "interesting" numbers in a copy of `seedText`. */
function mutate(seedText: string): string {
  let s = seedText;
  const n = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rnd() * Math.max(1, s.length));
    switch (Math.floor(rnd() * 5)) {
      case 0: s = s.slice(0, i) + String.fromCharCode(Math.floor(rnd() * 128)) + s.slice(i + 1); break;
      case 1: s = s.slice(0, i) + pick(['-1', '1e300', '-1e300', '2147483648', 'NaN', '0', '<', '>', '"', '\n', '\n0\n']) + s.slice(i); break;
      case 2: s = s.slice(0, i) + s.slice(i + Math.floor(rnd() * 20)); break;
      case 3: { const len = Math.floor(rnd() * 40); s = s.slice(0, i) + s.slice(i, i + len).repeat(1 + Math.floor(rnd() * 50)) + s.slice(i); break; }
      default: s = s.slice(0, i) + pick(['ARC', 'INSERT', 'BLOCK', 'ELLIPSE', '<host>', '</host>', '<port>', ',', ';', '"']) + s.slice(i);
    }
  }
  return s;
}

/** Feeds 400 mutations of `seedText` to `parse`: only clean Errors are allowed, each input in under 2 s. */
function fuzz(seedText: string, parse: (s: string) => unknown) {
  for (let i = 0; i < 400; i++) {
    const input = mutate(seedText);
    const t = Date.now();
    try { parse(input); } catch (e) {
      assert.ok(e instanceof Error, `non-Error thrown: ${String(e)}`);
      assert.ok(!(e instanceof RangeError || e instanceof TypeError), `${(e as Error).name}: ${(e as Error).message}\ninput: ${JSON.stringify(input.slice(0, 300))}`);
    }
    assert.ok(Date.now() - t < 2000, `slow input: ${JSON.stringify(input.slice(0, 300))}`);
  }
}

test('fuzz: DXF', () => {
  const blocks = '0\nBLOCK\n2\nDOOR\n10\n0\n20\n0\n0\nARC\n10\n0\n20\n0\n40\n3\n50\n0\n51\n90\n0\nENDBLK\n';
  const ents = '0\nLINE\n10\n0\n20\n0\n11\n100\n21\n0\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n42\n0.5\n10\n10\n20\n0\n10\n10\n20\n10\n'
    + '0\nCIRCLE\n10\n50\n20\n50\n40\n5\n0\nELLIPSE\n10\n5\n20\n5\n11\n3\n21\n0\n40\n0.5\n41\n0\n42\n6.28\n'
    + '0\nTEXT\n10\n1\n20\n1\n40\n2\n1\nRoom 101\n0\nINSERT\n2\nDOOR\n10\n20\n20\n0\n41\n2\n42\n2\n50\n45\n';
  fuzz(dxfDoc(ents, blocks), (s) => parseDxf(s));
});

test('fuzz: network scans and CSV', () => {
  const nmap = '<nmaprun><host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/><address addr="AA:BB:CC:DD:EE:FF" addrtype="mac" vendor="Dell"/>'
    + '<ports><port portid="443"><state state="open"/></port></ports><os><osmatch name="Windows"/></os></host></nmaprun>';
  fuzz(nmap, (s) => parseScan(s));
  fuzz('IP,Name,MAC\n10.0.0.1,"gw, main",aa-bb-cc-dd-ee-ff\n10.0.0.2,pc,\n', (s) => { parseScan(s); parseCsv(s); });
});

test('fuzz: BMP and EMF bytes', () => {
  const emf = emfWithBitmap(3, 2);
  for (let i = 0; i < 400; i++) {
    const b = emf.slice();
    for (let k = 0; k < 4; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    // Out-of-range reads are RangeErrors that the Visio reader turns into a warning; nothing may hang or allocate wildly.
    const t = Date.now();
    try { emfToSvg(b, () => 'data:,'); } catch (e) { assert.ok(e instanceof Error); }
    try { bmpToRgba(b); } catch (e) { assert.ok(e instanceof Error); }
    assert.ok(Date.now() - t < 2000);
  }
});

test('fuzz: a client file with wrong field types never crashes the reports', () => {
  const base = JSON.stringify(projectFromTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-office-rack')!.project, 'Acme'));
  const st = (id: string) => STENCIL_MAP[id];
  const WRONG: unknown[] = [5, 'text', null, true, [], {}, [1, 2], { a: 1 }, -1, 1e308];
  const paths: string[][] = [];
  (function walk(v: unknown, path: string[]) {
    paths.push(path);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  })(JSON.parse(base), []);
  for (let i = 0; i < 1500; i++) {
    const obj = JSON.parse(base);
    const path = paths[1 + Math.floor(rnd() * (paths.length - 1))];
    let o = obj;
    for (const k of path.slice(0, -1)) o = o[k];
    o[path[path.length - 1]] = pick(WRONG);
    let p: Project;
    try { p = sanitizeProject(obj).project; } catch (e) { assert.equal((e as Error).constructor, Error, `${path.join('.')}: ${(e as Error).message}`); continue; }
    const where = path.join('.');
    try {
      checkProject(p, st);
      billOfMaterials(p, st);
      subnetUsage(p);
      ipPlanProblems(p);
      lifecycleRows(p);
      circuitRows(p);
      for (const d of portMapDevices(p, st)) { const m = portMap(p, d.id, st); if (m) portFaceSvg(m); }
      cableLabels(p, st, { perEnd: true }); cableLabels(p, st, { perEnd: false });
      for (const r of p.racks ?? []) rackPower(p, r, st);
    } catch (e) {
      assert.fail(`${where}: ${(e as Error).message}`);
    }
  }
});
