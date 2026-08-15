'use strict';

const EventEmitter = require('events');

/**
 * Common interface every market-data provider must implement.
 *
 * Events:
 *   'tokens'       (rawTokens: object[])  batch of raw, provider-shaped token/pair updates
 *   'connected'    ()
 *   'disconnected' (reason?: string)
 *   'error'        (err: Error)
 *
 * Providers never touch scoring/alerts - they only fetch + emit raw data.
 * `mode` tells the rest of the system whether data is truly push/live or
 * being simulated via polling, so the UI can be honest about it.
 */
class MarketDataProvider extends EventEmitter {
  constructor(name, mode) {
    super();
    this.name = name;
    this.mode = mode; // 'LIVE_WEBSOCKET' | 'POLLING_FALLBACK'
    this.connected = false;
  }

  // eslint-disable-next-line class-methods-use-this
  async connect() {
    throw new Error('connect() not implemented');
  }

  // eslint-disable-next-line class-methods-use-this
  disconnect() {
    throw new Error('disconnect() not implemented');
  }

  getMode() {
    return this.mode;
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = { MarketDataProvider };
