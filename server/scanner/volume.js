'use strict';

const { isFiniteNumber } = require('../utils/sanitize');

/**
 * Volume acceleration = current 5m volume / previous 5m volume.
 *
 * Returns:
 *   - a positive number  -> normal ratio (1 = flat, 2 = doubled, etc.)
 *   - null                -> no prior baseline observed yet (token just
 *                            entered tracking); callers should treat this
 *                            as "insufficient data", not zero or infinite.
 *   - 0                    -> current volume is zero/invalid.
 */
function calculateVolumeAcceleration(current5mVolume, previous5mVolume) {
  if (!isFiniteNumber(current5mVolume) || current5mVolume <= 0) return 0;
  if (!isFiniteNumber(previous5mVolume) || previous5mVolume <= 0) return null;
  return round(current5mVolume / previous5mVolume, 4);
}

/** Volume generated per minute for a given volume figure over `windowMinutes`. */
function calculateVolumeVelocity(volume, windowMinutes) {
  if (!isFiniteNumber(volume) || volume < 0) return 0;
  if (!isFiniteNumber(windowMinutes) || windowMinutes <= 0) return 0;
  return round(volume / windowMinutes, 2);
}

/** How much of a pool's liquidity is turning over in 5 minutes. */
function calculateVolumeToLiquidity(volume5m, liquidity) {
  if (!isFiniteNumber(volume5m) || volume5m < 0) return 0;
  if (!isFiniteNumber(liquidity) || liquidity <= 0) return 0;
  return round(volume5m / liquidity, 4);
}

/**
 * Finds the volume-5m sample closest to `targetAgeMs` in the past from a
 * history array of `{ t: epochMs, v: number }` samples (newest last),
 * within `toleranceMs`. Used to derive the "previous 5m volume" baseline
 * for acceleration even when polling intervals don't align perfectly to
 * 5-minute boundaries.
 */
function findBaselineSample(history, targetAgeMs, toleranceMs) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const now = Date.now();
  const targetTs = now - targetAgeMs;
  let best = null;
  let bestDelta = Infinity;
  for (const sample of history) {
    const delta = Math.abs(sample.t - targetTs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = sample;
    }
  }
  if (best && bestDelta <= toleranceMs) return best.v;
  return null;
}

function round(n, dp) {
  const m = 10 ** dp;
  return Math.round(n * m) / m;
}

module.exports = {
  calculateVolumeAcceleration,
  calculateVolumeVelocity,
  calculateVolumeToLiquidity,
  findBaselineSample,
};
