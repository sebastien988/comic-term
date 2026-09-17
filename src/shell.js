'use strict';

/**
 * Shell + environment resolution for new terminal sessions.
 *
 * Kept free of Electron and node-pty imports so it can be unit tested with
 * plain `node --test`.
 */

/** Variables Electron injects that must not leak into the child shell. */
const ELECTRON_ONLY_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_FORCE_WINDOW_MENU_BAR',
  'NODE_OPTIONS',
];

/**
 * Pick the shell to spawn.
 *
 * `COMICTERM_SHELL` always wins so users can point ComicTerm at fish, nushell,
 * pwsh, or anything else without editing the source. Otherwise we follow the
 * platform convention: `$SHELL` on Unix (what the user chose in their account),
 * PowerShell on Windows.
 *
 * @param {string} platform - A `process.platform` value.
 * @param {Record<string, string|undefined>} env
 * @returns {{ file: string, args: string[] }}
 */
function resolveShell(platform = process.platform, env = process.env) {
  const override = trimmed(env.COMICTERM_SHELL);
  if (override) return { file: override, args: splitArgs(env.COMICTERM_SHELL_ARGS) };

  if (platform === 'win32') return { file: 'powershell.exe', args: [] };

  const userShell = trimmed(env.SHELL);
  const file = userShell && userShell.startsWith('/') ? userShell : '/bin/bash';

  // macOS puts PATH together in /etc/paths and friends, which only a login
  // shell reads. Without `-l` a GUI-launched terminal gets a crippled PATH.
  return { file, args: platform === 'darwin' ? ['-l'] : [] };
}

/**
 * Build the environment for the child shell.
 *
 * Advertises 256-color + truecolor support (xterm.js handles both) and drops
 * the variables Electron sets for its own processes, which confuse any Electron
 * or Node tooling launched from inside the terminal.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string>}
 */
function resolveEnv(env = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ELECTRON_ONLY_VARS.includes(key)) continue;
    result[key] = value;
  }
  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  result.TERM_PROGRAM = 'ComicTerm';
  return result;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function splitArgs(value) {
  return trimmed(value) ? value.trim().split(/\s+/) : [];
}

module.exports = { resolveShell, resolveEnv, ELECTRON_ONLY_VARS };
