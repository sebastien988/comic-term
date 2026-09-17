'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSessionId,
  sanitizeSize,
  isWritableData,
  MAX_COLS,
  MAX_ROWS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} = require('../src/validate');

test('isSessionId: accepts positive integers only', () => {
  assert.equal(isSessionId(1), true);
  assert.equal(isSessionId(4096), true);

  for (const bad of [0, -1, 1.5, NaN, Infinity, '1', null, undefined, {}, []]) {
    assert.equal(isSessionId(bad), false, `${String(bad)} should be rejected`);
  }
});

test('sanitizeSize: passes sensible dimensions through', () => {
  assert.deepEqual(sanitizeSize({ cols: 120, rows: 40 }), { cols: 120, rows: 40 });
});

test('sanitizeSize: replaces junk with defaults instead of forwarding it', () => {
  for (const bad of [undefined, null, 0, -5, NaN, Infinity, 'eighty', {}]) {
    assert.deepEqual(
      sanitizeSize({ cols: bad, rows: bad }),
      { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
      `${String(bad)} should fall back to defaults`,
    );
  }
});

test('sanitizeSize: truncates fractional dimensions', () => {
  assert.deepEqual(sanitizeSize({ cols: 80.9, rows: 24.4 }), { cols: 80, rows: 24 });
});

test('sanitizeSize: clamps absurd dimensions', () => {
  assert.deepEqual(sanitizeSize({ cols: 1e9, rows: 1e9 }), { cols: MAX_COLS, rows: MAX_ROWS });
});

test('sanitizeSize: tolerates a missing payload', () => {
  assert.deepEqual(sanitizeSize(), { cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
});

test('isWritableData: only strings reach the PTY', () => {
  assert.equal(isWritableData(''), true);
  assert.equal(isWritableData('ls -la\r'), true);

  for (const bad of [null, undefined, 42, {}, [], Buffer.from('x')]) {
    assert.equal(isWritableData(bad), false, `${String(bad)} should be rejected`);
  }
});
