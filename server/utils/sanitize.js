'use strict';

/**
 * Small set of defensive parsing/sanitizing helpers used at every boundary
 * where untrusted data enters the system (provider payloads, WS client
 * messages, REST bodies). Nothing here should ever throw.
 */

/** Safely coerce a value to a finite number, otherwise return `fallback`. */
function toNumber(value, fallback = null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  if (!isFiniteNumber(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Matches ASCII control characters (0x00-0x1F, 0x7F) without embedding raw
// control bytes in source - built from char codes to stay editor/diff safe.
const CONTROL_CHARS_RE = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']',
  'g'
);

/**
 * Strips markup/control characters from user-facing strings (token name,
 * symbol, dex label, chain) before they are ever stored or rendered.
 */
function sanitizeString(value, maxLen = 64) {
  if (typeof value !== 'string') return '';
  const stripped = value
    .replace(/<[^>]*>/g, '') // strip tags
    .replace(CONTROL_CHARS_RE, '') // strip control chars
    .trim();
  return stripped.slice(0, maxLen);
}

/** Loose validation for an on-chain address / mint / pair id string. */
function sanitizeAddress(value, maxLen = 128) {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(/[^a-zA-Z0-9:_-]/g, '');
  return stripped.slice(0, maxLen);
}

/** Loose validation for an https(s) URL; returns '' if not safe/valid. */
function sanitizeUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

module.exports = {
  toNumber,
  isFiniteNumber,
  clamp,
  sanitizeString,
  sanitizeAddress,
  sanitizeUrl,
};
