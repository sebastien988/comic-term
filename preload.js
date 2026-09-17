'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only surface the renderer gets on the main process.
 *
 * Every listener returns its own unsubscribe function: the renderer creates and
 * destroys tabs for the lifetime of the app, and `ipcRenderer.on` with no way
 * to detach is how an Electron app slowly leaks handlers.
 */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ptyAPI', {
  /**
   * Start a shell. Resolves to `{ ok: true, shell }` or `{ ok: false, error }`
   * so the renderer can surface a failed spawn instead of showing a dead tab.
   */
  create: (id, cols, rows) => ipcRenderer.invoke('pty:create', { id, cols, rows }),
  write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  onData: (cb) => subscribe('pty:data', cb),
  onExit: (cb) => subscribe('pty:exit', cb),
});

// Reads go through main because a sandboxed renderer has no `clipboard` module,
// and the async Clipboard API would prompt for read permission.
contextBridge.exposeInMainWorld('clipboardAPI', {
  read: () => ipcRenderer.invoke('clipboard:read'),
  write: (text) => ipcRenderer.send('clipboard:write', text),
});
