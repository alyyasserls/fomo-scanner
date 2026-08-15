'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeFomoScores, buildRanker, median } = require('../server/scanner/score');

function baseToken(overrides) {
  return {
    id: 't',
    volumeAcceleration: 2,
    volume: { m5: 10000, h1: 40000 },
    priceChange: { m5: 5, h1: 10 },
    volumeToLiquidity: 0.1,
    trades: { count: 50 },
    buySellRatio: 1.5,
    ...overrides,
  };
}

test('computeFomoScores produces scores in [0,100] and ranks descending', () => {
  const tokens = [
    baseToken({ id: 'low', volume: { m5: 1000, h1: 2000 }, priceChange: { m5: 1, h1: 1 } }),
    baseToken({ id: 'mid' }),
    baseToken({ id: 'high', volume: { m5: 500000, h1: 900000 }, priceChange: { m5: 60, h1: 90 }, volumeAcceleration: 10 }),
  ];

  computeFomoScores(tokens);

  for (const t of tokens) {
    assert.ok(t.fomoScore >= 0 && t.fomoScore <= 100);
  }

  const high = tokens.find((t) => t.id === 'high');
  const low = tokens.find((t) => t.id === 'low');
  assert.ok(high.fomoScore > low.fomoScore, 'the clearly bigger mover should score higher');
  assert.equal(high.fomoRank, 1);
});

test('one huge token does not automatically dominate the whole universe', () => {
  // A single enormous-liquidity/volume token alongside many small but
  // proportionally very active tokens - percentile ranking means the
  // small hyperactive tokens can still outrank the whale on score.
  const whale = baseToken({
    id: 'whale',
    volume: { m5: 5000000, h1: 9000000 },
    volumeToLiquidity: 0.01, // huge absolute volume, but tiny relative to its liquidity
    volumeAcceleration: 1.1, // barely accelerating
    priceChange: { m5: 0.5, h1: 1 },
  });
  const hot = baseToken({
    id: 'hot',
    volume: { m5: 200000, h1: 300000 },
    volumeToLiquidity: 4, // turning over its whole pool several times in 5m
    volumeAcceleration: 12,
    priceChange: { m5: 45, h1: 70 },
  });
  const filler = Array.from({ length: 8 }, (_, i) => baseToken({ id: `filler${i}` }));

  const tokens = [whale, hot, ...filler];
  computeFomoScores(tokens);

  assert.ok(hot.fomoScore > whale.fomoScore, 'proportionally hotter small token should outrank the whale');
});

test('null volumeAcceleration (no baseline) is treated as neutral, not zero', () => {
  const withBaseline = baseToken({ id: 'a', volumeAcceleration: 5 });
  const noBaseline = baseToken({ id: 'b', volumeAcceleration: null });
  const tokens = [withBaseline, noBaseline];
  computeFomoScores(tokens);
  // noBaseline should not be crushed to the bottom just for lacking history.
  assert.ok(noBaseline.fomoScore > 0);
});

test('buildRanker: percentile rank is monotonic and bounded [0,1]', () => {
  const rank = buildRanker([10, 20, 30, 40, 50]);
  assert.equal(rank(5), 0);
  assert.equal(rank(50), 1);
  assert.ok(rank(25) > rank(15));
});

test('median handles even/odd/empty arrays', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('computeFomoScores is a no-op-safe on empty input', () => {
  assert.deepEqual(computeFomoScores([]), []);
  assert.deepEqual(computeFomoScores(null), []);
});
