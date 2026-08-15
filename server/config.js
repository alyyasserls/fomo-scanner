'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).trim().toLowerCase() === 'true';
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 3000),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  chains: list('CHAINS', ['solana']),

  provider: {
    mode: (process.env.DATA_PROVIDER || 'auto').toLowerCase(), // auto | mobula | fallback
    mobula: {
      apiKey: process.env.MOBULA_API_KEY || '',
      wsUrl: process.env.MOBULA_WS_URL || 'wss://api.mobula.io/ws',
      maxReconnectAttempts: num('MOBULA_MAX_RECONNECT_ATTEMPTS', 5),
    },
    fallback: {
      queries: list('FALLBACK_QUERIES', ['solana', 'raydium', 'pump']),
      pollIntervalMs: num('FALLBACK_POLL_INTERVAL_MS', 15000),
    },
  },

  scanner: {
    tickIntervalMs: num('SCAN_TICK_INTERVAL_MS', 2000),
    staleTokenTtlMs: num('STALE_TOKEN_TTL_MS', 900000),
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  alerts: {
    defaultConditions: {
      minLiquidityUsd: num('MIN_LIQUIDITY_USD', 50000),
      min5mVolumeUsd: num('MIN_5M_VOLUME_USD', 100000),
      minVolumeMultiplier: num('MIN_VOLUME_MULTIPLIER', 3),
      min5mChangePct: num('MIN_5M_CHANGE_PCT', 10),
    },
    cooldownSeconds: num('ALERT_COOLDOWN_SECONDS', 900),
    globalCooldownSeconds: num('GLOBAL_ALERT_COOLDOWN_SECONDS', 5),
    onlyOncePerToken: bool('ALERT_ONLY_ONCE_PER_TOKEN', false),
    retriggerScoreDelta: num('ALERT_RETRIGGER_SCORE_DELTA', 15),
    severity: {
      highScore: num('ALERT_SEVERITY_HIGH_SCORE', 75),
      extremeScore: num('ALERT_SEVERITY_EXTREME_SCORE', 90),
    },
  },
};

module.exports = config;
