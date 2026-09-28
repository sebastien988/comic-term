const DEFAULT_FONT = 'Cascadia Mono';
const DEFAULT_SIZE = 14;
const FONT_KEY = 'comicterm:font';
const SIZE_KEY = 'comicterm:fontSize';

// Preferences are optional; storage throwing must not stop the terminal.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } },
};

let tabCount = 0;
let activeId = null;
const tabs = new Map(); // id -> { term, fitAddon, tabEl, labelEl, paneEl, fallbackTitle, title }

const tabbar = document.getElementById('tabbar');
const panes = document.getElementById('panes');
const fontInput = document.getElementById('fontinput');

const clampSize = (n) => Math.min(40, Math.max(6, Math.round(n)));
// Quotes or backslashes would break out of the CSS font-family string.
const cleanFont = (name) => name.replace(/["\\]/g, '').trim() || DEFAULT_FONT;

let fontFamily = cleanFont(store.get(FONT_KEY) || DEFAULT_FONT);
let fontSize = clampSize(Number(store.get(SIZE_KEY)) || DEFAULT_SIZE);
fontInput.value = fontFamily;

const fontStack = () => `"${fontFamily}", monospace`;
const activeTab = () => tabs.get(activeId);

function newTab() {
  const id = ++tabCount;
  const fallbackTitle = `Shell ${id}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.title = fallbackTitle;
  const labelEl = document.createElement('span');
  labelEl.className = 'tab-label';
  labelEl.textContent = fallbackTitle;
  const closeEl = document.createElement('span');
  closeEl.className = 'tab-close';
  closeEl.textContent = '✕';
  closeEl.title = 'Close tab (Ctrl+Shift+W)';
  closeEl.onclick = (e) => { e.stopPropagation(); closeTab(id); };
  tabEl.appendChild(labelEl);
  tabEl.appendChild(closeEl);
  tabEl.onclick = () => activate(id);
  // Middle-click closes, as in browsers.
  tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
  tabbar.insertBefore(tabEl, document.getElementById('newtab'));

  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  panes.appendChild(paneEl);

  const term = new Terminal({
    fontFamily: fontStack(),
    fontSize,
    theme: { background: '#1e1e1e', foreground: '#e0e0e0' },
    cursorBlink: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  // Ctrl+click opens a URL; a plain click stays free for selecting text.
  term.loadAddon(new WebLinksAddon.WebLinksAddon((event, uri) => {
    if (event.ctrlKey || event.metaKey) window.hostAPI.openExternal(uri);
  }));
  // Keys the app handles itself (see shortcutFor) must not also reach the
  // shell; the document-level listener below acts on them.
  term.attachCustomKeyEventHandler((e) => !shortcutFor(e));
  term.onTitleChange((title) => setTitle(id, title));
  term.open(paneEl);

  // Right-click copies the selection, or pastes when there isn't one — the
  // Windows console convention.
  paneEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) copySelection(term);
    else pasteInto(term);
  });

  tabs.set(id, { term, fitAddon, tabEl, labelEl, paneEl, fallbackTitle, title: fallbackTitle });
  activate(id);

  window.ptyAPI.create(id, term.cols, term.rows);
  term.onData((data) => window.ptyAPI.write(id, data));
  term.onResize(({ cols, rows }) => window.ptyAPI.resize(id, cols, rows));
}

function activate(id) {
  const t = tabs.get(id);
  if (!t) return;
  activeId = id;
  for (const [tid, other] of tabs) {
    other.tabEl.classList.toggle('active', tid === id);
    other.paneEl.classList.toggle('active', tid === id);
  }
  document.title = `${t.title} — ComicTerm`;
  t.fitAddon.fit();
  t.term.focus();
}

function setTitle(id, title) {
  const t = tabs.get(id);
  if (!t) return;
  t.title = title.trim() || t.fallbackTitle;
  t.labelEl.textContent = t.title;
  t.tabEl.title = t.title;
  if (id === activeId) document.title = `${t.title} — ComicTerm`;
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  window.ptyAPI.kill(id);
  t.term.dispose();
  t.tabEl.remove();
  t.paneEl.remove();
  tabs.delete(id);
  if (activeId === id) {
    const remaining = [...tabs.keys()];
    if (remaining.length) activate(remaining[remaining.length - 1]);
    else window.close();
  }
}

function cycleTab(step) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  activate(ids[(i + step + ids.length) % ids.length]);
}

function copySelection(term) {
  const text = term.getSelection();
  if (text) window.hostAPI.writeClipboard(text);
  term.clearSelection();
}

async function pasteInto(term) {
  const text = await window.hostAPI.readClipboard();
  // paste() handles bracketed-paste mode and line-ending conversion.
  if (text) term.paste(text);
  term.focus();
}

function applyFont() {
  for (const { term } of tabs.values()) {
    term.options.fontFamily = fontStack();
    term.options.fontSize = fontSize;
  }
  fitActive();
  store.set(FONT_KEY, fontFamily);
  store.set(SIZE_KEY, String(fontSize));
}

function setFontSize(size) {
  fontSize = clampSize(size);
  applyFont();
}

function fitActive() {
  const t = activeTab();
  if (t) t.fitAddon.fit();
}

/*
 * App shortcuts, in the Windows Terminal style. Returns the action for a
 * key event, or null to leave it to the shell. Ctrl+C copies only while
 * text is selected; otherwise it is the usual interrupt.
 */
function shortcutFor(e) {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey) {
    switch (key) {
      case 't': return 'newTab';
      case 'w': return 'closeTab';
      case 'c': return 'copy';
      case 'v': return 'paste';
      case 'Tab': return 'prevTab';
      case '+': return 'fontUp'; // Ctrl+Shift+= on most layouts
      default: return null;
    }
  }
  switch (key) {
    case 'Tab': case 'PageDown': return 'nextTab';
    case 'PageUp': return 'prevTab';
    case '=': case '+': return 'fontUp';
    case '-': return 'fontDown';
    case '0': return 'fontReset';
    case 'c': return activeTab()?.term.hasSelection() ? 'copy' : null;
    default: return null;
  }
}

const actions = {
  newTab,
  closeTab: () => { if (activeId !== null) closeTab(activeId); },
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  copy: () => { const t = activeTab(); if (t) copySelection(t.term); },
  paste: () => { const t = activeTab(); if (t) pasteInto(t.term); },
  fontUp: () => setFontSize(fontSize + 1),
  fontDown: () => setFontSize(fontSize - 1),
  fontReset: () => setFontSize(DEFAULT_SIZE),
};

document.addEventListener('keydown', (e) => {
  const action = shortcutFor(e);
  if (!action) return;
  // In the font box, copy and paste mean the box's own text.
  if (e.target === fontInput && (action === 'copy' || action === 'paste')) return;
  e.preventDefault();
  e.stopPropagation();
  actions[action]();
});

window.ptyAPI.onData(({ id, data }) => tabs.get(id)?.term.write(data));
// Windows Terminal's "graceful" rule: a clean exit closes the tab; anything
// else (a crash, a shell that couldn't start) leaves it open so the reason
// can be read.
window.ptyAPI.onExit(({ id, exitCode }) => {
  const t = tabs.get(id);
  if (!t) return;
  if (exitCode === 0) {
    closeTab(id);
    return;
  }
  t.term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
});

document.getElementById('newtab').onclick = newTab;

fontInput.addEventListener('change', () => {
  fontFamily = cleanFont(fontInput.value);
  fontInput.value = fontFamily;
  applyFont();
});

// Follows the panes area itself, so anything that changes its size — not
// just the window — refits the terminal.
let fitQueued = false;
new ResizeObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fitActive(); });
}).observe(panes);

newTab();
