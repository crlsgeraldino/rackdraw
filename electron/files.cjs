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

/**
 * Save writes without asking only to a .rackdraw file the user picked or opened this session (`approved`), or to a
 * file that already is a RackDraw drawing. Anything else goes through the Save dialog.
 */
function mayWrite(p, approved) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.rackdraw$/i.test(p)) return false;
  return approved.has(key(p)) || isRackdrawOnDisk(p);
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
  await fsp.writeFile(tmp, bytes);
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
  if (typeof given === 'string' && path.isAbsolute(given)) return given.replace(/(\.(rackdraw|netcraft))?(\.json)?$/i, '.rackdraw');
  const clean = String(name || 'Client').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150);
  return path.join(documents, /\.rackdraw$/i.test(clean) ? clean : `${clean}.rackdraw`);
}

module.exports = { RD_MIME, MAX_FILE, key, isRackdrawOnDisk, mayWrite, writeAtomic, filesIn, suggestedPath, isClientFile };
