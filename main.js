const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

const shells = new Map(); // id -> pty process

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 650,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile('index.html');

  ipcMain.on('pty:create', (event, { id, cols, rows }) => {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: os.homedir(),
      env: process.env,
    });
    shells.set(id, term);
    term.onData((data) => {
      if (!win.isDestroyed()) win.webContents.send('pty:data', { id, data });
    });
    term.onExit(() => {
      shells.delete(id);
      if (!win.isDestroyed()) win.webContents.send('pty:exit', { id });
    });
  });

  ipcMain.on('pty:write', (event, { id, data }) => {
    shells.get(id)?.write(data);
  });

  ipcMain.on('pty:resize', (event, { id, cols, rows }) => {
    shells.get(id)?.resize(cols, rows);
  });

  ipcMain.on('pty:kill', (event, { id }) => {
    shells.get(id)?.kill();
    shells.delete(id);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
