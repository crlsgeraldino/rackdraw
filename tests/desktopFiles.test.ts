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
  mayWrite: (p: unknown, approved: { has: (k: string) => boolean }) => boolean;
  isUnc: (p: unknown) => boolean;
  approvedStore: (file: string) => { has: (k: string) => boolean; add: (p: string) => void; flush: () => void };
  writeAtomic: (p: string, b: Uint8Array) => Promise<void>;
  filesIn: (argv: string[]) => string[];
  suggestedPath: (given: unknown, name: string, docs: string) => string;
  isClientFile: (p: unknown) => boolean;
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

  it('writes without asking only to a .rackdraw file the user picked or opened', () => {
    const approved = new Set<string>();
    assert.equal(files.mayWrite(drawing, approved), false, 'an existing drawing the user never opened: the Save dialog asks');
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

  it('remembers approved files between runs, and never network paths it was not given', () => {
    const store = join(dir, 'approved.json');
    const a = files.approvedStore(store);
    a.add(drawing);
    a.flush();
    const b = files.approvedStore(store);
    assert.equal(files.mayWrite(drawing, b), true, 'after a restart');
    assert.equal(files.mayWrite(join(dir, 'Other.rackdraw'), b), false);
    assert.equal(files.isUnc('\\\\server\\share\\x.rackdraw'), true);
    assert.equal(files.isUnc('//server/share/x.rackdraw'), true);
    assert.equal(files.isUnc(drawing), false);
    assert.equal(files.suggestedPath('\\\\server\\share\\x.rackdraw', 'Acme', 'C:\\Docs'), join('C:\\Docs', 'Acme.rackdraw'), 'a network path is not suggested');
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
  it('opens from Recent / shows in Explorer only existing client files', () => {
    assert.equal(files.isClientFile(drawing), true);
    assert.equal(files.isClientFile(doc), false, 'not a client file type');
    assert.equal(files.isClientFile(join(dir, 'gone.rackdraw')), false);
    assert.equal(files.isClientFile('Acme.rackdraw'), false, 'relative path');
    assert.equal(files.isClientFile(42), false);
  });
  it('two saves of the same file land in the order they were asked for', async () => {
    const target = join(dir, 'Twice.rackdraw');
    const big = new Uint8Array(30 * 1024 * 1024).fill(1);
    await Promise.all([files.writeAtomic(target, big), files.writeAtomic(target, new Uint8Array([9]))]);
    assert.deepEqual([...readFileSync(target)], [9], 'the second (newer) save wins even though the first was bigger');
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')));
  });
});
