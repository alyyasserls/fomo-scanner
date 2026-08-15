'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

const { FallbackProvider } = require('../server/providers/fallback');
const { ProviderManager } = require('../server/providers');
const { MarketDataProvider } = require('../server/providers/base');

function baseConfig(overrides = {}) {
  return {
    chains: ['solana'],
    provider: {
      mode: 'auto',
      mobula: { apiKey: '', wsUrl: 'wss://example.invalid', maxReconnectAttempts: 1 },
      fallback: { queries: ['solana'], pollIntervalMs: 60000 },
    },
    ...overrides,
  };
}

test('FallbackProvider emits tokens on a successful poll using an injected fetch', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      pairs: [
        {
          chainId: 'solana',
          dexId: 'raydium',
          pairAddress: 'pair1',
          baseToken: { address: 'mint1', name: 'Test Token', symbol: 'TEST' },
          priceUsd: '0.01',
          liquidity: { usd: 100000 },
          volume: { m5: 50000, h1: 200000, h6: 500000, h24: 900000 },
          priceChange: { m5: 12, h1: 24 },
          txns: { m5: { buys: 20, sells: 5 } },
          url: 'https://dexscreener.com/solana/pair1',
        },
      ],
    }),
  });

  const provider = new FallbackProvider({ queries: ['solana'], pollIntervalMs: 60000, chains: ['solana'], fetchImpl: fakeFetch });
  const received = await new Promise((resolve) => {
    provider.on('tokens', resolve);
    provider.connect();
  });
  provider.disconnect();

  assert.equal(received.length, 1);
  assert.equal(received[0].symbol, 'TEST');
  assert.equal(provider.getMode(), 'POLLING_FALLBACK');
});

test('FallbackProvider survives malformed/non-JSON provider responses without crashing', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const provider = new FallbackProvider({ queries: ['solana'], pollIntervalMs: 60000, chains: ['solana'], fetchImpl: fakeFetch });
  await assert.doesNotReject(provider.connect());
  provider.disconnect();
});

test('FallbackProvider emits an error after repeated consecutive polling failures (simulated disconnect)', async () => {
  let calls = 0;
  const failingFetch = async () => {
    calls += 1;
    throw new Error('network unreachable');
  };
  const provider = new FallbackProvider({ queries: ['solana'], pollIntervalMs: 10, chains: ['solana'], fetchImpl: failingFetch });

  const errorSeen = new Promise((resolve) => provider.once('error', resolve));
  await provider.connect(); // first poll fails but connect() itself resolves (never throws)
  provider.timer && clearInterval(provider.timer);
  // Drive two more failing polls manually to reach the 3-failure threshold quickly.
  await provider._pollOnce();
  await provider._pollOnce();

  const err = await errorSeen;
  assert.ok(err instanceof Error);
  assert.ok(calls >= 3);
  provider.disconnect();
});

test('ProviderManager (auto mode, no Mobula key) goes straight to the fallback provider without touching Mobula', async () => {
  let mobulaConstructed = false;
  class NeverCalledMobula extends MarketDataProvider {
    constructor() {
      super('should-not-be-used', 'LIVE_WEBSOCKET');
      mobulaConstructed = true;
    }
  }
  class FakeFallback extends MarketDataProvider {
    constructor() {
      super('fake-fallback', 'POLLING_FALLBACK');
    }
    async connect() {
      this.connected = true;
      this.emit('connected');
    }
    disconnect() {
      this.connected = false;
    }
  }

  const manager = new ProviderManager(baseConfig(), { MobulaProviderClass: NeverCalledMobula, FallbackProviderClass: FakeFallback });
  await manager.start();

  assert.equal(mobulaConstructed, false);
  assert.equal(manager.getMode(), 'POLLING_FALLBACK');
  assert.equal(manager.isConnected(), true);
  manager.stop();
});

test('ProviderManager fails over from Mobula to the fallback provider when Mobula errors out (auto mode)', async () => {
  class FlakyMobula extends MarketDataProvider {
    constructor() {
      super('flaky-mobula', 'LIVE_WEBSOCKET');
    }
    async connect() {
      // Simulate a successful handshake that then immediately errors out,
      // like an auth/plan rejection arriving after the socket opens.
      this.connected = true;
      setImmediate(() => this.emit('error', new Error('plan does not support Pulse V2')));
    }
    disconnect() {
      this.connected = false;
    }
  }
  class FakeFallback extends MarketDataProvider {
    constructor() {
      super('fake-fallback', 'POLLING_FALLBACK');
    }
    async connect() {
      this.connected = true;
      this.emit('connected');
    }
    disconnect() {
      this.connected = false;
    }
  }

  const config = baseConfig();
  config.provider.mobula.apiKey = 'fake-key-present';
  const manager = new ProviderManager(config, { MobulaProviderClass: FlakyMobula, FallbackProviderClass: FakeFallback });

  const modeChanges = [];
  manager.on('mode-change', (mode) => modeChanges.push(mode));

  await manager.start();
  assert.equal(manager.getMode(), 'LIVE_WEBSOCKET');

  // Wait for the async 'error' emission to trigger the failover.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(manager.getMode(), 'POLLING_FALLBACK');
  assert.deepEqual(modeChanges, ['LIVE_WEBSOCKET', 'POLLING_FALLBACK']);
  manager.stop();
});
