'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateConditionTree, buildDefaultConditionTree, isValidConditionTree } = require('../server/alerts/conditions');

function sampleToken(overrides) {
  return {
    volume: { m5: 150000, h1: 400000 },
    liquidity: 60000,
    volumeAcceleration: 4,
    priceChange: { m5: 15, h1: 20 },
    fomoScore: 80,
    ...overrides,
  };
}

test('AND group requires every condition to be true', () => {
  const tree = {
    and: [
      { field: 'volume.m5', op: '>', value: 100000 },
      { field: 'volumeAcceleration', op: '>', value: 3 },
      { field: 'liquidity', op: '>', value: 50000 },
      { field: 'priceChange.m5', op: '>', value: 10 },
    ],
  };
  assert.equal(evaluateConditionTree(sampleToken(), tree), true);
  assert.equal(evaluateConditionTree(sampleToken({ liquidity: 10000 }), tree), false);
});

test('OR group requires only one condition to be true', () => {
  const tree = { or: [{ field: 'liquidity', op: '>', value: 1000000 }, { field: 'fomoScore', op: '>', value: 70 }] };
  assert.equal(evaluateConditionTree(sampleToken(), tree), true);
  assert.equal(evaluateConditionTree(sampleToken({ fomoScore: 10 }), tree), false);
});

test('nested AND/OR trees evaluate correctly', () => {
  const tree = {
    and: [
      { field: 'liquidity', op: '>', value: 50000 },
      { or: [{ field: 'volumeAcceleration', op: '>', value: 10 }, { field: 'priceChange.m5', op: '>', value: 10 }] },
    ],
  };
  assert.equal(evaluateConditionTree(sampleToken(), tree), true); // priceChange.m5 branch satisfies the OR
  assert.equal(evaluateConditionTree(sampleToken({ priceChange: { m5: 1 } }), tree), false);
});

test('a missing/null field never satisfies a condition (fails closed)', () => {
  const tree = { field: 'trades.count', op: '>', value: 0 };
  assert.equal(evaluateConditionTree(sampleToken(), tree), false);
  assert.equal(evaluateConditionTree(sampleToken({ trades: undefined }), tree), false);
});

test('unknown operator and malformed nodes evaluate to false rather than throwing', () => {
  assert.equal(evaluateConditionTree(sampleToken(), { field: 'liquidity', op: '~=', value: 1 }), false);
  assert.equal(evaluateConditionTree(sampleToken(), {}), false);
  assert.equal(evaluateConditionTree(sampleToken(), null), false);
  assert.equal(evaluateConditionTree(sampleToken(), 'not-an-object'), false);
});

test('buildDefaultConditionTree matches the documented example thresholds', () => {
  const tree = buildDefaultConditionTree({
    minLiquidityUsd: 50000,
    min5mVolumeUsd: 100000,
    minVolumeMultiplier: 3,
    min5mChangePct: 10,
  });
  assert.equal(evaluateConditionTree(sampleToken(), tree), true);
  assert.equal(evaluateConditionTree(sampleToken({ volume: { m5: 50000 } }), tree), false);
});

test('isValidConditionTree accepts well-formed trees on allowlisted fields', () => {
  const tree = buildDefaultConditionTree({ minLiquidityUsd: 1, min5mVolumeUsd: 1, minVolumeMultiplier: 1, min5mChangePct: 1 });
  assert.equal(isValidConditionTree(tree), true);
});

test('isValidConditionTree rejects fields outside the allowlist', () => {
  assert.equal(isValidConditionTree({ field: '__proto__.polluted', op: '>', value: 1 }), false);
  assert.equal(isValidConditionTree({ field: 'name', op: '>', value: 1 }), false);
});

test('isValidConditionTree rejects non-numeric values and empty groups', () => {
  assert.equal(isValidConditionTree({ field: 'liquidity', op: '>', value: '50000' }), false);
  assert.equal(isValidConditionTree({ and: [] }), false);
});

test('isValidConditionTree bounds recursion depth and leaf count', () => {
  let deep = { field: 'liquidity', op: '>', value: 1 };
  for (let i = 0; i < 10; i++) deep = { and: [deep] };
  assert.equal(isValidConditionTree(deep), false);

  const manyLeaves = { and: Array.from({ length: 60 }, () => ({ field: 'liquidity', op: '>', value: 1 })) };
  assert.equal(isValidConditionTree(manyLeaves), false);
});
