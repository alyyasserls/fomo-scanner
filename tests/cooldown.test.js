'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AlertEngine } = require('../server/alerts/alertEngine');

function makeConfig(overrides = {}) {
  return {
    alerts: {
      defaultConditions: { minLiquidityUsd: 1000, min5mVolumeUsd: 1000, minVolumeMultiplier: 1, min5mChangePct: 1 },
      cooldownSeconds: 900,
      globalCooldownSeconds: 0,
      onlyOncePerToken: false,
      retriggerScoreDelta: 15,
      severity: { highScore: 75, extremeScore: 90 },
      ...overrides,
    },
    telegram: { botToken: 'x', chatId: 'y' },
  };
}

function token(overrides) {
  return {
    id: 'solana:abc',
    symbol: 'FOMO',
    name: 'Fomo Token',
    chain: 'solana',
    price: 0.001,
    liquidity: 60000,
    volume: { m5: 150000, h1: 400000 },
    volumeAcceleration: 5,
    priceChange: { m5: 20, h1: 30 },
    fomoScore: 80,
    ...overrides,
  };
}

test('per-token cooldown blocks a second alert for the same token within the window', async () => {
  const calls = [];
  const engine = new AlertEngine({ config: makeConfig(), sendAlertFn: async (t) => (calls.push(t.id), { ok: true }) });

  const r1 = await engine.evaluate(token());
  const r2 = await engine.evaluate(token());

  assert.equal(r1.fired, true);
  assert.equal(r2.fired, false);
  assert.equal(r2.reason, 'cooldown');
  assert.equal(calls.length, 1);
});

test('per-token cooldown allows a new alert once it fully elapses', async () => {
  const engine = new AlertEngine({ config: makeConfig({ cooldownSeconds: 0.05 }), sendAlertFn: async () => ({ ok: true }) });
  const r1 = await engine.evaluate(token());
  await new Promise((r) => setTimeout(r, 80));
  // A different score keeps this test isolated from the separate duplicate-hash
  // check (see duplicateAlerts.test.js), which intentionally suppresses a
  // byte-for-byte identical repeat alert even once the cooldown has elapsed.
  const r2 = await engine.evaluate(token({ fomoScore: 55 }));
  assert.equal(r1.fired, true);
  assert.equal(r2.fired, true);
});

test('global cooldown blocks alerts across different tokens fired too close together', async () => {
  const engine = new AlertEngine({ config: makeConfig({ globalCooldownSeconds: 60 }), sendAlertFn: async () => ({ ok: true }) });

  const r1 = await engine.evaluate(token({ id: 'solana:aaa' }));
  const r2 = await engine.evaluate(token({ id: 'solana:bbb' })); // different token, still within global cooldown

  assert.equal(r1.fired, true);
  assert.equal(r2.fired, false);
  assert.equal(r2.reason, 'global_cooldown');
});

test('cooldown is configurable at runtime via updateAlertConfig', async () => {
  const engine = new AlertEngine({ config: makeConfig({ cooldownSeconds: 900 }), sendAlertFn: async () => ({ ok: true }) });
  await engine.evaluate(token());
  engine.updateAlertConfig({ cooldownSeconds: 0 });
  const r2 = await engine.evaluate(token({ fomoScore: 55 })); // different score - see note above
  assert.equal(r2.fired, true, 'shrinking the cooldown at runtime should immediately allow a re-alert');
});
