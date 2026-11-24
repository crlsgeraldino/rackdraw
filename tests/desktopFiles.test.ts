/** Unit tests for the desktop app's file rules (electron/files.cjs). */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { packRackdraw } from '../src/lib/rackdrawFile';

const files = createRequire(import.meta.url)('../electron/files.cjs') as {
  key: (p: string) => string;
  isRackdrawOnDisk: (p: string) => boolean;
  mayWrite: (p: unknown, approved: Set<string>) => boolean;
  writeAtomic: (p: string, b: Uint8Array) => Promise<void>;
  filesIn: (argv: string[]) => string[];
  suggestedPath: (given: unknown, name: string, docs: string) => string;
};

describe('desktop file rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-files-'));
  const drawing = join(dir, 'Acme.rackdraw');
  writeFileSync(drawing, packRackdraw({ project: { name: 'Acme' } }, { name: 'Acme' }));
  const fake = join(dir, 'Fake.rackdraw');
  writeFileSync(fake, 'not a drawing');
  const doc = join(dir, 'notes.txt');
  writeFileSync(doc, 'hello');

  it('recognises a .rackdraw file by its contents', () => {
    assert.equal(files.isRackdrawOnDisk(drawing), true);
    assert.equal(files.isRackdrawOnDisk(fake), false);
    assert.equal(files.isRackdrawOnDisk(join(dir, 'missing.rackdraw')), false);
  });

  it('writes without asking only to a picked / opened .rackdraw file or an existing drawing', () => {
    const approved = new Set<string>();
    assert.equal(files.mayWrite(drawing, approved), true, 'an existing RackDraw drawing');
    assert.equal(files.mayWrite(fake, approved), false, 'a file only named .rackdraw');
    assert.equal(files.mayWrite(doc, approved), false);
    assert.equal(files.mayWrite(join(dir, 'New.rackdraw'), approved), false, 'a new file: the Save dialog asks');
    approved.add(files.key(join(dir, 'New.rackdraw')));
    assert.equal(files.mayWrite(join(dir, 'new.RACKDRAW'), approved), true, 'picked in the dialog this session');
    approved.add(files.key(doc));
    assert.equal(files.mayWrite(doc, approved), false, 'never anything but .rackdraw');
    assert.equal(files.mayWrite('relative.rackdraw', approved), false);
    assert.equal(files.mayWrite(undefined, approved), false);
  });

  it('saves by replacing the file in one step, leaving no temporary file', async () => {
    const target = join(dir, 'Save.rackdraw');
    await files.writeAtomic(target, new Uint8Array([1, 2, 3]));
    await files.writeAtomic(target, new Uint8Array([4, 5]));
    assert.deepEqual([...readFileSync(target)], [4, 5]);
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')));
  });

  it('finds the files to open on a command line', () => {
    const old = join(dir, 'Old.rackdraw.json');
    writeFileSync(old, '{}');
    assert.deepEqual(files.filesIn(['RackDraw.exe', '--remote-debugging-port=1', drawing, doc, old, join(dir, 'gone.rackdraw')]), [drawing, old]);
  });

  it('suggests a .rackdraw name, also for older files', () => {
    assert.equal(files.suggestedPath(join(dir, 'Old.rackdraw.json'), 'x', dir), join(dir, 'Old.rackdraw'));
    assert.equal(files.suggestedPath(join(dir, 'Older.netcraft.json'), 'x', dir), join(dir, 'Older.rackdraw'));
    assert.equal(files.suggestedPath(undefined, 'Acme: HQ/Main', 'C:\\Docs'), join('C:\\Docs', 'Acme- HQ-Main.rackdraw'));
  });
});
