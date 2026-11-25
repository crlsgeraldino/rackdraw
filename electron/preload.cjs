// The only bridge between RackDraw's page and Windows: saving a client to a file, and files opened from Explorer
// (double-click a .rackdraw file). The page gets these three functions and nothing else; the main process decides
// where it may write (see electron/main.cjs).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('rackdrawDesktop', {
  /** Saves the bytes: back to `path` when RackDraw may write there, else asks where (Save As always asks). */
  save: (bytes, suggestedName, path, saveAs) => ipcRenderer.invoke('rd:save', { bytes, suggestedName, path, saveAs: !!saveAs }),
  /** Files opened from Explorer / the command line, sent once the page is listening. */
  onOpenFile: (cb) => {
    const handler = (_e, file) => cb(file);
    ipcRenderer.on('rd:open-file', handler);
    return () => ipcRenderer.removeListener('rd:open-file', handler);
  },
  /** How each download ended ('completed', 'cancelled', 'interrupted'): the Save dialog can be cancelled. */
  onDownloadDone: (cb) => {
    const handler = (_e, r) => cb(r);
    ipcRenderer.on('rd:download-done', handler);
    return () => ipcRenderer.removeListener('rd:download-done', handler);
  },
  /** A file that was asked to open but couldn't be read (too large, locked, offline). */
  onOpenFailed: (cb) => {
    const handler = (_e, r) => cb(r);
    ipcRenderer.on('rd:open-failed', handler);
    return () => ipcRenderer.removeListener('rd:open-failed', handler);
  },
  /** The page is ready for opened files. */
  ready: () => ipcRenderer.send('rd:ready'),
  /** Opens a client file from the Recent list (false if it is gone). */
  openPath: (path) => ipcRenderer.invoke('rd:open-path', path),
  /** Shows a client file in Explorer. */
  showInFolder: (path) => ipcRenderer.invoke('rd:show-in-folder', path),
  /** Where a file chosen in File → Open is on disk ('' if unknown), so Save can write back to it. */
  pathOf: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
});
