'use strict';

/**
 * End-to-end smoke test. Run with `npm run smoke` (needs a display; use
 * `xvfb-run -a npm run smoke` on a headless machine).
 *
 * Boots the real app and checks the things unit tests cannot see: that the
 * Content-Security-Policy does not block the bundle, that the preload bridge
 * is reachable from the sandboxed renderer, that a PTY actually spawns, and
 * that a command typed into a tab produces output.
 */

const path = require('path');
const { app, BrowserWindow } = require('electron');

process.env.COMICTERM_SHELL = process.env.COMICTERM_SHELL || '/bin/bash';

const TIMEOUT_MS = 30000;
const consoleErrors = [];
const checks = [];

require('../main.js');

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** Poll `fn` until it returns a truthy value or the deadline passes. */
async function waitFor(description, fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description} (last value: ${JSON.stringify(last)})`);
}

/** Read the visible text of the active terminal out of the renderer. */
const READ_ACTIVE_BUFFER = `(() => {
  const tab = tabs.get(activeId);
  if (!tab) return '';
  const buffer = tab.term.buffer.active;
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) out += line.translateToString(true) + '\\n';
  }
  return out;
})()`;

async function run(win) {
  const wc = win.webContents;

  await waitFor('the renderer to finish loading', () => !wc.isLoading(), 15000);

  const bridged = await wc.executeJavaScript(
    'Boolean(window.ptyAPI && window.ptyAPI.create && window.clipboardAPI)',
  );
  check('preload bridge is exposed to the sandboxed renderer', bridged === true);

  const xtermLoaded = await wc.executeJavaScript('typeof Terminal === "function"');
  check('Content-Security-Policy allows the local xterm.js bundle', xtermLoaded === true);

  const initialTabs = await wc.executeJavaScript('tabs.size');
  check('one tab opens at startup', initialTabs === 1, `tabs.size = ${initialTabs}`);

  const ready = await waitFor('the PTY to be spawned', () =>
    wc.executeJavaScript('Boolean(tabs.get(activeId) && tabs.get(activeId).ready)'),
  );
  check('a PTY is attached to the first tab', ready === true);

  // Type a command and wait for its output to come back through the PTY.
  const marker = `comicterm-smoke-${Date.now()}`;
  await wc.executeJavaScript(
    `window.ptyAPI.write(activeId, ${JSON.stringify(`echo ${marker}\n`)}), true`,
  );
  const echoed = await waitFor('shell output', async () => {
    const text = await wc.executeJavaScript(READ_ACTIVE_BUFFER);
    // Two hits: the echoed keystrokes and the command's own output.
    return (text.match(new RegExp(marker, 'g')) || []).length >= 2;
  }, 15000);
  check('a command typed into a tab produces shell output', echoed === true);

  await wc.executeJavaScript('newTab(), true');
  const afterNew = await waitFor('the second tab to register', async () => {
    const size = await wc.executeJavaScript('tabs.size');
    return size === 2 ? size : 0;
  });
  check('a second tab can be opened', afterNew === 2);

  const secondReady = await waitFor('the second PTY to be spawned', () =>
    wc.executeJavaScript('Boolean(tabs.get(activeId) && tabs.get(activeId).ready)'),
  );
  check('the second tab gets its own PTY', secondReady === true);

  // Shortcuts go through the same handler the terminal and window both call.
  const cycled = await wc.executeJavaScript(`(() => {
    const before = activeId;
    const handled = handleShortcut({ type: 'keydown', key: 'Tab', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
    return { handled, moved: activeId !== before };
  })()`);
  check('Ctrl+Tab cycles tabs', cycled.handled === true && cycled.moved === true, JSON.stringify(cycled));

  const zoomed = await wc.executeJavaScript(`(() => {
    const before = fontSize;
    handleShortcut({ type: 'keydown', key: '=', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
    return { before, after: fontSize };
  })()`);
  check('Ctrl+= zooms in', zoomed.after === zoomed.before + 1, JSON.stringify(zoomed));

  await wc.executeJavaScript('closeTab(activeId), true');
  const afterClose = await wc.executeJavaScript('tabs.size');
  check('closing a tab removes it', afterClose === 1, `tabs.size = ${afterClose}`);

  const fontPersisted = await wc.executeJavaScript(
    'setFontSize(18), window.localStorage.getItem("comicterm.fontSize")',
  );
  check('font size is persisted', fontPersisted === '18', `stored ${fontPersisted}`);

  check('renderer logged no errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  if (process.env.COMICTERM_SMOKE_SCREENSHOT) {
    const image = await wc.capturePage();
    require('fs').writeFileSync(process.env.COMICTERM_SMOKE_SCREENSHOT, image.toPNG());
    console.log(`screenshot written to ${process.env.COMICTERM_SMOKE_SCREENSHOT}`);
  }
}

const bail = setTimeout(() => {
  console.error(`smoke test exceeded ${TIMEOUT_MS}ms`);
  app.exit(1);
}, TIMEOUT_MS);

/**
 * Shut down the way a user does — close the windows and let `app.quit()` run
 * the normal teardown, which is also what reaps the PTYs. `app.exit()` is kept
 * only as a backstop in case quitting stalls.
 */
function finish(code) {
  process.exitCode = code;
  clearTimeout(bail);
  const backstop = setTimeout(() => app.exit(code), 5000);
  backstop.unref?.();
  for (const win of BrowserWindow.getAllWindows()) win.close();
  app.quit();
}

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.error('FAIL no BrowserWindow was created');
    finish(1);
    return;
  }

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // level 3 is "error"; CSP violations and uncaught renderer exceptions land here.
    if (level >= 3) consoleErrors.push(`${path.basename(sourceId)}:${line} ${message}`);
  });

  let failure = null;
  try {
    await run(win);
  } catch (err) {
    failure = err;
    check('smoke test ran to completion', false, err.message);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failure) console.error(failure.stack);
  finish(failed.length === 0 ? 0 : 1);
});
