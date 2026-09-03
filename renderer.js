let tabCount = 0;
let activeId = null;
const tabs = new Map(); // id -> { term, fitAddon, tabEl, paneEl }

const tabbar = document.getElementById('tabbar');
const panes = document.getElementById('panes');
const fontInput = document.getElementById('fontinput');

function newTab() {
  const id = ++tabCount;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  const labelEl = document.createElement('span');
  labelEl.textContent = `Shell ${id}`;
  const closeEl = document.createElement('span');
  closeEl.className = 'tab-close';
  closeEl.textContent = '✕';
  closeEl.onclick = (e) => { e.stopPropagation(); closeTab(id); };
  tabEl.appendChild(labelEl);
  tabEl.appendChild(closeEl);
  tabEl.onclick = () => activate(id);
  tabbar.insertBefore(tabEl, document.getElementById('fontbox'));

  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  panes.appendChild(paneEl);

  const term = new Terminal({
    fontFamily: `"${fontInput.value}", monospace`,
    fontSize: 14,
    theme: { background: '#1e1e1e', foreground: '#e0e0e0' },
    cursorBlink: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(paneEl);

  tabs.set(id, { term, fitAddon, tabEl, paneEl });
  activate(id);
  fitAddon.fit();

  window.ptyAPI.create(id, term.cols, term.rows);
  term.onData((data) => window.ptyAPI.write(id, data));
  term.onResize(({ cols, rows }) => window.ptyAPI.resize(id, cols, rows));
}

function activate(id) {
  activeId = id;
  for (const [tid, t] of tabs) {
    t.tabEl.classList.toggle('active', tid === id);
    t.paneEl.classList.toggle('active', tid === id);
  }
  const t = tabs.get(id);
  t.fitAddon.fit();
  t.term.focus();
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

window.ptyAPI.onData(({ id, data }) => tabs.get(id)?.term.write(data));
window.ptyAPI.onExit(({ id }) => closeTab(id));

document.getElementById('newtab').onclick = newTab;

fontInput.addEventListener('change', () => {
  for (const { term, fitAddon } of tabs.values()) {
    term.options.fontFamily = `"${fontInput.value}", monospace`;
    fitAddon.fit();
  }
});

window.addEventListener('resize', () => {
  const t = tabs.get(activeId);
  if (t) t.fitAddon.fit();
});

newTab();
