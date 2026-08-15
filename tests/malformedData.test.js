'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeToken } = require('../server/scanner/normalize');
const { TokenStore } = require('../server/scanner/tokenStore');

test('normalizeToken rejects payloads with no identifiable address', () => {
  assert.equal(normalizeToken({ name: 'X' }), null);
  assert.equal(normalizeToken({}), null);
  assert.equal(normalizeToken(null), null);
  assert.equal(normalizeToken(undefined), null);
  assert.equal(normalizeToken('not an object'), null);
  assert.equal(normalizeToken(42), null);
});

test('normalizeToken defaults missing numeric fields to null instead of throwing/NaN', () => {
  const t = normalizeToken({ chain: 'solana', mintAddress: 'abc' });
  assert.equal(t.price, null);
  assert.equal(t.marketCap, null);
  assert.equal(t.liquidity, null);
  assert.equal(t.volume.m5, null);
  assert.equal(Number.isNaN(t.price), false);
});

test('normalizeToken clamps negative numeric fields to zero (bad upstream data)', () => {
  const t = normalizeToken({ chain: 'solana', mintAddress: 'abc', price: -5, liquidity: -100, volume: { m5: -50 } });
  assert.equal(t.price, 0);
  assert.equal(t.liquidity, 0);
  assert.equal(t.volume.m5, 0);
});

test('normalizeToken strips markup/control characters from name and symbol', () => {
  const t = normalizeToken({
    chain: 'solana',
    mintAddress: 'abc',
    name: '<img src=x onerror=alert(1)>Scam',
    symbol: '<script>bad</script>',
  });
  assert.ok(!t.name.includes('<'));
  assert.ok(!t.symbol.includes('<'));
});

test('normalizeToken ignores non-numeric garbage in numeric fields', () => {
  const t = normalizeToken({ chain: 'solana', mintAddress: 'abc', price: 'not-a-number', volume: { m5: {} } });
  assert.equal(t.price, null);
  assert.equal(t.volume.m5, null);
});

test('normalizeToken rejects an unsafe/non-http(s) token URL', () => {
  const t = normalizeToken({ chain: 'solana', mintAddress: 'abc', url: 'javascript:alert(1)' });
  assert.equal(t.url, '');
});

test('TokenStore.upsert never throws on malformed input and simply skips it', () => {
  const store = new TokenStore();
  assert.equal(store.upsert(null), null);
  assert.equal(store.upsert(undefined), null);
  assert.equal(store.upsert('garbage'), null);
  assert.equal(store.upsert(12345), null);
  assert.equal(store.upsert({ random: 'field' }), null);
  assert.equal(store.size(), 0);
});

test('TokenStore.upsert accepts a valid token amid a batch containing garbage', () => {
  const store = new TokenStore();
  const batch = [null, { chain: 'solana', mintAddress: 'good', pairAddress: 'good-pair', volume: {} }, 'nope', undefined];
  const results = batch.map((raw) => store.upsert(raw));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(store.size(), 1);
});

test('TokenStore.removeStale evicts tokens past the TTL and leaves fresh ones', async () => {
  const store = new TokenStore();
  store.upsert({ chain: 'solana', mintAddress: 'old', pairAddress: 'old-pair' });
  await new Promise((r) => setTimeout(r, 30));
  store.upsert({ chain: 'solana', mintAddress: 'fresh', pairAddress: 'fresh-pair' });

  const removed = store.removeStale(20);
  assert.equal(removed.length, 1);
  assert.equal(store.size(), 1);
  assert.equal(store.get('solana:fresh-pair') !== null, true);
});
