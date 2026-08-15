'use strict';

const rateLimit = require('express-rate-limit');

/** General REST API limiter - generous, protects against accidental hammering. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

/** Stricter limiter for state-mutating endpoints (presets, alert config). */
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

module.exports = { apiLimiter, writeLimiter };
