/*
 * End-to-end test: launches the real Electron app over real shells and
 * drives it the way a user would.
 *
 *   npm test                 (Linux CI: xvfb-run -a npm test)
 *
 * Commands are chosen to mean the same thing in bash and PowerShell, so the
 * same checks run on Linux and Windows.
 */
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(import.meta.url)('electron');
const isWin = process.platform === 'win32';
const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'comicterm-test-'));

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}${ok ? '' : `  (got: ${JSON.stringify(actual)})`}`);
  if (!ok) failures++;
}

async function launch(env = {}) {
  const app = await electron.launch({
    executablePath: electronPath,
    // CI Linux runners can't set up Chromium's sandbox; the app itself
    // still asks for one.
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userDataDir}`, root],
    cwd: root,
    env: { ...process.env, ...env },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  win.on('console', (m) => {
    if (m.type() === 'error' || /Security Warning/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await win.waitForSelector('.pane.active .xterm-rows');
  // Type only once the shell has drawn its prompt: PowerShell can take a few
  // seconds on a cold CI runner, and early keystrokes may go astray.
  await waitForScreen(win, /\S/, 30000);
  return { app, win, errors };
}

const screen = (win) => win.$eval('.pane.active .xterm-rows', (e) => e.innerText);

async function waitForScreen(win, pattern, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let text = '';
  while (Date.now() < deadline) {
    text = await screen(win);
    if (pattern.test(text)) return true;
    await win.waitForTimeout(100);
  }
  console.log(`        screen was:\n${text.trimEnd().split('\n').slice(-6).map((l) => `        | ${l}`).join('\n')}`);
  return false;
}

async function run(win, command) {
  await win.keyboard.type(command);
  await win.keyboard.press('Enter');
}

const clipboard = {
  read: (app) => app.evaluate(({ clipboard }) => clipboard.readText()),
  write: (app, text) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text),
};

const tabState = (win) => win.$$eval('.tab', (els) => ({
  count: els.length,
  active: els.findIndex((e) => e.classList.contains('active')),
}));

// Select a word of output the way a user would: double-click it.
async function selectWord(win, word) {
  const at = await win.$eval('.pane.active .xterm-rows', (rows, w) => {
    const lines = [...rows.children];
    const line = lines.findLast((l) => l.textContent.trim() === w);
    const r = line.getBoundingClientRect();
    return { x: r.left + 12, y: r.top + r.height / 2 };
  }, word);
  await win.mouse.dblclick(at.x, at.y);
}

const cmd = {
  // Double quotes expand $((…)) in bash and PowerShell alike.
  echo: (s) => `echo "${s}"`,
  termVar: isWin ? 'echo "term=$env:TERM"' : 'echo term=$TERM',
  pid: isWin ? 'echo "pid=$PID"' : 'echo pid=$$',
  setTitle: (t) => (isWin
    ? `Write-Host -NoNewline "$([char]27)]0;${t}$([char]7)"; Start-Sleep 3`
    : `printf '\\033]0;%s\\007' ${t}; sleep 3`),
  fail: 'exit 3',
};

async function main() {
  console.log('\nShell');
  let { app, win, errors } = await launch();
  await win.click('.pane.active');
  await run(win, cmd.echo('hi-$((6*7))'));
  check('a shell runs in the first tab', await waitForScreen(win, /^hi-42$/m), true);
  await run(win, cmd.termVar);
  check('TERM advertises 256 colours', await waitForScreen(win, /^term=xterm-256color$/m), true);

  await run(win, cmd.setTitle('title-from-shell'));
  await win.waitForTimeout(800);
  check('tab label follows the shell title',
    await win.$eval('.tab.active .tab-label', (e) => e.textContent), 'title-from-shell');
  check('window title follows too', await win.title(), 'title-from-shell — ComicTerm');

  console.log('\nTabs');
  await win.keyboard.press('Control+Shift+T');
  await win.waitForTimeout(300);
  check('Ctrl+Shift+T opens a tab and switches to it', await tabState(win), (s) => s.count === 2 && s.active === 1);
  await win.keyboard.press('Control+Tab');
  check('Ctrl+Tab cycles to the next tab', (await tabState(win)).active, 0);
  await win.keyboard.press('Control+Shift+Tab');
  check('Ctrl+Shift+Tab cycles back', (await tabState(win)).active, 1);
  await win.keyboard.press('Control+Shift+W');
  await win.waitForTimeout(300);
  check('Ctrl+Shift+W closes the tab', await tabState(win), (s) => s.count === 1 && s.active === 0);

  console.log('\nClipboard');
  await run(win, cmd.echo('copy-$((6*7))'));
  await waitForScreen(win, /^copy-42$/m);
  await clipboard.write(app, 'before');
  await selectWord(win, 'copy-42');
  await win.keyboard.press('Control+Shift+C');
  await win.waitForTimeout(200);
  check('Ctrl+Shift+C copies the selection', await clipboard.read(app), 'copy-42');

  await clipboard.write(app, 'before');
  await selectWord(win, 'copy-42');
  await win.keyboard.press('Control+c');
  await win.waitForTimeout(200);
  check('Ctrl+C copies while text is selected', await clipboard.read(app), 'copy-42');
  check('…and clears the selection', await win.evaluate(() => activeTab().term.hasSelection()), false);

  await clipboard.write(app, cmd.echo('pasted-$((6*7))'));
  await win.keyboard.press('Control+Shift+V');
  await win.waitForTimeout(300);
  await win.keyboard.press('Enter');
  check('Ctrl+Shift+V pastes', await waitForScreen(win, /^pasted-42$/m), true);

  await clipboard.write(app, cmd.echo('rclick-$((6*7))'));
  await win.click('.pane.active', { button: 'right' });
  await win.waitForTimeout(300);
  await win.keyboard.press('Enter');
  check('right-click pastes when nothing is selected', await waitForScreen(win, /^rclick-42$/m), true);

  console.log('\nFont');
  const size = () => win.evaluate(() => activeTab().term.options.fontSize);
  const before = await size();
  await win.keyboard.press('Control+=');
  await win.keyboard.press('Control+=');
  check('Ctrl+= enlarges the font', await size(), before + 2);
  await win.keyboard.press('Control+-');
  check('Ctrl+- shrinks it', await size(), before + 1);
  await win.fill('#fontinput', 'DejaVu Sans Mono');
  await win.press('#fontinput', 'Enter');

  console.log('\nLifecycle');
  await win.click('.pane.active');
  await run(win, cmd.pid);
  await waitForScreen(win, /^pid=\d+$/m);
  const pid = Number((await screen(win)).match(/^pid=(\d+)$/m)[1]);
  // The way View → Reload does it (a page-initiated reload is blocked by
  // the app's navigation guard).
  await Promise.all([
    win.waitForEvent('load'),
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload()),
  ]);
  await win.waitForSelector('.pane.active .xterm-rows');
  await win.waitForTimeout(1000);
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  check('reloading the window ends its old shells', alive, false);

  check('no page errors or security warnings', errors, (e) => e.length === 0);
  errors.forEach((e) => console.log(`        ${e}`));
  await app.close();

  console.log('\nPreferences survive a restart');
  ({ app, win, errors } = await launch());
  check('font size remembered', await win.evaluate(() => activeTab().term.options.fontSize), before + 1);
  check('font family remembered', await win.inputValue('#fontinput'), 'DejaVu Sans Mono');

  console.log('\nExits');
  await win.click('.pane.active');
  await run(win, cmd.fail);
  check('a failed exit keeps the tab open with its code',
    await waitForScreen(win, /\[process exited with code 3\]/), true);
  check('…and the window stays', app.windows().length, 1);
  await app.close();

  ({ app, win, errors } = await launch({ COMICTERM_SHELL: path.join(root, 'no-such-shell') }));
  check('a missing shell says why', await waitForScreen(win, /Couldn't start .*no-such-shell/), true);
  await app.close();
}

try {
  await main();
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
