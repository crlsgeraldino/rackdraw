/** Hostile files: values from a file must never become markup, hang the app or break it on every start. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { portFaceSvg, portFill, type PortMap, type PortMapRow } from '../src/lib/portMap';
import { hfCss } from '../src/lib/headerFooter';
import { sanitizeProject, sanitizeStencil, sanitizeStencils } from '../src/lib/sanitize';
import { cleanDeep, isPlainStyle, MAX_DEPTH, safeColor } from '../src/lib/safe';
import { unzipLimited, ZipTooLargeError } from '../src/lib/zipSafe';
import { deriveSecret, protectText, unlockJson } from '../src/lib/fileCrypto';
import { packProtected, packRackdraw, RackdrawFileError, unpackRackdraw, unprotect } from '../src/lib/rackdrawFile';
import type { Project } from '../src/lib/types';

const EVIL = '#000"/><img src=x onerror=alert(1)>';
const noMarkup = (s: string) => !/<img|onerror|<script|javascript:/i.test(s);

describe('values from files never become markup', () => {
  it('colours must be plain values', () => {
    for (const ok of ['#fff', '#12ab34', 'red', 'rgba(0, 0, 0, .5)', 'hsl(120 50% 50%)', 'vlan', '4 2', 'transparent']) assert.ok(isPlainStyle(ok), ok);
    for (const bad of [EVIL, 'red;background:url(x)', 'red}</style>', 'url("x")', 'expression(alert(1))'.replace('(', ':('), 'a'.repeat(65)]) assert.ok(!isPlainStyle(bad), bad);
    assert.equal(safeColor(EVIL, '#fff'), '#fff');
  });

  it('the port map draws a hostile VLAN colour and stencil geometry as plain values', () => {
    const row = { id: 'p1', label: '1', vlanColor: EVIL, cabled: true, uplink: false } as unknown as PortMapRow;
    assert.equal(portFill(row).fill, '#bbf7d0');
    const m = {
      rows: [row],
      stencil: { ports: [{ id: 'p1', label: '1', x: '1" onload="alert(1)', y: 2, w: 10, h: 10 }] },
    } as unknown as PortMap;
    const svg = portFaceSvg(m);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(noMarkup(svg) && !svg.includes('onload'), svg);
  });

  it('header / footer text can not close the print style element', () => {
    const css = hfCss('Client </style><img src=x onerror=alert(1)>\n"quoted"', { name: 'x' } as Project);
    assert.ok(!css.includes('</style'), css);
    assert.ok(!css.includes('\n'));
  });

  it('opening a client removes style values that are not plain, everywhere in the file', () => {
    const raw = {
      name: 'Acme',
      display: { frameColor: EVIL, pageColor: '#ffffff', deviceColor: 'vlan' },
      vlans: [{ id: 'v1', name: 'Data', vlan: '10', color: EVIL }, { id: 'v2', name: 'Voice', vlan: '20', color: '#22c55e' }],
      pages: [{ id: 'p', name: 'P', nodes: [{ id: 'n', type: 'shape', position: { x: 0, y: 0 }, data: { fill: EVIL, stroke: '#000' } }], edges: [] }],
    };
    const { project } = sanitizeProject(raw);
    const text = JSON.stringify(project);
    assert.ok(noMarkup(text), text);
    assert.equal(project.display?.pageColor, '#ffffff');
    assert.equal(project.display?.deviceColor, 'vlan');
    assert.equal(project.vlans?.[1].color, '#22c55e');
    assert.equal((project.pages[0].nodes[0].data as { stroke?: string }).stroke, '#000');
  });

  it('absurdly deep data is dropped (it would break saving)', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20_000; i++) deep = { x: deep };
    const out = cleanDeep({ keep: 1, deep });
    assert.equal(out.keep, 1);
    assert.doesNotThrow(() => JSON.stringify(out));
    let d = 0;
    for (let o: unknown = out.deep; o && typeof o === 'object'; o = (o as { x?: unknown }).x) d++;
    assert.ok(d <= MAX_DEPTH + 1);
  });
});

describe('stencils from files', () => {
  const good = { id: 'c1', name: 'Camera', image: 'data:image/png;base64,AAAA', width: 50, height: 40, scale: 1, ports: [], style: 'image', category: 'Security' };

  it('keeps usable stencils and repairs or refuses broken ones', () => {
    assert.equal(sanitizeStencil(good)?.name, 'Camera');
    assert.equal(sanitizeStencil({ ...good, name: undefined })?.name, 'Imported shape', 'a missing name no longer breaks the palette');
    assert.equal(sanitizeStencil({ ...good, image: 'javascript:alert(1)' }), null);
    assert.equal(sanitizeStencil({ ...good, id: 42 }), null);
    assert.equal(sanitizeStencil({ ...good, width: 'wide' })?.width, 100);
    const s = sanitizeStencil({ ...good, ports: [{ id: 'a', x: '1"><img', y: 2, w: 3, h: 4 }, { x: 1 }] });
    assert.equal(s?.ports.length, 1);
    assert.equal(s?.ports[0].x, 0);
    assert.equal(sanitizeStencils([good, null, 'x', { ...good, id: 'c2', name: undefined }]).length, 2);
  });
});

describe('files too big to open', () => {
  it('a small ZIP claiming gigabytes is refused before it is unpacked', () => {
    const zeros = new Uint8Array(40 * 1024 * 1024);
    const bomb = zipSync({ 'project.json': [zeros, { level: 9 }] });
    assert.ok(bomb.length < 200_000);
    assert.throws(() => unzipLimited(bomb, { maxTotal: 10 * 1024 * 1024 }), ZipTooLargeError);
    assert.equal(unzipLimited(bomb, { maxTotal: 64 * 1024 * 1024 })['project.json'].length, zeros.length);
    assert.throws(() => unzipLimited(zipSync({ a: strToU8('1'), b: strToU8('2'), c: strToU8('3') }), { maxTotal: 1e6, maxEntries: 2 }), ZipTooLargeError);
  });

  it('a .rackdraw that unpacks to too much says so', () => {
    const file = packRackdraw({ project: { name: 'Acme' } }, { name: 'Acme' });
    assert.ok(unpackRackdraw(file));
  });
});

describe('password-protected files with hostile settings', () => {
  it('refuses weak or hang-inducing iteration counts', async () => {
    const inner = packRackdraw({ project: { name: 'Acme' } }, { name: 'Acme' });
    for (const iterations of [1, 99_999, 50_000_000]) {
      const secret = await deriveSecret('password1', undefined, Math.min(iterations, 1000));
      const file = await packProtected(inner, { ...secret, iterations });
      await assert.rejects(unprotect(file, 'password1'), RackdrawFileError, String(iterations));
    }
    const p = await protectText('{}', 'password1');
    await assert.rejects(unlockJson({ ...p, iterations: 10 ** 9 }, async () => 'password1'), /damaged/);
  });

  it('a file opened with other settings is saved again with RackDraw\'s own', async () => {
    const inner = packRackdraw({ project: { name: 'Acme' } }, { name: 'Acme' });
    const file = await packProtected(inner, await deriveSecret('password1', undefined, 100_000));
    const { secret } = await unprotect(file, 'password1');
    assert.equal(secret.iterations, 600_000);
  });
});
