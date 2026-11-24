/** Unit tests for password-protected client files and backups. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { deriveSecret, makeCheck, unlockJson, passwordMatches, protectText, seal, unprotectText, unseal, WrongPasswordError } from '../src/lib/fileCrypto';
import { isRackdrawPackage, packProtected, packRackdraw, protectionOf, RACKDRAW_MIME, RackdrawFileError, unpackRackdraw, unprotect } from '../src/lib/rackdrawFile';

// Fewer rounds keep the tests quick; the app uses 600,000.
const FAST = 1000;

describe('password protection', () => {
  it('seals and unseals; a wrong password or a changed byte is refused', async () => {
    const secret = await deriveSecret('correct horse', undefined, FAST);
    const plain = new TextEncoder().encode('10.0.0.1 core switch, circuit ID 12345');
    const s = await seal(secret, plain);
    assert.notDeepEqual(s.data.subarray(0, plain.length), plain, 'not readable');
    assert.deepEqual(await unseal(secret, s), plain);
    const wrong = await deriveSecret('wrong horse', secret.salt, FAST);
    await assert.rejects(unseal(wrong, s), WrongPasswordError);
    const tampered = { iv: s.iv, data: s.data.slice() };
    tampered.data[5] ^= 1;
    await assert.rejects(unseal(secret, tampered), WrongPasswordError);
    const s2 = await seal(secret, plain);
    assert.notDeepEqual(s2.iv, s.iv, 'a new IV every time');
  });

  it('protects a .rackdraw file: still a RackDraw package, no client data readable, opens with the password', async () => {
    const inner = packRackdraw({ format: 'netcraft', version: 3, project: { name: 'Acme Secret Client', notes: 'admin VLAN 99' } }, { name: 'Acme Secret Client' });
    const secret = await deriveSecret('s3cret-pass', undefined, FAST);
    const file = await packProtected(inner, secret);
    assert.ok(isRackdrawPackage(file));
    assert.equal(Buffer.from(file.subarray(38, 38 + RACKDRAW_MIME.length)).toString(), RACKDRAW_MIME, 'same mimetype first');
    const text = Buffer.from(file).toString('latin1');
    assert.ok(!text.includes('Acme') && !text.includes('VLAN 99'), 'no client name or data in the clear');
    assert.ok(Object.keys(unzipSync(file)).includes('payload.bin'));
    assert.equal(protectionOf(file)?.iterations, FAST);
    assert.equal(protectionOf(inner), null);
    assert.throws(() => unpackRackdraw(file), /password-protected/);
    const { inner: back, secret: s2 } = await unprotect(file, 's3cret-pass');
    assert.deepEqual(back, inner);
    assert.equal((unpackRackdraw(back).payload as { project: { name: string } }).project.name, 'Acme Secret Client');
    await assert.rejects(unprotect(file, 'nope'), WrongPasswordError);
    // Saving again with the remembered key gives a file the same password opens.
    const again = await packProtected(inner, s2);
    assert.deepEqual((await unprotect(again, 's3cret-pass')).inner, inner);
    // A truncated protected file is refused as damaged, not as a wrong password.
    await assert.rejects(unprotect(file.subarray(0, file.length - 30), 's3cret-pass'), (e: Error) => e instanceof RackdrawFileError || e instanceof WrongPasswordError);
    // Missing payload.
    const files = unzipSync(file);
    delete files['payload.bin'];
    await assert.rejects(unprotect(zipSync(files), 's3cret-pass'), RackdrawFileError);
  });

  it('protects a backup as JSON, and opens it only with the password', async () => {
    const json = JSON.stringify({ format: 'rackdraw-backup', version: 1, projects: { a: { name: 'Acme' } } });
    const p = await protectText(json, 'backup-pass');
    assert.equal(p.format, 'rackdraw-backup-protected');
    assert.ok(!JSON.stringify(p).includes('Acme'));
    assert.equal(await unprotectText(p, 'backup-pass'), json);
    await assert.rejects(unprotectText(p, 'other-pass'), WrongPasswordError);
  });

  it('checks a password against a stored check value, which is not the password', async () => {
    const c = await makeCheck('right-password', undefined, FAST);
    assert.ok(!JSON.stringify(c).includes('right-password'));
    assert.equal(await passwordMatches('right-password', c), true);
    assert.equal(await passwordMatches('wrong-password', c), false);
  });

  it('uses 600,000 rounds by default', async () => {
    const t = performance.now();
    const s = await deriveSecret('x'.repeat(12));
    assert.equal(s.iterations, 600_000);
    assert.ok(performance.now() - t < 5000);
  });
});

describe('protected backups through File → Restore', () => {
  it('asks for the password, retries on a wrong one, and cancels cleanly', async () => {
    const plain = { format: 'rackdraw-backup', version: 1, projects: { a: { name: 'Acme' } } };
    const file = JSON.parse(JSON.stringify(await protectText(JSON.stringify(plain), 'backup-pass')));
    const asked: (string | undefined)[] = [];
    const answers = ['wrong-pass', 'backup-pass'];
    const b = await unlockJson(file, async (error) => { asked.push(error); return answers.shift() ?? null; });
    assert.deepEqual(asked, [undefined, 'Wrong password. Try again.']);
    assert.deepEqual(b, plain);
    assert.equal(await unlockJson(file, async () => null), null);
    await assert.rejects(unlockJson(file), /password-protected/);
    // A changed backup can't be told from a wrong password (GCM): it asks again, and Cancel ends it.
    const tries: (string | undefined)[] = [];
    const left = ['backup-pass'];
    assert.equal(await unlockJson({ ...file, data: file.data.slice(0, -8) + 'AAAAAAA=' }, async (e) => { tries.push(e); return left.shift() ?? null; }), null);
    assert.deepEqual(tries, [undefined, 'Wrong password. Try again.']);
    // An unprotected backup still opens without asking.
    assert.deepEqual(await unlockJson(plain, async () => { throw new Error('asked'); }), plain);
  });
});
