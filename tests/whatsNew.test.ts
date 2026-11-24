/** Unit tests for the What's new notes. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { compareVersions, notesSince, RELEASES } from '../src/lib/whatsNew';

describe("what's new", () => {
  it('compares versions as numbers', () => {
    assert.equal(compareVersions('0.109.0', '0.99.0'), 1);
    assert.equal(compareVersions('1.0.0', '0.109.0'), 1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.9.9', '0.10.0'), -1);
  });

  it('shows what came after the version last used, newest first, once', () => {
    assert.deepEqual(notesSince('0.107.0', '1.0.0').map((r) => r.version), ['1.0.0', '0.109.0', '0.108.0']);
    assert.deepEqual(notesSince('1.0.0', '1.0.0'), [], 'same version: nothing');
    assert.deepEqual(notesSince('1.1.0', '1.0.0'), [], 'going back: nothing');
    assert.deepEqual(notesSince('', '1.0.0').map((r) => r.version), ['1.0.0'], 'first run: only the newest');
    assert.deepEqual(notesSince('', '1.0.0', 6, true).map((r) => r.version), ['1.0.0', '0.109.0', '0.108.0', '0.107.0'], 'someone with clients already: the last few');
    assert.equal(notesSince('0.50.0', '1.0.0').length, 6, 'a long jump is capped');
    assert.deepEqual(notesSince('0.100.0', ''), [], 'no version known: nothing');
  });

  it('has notes for the version being built, newest first', () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    for (let i = 1; i < RELEASES.length; i++) assert.equal(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), 1, RELEASES[i].version);
    assert.ok(compareVersions(RELEASES[0].version, version) >= 0, `notes exist for ${version}`);
    for (const r of RELEASES) assert.ok(r.items.length > 0 && r.title);
  });
});
