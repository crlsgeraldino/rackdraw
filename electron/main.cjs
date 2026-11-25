// RackDraw desktop shell (formerly NetCraft): serves the static Next.js export (out/) from a private app:// origin.
// A custom scheme (rather than file://) keeps absolute asset paths working and gives the app a
// stable origin, so diagrams saved in localStorage persist between launches.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', 'out');
// The app was called NetCraft: its origin and data folder keep that name, so the diagrams saved there (IndexedDB /
// localStorage belong to this origin, in this folder) are still found after the rename to RackDraw.
const ORIGIN = 'app://netcraft';
// RACKDRAW_DATA_DIR puts everything in another folder instead (a portable copy on a USB stick, or a test run that
// must not touch the real data).
app.setPath('userData', process.env.RACKDRAW_DATA_DIR ? path.resolve(process.env.RACKDRAW_DATA_DIR) : path.join(app.getPath('appData'), 'NetCraft'));

/*
 * What the app's pages may load: only the app itself (plus data: / blob: pictures, and the PDF reader's worker).
 * Nothing from the internet — so text from an imported file can never send the diagrams anywhere or pull code in.
 * Scripts: the app's own files, plus exactly the inline start-up scripts Next.js wrote into each page (allowed by
 * their hashes, see cspFor) — no other inline script or event handler can run, even if a file managed to put markup
 * into the page. WebAssembly is for the PDF reader's image decoders.
 */
const csp = (scriptHashes) => [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval'${scriptHashes.map((h) => ` '${h}'`).join('')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');
const CSP = csp([]);

/** The policy for one of the app's HTML pages: its own inline scripts by hash (pages never change while running). */
const pageCsp = new Map();
function cspFor(file, html) {
  if (!pageCsp.has(file)) {
    const hashes = new Set();
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(m[1]) || !m[2]) continue;
      hashes.add(`sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}`);
    }
    pageCsp.set(file, csp([...hashes]));
  }
  return pageCsp.get(file);
}

/**
 * Browser permissions the app's own pages get: the clipboard (Copy buttons — Electron reports navigator.clipboard
 * writes as "clipboard-read"), keeping its storage, full screen. Nothing else, and nothing for any other page.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'persistent-storage', 'fullscreen']);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  } catch {
    return path.join(ROOT, '404.html'); // malformed %-escape
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(ROOT, rel));
  // Never serve anything outside out/ (path.relative also catches sibling folders like "out-x").
  const inside = path.relative(ROOT, full);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return path.join(ROOT, '404.html');
  return full;
}

/**
 * True for pages of the app itself: exact scheme and host, so "app://netcraftevil" is not ours. (Node's URL gives
 * custom schemes an origin of "null", so the origin can't be compared directly.)
 */
function isOwn(url) {
  try {
    const u = new URL(url);
    const own = new URL(ORIGIN);
    return u.protocol === own.protocol && u.host === own.host;
  } catch {
    return false;
  }
}

/**
 * Opens a link from a diagram in the default browser / mail app. Only web and mail links: other schemes (file:,
 * smb:, ms-msdt:, search-ms:…) can start programs, and links come from user content and imported Visio files.
 */
function openOutside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') void shell.openExternal(u.toString());
  } catch {
    // not a URL: ignore
  }
}

/* ---------- .rackdraw files: Save / Save As, and files opened from Explorer ---------- */

const { MAX_FILE, key, isUnc, mayWrite, approvedStore, writeAtomic, filesIn, suggestedPath, isClientFile } = require('./files.cjs');
/**
 * Files the user picked in a Save dialog or opened (double-click, File → Open, command line): Save may write back to
 * them without asking. Kept here in the desktop app, remembered between runs; the page can't add to it.
 */
let approved = null;
/** A client file the page may open / show: one the user approved before, or a local (not network) client file. */
const mayTouch = (p) => typeof p === 'string' && (approved.has(key(p)) || (!isUnc(p) && isClientFile(p)));

let mainWindow = null;
let pageReady = false;
const pendingFiles = [];

async function openFiles(paths) {
  for (const p of paths) {
    try {
      if ((await fsp.stat(p)).size > MAX_FILE) continue;
      const bytes = new Uint8Array(await fsp.readFile(p));
      if (/\.rackdraw$/i.test(p)) approved.add(p);
      app.addRecentDocument(p); // the taskbar icon's list (Windows jump list)
      const file = { path: p, name: path.basename(p), bytes };
      if (pageReady && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rd:open-file', file);
      else pendingFiles.push(file);
    } catch {
      // unreadable file: skip it
    }
  }
}

ipcMain.handle('rd:save', async (e, args) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !isOwn(e.senderFrame?.url ?? '')) throw new Error('Not allowed');
  const { bytes, suggestedName, path: given, saveAs } = args ?? {};
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FILE) throw new Error('Nothing to save');
  let target = !saveAs && mayWrite(given, approved) ? given : null;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save client',
      defaultPath: suggestedPath(mayTouch(given) ? given : undefined, suggestedName, app.getPath('documents')),
      filters: [{ name: 'RackDraw drawing', extensions: ['rackdraw'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (r.canceled || !r.filePath) return null;
    target = /\.rackdraw$/i.test(r.filePath) ? r.filePath : `${r.filePath}.rackdraw`;
  }
  await writeAtomic(target, Buffer.from(bytes));
  approved.add(target);
  app.addRecentDocument(target);
  return { path: target, name: path.basename(target) };
});

// File → Recent: open a client file again (only client files: .rackdraw, .rackdraw.json, .netcraft.json).
ipcMain.handle('rd:open-path', async (e, p) => {
  if (!isOwn(e.senderFrame?.url ?? '') || !mayTouch(p)) return false;
  await openFiles([p]);
  return true;
});

// Open file location: Explorer with the client's file selected.
ipcMain.handle('rd:show-in-folder', (e, p) => {
  if (!isOwn(e.senderFrame?.url ?? '') || !mayTouch(p)) return false;
  shell.showItemInFolder(p);
  return true;
});

ipcMain.on('rd:ready', (e) => {
  if (!isOwn(e.senderFrame?.url ?? '')) return;
  pageReady = true;
  for (const f of pendingFiles.splice(0)) e.sender.send('rd:open-file', f);
});

// macOS: files opened from Finder arrive as an event rather than on the command line.
app.on('open-file', (e, p) => { e.preventDefault(); void openFiles([p]); });

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'RackDraw',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f9fafb',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'preload.cjs') },
  });

  // Links to other sites open in the default browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOwn(url)) openOutside(url);
    return { action: 'deny' };
  });
  // The window itself never leaves the app (links open through window.open above, from a click).
  const keepInside = (e, url) => {
    if (!isOwn(url)) e.preventDefault();
  };
  win.webContents.on('will-navigate', keepInside);
  win.webContents.on('will-redirect', keepInside);
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Before closing, let the page write any changes it hasn't saved yet (saves are batched; see src/lib/persistence.ts).
  let flushed = false;
  let closing = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    const done = () => {
      flushed = true;
      if (!win.isDestroyed()) win.close();
      if (quitting) app.quit();
    };
    const timeout = new Promise((r) => setTimeout(() => r('timeout'), 4000));
    Promise.race([win.webContents.executeJavaScript('window.__rackdrawFlush ? window.__rackdrawFlush() : true', true), timeout])
      .catch(() => true)
      .then(async (saved) => {
        // The last save failed (disk full…): say so instead of quietly losing the changes.
        if (saved === false && !win.isDestroyed()) {
          const r = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Keep RackDraw open', 'Close anyway'],
            defaultId: 0,
            cancelId: 0,
            message: 'Your latest changes could not be saved.',
            detail: 'Keep RackDraw open, then use the red bar to retry or back up everything. Closing now loses those changes.',
          });
          if (r.response !== 1) { closing = false; quitting = false; return; }
        }
        done();
      });
  });

  // Right-click in a text box: spelling suggestions for a misspelt word, then Cut / Copy / Paste. (The drawing has
  // its own right-click menu; this one only appears in places where text is typed.)
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.misspelledWord) return;
    const items = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 6)) items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    const f = params.editFlags;
    items.push(
      { role: 'cut', enabled: f.canCut }, { role: 'copy', enabled: f.canCopy }, { role: 'paste', enabled: f.canPaste },
      { type: 'separator' }, { role: 'selectAll', enabled: f.canSelectAll },
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // A reload starts the page over: opened files wait until it is listening again.
  win.webContents.on('did-start-loading', () => { pageReady = false; });
  mainWindow = win;
  win.loadURL(`${ORIGIN}/`);
}

// Set when the user quits (Cmd+Q / File → Quit): after the windows have saved, the app quits too (macOS keeps
// running with no windows otherwise).
let quitting = false;
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => approved?.flush());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // RackDraw already running: a double-clicked file opens in the open window.
  app.on('second-instance', (_e, argv) => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    void openFiles(filesIn(argv));
  });

  app.whenReady().then(() => {
    approved = approvedStore(path.join(app.getPath('userData'), 'approved-files.json'));
    // Every response carries the policy (pages, scripts, the PDF reader's worker, pictures).
    protocol.handle('app', async (req) => {
      const file = resolveFile(new URL(req.url).pathname);
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      if (/\.html?$/i.test(file)) {
        const html = await res.text();
        headers.set('Content-Security-Policy', cspFor(file, html));
        return new Response(html, { status: res.status, statusText: res.statusText, headers });
      }
      headers.set('Content-Security-Policy', CSP);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    });
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(ALLOWED_PERMISSIONS.has(permission) && isOwn(details?.requestingUrl || wc?.getURL() || '')));
    ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isOwn(origin || wc?.getURL() || ''));
    // No downloads of anything the app didn't make itself (its own exports are blob: / data: URLs).
    ses.on('will-download', (e, item) => {
      const u = item.getURL();
      if (!u.startsWith('blob:') && !u.startsWith('data:')) e.preventDefault();
    });

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'File', submenu: [{ role: 'quit' }] },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        // Developer tools only in development builds.
        { label: 'View', submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
        { label: 'Help', submenu: [{ label: 'About RackDraw', click: () => app.showAboutPanel() }] },
      ]),
    );
    app.setAboutPanelOptions({ applicationName: 'RackDraw', applicationVersion: app.getVersion(), copyright: 'MIT License' });

    createWindow();
    void openFiles(filesIn(process.argv));
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
