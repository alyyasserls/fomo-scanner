'use strict';

const { MarketDataProvider } = require('./base');
const { createLogger } = require('../utils/logger');
const { toNumber, sanitizeString, sanitizeAddress, sanitizeUrl } = require('../utils/sanitize');

const log = createLogger('provider:fallback');

const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';

/**
 * Development/no-key polling provider backed by DexScreener's public,
 * unauthenticated search API. This is real live market data (not
 * simulated) - it is just delivered via polling instead of a push
 * WebSocket, which is why the dashboard labels it POLLING FALLBACK rather
 * than LIVE WEBSOCKET. Used automatically when MOBULA_API_KEY is not set,
 * or when DATA_PROVIDER=fallback is forced.
 */
class FallbackProvider extends MarketDataProvider {
  constructor({ queries, pollIntervalMs, chains, fetchImpl = fetch }) {
    super('dexscreener-fallback', 'POLLING_FALLBACK');
    this.queries = queries && queries.length ? queries : ['solana'];
    this.pollIntervalMs = pollIntervalMs || 15000;
    this.chains = new Set((chains || ['solana']).map((c) => c.toLowerCase()));
    this.fetchImpl = fetchImpl;
    this.timer = null;
    this.consecutiveFailures = 0;
  }

  async connect() {
    this.connected = true;
    this.emit('connected');
    await this._pollOnce();
    this.timer = setInterval(() => {
      this._pollOnce().catch((err) => log.warn('poll cycle failed', err.message));
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected = false;
    this.emit('disconnected', 'shutdown');
  }

  async _pollOnce() {
    const dedup = new Map();
    let anySuccess = false;

    for (const query of this.queries) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const pairs = await this._fetchQuery(query);
        anySuccess = true;
        for (const raw of pairs) {
          const mapped = mapDexscreenerPair(raw);
          if (mapped && this.chains.has(mapped.chain)) {
            dedup.set(mapped.pairAddress || mapped.mintAddress, mapped);
          }
        }
      } catch (err) {
        log.warn(`query "${query}" failed`, err.message);
      }
    }

    if (!anySuccess) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures === 3) {
        log.error('fallback provider failing repeatedly - check network access to api.dexscreener.com');
        this.emit('error', new Error('DexScreener polling failing repeatedly'));
      }
      return;
    }
    this.consecutiveFailures = 0;

    const tokens = Array.from(dedup.values());
    if (tokens.length) this.emit('tokens', tokens);
  }

  async _fetchQuery(query) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = `${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(query)}`;
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return Array.isArray(body?.pairs) ? body.pairs : [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Maps a DexScreener pair object into our raw normalized-ish input shape. */
function mapDexscreenerPair(p) {
  if (!p || typeof p !== 'object') return null;
  const pairAddress = sanitizeAddress(p.pairAddress || '');
  const mintAddress = sanitizeAddress(p.baseToken?.address || '');
  if (!pairAddress && !mintAddress) return null;

  const vol5m = toNumber(p.volume?.m5);
  const createdAt = toNumber(p.pairCreatedAt);

  // DexScreener does not expose 1m/15m volume windows directly. We derive
  // conservative estimates from the 5m window (a real, observed number) so
  // the dashboard always has a value to show, and flag them as estimated
  // rather than pretending they are provider-reported figures.
  const estM1 = vol5m != null ? vol5m / 5 : null;
  const estM15 = vol5m != null ? Math.min(vol5m * 3, toNumber(p.volume?.h1) ?? vol5m * 3) : null;

  return {
    source: 'dexscreener',
    chain: sanitizeString(p.chainId || '', 32).toLowerCase(),
    dex: sanitizeString(p.dexId || 'unknown', 32),
    name: sanitizeString(p.baseToken?.name || '', 64),
    symbol: sanitizeString(p.baseToken?.symbol || '', 16),
    mintAddress: mintAddress || pairAddress,
    pairAddress: pairAddress || mintAddress,
    price: toNumber(p.priceUsd),
    marketCap: toNumber(p.marketCap ?? p.fdv),
    liquidity: toNumber(p.liquidity?.usd),
    volume: {
      m1: estM1,
      m1Estimated: true,
      m5: vol5m,
      m15: estM15,
      m15Estimated: true,
      h1: toNumber(p.volume?.h1),
      h6: toNumber(p.volume?.h6),
      h24: toNumber(p.volume?.h24),
    },
    priceChange: {
      m1: null,
      m5: toNumber(p.priceChange?.m5),
      m15: null,
      h1: toNumber(p.priceChange?.h1),
    },
    trades: {
      count: toNumber(p.txns?.m5?.buys) + toNumber(p.txns?.m5?.sells) || null,
      buys: toNumber(p.txns?.m5?.buys),
      sells: toNumber(p.txns?.m5?.sells),
    },
    tokenAgeSeconds: createdAt ? Math.max(0, Math.floor((Date.now() - createdAt) / 1000)) : null,
    createdAt,
    url: sanitizeUrl(p.url || ''),
  };
}

module.exports = { FallbackProvider, mapDexscreenerPair };
