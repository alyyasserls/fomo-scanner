'use strict';

const { isFiniteNumber, clamp } = require('../utils/sanitize');

// Internal weights for the general-purpose momentum composite. These are
// separate from the FOMO Score weights in score.js - this value is a raw,
// unbounded "how much is happening" signal that score.js's trade-activity
// and rank inputs can draw on, and that the UI can optionally sort by.
const WEIGHTS = {
  volume5m: 0.35,
  volume1h: 0.2,
  acceleration: 0.25,
  priceChange: 0.15,
  liquidity: 0.05,
};

/**
 * Weighted combination of 5m volume, 1h volume, volume acceleration, price
 * change and liquidity. Volume/liquidity magnitudes are log-scaled so a
 * single very large pool does not swamp the composite.
 */
function computeVolumeMomentum({ volume5m, volume1h, acceleration, priceChange5m, liquidity }) {
  const logVol5m = logScale(volume5m);
  const logVol1h = logScale(volume1h);
  const logLiquidity = logScale(liquidity);
  const accelScore = clamp(isFiniteNumber(acceleration) ? acceleration : 1, 0, 20) / 20; // 0..1
  const priceScore = clamp((isFiniteNumber(priceChange5m) ? priceChange5m : 0) / 100, -1, 1); // -1..1

  const raw =
    WEIGHTS.volume5m * logVol5m +
    WEIGHTS.volume1h * logVol1h +
    WEIGHTS.acceleration * accelScore * 10 +
    WEIGHTS.priceChange * priceScore * 10 +
    WEIGHTS.liquidity * logLiquidity;

  return round(raw, 4);
}

function logScale(value) {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return Math.log10(1 + value);
}

function round(n, dp) {
  const m = 10 ** dp;
  return Math.round(n * m) / m;
}

module.exports = { computeVolumeMomentum, WEIGHTS };
