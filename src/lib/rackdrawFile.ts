import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/*
 * The .rackdraw file: a ZIP package, like Office and Visio files.
 *
 *   mimetype        "application/vnd.rackdraw+zip", stored first and uncompressed (so the file says what it is)
 *   manifest.json   format, version, client name, when it was saved, a checksum of project.json, the media list
 *   project.json    the client (the same content as the old .rackdraw.json), with pictures replaced by references
 *   media/…         each picture (floor plans, imported stencil art, photos) as a real file, stored once
 *
 * Pictures are kept in the drawing as data: URLs; they go into media/ byte for byte and come back exactly as they
 * were, so opening a saved file gives the same client. The checksum and the ZIP's own structure catch a damaged or
 * half-copied file, which is refused with a clear message instead of opening wrong.
 */

export const RACKDRAW_MIME = 'application/vnd.rackdraw+zip';
export const RACKDRAW_EXT = '.rackdraw';
const FORMAT_VERSION = 1;
const MEDIA_REF = 'rackdraw-media:';
/** Text that happens to start with "rackdraw-" is escaped with this, so it can't be taken for a picture reference. */
const TEXT_ESC = 'rackdraw-text:';
/** data: URLs shorter than this stay in project.json (tiny icons aren't worth a file). */
const MIN_MEDIA = 512;

export interface RackdrawManifest {
  format: 'rackdraw';
  version: number;
  name: string;
  saved: string;
  app?: string;
  /** Checksum of project.json. */
  checksum: string;
  /** Each media file and the start of its data: URL ("data:image/png;base64"), to rebuild it exactly. */
  media: { path: string; header: string }[];
}

export class RackdrawFileError extends Error {}

/** A checksum of a text (53-bit, cyrb53): catches damage, not tampering. */
export function checksum(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'application/pdf': 'pdf' };
/** Already-compressed formats are stored as they are; text-like ones are compressed. */
const STORED = new Set(['png', 'jpg', 'webp', 'gif', 'pdf']);

/** True when the bytes look like a ZIP (a .rackdraw file) rather than text. */
export const isRackdrawPackage = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

/** Packs a client file object ({ format, version, project, stencils }) into a .rackdraw file. */
export function packRackdraw(payload: unknown, meta: { name: string; app?: string; saved?: Date }): Uint8Array {
  const files: Zippable = {};
  const media: RackdrawManifest['media'] = [];
  const byUrl = new Map<string, string>();
  const mediaFiles: [string, Uint8Array, boolean][] = [];

  const take = (url: string): string => {
    const known = byUrl.get(url);
    if (known) return MEDIA_REF + known;
    const comma = url.indexOf(',');
    if (comma < 0) return url;
    const header = url.slice(0, comma);
    const body = url.slice(comma + 1);
    const base64 = /;base64$/i.test(header);
    let bytes: Uint8Array;
    try {
      bytes = base64 ? b64ToBytes(body) : strToU8(body);
    } catch {
      return url; // not valid base64: leave it in the JSON as it is
    }
    const mime = header.slice(5).split(';')[0].toLowerCase();
    const ext = EXT[mime] ?? 'bin';
    const path = `media/${media.length + 1}.${ext}`;
    media.push({ path, header });
    mediaFiles.push([path, bytes, STORED.has(ext)]);
    byUrl.set(url, path);
    return MEDIA_REF + path;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length >= MIN_MEDIA && v.startsWith('data:') ? take(v) : v.startsWith('rackdraw-') ? TEXT_ESC + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  const json = JSON.stringify(walk(payload));
  const manifest: RackdrawManifest = {
    format: 'rackdraw', version: FORMAT_VERSION, name: meta.name, saved: (meta.saved ?? new Date()).toISOString(),
    ...(meta.app ? { app: meta.app } : {}), checksum: checksum(json), media,
  };
  // Insertion order is the order in the ZIP: mimetype first, uncompressed.
  files.mimetype = [strToU8(RACKDRAW_MIME), { level: 0 }];
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 1)), { level: 6 }];
  files['project.json'] = [strToU8(json), { level: 6 }];
  for (const [path, bytes, stored] of mediaFiles) files[path] = [bytes, { level: stored ? 0 : 6 }];
  return zipSync(files);
}

/** Reads a .rackdraw file back into the client file object (pictures restored exactly). */
export function unpackRackdraw(bytes: Uint8Array): { payload: unknown; manifest: RackdrawManifest } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new RackdrawFileError('This file is damaged and can\'t be opened (it may not have been copied completely).');
  }
  if (!files.mimetype || strFromU8(files.mimetype).trim() !== RACKDRAW_MIME) throw new RackdrawFileError('This is not a RackDraw drawing.');
  let manifest: RackdrawManifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new RackdrawFileError('This file is damaged and can\'t be opened (its contents list is missing).');
  }
  if (manifest?.format !== 'rackdraw') throw new RackdrawFileError('This is not a RackDraw drawing.');
  if (typeof manifest.version === 'number' && manifest.version > FORMAT_VERSION) throw new RackdrawFileError('This file was saved by a newer version of RackDraw. Update RackDraw to open it.');
  const raw = files['project.json'];
  if (!raw) throw new RackdrawFileError('This file is damaged and can\'t be opened (the drawing is missing).');
  const json = strFromU8(raw);
  if (manifest.checksum && checksum(json) !== manifest.checksum) throw new RackdrawFileError('This file is damaged and can\'t be opened (its contents don\'t match).');

  const header = new Map((Array.isArray(manifest.media) ? manifest.media : []).map((m) => [m.path, m.header]));
  const cache = new Map<string, string>();
  const restore = (ref: string): string => {
    const path = ref.slice(MEDIA_REF.length);
    const hit = cache.get(path);
    if (hit) return hit;
    const h = header.get(path), data = files[path];
    if (!h || !data) throw new RackdrawFileError(`This file is damaged and can't be opened (a picture is missing: ${path}).`);
    const url = `${h},${/;base64$/i.test(h) ? bytesToB64(data) : strFromU8(data)}`;
    cache.set(path, url);
    return url;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(MEDIA_REF) ? restore(v) : v.startsWith(TEXT_ESC) ? v.slice(TEXT_ESC.length) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new RackdrawFileError('This file is damaged and can\'t be opened (the drawing can\'t be read).');
  }
  return { payload: walk(payload), manifest };
}
