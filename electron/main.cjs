// RackDraw desktop shell (formerly NetCraft): serves the static Next.js export (out/) from a private app:// origin.
// A custom scheme (rather than file://) keeps absolute asset paths working and gives the app a
// stable origin, so diagrams saved in localStorage persist between launches.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', 'out');
// The app was called NetCraft: its origin and data folder keep that name, so the diagrams saved there (IndexedDB /
// localStorage belong to this origin, in this folder) are still found after the rename to RackDraw.
const ORIGIN = 'app://netcraft';
app.setPath('userData', path.join(app.getPath('appData'), 'NetCraft'));

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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });

  // Links to other sites open in the default browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOwn(url)) openOutside(url);
    return { action: 'deny' };
  });
  const keepInside = (e, url) => {
    if (!isOwn(url)) {
      e.preventDefault();
      openOutside(url);
    }
  };
  win.webContents.on('will-navigate', keepInside);
  win.webContents.on('will-redirect', keepInside);
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Before closing, let the page write any changes it hasn't saved yet (saves are batched; see src/lib/persistence.ts).
  let flushed = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    const done = () => {
      flushed = true;
      if (!win.isDestroyed()) win.close();
    };
    const timeout = new Promise((r) => setTimeout(r, 4000));
    Promise.race([win.webContents.executeJavaScript('window.__rackdrawFlush ? window.__rackdrawFlush() : true', true), timeout])
      .catch(() => undefined)
      .then(done);
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

  win.loadURL(`${ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => net.fetch(pathToFileURL(resolveFile(new URL(req.url).pathname)).toString()));

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
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
