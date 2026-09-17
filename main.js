'use strict';

const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

const { resolveShell, resolveEnv } = require('./src/shell');
const { isSessionId, sanitizeSize, isWritableData } = require('./src/validate');

/**
 * Live PTY sessions.
 *
 * Session ids are generated per renderer and start at 1 in every window, so the
 * key is namespaced by the owning webContents. That also means a window can
 * only ever address its own PTYs.
 *
 * @type {Map<string, { term: import('node-pty').IPty, webContents: Electron.WebContents }>}
 */
const sessions = new Map();

// -- session lifecycle -------------------------------------------------------

function sessionKey(webContents, id) {
  return `${webContents.id}:${id}`;
}

/** Look up a session, but only if the sender owns it. */
function ownedSession(event, id) {
  if (!isSessionId(id)) return undefined;
  return sessions.get(sessionKey(event.sender, id));
}

function killSession(key) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  try {
    session.term.kill();
  } catch {
    // The shell already exited on its own; nothing left to clean up.
  }
}

/** Kill every PTY owned by a window that is going away. */
function killSessionsFor(webContents) {
  for (const [key, session] of sessions) {
    if (session.webContents === webContents) killSession(key);
  }
}

/**
 * Shells are children of the app, not of the OS session: if we exit without
 * killing them they survive as orphans holding their working directories open.
 */
function killAllSessions() {
  for (const key of [...sessions.keys()]) killSession(key);
}

function startingDirectory() {
  try {
    return os.homedir();
  } catch {
    return process.cwd();
  }
}

// -- IPC ---------------------------------------------------------------------

// Registered once at startup rather than per window, so reopening a window
// cannot install a second set of handlers.
function registerIpcHandlers() {
  ipcMain.handle('pty:create', (event, payload = {}) => {
    const { id } = payload;
    if (!isSessionId(id)) return { ok: false, error: 'Invalid session id' };

    const key = sessionKey(event.sender, id);
    if (sessions.has(key)) return { ok: false, error: `Session ${id} already exists` };

    const { cols, rows } = sanitizeSize(payload);
    const { file, args } = resolveShell();

    let term;
    try {
      term = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: startingDirectory(),
        env: resolveEnv(),
      });
    } catch (err) {
      // A missing or non-executable shell is a user-fixable configuration
      // problem, so report it back instead of leaving a silently dead tab.
      return { ok: false, error: `Could not start ${file}: ${err.message}` };
    }

    const webContents = event.sender;
    sessions.set(key, { term, webContents });

    term.onData((data) => {
      if (!webContents.isDestroyed()) webContents.send('pty:data', { id, data });
    });

    term.onExit(({ exitCode, signal }) => {
      sessions.delete(key);
      if (!webContents.isDestroyed()) {
        webContents.send('pty:exit', { id, exitCode, signal });
      }
    });

    return { ok: true, shell: file };
  });

  ipcMain.on('pty:write', (event, { id, data } = {}) => {
    if (!isWritableData(data)) return;
    const session = ownedSession(event, id);
    if (!session) return;
    try {
      session.term.write(data);
    } catch {
      // The shell exited between the keystroke and now.
    }
  });

  ipcMain.on('pty:resize', (event, payload = {}) => {
    const session = ownedSession(event, payload.id);
    if (!session) return;
    const { cols, rows } = sanitizeSize(payload);
    try {
      session.term.resize(cols, rows);
    } catch {
      // The shell exited between the resize request and now.
    }
  });

  ipcMain.on('pty:kill', (event, { id } = {}) => {
    if (ownedSession(event, id)) killSession(sessionKey(event.sender, id));
  });

  // The renderer is sandboxed, so it has no `clipboard` module of its own and
  // the async Clipboard API would need a permission prompt for reads.
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.on('clipboard:write', (_event, text) => {
    if (isWritableData(text) && text.length > 0) clipboard.writeText(text);
  });
}

// -- window ------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 650,
    minWidth: 400,
    minHeight: 200,
    backgroundColor: '#1e1e1e',
    title: 'ComicTerm',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // The renderer displays whatever the shell prints, including URLs and
  // escape sequences from remote machines. Never let it navigate away from
  // the app or open a second, less locked-down window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.webContents.on('destroyed', () => killSessionsFor(win.webContents));

  return win;
}

// -- app lifecycle -----------------------------------------------------------

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  // macOS keeps the app running with no windows; clicking the dock icon is how
  // you get one back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', killAllSessions);
process.on('exit', killAllSessions);
