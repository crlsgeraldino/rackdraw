/** Unit tests for working out SFP / console / power ports of imported Visio shapes. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { guessPortKinds, kindFromName, portLabel } from '../src/lib/visio/portKinds';
import type { PortDef } from '../src/lib/types';

const port = (i: number, x: number, y: number): PortDef => ({ id: `C${i + 1}`, label: `${i + 1}`, kind: 'rj45', x, y, w: 12, h: 12, side: 'top' });
/** `n` RJ45 in two rows (two blocks of n/2 columns with a small gap), then `extra` ports `gap` px further right. */
function faceplate(n: number, extra: number, gap = 150, left = false): PortDef[] {
  const ps: PortDef[] = [];
  const x0 = left ? 300 : 100;
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / 2);
    ps.push(port(i, x0 + col * 57 + (col >= n / 4 ? 20 : 0), i % 2 ? 94 : 43));
  }
  const edge = left ? x0 - gap : x0 + (n / 2 - 1) * 57 + 20 + gap;
  for (let j = 0; j < extra; j++) ps.push(port(n + j, edge + (left ? -1 : 1) * Math.floor(j / 2) * 57, j % 2 ? 94 : 43));
  return ps;
}
const kinds = (ps: PortDef[]) => ps.map((p) => p.kind).join('');
const sfps = (ps: PortDef[]) => ps.filter((p) => p.kind === 'sfp').map((p) => p.id);

describe('SFP ports of imported switches', () => {
  it('finds the uplink cages of a switch named for its port count', () => {
    assert.deepEqual(sfps(guessPortKinds(faceplate(24, 2), 'USW-Pro-24-PoE (400W) - Front')), ['C25', 'C26']);
    assert.deepEqual(sfps(guessPortKinds(faceplate(48, 4), 'Switch 48-port + 4 SFP')), ['C49', 'C50', 'C51', 'C52']);
  });
  it('finds them at the left end too', () => {
    assert.deepEqual(sfps(guessPortKinds(faceplate(16, 2, 150, true), 'Pro Max 16 PoE')), ['C17', 'C18']);
  });
  it('uses the gap alone when the name says SFP', () => {
    assert.deepEqual(sfps(guessPortKinds(faceplate(8, 2), 'Access switch with SFP uplinks')), ['C9', 'C10']);
  });
  it('leaves ports alone when nothing says they are SFP', () => {
    assert.equal(kinds(guessPortKinds(faceplate(8, 2), 'TZ570 firewall')), 'rj45'.repeat(10));
    // Count matches but the extra ports don't stand apart.
    assert.equal(sfps(guessPortKinds(faceplate(24, 2, 57), 'Switch 24')).length, 0);
    // Count doesn't match the group at the end.
    assert.equal(sfps(guessPortKinds(faceplate(24, 2), 'Switch 16')).length, 0);
    assert.deepEqual(guessPortKinds([], 'Switch 24'), []);
  });
  it('trusts the connection points’ own names', () => {
    const ps = faceplate(4, 0);
    const out = guessPortKinds(ps, 'Router', ['Console', 'USB_1', 'SFP+ 1', 'AC_Power']);
    assert.equal(out.map((p) => p.kind).join(','), 'console,usb,sfp,power');
    assert.equal(guessPortKinds(faceplate(2, 0), '', ['USP_RPS', 'AC_Power']).map((p) => p.kind).join(','), 'power,power');
    // Plain "Port_01" names don't stop the faceplate check.
    const sw = faceplate(24, 2);
    assert.deepEqual(sfps(guessPortKinds(sw, 'USW-Pro-24-PoE', sw.map((_, i) => `Port_${String(i + 1).padStart(2, '0')}`))), ['C25', 'C26']);
  });
  it('reads point names', () => {
    assert.equal(kindFromName('GE1'), 'rj45');
    assert.equal(kindFromName('7'), undefined);
    assert.equal(kindFromName('Fibre uplink'), 'sfp');
    assert.equal(portLabel('Port_07', 6), '7');
    assert.equal(portLabel('AC_Power', 1), 'AC Power');
    assert.equal(portLabel(undefined, 4), '5');
    assert.equal(portLabel('Port_0', 0), '0');
  });
});
