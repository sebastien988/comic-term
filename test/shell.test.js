'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveShell, resolveEnv } = require('../src/shell');

test('resolveShell: Windows defaults to PowerShell', () => {
  assert.deepEqual(resolveShell('win32', {}), { file: 'powershell.exe', args: [] });
});

test('resolveShell: Linux honours $SHELL', () => {
  assert.deepEqual(resolveShell('linux', { SHELL: '/usr/bin/fish' }), {
    file: '/usr/bin/fish',
    args: [],
  });
});

test('resolveShell: falls back to bash when $SHELL is unset or relative', () => {
  assert.equal(resolveShell('linux', {}).file, '/bin/bash');
  assert.equal(resolveShell('linux', { SHELL: '' }).file, '/bin/bash');
  assert.equal(resolveShell('linux', { SHELL: '   ' }).file, '/bin/bash');
  assert.equal(resolveShell('linux', { SHELL: 'zsh' }).file, '/bin/bash');
});

test('resolveShell: macOS starts a login shell so PATH is populated', () => {
  assert.deepEqual(resolveShell('darwin', { SHELL: '/bin/zsh' }), {
    file: '/bin/zsh',
    args: ['-l'],
  });
});

test('resolveShell: COMICTERM_SHELL overrides every platform default', () => {
  assert.deepEqual(resolveShell('win32', { COMICTERM_SHELL: 'pwsh.exe' }), {
    file: 'pwsh.exe',
    args: [],
  });
  assert.deepEqual(resolveShell('darwin', { COMICTERM_SHELL: '/bin/sh', SHELL: '/bin/zsh' }), {
    file: '/bin/sh',
    args: [],
  });
});

test('resolveShell: COMICTERM_SHELL_ARGS is split on whitespace', () => {
  assert.deepEqual(
    resolveShell('linux', { COMICTERM_SHELL: '/bin/bash', COMICTERM_SHELL_ARGS: '-l  -i' }),
    { file: '/bin/bash', args: ['-l', '-i'] },
  );
});

test('resolveShell: a blank override does not win over the platform default', () => {
  assert.equal(resolveShell('linux', { COMICTERM_SHELL: '  ', SHELL: '/bin/zsh' }).file, '/bin/zsh');
});

test('resolveEnv: advertises 256-colour and truecolour support', () => {
  const env = resolveEnv({ PATH: '/usr/bin', TERM: 'dumb' });
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.TERM_PROGRAM, 'ComicTerm');
  assert.equal(env.PATH, '/usr/bin');
});

test('resolveEnv: strips Electron-only variables from the child shell', () => {
  const env = resolveEnv({
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--require=/tmp/x.js',
    HOME: '/home/u',
  });
  assert.ok(!('ELECTRON_RUN_AS_NODE' in env));
  assert.ok(!('NODE_OPTIONS' in env));
  assert.equal(env.HOME, '/home/u');
});

test('resolveEnv: drops undefined values node-pty cannot serialise', () => {
  const env = resolveEnv({ DEFINED: 'yes', MISSING: undefined });
  assert.ok(!('MISSING' in env));
  assert.equal(env.DEFINED, 'yes');
  for (const value of Object.values(env)) assert.equal(typeof value, 'string');
});
