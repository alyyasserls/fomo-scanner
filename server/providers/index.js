'use strict';

const EventEmitter = require('events');
const { MobulaProvider } = require('./mobula');
const { FallbackProvider } = require('./fallback');
const { createLogger } = require('../utils/logger');

const log = createLogger('provider:manager');

/**
 * Owns exactly one active provider connection at a time and re-emits its
 * events under a single stable interface, so the rest of the app never
 * needs to know whether data is coming from Mobula or the polling
 * fallback. In "auto" mode it transparently fails over Mobula -> fallback
 * if Mobula can't connect (missing key, wrong plan, network error), which
 * satisfies the "must work with zero paid keys configured" MVP requirement.
 */
class ProviderManager extends EventEmitter {
  /**
   * `deps` allows injecting fake provider classes / fetch implementations
   * in tests so failover logic can be verified without live network calls;
   * production code just uses the defaults.
   */
  constructor(config, deps = {}) {
    super();
    this.config = config;
    this.active = null;
    this.MobulaProviderClass = deps.MobulaProviderClass || MobulaProvider;
    this.FallbackProviderClass = deps.FallbackProviderClass || FallbackProvider;
    this.fetchImpl = deps.fetchImpl;
  }

  async start() {
    const { mode } = this.config.provider;

    if (mode === 'fallback') {
      await this._useFallback();
      return;
    }

    if (mode === 'mobula') {
      await this._useMobula({ allowFailover: false });
      return;
    }

    // auto
    if (this.config.provider.mobula.apiKey) {
      try {
        await this._useMobula({ allowFailover: true });
      } catch (err) {
        log.warn('Mobula unavailable, switching to polling fallback:', err.message);
        await this._useFallback();
      }
    } else {
      log.info('No MOBULA_API_KEY set - starting with the public polling fallback provider.');
      await this._useFallback();
    }
  }

  async _useMobula({ allowFailover }) {
    const provider = new this.MobulaProviderClass({
      apiKey: this.config.provider.mobula.apiKey,
      wsUrl: this.config.provider.mobula.wsUrl,
      chains: this.config.chains,
      maxReconnectAttempts: this.config.provider.mobula.maxReconnectAttempts,
    });

    if (allowFailover) {
      provider.once('error', () => {
        if (this.active === provider) {
          log.warn('Mobula reported a fatal error, failing over to polling fallback.');
          this._useFallback().catch((err) => log.error('failover to fallback failed', err.message));
        }
      });
    }

    this._bind(provider);
    await provider.connect();
    this.active = provider;
    this.emit('mode-change', provider.getMode());
  }

  async _useFallback() {
    if (this.active) {
      try {
        this.active.removeAllListeners();
        this.active.disconnect();
      } catch {
        // ignore
      }
    }
    const provider = new this.FallbackProviderClass({
      queries: this.config.provider.fallback.queries,
      pollIntervalMs: this.config.provider.fallback.pollIntervalMs,
      chains: this.config.chains,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    this._bind(provider);
    await provider.connect();
    this.active = provider;
    this.emit('mode-change', provider.getMode());
  }

  _bind(provider) {
    provider.on('tokens', (tokens) => this.emit('tokens', tokens));
    provider.on('connected', () => this.emit('status', { connected: true, mode: provider.getMode() }));
    provider.on('disconnected', (reason) =>
      this.emit('status', { connected: false, mode: provider.getMode(), reason })
    );
  }

  getMode() {
    return this.active ? this.active.getMode() : 'DISCONNECTED';
  }

  isConnected() {
    return this.active ? this.active.isConnected() : false;
  }

  getProviderName() {
    return this.active ? this.active.name : 'none';
  }

  stop() {
    if (this.active) {
      this.active.removeAllListeners();
      try {
        this.active.disconnect();
      } catch {
        // ignore
      }
    }
    this.active = null;
  }
}

module.exports = { ProviderManager };
