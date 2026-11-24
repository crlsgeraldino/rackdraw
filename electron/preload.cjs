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
  /** The page is ready for opened files. */
  ready: () => ipcRenderer.send('rd:ready'),
  /** Where a file chosen in File → Open is on disk ('' if unknown), so Save can write back to it. */
  pathOf: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
});
