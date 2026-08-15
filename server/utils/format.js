'use strict';

/** Shared number formatting used by Telegram messages and REST responses. */

function formatUsdCompact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatMultiplier(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NEW';
  return `${n.toFixed(1)}x`;
}

module.exports = { formatUsdCompact, formatPrice, formatPct, formatMultiplier };
