'use strict';

const { normalizeToken } = require('./normalize');
const {
  calculateVolumeAcceleration,
  calculateVolumeVelocity,
  calculateVolumeToLiquidity,
  findBaselineSample,
} = require('./volume');
const { computeVolumeMomentum } = require('./momentum');

const FIVE_MIN_MS = 5 * 60 * 1000;
const BASELINE_TOLERANCE_MS = 2 * 60 * 1000;
const MAX_HISTORY_POINTS = 288; // ~ enough for hours of chart history at typical poll rates

/**
 * In-memory token store. Owns the canonical token map plus a small rolling
 * history per token (used both to derive the volume-acceleration baseline
 * and to serve the live chart on the token detail page). Deliberately
 * simple/synchronous - the schema here is what a Postgres-backed store
 * would persist (see README "Upgrading to Postgres"), but an external DB
 * is not required to run the MVP.
 */
class TokenStore {
  constructor() {
    this.tokens = new Map(); // id -> token
    this.history = new Map(); // id -> { volume5m: [{t,v}], price: [{t,v}] }
  }

  /** Normalizes + merges one raw provider payload; returns the stored token or null if invalid. */
  upsert(rawToken) {
    const normalized = normalizeToken(rawToken);
    if (!normalized) return null;

    const id = normalized.id;
    const hist = this._historyFor(id);
    const baseline = findBaselineSample(hist.volume5m, FIVE_MIN_MS, BASELINE_TOLERANCE_MS);

    const acceleration = calculateVolumeAcceleration(normalized.volume.m5, baseline);
    const velocity = calculateVolumeVelocity(normalized.volume.m5, 5);
    const volumeToLiquidity = calculateVolumeToLiquidity(normalized.volume.m5, normalized.liquidity);

    const previous = this.tokens.get(id);
    const token = {
      ...normalized,
      volumeAcceleration: acceleration,
      volumeVelocityPerMin: velocity,
      volumeToLiquidity,
      firstSeenAt: previous ? previous.firstSeenAt : Date.now(),
      fomoScore: previous ? previous.fomoScore : 0,
      fomoRank: previous ? previous.fomoRank : null,
    };
    token.volumeMomentum = computeVolumeMomentum({
      volume5m: token.volume.m5,
      volume1h: token.volume.h1,
      acceleration,
      priceChange5m: token.priceChange.m5,
      liquidity: token.liquidity,
    });

    this.tokens.set(id, token);

    const now = Date.now();
    pushCapped(hist.volume5m, { t: now, v: normalized.volume.m5 ?? 0 });
    pushCapped(hist.price, { t: now, v: normalized.price ?? 0 });

    return token;
  }

  getAll() {
    return Array.from(this.tokens.values());
  }

  get(id) {
    return this.tokens.get(id) || null;
  }

  has(id) {
    return this.tokens.has(id);
  }

  getHistory(id) {
    return this.history.get(id) || { volume5m: [], price: [] };
  }

  size() {
    return this.tokens.size;
  }

  /** Removes tokens that haven't received an update in `ttlMs`. Returns removed ids. */
  removeStale(ttlMs) {
    const now = Date.now();
    const removed = [];
    for (const [id, token] of this.tokens) {
      if (now - token.updatedAt > ttlMs) {
        this.tokens.delete(id);
        this.history.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  _historyFor(id) {
    if (!this.history.has(id)) this.history.set(id, { volume5m: [], price: [] });
    return this.history.get(id);
  }
}

function pushCapped(arr, sample) {
  arr.push(sample);
  if (arr.length > MAX_HISTORY_POINTS) arr.splice(0, arr.length - MAX_HISTORY_POINTS);
}

module.exports = { TokenStore, MAX_HISTORY_POINTS };
