'use strict';

/**
 * Validation for IPC payloads crossing the renderer -> main boundary.
 *
 * The renderer is the only caller today, but it is also the process that runs
 * untrusted terminal output, so main treats everything it sends as input from
 * outside. node-pty will abort the process on a non-integer or zero-sized
 * resize, so these guards are load-bearing rather than decorative.
 */

/** xterm.js will never legitimately ask for more than this. */
const MAX_COLS = 2000;
const MAX_ROWS = 2000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Session ids are renderer-generated positive integers.
 * @param {unknown} id
 * @returns {boolean}
 */
function isSessionId(id) {
  return Number.isInteger(id) && id > 0;
}

/**
 * Coerce a requested terminal size into something node-pty will accept.
 * Non-numeric, zero, negative, fractional and absurd values are all replaced
 * rather than forwarded.
 *
 * @param {{cols?: unknown, rows?: unknown}} size
 * @returns {{cols: number, rows: number}}
 */
function sanitizeSize(size = {}) {
  return {
    cols: clampDimension(size.cols, DEFAULT_COLS, MAX_COLS),
    rows: clampDimension(size.rows, DEFAULT_ROWS, MAX_ROWS),
  };
}

/**
 * Terminal input must be a string; anything else is dropped.
 * @param {unknown} data
 * @returns {boolean}
 */
function isWritableData(data) {
  return typeof data === 'string';
}

function clampDimension(value, fallback, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

module.exports = {
  isSessionId,
  sanitizeSize,
  isWritableData,
  MAX_COLS,
  MAX_ROWS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
};
