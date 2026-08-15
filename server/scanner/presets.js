'use strict';

/**
 * Built-in filter presets. Shape mirrors the filter panel on the frontend
 * (public/components/filterPanel.js) so the same object can be applied
 * client-side without another round trip. Exposed read-only via
 * GET /api/presets; user-saved presets are layered on top in memory
 * (server/routes/api.js) with a schema ready to move to Postgres later.
 */
const BUILTIN_PRESETS = [
  {
    id: 'volume-explosion',
    name: '🔥 Volume Explosion',
    builtin: true,
    filters: {
      min5mVolume: 100000,
      minVolumeMultiplier: 3,
      minLiquidity: 50000,
    },
  },
  {
    id: 'early-momentum',
    name: '🚀 Early Momentum',
    builtin: true,
    filters: {
      min5mChange: 10,
      minVolumeMultiplier: 2,
      maxMarketCap: 10000000,
    },
  },
  {
    id: 'high-volume',
    name: '💰 High Volume',
    builtin: true,
    filters: {
      min1hVolume: 500000,
      minLiquidity: 100000,
    },
  },
  {
    id: 'new-tokens',
    name: '🆕 New Tokens',
    builtin: true,
    filters: {
      maxTokenAgeHours: 24,
      minLiquidity: 20000,
      min5mVolume: 5000,
    },
  },
  {
    id: 'meme-scanner',
    name: '🐸 Meme Scanner',
    builtin: true,
    filters: {
      chain: 'solana',
      minMarketCap: 50000,
      maxMarketCap: 5000000,
      minLiquidity: 20000,
      minVolumeMultiplier: 2,
    },
  },
];

module.exports = { BUILTIN_PRESETS };
