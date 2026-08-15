'use strict';

const { toNumber, sanitizeString, sanitizeAddress, sanitizeUrl } = require('../utils/sanitize');

/**
 * Canonical token shape used everywhere past this point (store, scoring,
 * alerts, WebSocket broadcast, REST API). Every provider maps its raw
 * payload into the loose "raw" shape consumed here; this function is the
 * single choke point that validates/defaults/sanitizes that input so a
 * malformed or partial provider payload can never crash the scanner or
 * leak unescaped data to the frontend.
 *
 * Returns `null` if the payload is unusable (no identifiable address).
 */
function normalizeToken(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const chain = sanitizeString(raw.chain || '', 32).toLowerCase() || 'unknown';
  const mintAddress = sanitizeAddress(raw.mintAddress || '');
  const pairAddress = sanitizeAddress(raw.pairAddress || '');
  if (!mintAddress && !pairAddress) return null;

  const id = `${chain}:${pairAddress || mintAddress}`;
  const volume = raw.volume || {};
  const priceChange = raw.priceChange || {};
  const trades = raw.trades || {};

  const buys = toNumber(trades.buys);
  const sells = toNumber(trades.sells);
  let buySellRatio = null;
  if (buys != null && sells != null) {
    buySellRatio = sells > 0 ? round(buys / sells, 3) : buys > 0 ? Infinity : null;
  }
  // Infinity is not JSON-safe over the wire; represent "all buys, no sells" as null + flag.
  const buySellRatioSafe = Number.isFinite(buySellRatio) ? buySellRatio : buys > 0 && sells === 0 ? null : buySellRatio;

  return {
    id,
    chain,
    dex: sanitizeString(raw.dex || 'unknown', 32),
    name: sanitizeString(raw.name || 'Unknown', 64) || 'Unknown',
    symbol: sanitizeString(raw.symbol || '?', 16) || '?',
    mintAddress: mintAddress || pairAddress,
    pairAddress: pairAddress || mintAddress,
    price: nonNegative(toNumber(raw.price)),
    marketCap: nonNegative(toNumber(raw.marketCap)),
    liquidity: nonNegative(toNumber(raw.liquidity)),
    volume: {
      m1: nonNegative(toNumber(volume.m1)),
      m5: nonNegative(toNumber(volume.m5)),
      m15: nonNegative(toNumber(volume.m15)),
      h1: nonNegative(toNumber(volume.h1)),
      h6: nonNegative(toNumber(volume.h6)),
      h24: nonNegative(toNumber(volume.h24)),
      m1Estimated: Boolean(volume.m1Estimated),
      m15Estimated: Boolean(volume.m15Estimated),
    },
    priceChange: {
      m1: toNumber(priceChange.m1),
      m5: toNumber(priceChange.m5),
      m15: toNumber(priceChange.m15),
      h1: toNumber(priceChange.h1),
    },
    trades: {
      count: nonNegative(toNumber(trades.count)),
      buys: nonNegative(buys),
      sells: nonNegative(sells),
    },
    buySellRatio: buySellRatioSafe,
    tokenAgeSeconds: nonNegative(toNumber(raw.tokenAgeSeconds)),
    url: sanitizeUrl(raw.url || ''),
    updatedAt: Date.now(),
  };
}

function nonNegative(n) {
  return n != null && n < 0 ? 0 : n;
}

function round(n, dp) {
  const m = 10 ** dp;
  return Math.round(n * m) / m;
}

module.exports = { normalizeToken };
