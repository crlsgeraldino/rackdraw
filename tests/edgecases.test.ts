/* Small calculation and export edge cases from the pre-public audit. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { csvOf, csvText } from '../src/lib/csv';
import { fitPadding } from '../src/lib/fit';
import { lengthFt } from '../src/lib/length';
import { daysUntil } from '../src/lib/lifecycle';
import { fits } from '../src/lib/rack';
import type { Rack } from '../src/lib/types';

describe('CSV for Excel', () => {
  it('text that Excel would read as a formula stays text', () => {
    assert.equal(csvText('-48 VDC'), "'-48 VDC");
    assert.equal(csvText('=HYPERLINK("x")'), `'=HYPERLINK("x")`);
    assert.equal(csvText('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvText('-5'), '-5');
    assert.equal(csvText('+1.5'), '+1.5');
    assert.equal(csvText('Switch 1'), 'Switch 1');
    assert.equal(csvOf([['a"b', 3]]), '"a""b","3"');
  });
});

describe('lengths, dates, racks, zoom margins', () => {
  it('reads a decimal comma in a length', () => {
    assert.ok(Math.abs((lengthFt('1,5 m') ?? 0) - 4.92126) < 1e-4);
    assert.equal(lengthFt('1,200 ft'), 1200);
  });
  it('refuses dates that do not exist', () => {
    const today = new Date(2026, 0, 1);
    assert.equal(daysUntil('2026-02-30', today), undefined);
    assert.equal(daysUntil('2026-02-28', today), 58);
  });
  it('rack items are whole units', () => {
    const rack = { id: 'r', name: 'R', units: 42, items: [] } as unknown as Rack;
    assert.equal(fits(rack, 1, 2.5, 'full'), false);
    assert.equal(fits(rack, 1, 2, 'full'), true);
  });
  it('fit margins keep the old look', () => {
    assert.equal(fitPadding(0.2), '8.3%');
    assert.equal(fitPadding(0), '0%');
    assert.equal(fitPadding(Number.NaN), '0%');
  });
});
