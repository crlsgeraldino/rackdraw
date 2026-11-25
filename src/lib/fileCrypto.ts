/*
 * Password protection for client files and backups.
 *
 * The password is turned into a key with PBKDF2-SHA256 (600,000 rounds, a random 16-byte salt), and the data is
 * encrypted with AES-256-GCM (a random 12-byte IV each time; GCM also detects any change to the data). It uses the
 * Web Crypto API built into the app — no other library. The password itself is never stored; there is no recovery.
 */

export const KDF_ITERATIONS = 600_000;
export const MIN_PASSWORD = 8;

export interface Secret {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

/** Wrong password (or data changed since it was protected: GCM can't tell the two apart). */
export class WrongPasswordError extends Error {
  constructor() { super('Wrong password.'); }
}

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Encryption is not available here.');
  return s;
};
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The key for a password (slow on purpose: about half a second). */
export async function deriveSecret(password: string, salt: Uint8Array = random(16), iterations = KDF_ITERATIONS): Promise<Secret> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  const key = await subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt, iterations };
}

export interface Sealed { iv: Uint8Array; data: Uint8Array }

export async function seal(secret: Secret, plain: Uint8Array): Promise<Sealed> {
  const iv = random(12);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, secret.key, plain as BufferSource));
  return { iv, data };
}

export async function unseal(secret: Secret, sealed: Sealed): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv as BufferSource }, secret.key, sealed.data as BufferSource));
  } catch {
    throw new WrongPasswordError();
  }
}

/**
 * A check value for a password (not the password, and not the file's key: its own salt and a different use), kept
 * on this computer so RackDraw can tell a wrong password before re-protecting a file with it.
 */
export interface PasswordCheck { salt: string; iterations: number; hash: string }

export async function makeCheck(password: string, salt: Uint8Array = random(16), iterations = KDF_ITERATIONS): Promise<PasswordCheck> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(`rackdraw-check:${password}`), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256));
  return { salt: toB64(salt), iterations, hash: toB64(bits) };
}

export async function passwordMatches(password: string, check: PasswordCheck): Promise<boolean> {
  const again = await makeCheck(password, fromB64(check.salt), check.iterations);
  return again.hash === check.hash;
}

/* ---------- protected backups (a JSON file, so File → Restore takes it like any backup) ---------- */

export interface ProtectedJson {
  format: 'rackdraw-backup-protected';
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export async function protectText(text: string, password: string): Promise<ProtectedJson> {
  const secret = await deriveSecret(password);
  const s = await seal(secret, new TextEncoder().encode(text));
  return { format: 'rackdraw-backup-protected', version: 1, kdf: 'PBKDF2-SHA256', iterations: secret.iterations, salt: toB64(secret.salt), iv: toB64(s.iv), data: toB64(s.data) };
}

/** Iteration counts RackDraw accepts from a file: never weak, never so many that opening it hangs. */
export const validIterations = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 100_000 && n <= 5_000_000;

export async function unprotectText(p: ProtectedJson, password: string): Promise<string> {
  if (!validIterations(p.iterations) || typeof p.salt !== 'string' || typeof p.iv !== 'string' || typeof p.data !== 'string') throw new Error('This backup is damaged and can\'t be opened.');
  const secret = await deriveSecret(password, fromB64(p.salt), p.iterations);
  return new TextDecoder().decode(await unseal(secret, { iv: fromB64(p.iv), data: fromB64(p.data) }));
}

/**
 * A parsed backup file as it is inside: an unprotected one as it is; a protected one after asking for its password
 * through `ask` (again after a wrong one). null = cancelled.
 */
export async function unlockJson(j: unknown, ask?: (error?: string) => Promise<string | null>): Promise<unknown> {
  if ((j as ProtectedJson | null)?.format !== 'rackdraw-backup-protected') return j;
  if (!ask) throw new Error('This backup is password-protected.');
  let error: string | undefined;
  for (;;) {
    const pw = await ask(error);
    if (pw === null) return null;
    try {
      return JSON.parse(await unprotectText(j as ProtectedJson, pw));
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw new Error('This backup is damaged and can\'t be opened.');
      error = 'Wrong password. Try again.';
    }
  }
}
