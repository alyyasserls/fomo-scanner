'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateVolumeAcceleration,
  calculateVolumeVelocity,
  calculateVolumeToLiquidity,
  findBaselineSample,
} = require('../server/scanner/volume');

test('volume acceleration: normal ratio', () => {
  assert.equal(calculateVolumeAcceleration(300000, 100000), 3);
  assert.equal(calculateVolumeAcceleration(50000, 100000), 0.5);
});

test('volume acceleration: no baseline yet returns null (not 0 or Infinity)', () => {
  assert.equal(calculateVolumeAcceleration(150000, null), null);
  assert.equal(calculateVolumeAcceleration(150000, 0), null);
  assert.equal(calculateVolumeAcceleration(150000, undefined), null);
});

test('volume acceleration: zero/invalid current volume returns 0', () => {
  assert.equal(calculateVolumeAcceleration(0, 100000), 0);
  assert.equal(calculateVolumeAcceleration(-5, 100000), 0);
  assert.equal(calculateVolumeAcceleration(NaN, 100000), 0);
});

test('volume velocity divides evenly across the window', () => {
  assert.equal(calculateVolumeVelocity(150000, 5), 30000);
  assert.equal(calculateVolumeVelocity(0, 5), 0);
});

test('volume velocity guards a zero/invalid window', () => {
  assert.equal(calculateVolumeVelocity(1000, 0), 0);
  assert.equal(calculateVolumeVelocity(1000, -1), 0);
});

test('volume/liquidity ratio', () => {
  assert.equal(calculateVolumeToLiquidity(50000, 100000), 0.5);
  assert.equal(calculateVolumeToLiquidity(50000, 0), 0);
});

test('findBaselineSample picks the sample closest to the target age within tolerance', () => {
  const now = Date.now();
  const history = [
    { t: now - 20 * 60 * 1000, v: 999 },
    { t: now - 5.2 * 60 * 1000, v: 42 },
    { t: now - 1 * 60 * 1000, v: 5 },
  ];
  const baseline = findBaselineSample(history, 5 * 60 * 1000, 2 * 60 * 1000);
  assert.equal(baseline, 42);
});

test('findBaselineSample returns null when nothing is within tolerance', () => {
  const now = Date.now();
  const history = [{ t: now - 1000, v: 5 }];
  assert.equal(findBaselineSample(history, 5 * 60 * 1000, 30 * 1000), null);
});

test('findBaselineSample returns null for empty/missing history', () => {
  assert.equal(findBaselineSample([], 5000, 1000), null);
  assert.equal(findBaselineSample(undefined, 5000, 1000), null);
});
