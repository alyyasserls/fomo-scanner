'use strict';

const EventEmitter = require('events');
const { evaluateConditionTree, buildDefaultConditionTree } = require('./conditions');
const { sendTelegramAlert } = require('./telegram');
const { isFiniteNumber } = require('../utils/sanitize');
const { createLogger } = require('../utils/logger');

const log = createLogger('alerts:engine');
const DUPLICATE_WINDOW_MS = 30000;
const MAX_HISTORY = 200;

/**
 * Evaluates every incoming token update against a configurable AND/OR
 * condition tree, classifies severity, applies anti-spam rules, and sends
 * Telegram notifications. All state is in-memory (Map/array), sized to be
 * trivially portable to a Postgres table later without changing the
 * evaluate() contract.
 */
class AlertEngine extends EventEmitter {
  constructor({ config, sendAlertFn = sendTelegramAlert }) {
    super();
    this.config = config;
    this.sendAlertFn = sendAlertFn;
    this.conditionTree = buildDefaultConditionTree(config.alerts.defaultConditions);
    this.tokenState = new Map(); // tokenId -> { lastAlertAt, lastScore, alertCount }
    this.recentHashes = new Map(); // dedup hash -> timestamp
    this.lastGlobalAlertAt = 0;
    this.history = [];
  }

  setConditionTree(tree) {
    this.conditionTree = tree;
  }

  getConditionTree() {
    return this.conditionTree;
  }

  updateAlertConfig(partial) {
    this.config.alerts = { ...this.config.alerts, ...partial };
  }

  classifySeverity(score) {
    if (score >= this.config.alerts.severity.extremeScore) return 'EXTREME';
    if (score >= this.config.alerts.severity.highScore) return 'HIGH';
    return 'NORMAL';
  }

  /**
   * Evaluates one token update. Fires (and returns) at most one Telegram
   * alert. Never throws.
   */
  async evaluate(token) {
    try {
      if (!evaluateConditionTree(token, this.conditionTree)) {
        return { fired: false, reason: 'condition_not_met' };
      }

      const now = Date.now();
      const state = this.tokenState.get(token.id) || { lastAlertAt: 0, lastScore: null, alertCount: 0 };
      const cooldownMs = this.config.alerts.cooldownSeconds * 1000;
      const sinceLast = now - state.lastAlertAt;

      let allowed;
      if (state.alertCount === 0) {
        allowed = true;
      } else if (this.config.alerts.onlyOncePerToken) {
        allowed = false;
      } else if (sinceLast >= cooldownMs) {
        allowed = true;
      } else if (
        isFiniteNumber(state.lastScore) &&
        isFiniteNumber(token.fomoScore) &&
        token.fomoScore - state.lastScore >= this.config.alerts.retriggerScoreDelta
      ) {
        allowed = true; // score jumped enough to justify an early re-alert
      } else {
        allowed = false;
      }

      if (!allowed) {
        return { fired: false, reason: state.alertCount === 0 ? 'condition_not_met' : 'cooldown' };
      }

      const globalCooldownMs = this.config.alerts.globalCooldownSeconds * 1000;
      if (now - this.lastGlobalAlertAt < globalCooldownMs) {
        return { fired: false, reason: 'global_cooldown' };
      }

      const severity = this.classifySeverity(token.fomoScore);
      const dedupHash = `${token.id}:${severity}:${Math.round((token.fomoScore || 0) / 5) * 5}`;
      const lastHashAt = this.recentHashes.get(dedupHash);
      if (lastHashAt && now - lastHashAt < DUPLICATE_WINDOW_MS) {
        return { fired: false, reason: 'duplicate' };
      }

      // Reserve state up front so concurrent evaluate() calls for the same
      // token (unlikely, but ticks can overlap under load) can't double-fire.
      this.recentHashes.set(dedupHash, now);
      this._pruneHashes(now);
      state.lastAlertAt = now;
      state.lastScore = token.fomoScore;
      state.alertCount += 1;
      this.tokenState.set(token.id, state);
      this.lastGlobalAlertAt = now;

      const telegramResult = await this.sendAlertFn(token, severity, this.config.telegram);

      const record = {
        id: `${token.id}-${now}`,
        tokenId: token.id,
        symbol: token.symbol,
        name: token.name,
        chain: token.chain,
        severity,
        fomoScore: token.fomoScore,
        price: token.price,
        volume5m: token.volume?.m5 ?? null,
        volumeAcceleration: token.volumeAcceleration,
        sentAt: now,
        telegramOk: telegramResult.ok,
      };
      this._pushHistory(record);
      this.emit('alert', record);

      return { fired: true, severity, telegramResult };
    } catch (err) {
      log.error(`evaluate() failed for ${token && token.id}`, err.message);
      return { fired: false, reason: 'error' };
    }
  }

  getHistory(limit = 50) {
    return this.history.slice(0, limit);
  }

  _pruneHashes(now) {
    for (const [hash, t] of this.recentHashes) {
      if (now - t > DUPLICATE_WINDOW_MS) this.recentHashes.delete(hash);
    }
  }

  _pushHistory(record) {
    this.history.unshift(record);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
  }
}

module.exports = { AlertEngine };
