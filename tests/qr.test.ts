/** QR encoder checked against published reference values (Thonky QR tutorial / ISO 18004 tables). */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatBits, qrMatrix, rsEncode, versionBits } from '../src/lib/qr';

describe('QR encoder', () => {
  it('Reed-Solomon matches the HELLO WORLD 1-M example', () => {
    assert.deepEqual(rsEncode([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('format information matches the standard table for level M', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    for (let mask = 0; mask < 8; mask++) assert.equal(formatBits(mask).toString(2).padStart(15, '0'), table[mask], `mask ${mask}`);
  });
  it('version information matches the standard table', () => {
    assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
    assert.equal(versionBits(10).toString(2).padStart(18, '0'), '001010010011010011');
  });
  it('picks the version by length and draws finder patterns', () => {
    assert.equal(qrMatrix('HELLO').length, 21);
    assert.equal(qrMatrix('x'.repeat(100)).length, 4 * 6 + 17); // version 6 holds 106 bytes at level M
    assert.equal(qrMatrix('x'.repeat(200)).length, 4 * 10 + 17);
    assert.throws(() => qrMatrix('x'.repeat(300)));
    const m = qrMatrix('RackDraw');
    const finder = [[1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
    const n = m.length;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) assert.equal(m[oy + y][ox + x] ? 1 : 0, finder[y][x]);
    assert.equal(m[n - 8][8], true, 'dark module');
  });
  it('both copies of the format information agree', () => {
    for (const text of ['A', 'https://example.com/asset/12345', 'x'.repeat(150)]) {
      const m = qrMatrix(text);
      const n = m.length;
      const a: boolean[] = [], b: boolean[] = [];
      for (let i = 0; i <= 5; i++) a.push(m[i][8]);
      a.push(m[7][8], m[8][8], m[8][7]);
      for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
      for (let i = 0; i < 8; i++) b.push(m[8][n - 1 - i]);
      for (let i = 8; i < 15; i++) b.push(m[n - 15 + i][8]);
      assert.deepEqual(a, b);
      const bits = a.reduce((s, v, i) => s | ((v ? 1 : 0) << i), 0);
      assert.ok([0, 1, 2, 3, 4, 5, 6, 7].some((mask) => formatBits(mask) === bits), 'valid level-M format word');
    }
  });
});
