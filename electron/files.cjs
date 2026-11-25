// File rules for the desktop app (no Electron here, so they can be tested on their own): which files Save may
// write without asking, writing safely, and which command-line arguments are files to open.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const RD_MIME = 'application/vnd.rackdraw+zip';
const MAX_FILE = 512 * 1024 * 1024;
const OPENABLE = /\.(rackdraw|rackdraw\.json|netcraft\.json)$/i;

const key = (p) => path.resolve(p).toLowerCase();

/** A .rackdraw package on disk: a ZIP whose first entry is the "mimetype" file saying so. */
function isRackdrawOnDisk(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(38 + RD_MIME.length);
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.readUInt32LE(0) === 0x04034b50 && buf.toString('latin1', 30, 38) === 'mimetype' && buf.toString('latin1', 38) === RD_MIME;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** A network path (\\server\share\…, \\?\UNC\…, //server/…): touching one sends the user's Windows sign-in to it. */
const isUnc = (p) => typeof p === 'string' && /^[\\/]{2}/.test(p);

/**
 * Save writes without asking only to a .rackdraw file the user picked in a Save dialog or opened (`approved`, kept by
 * the desktop app itself — the page can't add to it). Anything else goes through the Save dialog.
 */
function mayWrite(p, approved) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.rackdraw$/i.test(p)) return false;
  return approved.has(key(p));
}

/**
 * The approved files, remembered in a file of the app's own (so Ctrl+S after a restart still saves without asking).
 * The newest MAX_APPROVED are kept.
 */
const MAX_APPROVED = 2000;
function approvedStore(file) {
  const set = new Set();
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(list)) for (const k of list.slice(-MAX_APPROVED)) if (typeof k === 'string') set.add(k);
  } catch { /* none yet */ }
  let timer = null;
  const save = () => {
    timer = null;
    fsp.writeFile(file, JSON.stringify([...set])).catch(() => undefined);
  };
  return {
    has: (k) => set.has(k),
    add(p) {
      const k = key(p);
      set.delete(k);
      set.add(k);
      while (set.size > MAX_APPROVED) set.delete(set.values().next().value);
      if (!timer) timer = setTimeout(save, 200);
    },
    /** Writes pending changes now (on quit). */
    flush() { if (timer) { clearTimeout(timer); timer = null; try { fs.writeFileSync(file, JSON.stringify([...set])); } catch { /* ignore */ } } },
  };
}

/** Writes to the same file wait for each other, so they land in the order they were asked for. */
const queues = new Map();
function inOrder(k, job) {
  const next = (queues.get(k) ?? Promise.resolve()).then(job, job);
  const tail = next.catch(() => undefined);
  queues.set(k, tail);
  void tail.then(() => { if (queues.get(k) === tail) queues.delete(k); });
  return next;
}

/** Writes a temporary file next to the target, then renames it over the target: a crash never leaves half a file. */
function writeAtomic(target, bytes) {
  return inOrder(key(target), () => writeNow(target, bytes));
}

async function writeNow(target, bytes) {
  const tmp = `${target}.${process.pid}-${Date.now()}.tmp`;
  // On disk for real before the rename, so a power cut can't leave an empty file behind the new name.
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } catch (e) {
    await fh.close();
    await fsp.rm(tmp, { force: true });
    throw e;
  }
  await fh.close();
  try {
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

/** The client files named on a command line (a double-click in Explorer starts "RackDraw.exe <file>"). */
function filesIn(argv) {
  return argv.slice(1)
    .filter((a) => typeof a === 'string' && !a.startsWith('-') && OPENABLE.test(a))
    .map((a) => path.resolve(a))
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

/** An existing client file (.rackdraw, or an older .rackdraw.json / .netcraft.json) at an absolute path. */
function isClientFile(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !OPENABLE.test(p)) return false;
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** The name the Save dialog suggests: an old .rackdraw.json / .netcraft.json becomes .rackdraw. */
function suggestedPath(given, name, documents) {
  if (typeof given === 'string' && path.isAbsolute(given) && !isUnc(given)) return given.replace(/(\.(rackdraw|netcraft))?(\.json)?$/i, '.rackdraw');
  const clean = String(name || 'Client').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150);
  return path.join(documents, /\.rackdraw$/i.test(clean) ? clean : `${clean}.rackdraw`);
}

module.exports = { RD_MIME, MAX_FILE, key, isUnc, isRackdrawOnDisk, mayWrite, approvedStore, writeAtomic, filesIn, suggestedPath, isClientFile };
