'use strict';

const EventEmitter = require('events');
const { computeFomoScores, DEFAULT_WEIGHTS } = require('./score');
const { createLogger } = require('../utils/logger');

const log = createLogger('scanner:engine');

/**
 * Orchestrates the whole pipeline described in the architecture diagram:
 * ProviderManager -> normalize/store -> volume calc -> FOMO score ->
 * alert engine -> emitted 'update'/'remove'/'status' events that
 * server.js forwards onto the WebSocket broadcaster.
 *
 * All heavy lifting (scoring, filtering relevance) happens here on a fixed
 * tick, server-side - the frontend only ever receives the tokens that
 * actually changed plus periodic status, never a firehose of raw provider
 * traffic and never a per-token socket.
 */
class ScannerEngine extends EventEmitter {
  constructor({ config, tokenStore, alertEngine, providerManager }) {
    super();
    this.config = config;
    this.tokenStore = tokenStore;
    this.alertEngine = alertEngine;
    this.providerManager = providerManager;
    this.scoreWeights = { ...DEFAULT_WEIGHTS };
    this.pendingChanged = new Set();
    this.lastUpdateAt = null;
    this.tickTimer = null;
  }

  async start() {
    this.providerManager.on('tokens', (rawTokens) => this._onTokens(rawTokens));
    this.providerManager.on('status', () => this.emit('status', this.getStatus()));
    this.providerManager.on('mode-change', (mode) => {
      log.info(`active provider mode: ${mode} (${this.providerManager.getProviderName()})`);
      this.emit('status', this.getStatus());
    });

    await this.providerManager.start();
    this.emit('status', this.getStatus());

    this.tickTimer = setInterval(() => this._tick(), this.config.scanner.tickIntervalMs);
    if (typeof this.tickTimer.unref === 'function') this.tickTimer.unref();
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.providerManager.stop();
  }

  setScoreWeights(weights) {
    this.scoreWeights = { ...this.scoreWeights, ...weights };
  }

  getStatus() {
    return {
      mode: this.providerManager.getMode(),
      connected: this.providerManager.isConnected(),
      providerName: this.providerManager.getProviderName(),
      monitoredCount: this.tokenStore.size(),
      lastUpdateAt: this.lastUpdateAt,
      chains: this.config.chains,
    };
  }

  _onTokens(rawTokens) {
    for (const raw of rawTokens) {
      try {
        const token = this.tokenStore.upsert(raw);
        if (token) this.pendingChanged.add(token.id);
      } catch (err) {
        log.warn('failed to upsert token, skipping', err.message);
      }
    }
    this.lastUpdateAt = Date.now();
  }

  _tick() {
    try {
      const staleIds = this.tokenStore.removeStale(this.config.scanner.staleTokenTtlMs);
      const all = this.tokenStore.getAll();

      if (all.length) computeFomoScores(all, this.scoreWeights);

      for (const id of staleIds) this.pendingChanged.delete(id);

      if (this.pendingChanged.size) {
        const changed = Array.from(this.pendingChanged)
          .map((id) => this.tokenStore.get(id))
          .filter(Boolean);
        this.pendingChanged.clear();

        if (changed.length) {
          this.emit('update', { tokens: changed, monitoredCount: all.length });
          for (const token of changed) {
            Promise.resolve()
              .then(() => this.alertEngine.evaluate(token))
              .catch((err) => log.error(`alert evaluation failed for ${token.id}`, err.message));
          }
        }
      }

      if (staleIds.length) {
        this.emit('remove', { ids: staleIds, monitoredCount: all.length });
      }

      this.emit('status', this.getStatus());
    } catch (err) {
      log.error('tick failed', err);
    }
  }
}

module.exports = { ScannerEngine };
