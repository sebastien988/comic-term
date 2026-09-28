const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ptyAPI', {
  create: (id, cols, rows) => ipcRenderer.send('pty:create', { id, cols, rows }),
  write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  onData: (cb) => ipcRenderer.on('pty:data', (e, payload) => cb(payload)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (e, payload) => cb(payload)),
});

contextBridge.exposeInMainWorld('hostAPI', {
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard:write', text),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
