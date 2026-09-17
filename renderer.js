'use strict';

/* global Terminal, FitAddon */

const STORAGE_KEYS = {
  fontFamily: 'comicterm.fontFamily',
  fontSize: 'comicterm.fontSize',
};

const DEFAULT_FONT_FAMILY = 'Cascadia Mono';
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 48;
const SCROLLBACK = 10000;

const THEME = {
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  selectionBackground: '#4a4a4a',
};

const isMac = (navigator.userAgentData?.platform || navigator.platform || '')
  .toUpperCase()
  .includes('MAC');

/** @type {Map<number, Tab>} */
const tabs = new Map();
let tabCount = 0;
let activeId = null;

const tabbar = document.getElementById('tabbar');
const tabstrip = document.getElementById('tabstrip');
const panes = document.getElementById('panes');
const fontInput = document.getElementById('fontinput');

// -- persisted settings ------------------------------------------------------

/**
 * localStorage throws in some Electron configurations (and when storage is
 * full), and a terminal that refuses to open because it could not read a font
 * preference would be a silly way to fail.
 */
function readSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Preference just will not survive a restart.
  }
}

let fontFamily = readSetting(STORAGE_KEYS.fontFamily, DEFAULT_FONT_FAMILY);
let fontSize = clampFontSize(Number(readSetting(STORAGE_KEYS.fontSize, DEFAULT_FONT_SIZE)));

function clampFontSize(size) {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/** Quote the family name so fonts with spaces ("Cascadia Mono") resolve. */
function fontStack(family) {
  const name = family.trim() || DEFAULT_FONT_FAMILY;
  return `"${name.replace(/"/g, '')}", monospace`;
}

function applyFontToAllTabs() {
  for (const tab of tabs.values()) {
    tab.term.options.fontFamily = fontStack(fontFamily);
    tab.term.options.fontSize = fontSize;
    fit(tab);
  }
}

function setFontFamily(family) {
  fontFamily = family;
  writeSetting(STORAGE_KEYS.fontFamily, family);
  applyFontToAllTabs();
}

function setFontSize(size) {
  fontSize = clampFontSize(size);
  writeSetting(STORAGE_KEYS.fontSize, fontSize);
  applyFontToAllTabs();
}

// -- tabs --------------------------------------------------------------------

/**
 * @typedef {object} Tab
 * @property {import('@xterm/xterm').Terminal} term
 * @property {object} fitAddon
 * @property {HTMLElement} tabEl
 * @property {HTMLElement} labelEl
 * @property {HTMLElement} paneEl
 * @property {boolean} ready   - true once the PTY has been spawned
 * @property {string[]} pending - keystrokes typed before the PTY existed
 */

function newTab() {
  const id = ++tabCount;
  const defaultTitle = `Shell ${id}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.setAttribute('role', 'tab');
  tabEl.tabIndex = 0;

  const labelEl = document.createElement('span');
  labelEl.className = 'tab-label';
  labelEl.textContent = defaultTitle;

  const closeEl = document.createElement('button');
  closeEl.className = 'tab-close';
  closeEl.type = 'button';
  closeEl.textContent = '✕';
  closeEl.title = 'Close tab';
  closeEl.setAttribute('aria-label', `Close ${defaultTitle}`);
  closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  tabEl.append(labelEl, closeEl);
  tabEl.addEventListener('click', () => activate(id));
  tabEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(id);
    }
  });
  // Middle-click to close, as in every browser and most terminals.
  tabEl.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(id);
    }
  });
  tabstrip.appendChild(tabEl);

  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  paneEl.setAttribute('role', 'tabpanel');
  panes.appendChild(paneEl);

  const term = new Terminal({
    fontFamily: fontStack(fontFamily),
    fontSize,
    theme: THEME,
    cursorBlink: true,
    scrollback: SCROLLBACK,
    allowTransparency: false,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(paneEl);

  /** @type {Tab} */
  const tab = { term, fitAddon, tabEl, labelEl, paneEl, ready: false, pending: [] };
  tabs.set(id, tab);

  // Shells announce their cwd and running command through OSC 0/2; showing that
  // is the difference between "Shell 3" and "~/src/comic-term - vim".
  term.onTitleChange((title) => {
    const text = title.trim() || defaultTitle;
    labelEl.textContent = text;
    tabEl.title = text;
    closeEl.setAttribute('aria-label', `Close ${text}`);
    if (id === activeId) document.title = `${text} - ComicTerm`;
  });

  term.attachCustomKeyEventHandler((event) => {
    if (!handleShortcut(event)) return true;
    // Stop the event here so the window-level listener below does not run the
    // same shortcut a second time as it bubbles up.
    event.preventDefault();
    event.stopPropagation();
    return false;
  });

  term.onData((data) => {
    if (tab.ready) window.ptyAPI.write(id, data);
    else tab.pending.push(data);
  });
  term.onResize(({ cols, rows }) => {
    if (tab.ready) window.ptyAPI.resize(id, cols, rows);
  });

  term.element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const selection = term.getSelection();
    if (selection) copySelection(term);
    else pasteInto(id);
  });

  activate(id);
  fit(tab);

  window.ptyAPI
    .create(id, term.cols, term.rows)
    .then((result) => {
      if (!tabs.has(id)) return; // Closed while the shell was starting.
      if (!result || !result.ok) {
        term.writeln(`\x1b[31mComicTerm: ${(result && result.error) || 'failed to start shell'}\x1b[0m`);
        term.writeln('\x1b[90mSet COMICTERM_SHELL to choose a different shell.\x1b[0m');
        return;
      }
      tab.ready = true;
      window.ptyAPI.resize(id, term.cols, term.rows);
      for (const chunk of tab.pending) window.ptyAPI.write(id, chunk);
      tab.pending.length = 0;
    })
    .catch((err) => {
      if (tabs.has(id)) term.writeln(`\x1b[31mComicTerm: ${err.message}\x1b[0m`);
    });

  return id;
}

function activate(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  activeId = id;
  for (const [tid, t] of tabs) {
    const isActive = tid === id;
    t.tabEl.classList.toggle('active', isActive);
    t.tabEl.setAttribute('aria-selected', String(isActive));
    t.paneEl.classList.toggle('active', isActive);
  }

  document.title = `${tab.labelEl.textContent} - ComicTerm`;
  tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  fit(tab);
  tab.term.focus();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  tabs.delete(id);
  window.ptyAPI.kill(id);
  tab.term.dispose();
  tab.tabEl.remove();
  tab.paneEl.remove();

  if (activeId !== id) return;
  activeId = null;
  const remaining = [...tabs.keys()];
  if (remaining.length) activate(remaining[remaining.length - 1]);
  else window.close();
}

/**
 * Fitting a hidden or detached pane measures zero and leaves xterm with a
 * nonsense geometry, so only measure panes that are actually on screen.
 */
function fit(tab) {
  if (!tab || !tab.paneEl.isConnected) return;
  if (tab.paneEl.clientWidth === 0 || tab.paneEl.clientHeight === 0) return;
  try {
    tab.fitAddon.fit();
  } catch {
    // xterm throws if the pane is mid-layout; the next resize will catch it.
  }
}

function orderedIds() {
  return [...tabs.keys()];
}

function cycleTab(delta) {
  const ids = orderedIds();
  if (ids.length < 2) return;
  const index = ids.indexOf(activeId);
  const next = (index + delta + ids.length) % ids.length;
  activate(ids[next]);
}

// -- clipboard ---------------------------------------------------------------

function copySelection(term) {
  const selection = term.getSelection();
  if (selection) window.clipboardAPI.write(selection);
}

async function pasteInto(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const text = await window.clipboardAPI.read();
  if (!text) return;
  if (tab.ready) window.ptyAPI.write(id, text);
  else tab.pending.push(text);
}

// -- keyboard shortcuts ------------------------------------------------------

/**
 * Terminals hand almost every keystroke to the shell, so app shortcuts have to
 * be claimed explicitly. macOS uses Cmd; everywhere else uses Ctrl+Shift, which
 * keeps Ctrl+C free for SIGINT.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean} true if ComicTerm handled the key and the shell should not see it
 */
function handleShortcut(event) {
  if (event.type !== 'keydown') return false;

  const mod = isMac ? event.metaKey : event.ctrlKey;
  const appMod = isMac ? event.metaKey : event.ctrlKey && event.shiftKey;
  const key = event.key;

  if (appMod && !event.altKey) {
    switch (key.toLowerCase()) {
      case 't':
        newTab();
        return true;
      case 'w':
        if (activeId !== null) closeTab(activeId);
        return true;
      case 'c': {
        const tab = tabs.get(activeId);
        // On macOS, Cmd+C with no selection should not swallow the keystroke.
        if (tab && tab.term.hasSelection()) {
          copySelection(tab.term);
          return true;
        }
        return false;
      }
      case 'v':
        if (activeId !== null) pasteInto(activeId);
        return true;
      default:
        break;
    }
  }

  // Cmd+Tab belongs to the macOS app switcher and never reaches us, so tab
  // cycling listens for Ctrl on every platform.
  if (event.ctrlKey && !event.altKey) {
    if (key === 'Tab') {
      cycleTab(event.shiftKey ? -1 : 1);
      return true;
    }
    if (key === 'PageDown') {
      cycleTab(1);
      return true;
    }
    if (key === 'PageUp') {
      cycleTab(-1);
      return true;
    }
  }

  if (mod && !event.altKey) {
    if (key === '=' || key === '+') {
      setFontSize(fontSize + 1);
      return true;
    }
    if (key === '-' || key === '_') {
      setFontSize(fontSize - 1);
      return true;
    }
    if (key === '0') {
      setFontSize(DEFAULT_FONT_SIZE);
      return true;
    }
  }

  // Alt+1..9 jumps straight to a tab (GNOME Terminal / Konsole convention).
  const jumpMod = isMac ? event.metaKey : event.altKey;
  if (jumpMod && !event.shiftKey && /^[1-9]$/.test(key)) {
    const ids = orderedIds();
    const target = key === '9' ? ids[ids.length - 1] : ids[Number(key) - 1];
    if (target !== undefined) activate(target);
    return true;
  }

  return false;
}

// -- wiring ------------------------------------------------------------------

window.ptyAPI.onData(({ id, data }) => {
  tabs.get(id)?.term.write(data);
});

window.ptyAPI.onExit(({ id }) => closeTab(id));

document.getElementById('newtab').addEventListener('click', () => newTab());

fontInput.value = fontFamily;
fontInput.addEventListener('change', () => setFontFamily(fontInput.value));
// Let Escape/Enter hand focus back to the terminal instead of trapping it.
fontInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    if (e.key === 'Escape') fontInput.value = fontFamily;
    else setFontFamily(fontInput.value);
    tabs.get(activeId)?.term.focus();
  }
});

// Shortcuts still work when focus is on the tab bar or the chrome. Keystrokes
// a terminal already acted on never reach here: it stops their propagation.
window.addEventListener('keydown', (event) => {
  if (event.target === fontInput) return;
  if (handleShortcut(event)) event.preventDefault();
});

// ResizeObserver catches window resizes, DPI changes and the tab strip growing
// into a second row — a plain `window.onresize` listener misses the last two.
const observer = new ResizeObserver(() => {
  window.requestAnimationFrame(() => fit(tabs.get(activeId)));
});
observer.observe(panes);

// Clicking dead space in the tab bar should return focus to the terminal.
tabbar.addEventListener('mousedown', (event) => {
  if (event.target === tabbar || event.target === tabstrip) {
    event.preventDefault();
    tabs.get(activeId)?.term.focus();
  }
});

newTab();
