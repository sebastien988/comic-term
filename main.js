const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

// Shells belong to the window that started them, keyed by its webContents,
// so a window closing (or reloading) takes its shells with it rather than
// leaving them running with nowhere to send output.
const shellsByContents = new Map(); // webContents id -> Map<tab id, pty>

// COMICTERM_SHELL wins; otherwise PowerShell on Windows and the login shell
// elsewhere.
function defaultShell() {
  if (process.env.COMICTERM_SHELL) return process.env.COMICTERM_SHELL;
  if (os.platform() === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

function isWebUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function send(contents, channel, payload) {
  if (!contents.isDestroyed()) contents.send(channel, payload);
}

function shellsFor(contents) {
  const key = contents.id;
  let shells = shellsByContents.get(key);
  if (!shells) {
    shells = new Map();
    shellsByContents.set(key, shells);
    const killAll = () => {
      const all = [...shells.values()];
      shells.clear();
      for (const term of all) term.kill();
    };
    contents.once('destroyed', () => {
      killAll();
      shellsByContents.delete(key);
    });
    // A reloaded page numbers its tabs from 1 again; the old shells would
    // otherwise keep running and write into the new page's tabs.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) killAll();
    });
  }
  return shells;
}

ipcMain.on('pty:create', (event, { id, cols, rows }) => {
  const contents = event.sender;
  const shells = shellsFor(contents);
  const file = defaultShell();
  let term;
  try {
    // On Unix a missing program only shows up as the child exiting, so a
    // mistyped COMICTERM_SHELL path would give no reason at all.
    if (path.isAbsolute(file) && !fs.existsSync(file)) throw new Error('no such file');
    term = pty.spawn(file, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: os.homedir(),
      // xterm.js renders 256 colours and 24-bit colour; say so, or programs
      // fall back to 8.
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ComicTerm' },
    });
  } catch (err) {
    // Shown in the tab, which stays open so the message can be read.
    send(contents, 'pty:data', { id, data: `\x1b[31mCouldn't start ${file}: ${err.message}\x1b[0m\r\n` });
    return;
  }
  shells.set(id, term);
  term.onData((data) => send(contents, 'pty:data', { id, data }));
  term.onExit(({ exitCode }) => {
    // Shells the app ended itself (tab closed, window reloading) are already
    // out of the map; only one that exited on its own is news to the page.
    // Telling a reloading page would have it close its "last tab", and with
    // it the window.
    if (shells.get(id) !== term) return;
    shells.delete(id);
    send(contents, 'pty:exit', { id, exitCode });
  });
});

ipcMain.on('pty:write', (event, { id, data }) => {
  shellsByContents.get(event.sender.id)?.get(id)?.write(data);
});

ipcMain.on('pty:resize', (event, { id, cols, rows }) => {
  shellsByContents.get(event.sender.id)?.get(id)?.resize(cols, rows);
});

ipcMain.on('pty:kill', (event, { id }) => {
  const shells = shellsByContents.get(event.sender.id);
  const term = shells?.get(id);
  if (!term) return;
  shells.delete(id);
  term.kill();
});

// The renderer is sandboxed, so the clipboard is reached through here.
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (event, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

ipcMain.on('open-external', (event, url) => {
  if (isWebUrl(url)) shell.openExternal(url);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 650,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // A terminal, not a browser: links go to the real browser, and nothing
  // (a dropped file, say) may navigate the window away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
