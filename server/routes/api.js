'use strict';

const express = require('express');
const { BUILTIN_PRESETS } = require('../scanner/presets');
const { isValidConditionTree } = require('../alerts/conditions');
const { sanitizeString } = require('../utils/sanitize');
const { apiLimiter, writeLimiter } = require('../utils/rateLimit');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:api');

const ALLOWED_FILTER_KEYS = new Set([
  'chain',
  'minLiquidity',
  'min5mVolume',
  'min1hVolume',
  'minMarketCap',
  'maxMarketCap',
  'min5mChange',
  'minVolumeMultiplier',
  'minFomoScore',
  'maxTokenAgeHours',
  'minBuySellRatio',
]);

function sanitizeFilters(filters) {
  if (!filters || typeof filters !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!ALLOWED_FILTER_KEYS.has(key)) continue;
    if (key === 'chain') {
      out[key] = sanitizeString(value, 32).toLowerCase();
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

function createApiRouter({ config, tokenStore, alertEngine, scannerEngine, startedAt }) {
  const router = express.Router();
  router.use(apiLimiter);

  // In-memory saved presets (schema is DB-ready: id/name/filters/createdAt).
  const savedPresets = [];
  let presetSeq = 1;

  router.get('/status', (req, res) => {
    const status = scannerEngine.getStatus();
    res.json({
      ...status,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      serverTime: Date.now(),
    });
  });

  router.get('/tokens', (req, res) => {
    const tokens = tokenStore.getAll().sort((a, b) => (b.fomoScore || 0) - (a.fomoScore || 0));
    res.json({ tokens, count: tokens.length });
  });

  router.get('/tokens/:id', (req, res) => {
    const id = sanitizeString(req.params.id, 128);
    const token = tokenStore.get(id);
    if (!token) return res.status(404).json({ error: 'Token not found' });
    return res.json({ token });
  });

  router.get('/tokens/:id/history', (req, res) => {
    const id = sanitizeString(req.params.id, 128);
    if (!tokenStore.has(id)) return res.status(404).json({ error: 'Token not found' });
    return res.json(tokenStore.getHistory(id));
  });

  router.get('/presets', (req, res) => {
    res.json({ presets: [...BUILTIN_PRESETS, ...savedPresets] });
  });

  router.post('/presets', writeLimiter, express.json({ limit: '16kb' }), (req, res) => {
    const name = sanitizeString(req.body?.name, 48);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const filters = sanitizeFilters(req.body?.filters);
    const preset = { id: `custom-${presetSeq++}`, name, builtin: false, filters, createdAt: Date.now() };
    savedPresets.push(preset);
    res.status(201).json({ preset });
  });

  router.delete('/presets/:id', writeLimiter, (req, res) => {
    const id = sanitizeString(req.params.id, 64);
    const idx = savedPresets.findIndex((p) => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Preset not found or not deletable' });
    savedPresets.splice(idx, 1);
    res.status(204).end();
  });

  router.get('/alerts', (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ alerts: alertEngine.getHistory(limit) });
  });

  router.get('/alerts/config', (req, res) => {
    res.json({
      thresholds: config.alerts.defaultConditions,
      cooldownSeconds: config.alerts.cooldownSeconds,
      globalCooldownSeconds: config.alerts.globalCooldownSeconds,
      onlyOncePerToken: config.alerts.onlyOncePerToken,
      retriggerScoreDelta: config.alerts.retriggerScoreDelta,
      severity: config.alerts.severity,
      conditionTree: alertEngine.getConditionTree(),
      telegramConfigured: Boolean(config.telegram.botToken && config.telegram.chatId),
    });
  });

  router.post('/alerts/config', writeLimiter, express.json({ limit: '16kb' }), (req, res) => {
    const body = req.body || {};
    const patch = {};

    for (const key of ['cooldownSeconds', 'globalCooldownSeconds', 'retriggerScoreDelta']) {
      if (typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0) {
        patch[key] = body[key];
      }
    }
    if (typeof body.onlyOncePerToken === 'boolean') patch.onlyOncePerToken = body.onlyOncePerToken;

    if (Object.keys(patch).length) alertEngine.updateAlertConfig(patch);

    if (body.conditionTree) {
      if (!isValidConditionTree(body.conditionTree)) {
        return res.status(400).json({ error: 'Invalid conditionTree' });
      }
      alertEngine.setConditionTree(body.conditionTree);
    }

    return res.json({ ok: true });
  });

  // Central error handler for this router - never leak internals.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    log.error('API error', err && err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}

module.exports = { createApiRouter };
