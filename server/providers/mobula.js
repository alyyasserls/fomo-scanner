'use strict';

const WebSocket = require('ws');
const { MarketDataProvider } = require('./base');
const { createLogger } = require('../utils/logger');
const { toNumber, sanitizeString, sanitizeAddress } = require('../utils/sanitize');

const log = createLogger('provider:mobula');

/**
 * Mobula Pulse V2 WebSocket provider.
 *
 * IMPORTANT: Pulse Stream V2 (https://docs.mobula.io/indexing-stream/stream/websocket/pulse-stream-v2)
 * is gated behind Mobula's Growth/Enterprise plans and its exact subscribe
 * payload can change between Mobula API revisions. This client is written
 * defensively: it authenticates, sends a best-effort subscribe message for
 * the configured chains, and parses incoming payloads by scanning for
 * common field name variants rather than assuming one rigid schema. If your
 * Mobula plan/version uses a different subscribe shape, adjust
 * `buildSubscribeMessage()` and `extractTokenList()` below to match the
 * payload shown in your Mobula dashboard - the rest of the app (scanner,
 * scoring, alerts) is unaffected because it only ever consumes the
 * normalized shape produced by `mapMobulaToken()`.
 *
 * If the connection cannot be authenticated/established, this provider
 * emits 'error' and the ProviderManager (server/providers/index.js) will
 * automatically fail over to the polling fallback provider when running in
 * "auto" mode.
 */
class MobulaProvider extends MarketDataProvider {
  constructor({ apiKey, wsUrl, chains, maxReconnectAttempts = 5 }) {
    super('mobula', 'LIVE_WEBSOCKET');
    this.apiKey = apiKey;
    this.wsUrl = wsUrl;
    this.chains = chains;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.shuttingDown = false;
  }

  async connect() {
    if (!this.apiKey) {
      throw new Error('MOBULA_API_KEY is not set');
    }
    this.shuttingDown = false;
    return this._open();
  }

  _open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.wsUrl, {
        headers: { Authorization: this.apiKey },
        handshakeTimeout: 10000,
      });
      this.ws = ws;

      ws.once('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        log.info('connected to Mobula Pulse V2', { wsUrl: this.wsUrl, chains: this.chains });
        try {
          ws.send(JSON.stringify(this._buildSubscribeMessage()));
        } catch (err) {
          log.warn('failed to send subscribe message', err.message);
        }
        this.emit('connected');
        settled = true;
        resolve();
      });

      ws.on('message', (raw) => this._handleMessage(raw));

      ws.on('error', (err) => {
        log.warn('websocket error', err.message);
        this.emit('error', err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      ws.on('close', (code, reasonBuf) => {
        this.connected = false;
        const reason = reasonBuf ? reasonBuf.toString() : `code ${code}`;
        this.emit('disconnected', reason);
        if (!settled) {
          settled = true;
          reject(new Error(`Mobula socket closed before it opened (${reason})`));
          return;
        }
        if (!this.shuttingDown) this._scheduleReconnect();
      });
    });
  }

  _buildSubscribeMessage() {
    // Best-effort subscribe payload - see class docstring.
    return {
      type: 'subscribe',
      channel: 'pulse',
      payload: {
        blockchains: this.chains,
        apiKey: this.apiKey,
      },
    };
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error('max reconnect attempts reached, giving up on Mobula');
      this.emit('error', new Error('Mobula reconnect attempts exhausted'));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    log.warn(`reconnecting to Mobula in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.shuttingDown) return;
      this._open().catch((err) => log.warn('reconnect failed', err.message));
    }, delay);
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }
    const list = extractTokenList(msg);
    if (!list.length) return;
    const mapped = list.map(mapMobulaToken).filter(Boolean);
    if (mapped.length) this.emit('tokens', mapped);
  }

  disconnect() {
    this.shuttingDown = true;
    if (this.ws) {
      try {
        this.ws.close(1000, 'shutdown');
      } catch {
        // ignore
      }
    }
    this.connected = false;
  }
}

/** Digs through common wrapper shapes to find the array of token payloads. */
function extractTokenList(msg) {
  if (Array.isArray(msg)) return msg;
  if (!msg || typeof msg !== 'object') return [];
  for (const key of ['data', 'tokens', 'pairs', 'results', 'payload']) {
    if (Array.isArray(msg[key])) return msg[key];
    if (msg[key] && Array.isArray(msg[key].data)) return msg[key].data;
  }
  return [];
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/** Maps a Mobula-shaped pair/token payload into our raw normalized-ish input. */
function mapMobulaToken(t) {
  if (!t || typeof t !== 'object') return null;
  const pairAddress = sanitizeAddress(pick(t, ['pairAddress', 'pair_address', 'poolAddress', 'address']) || '');
  const mintAddress = sanitizeAddress(
    pick(t, ['tokenAddress', 'token_address', 'mintAddress', 'contract', 'address']) || ''
  );
  if (!pairAddress && !mintAddress) return null;

  const volume = pick(t, ['volume']) || {};
  const priceChange = pick(t, ['priceChange', 'price_change']) || {};
  const liquidity = pick(t, ['liquidity']);
  const txns = pick(t, ['trades', 'txns']) || {};

  return {
    source: 'mobula',
    chain: sanitizeString(pick(t, ['blockchain', 'chain']) || 'solana', 32).toLowerCase(),
    dex: sanitizeString(pick(t, ['dex', 'exchange', 'dexId']) || 'unknown', 32),
    name: sanitizeString(pick(t, ['name', 'tokenName']) || '', 64),
    symbol: sanitizeString(pick(t, ['symbol', 'tokenSymbol']) || '', 16),
    mintAddress: mintAddress || pairAddress,
    pairAddress: pairAddress || mintAddress,
    price: toNumber(pick(t, ['price', 'priceUsd', 'price_usd'])),
    marketCap: toNumber(pick(t, ['marketCap', 'market_cap', 'fdv'])),
    liquidity: toNumber(typeof liquidity === 'object' ? liquidity?.usd : liquidity),
    volume: {
      m1: toNumber(pick(volume, ['m1', '1m'])),
      m5: toNumber(pick(volume, ['m5', '5m'])),
      m15: toNumber(pick(volume, ['m15', '15m'])),
      h1: toNumber(pick(volume, ['h1', '1h'])),
      h6: toNumber(pick(volume, ['h6', '6h'])),
      h24: toNumber(pick(volume, ['h24', '24h'])),
    },
    priceChange: {
      m1: toNumber(pick(priceChange, ['m1', '1m'])),
      m5: toNumber(pick(priceChange, ['m5', '5m'])),
      m15: toNumber(pick(priceChange, ['m15', '15m'])),
      h1: toNumber(pick(priceChange, ['h1', '1h'])),
    },
    trades: {
      count: toNumber(pick(txns, ['count', 'total'])),
      buys: toNumber(pick(txns, ['buys', 'buy'])),
      sells: toNumber(pick(txns, ['sells', 'sell'])),
    },
    tokenAgeSeconds: toNumber(pick(t, ['ageSeconds', 'age'])),
    createdAt: toNumber(pick(t, ['createdAt', 'pairCreatedAt', 'created_at'])),
    url: pick(t, ['url', 'link']) || '',
  };
}

module.exports = { MobulaProvider, mapMobulaToken, extractTokenList };
