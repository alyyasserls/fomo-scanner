'use strict';

const OPS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/** Resolves a dotted path like "volume.m5" against a token object. */
function getField(token, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), token);
}

/**
 * Evaluates a condition tree against a token.
 *
 * Leaf:  { field: 'volume.m5', op: '>', value: 100000 }
 * Group: { and: [ ...nodes ] } | { or: [ ...nodes ] }  (nestable)
 *
 * A leaf whose field resolves to null/undefined always evaluates to false
 * (missing data should never accidentally satisfy a threshold condition).
 */
function evaluateConditionTree(token, node) {
  if (!node || typeof node !== 'object') return false;

  if (Array.isArray(node.and)) return node.and.every((child) => evaluateConditionTree(token, child));
  if (Array.isArray(node.or)) return node.or.some((child) => evaluateConditionTree(token, child));

  if (typeof node.field === 'string' && typeof node.op === 'string') {
    const fieldValue = getField(token, node.field);
    if (fieldValue === null || fieldValue === undefined) return false;
    const cmp = OPS[node.op];
    if (!cmp) return false;
    return cmp(fieldValue, node.value);
  }

  return false;
}

/** Builds the default AND-condition alert tree from flat config thresholds. */
function buildDefaultConditionTree(thresholds) {
  return {
    and: [
      { field: 'volume.m5', op: '>', value: thresholds.min5mVolumeUsd },
      { field: 'volumeAcceleration', op: '>', value: thresholds.minVolumeMultiplier },
      { field: 'liquidity', op: '>', value: thresholds.minLiquidityUsd },
      { field: 'priceChange.m5', op: '>', value: thresholds.min5mChangePct },
    ],
  };
}

const ALLOWED_FIELDS = new Set([
  'price',
  'marketCap',
  'liquidity',
  'volume.m1',
  'volume.m5',
  'volume.m15',
  'volume.h1',
  'volume.h6',
  'volume.h24',
  'priceChange.m1',
  'priceChange.m5',
  'priceChange.m15',
  'priceChange.h1',
  'volumeAcceleration',
  'volumeVelocityPerMin',
  'volumeToLiquidity',
  'volumeMomentum',
  'trades.count',
  'trades.buys',
  'trades.sells',
  'buySellRatio',
  'tokenAgeSeconds',
  'fomoScore',
]);

/**
 * Validates a user-supplied condition tree (e.g. from POST /api/alerts/config)
 * before it is ever passed to evaluateConditionTree - bounds recursion
 * depth/size and restricts fields/ops to a known-safe allowlist so a
 * malformed or adversarial payload can't cause excessive recursion or
 * reference unexpected object properties.
 */
function isValidConditionTree(node, depth = 0, leafCounter = { count: 0 }) {
  if (depth > 6 || leafCounter.count > 50) return false;
  if (!node || typeof node !== 'object') return false;

  if (Array.isArray(node.and) || Array.isArray(node.or)) {
    const children = node.and || node.or;
    if (!children.length) return false;
    return children.every((child) => isValidConditionTree(child, depth + 1, leafCounter));
  }

  if (typeof node.field === 'string' && typeof node.op === 'string') {
    leafCounter.count += 1;
    return ALLOWED_FIELDS.has(node.field) && Object.prototype.hasOwnProperty.call(OPS, node.op) && typeof node.value === 'number' && Number.isFinite(node.value);
  }

  return false;
}

module.exports = {
  evaluateConditionTree,
  buildDefaultConditionTree,
  isValidConditionTree,
  getField,
  OPS,
  ALLOWED_FIELDS,
};
