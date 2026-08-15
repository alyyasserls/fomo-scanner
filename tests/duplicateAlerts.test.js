'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AlertEngine } = require('../server/alerts/alertEngine');

function makeConfig(overrides = {}) {
  return {
    alerts: {
      defaultConditions: { minLiquidityUsd: 1000, min5mVolumeUsd: 1000, minVolumeMultiplier: 1, min5mChangePct: 1 },
      cooldownSeconds: 0.05,
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
    liquidity: 60000,
    volume: { m5: 150000, h1: 400000 },
    volumeAcceleration: 5,
    priceChange: { m5: 20, h1: 30 },
    fomoScore: 80,
    ...overrides,
  };
}

test('identical rapid-fire updates are deduplicated even after the cooldown technically elapses', async () => {
  const engine = new AlertEngine({ config: makeConfig(), sendAlertFn: async () => ({ ok: true }) });
  const r1 = await engine.evaluate(token());
  await new Promise((r) => setTimeout(r, 80)); // cooldown (50ms) elapses
  const r2 = await engine.evaluate(token()); // same id/severity/score bucket -> still a duplicate
  assert.equal(r1.fired, true);
  assert.equal(r2.fired, false);
  assert.equal(r2.reason, 'duplicate');
});

test('"only alert once per token" suppresses every subsequent alert regardless of score', async () => {
  const engine = new AlertEngine({ config: makeConfig({ onlyOncePerToken: true, cooldownSeconds: 0 }), sendAlertFn: async () => ({ ok: true }) });
  const r1 = await engine.evaluate(token());
  const r2 = await engine.evaluate(token({ fomoScore: 99 }));
  assert.equal(r1.fired, true);
  assert.equal(r2.fired, false);
  assert.equal(r2.reason, 'cooldown');
});

test('a 15+ point score jump re-triggers an alert even before the full cooldown elapses', async () => {
  const engine = new AlertEngine({ config: makeConfig({ cooldownSeconds: 900, retriggerScoreDelta: 15 }), sendAlertFn: async () => ({ ok: true }) });
  const r1 = await engine.evaluate(token({ fomoScore: 80 }));
  const r2 = await engine.evaluate(token({ fomoScore: 90 })); // +10, below the retrigger threshold
  const r3 = await engine.evaluate(token({ fomoScore: 96 })); // +16 vs the last *alerted* score (80) -> retriggers
  assert.equal(r1.fired, true);
  assert.equal(r2.fired, false);
  assert.equal(r3.fired, true);
});

test('severity classification follows the configured score thresholds', async () => {
  const engine = new AlertEngine({ config: makeConfig(), sendAlertFn: async () => ({ ok: true }) });
  assert.equal(engine.classifySeverity(50), 'NORMAL');
  assert.equal(engine.classifySeverity(75), 'HIGH');
  assert.equal(engine.classifySeverity(90), 'EXTREME');
});

test('fired alerts are recorded in history in most-recent-first order', async () => {
  const engine = new AlertEngine({ config: makeConfig({ cooldownSeconds: 0, globalCooldownSeconds: 0 }), sendAlertFn: async () => ({ ok: true }) });
  await engine.evaluate(token({ id: 'solana:aaa' }));
  await new Promise((r) => setTimeout(r, 5));
  await engine.evaluate(token({ id: 'solana:bbb' }));
  const history = engine.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].tokenId, 'solana:bbb');
  assert.equal(history[1].tokenId, 'solana:aaa');
});
