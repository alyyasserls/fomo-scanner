'use strict';

const { isFiniteNumber } = require('../utils/sanitize');

// FOMO Score weighting - configurable, does not require code changes to
// re-tune from an admin/API layer later (see server/routes/api.js).
const DEFAULT_WEIGHTS = {
  acceleration: 0.3,
  volume5m: 0.25,
  priceMomentum: 0.2,
  volumeToLiquidity: 0.15,
  tradeActivity: 0.1,
};

/**
 * Builds a rank(value) => [0..1] function over a fixed distribution.
 * Percentile ranking is used (instead of raw magnitude/min-max) so that one
 * enormous token's absolute volume/liquidity can't single-handedly dominate
 * the score - what matters is how a token compares to everything else
 * currently being scanned.
 */
function buildRanker(values) {
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return () => 0.5;
  return (value) => {
    if (!isFiniteNumber(value)) return 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo / n;
  };
}

function median(values) {
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Combined price-momentum metric: mostly 5m change, some 1h context. */
function priceMomentumValue(token) {
  const m5 = token.priceChange?.m5;
  const h1 = token.priceChange?.h1;
  const parts = [];
  if (isFiniteNumber(m5)) parts.push({ v: m5, w: 0.65 });
  if (isFiniteNumber(h1)) parts.push({ v: h1, w: 0.35 });
  if (!parts.length) return 0;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
}

/** Combined trade-activity metric: trade count plus a buy-dominance bonus. */
function tradeActivityValue(token) {
  const count = token.trades?.count;
  const ratio = token.buySellRatio;
  const countScore = isFiniteNumber(count) && count > 0 ? Math.log10(1 + count) : 0;
  const buyBonus = isFiniteNumber(ratio) ? Math.min(ratio, 5) / 5 : ratio === null && token.trades?.buys > 0 ? 1 : 0.5;
  return countScore * (0.7 + 0.3 * buyBonus);
}

/**
 * Recomputes the FOMO Score (0-100) for every token in `tokens` relative to
 * one another. Must be called with the *entire* currently-tracked universe
 * (or at least a representative slice) for the percentile normalization to
 * be meaningful - a single token scored in isolation has nothing to rank
 * against and will land at the midpoint/extreme trivially.
 *
 * Mutates and returns the same array; each token gains `.fomoScore` (int
 * 0-100) and `.fomoRank` (1 = highest score).
 */
function computeFomoScores(tokens, weights = DEFAULT_WEIGHTS) {
  if (!Array.isArray(tokens) || tokens.length === 0) return tokens || [];

  const accelMedian = median(tokens.map((t) => t.volumeAcceleration).filter((v) => v !== null));
  const accelFallback = accelMedian ?? 1;

  const accelValues = tokens.map((t) => (t.volumeAcceleration === null ? accelFallback : t.volumeAcceleration));
  const vol5mValues = tokens.map((t) => t.volume?.m5 ?? 0);
  const priceValues = tokens.map((t) => priceMomentumValue(t));
  const volLiqValues = tokens.map((t) => t.volumeToLiquidity ?? 0);
  const tradeValues = tokens.map((t) => tradeActivityValue(t));

  const rankAccel = buildRanker(accelValues);
  const rankVol5m = buildRanker(vol5mValues);
  const rankPrice = buildRanker(priceValues);
  const rankVolLiq = buildRanker(volLiqValues);
  const rankTrades = buildRanker(tradeValues);

  tokens.forEach((token, i) => {
    const composite =
      weights.acceleration * rankAccel(accelValues[i]) +
      weights.volume5m * rankVol5m(vol5mValues[i]) +
      weights.priceMomentum * rankPrice(priceValues[i]) +
      weights.volumeToLiquidity * rankVolLiq(volLiqValues[i]) +
      weights.tradeActivity * rankTrades(tradeValues[i]);

    token.fomoScore = Math.round(Math.min(100, Math.max(0, composite * 100)));
  });

  tokens
    .slice()
    .sort((a, b) => b.fomoScore - a.fomoScore)
    .forEach((token, i) => {
      token.fomoRank = i + 1;
    });

  return tokens;
}

module.exports = {
  DEFAULT_WEIGHTS,
  computeFomoScores,
  buildRanker,
  median,
  priceMomentumValue,
  tradeActivityValue,
};
