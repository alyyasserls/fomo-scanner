'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const fromEnv = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[fromEnv] || LEVELS.info;
}

function timestamp() {
  return new Date().toISOString();
}

function write(level, scope, args) {
  if (LEVELS[level] < currentLevel()) return;
  const prefix = `[${timestamp()}] [${level.toUpperCase()}] [${scope}]`;
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  // eslint-disable-next-line no-console
  console[method](prefix, ...args);
}

/**
 * Creates a namespaced logger, e.g. logger('provider:mobula').info('connected')
 */
function createLogger(scope) {
  return {
    debug: (...args) => write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args),
  };
}

module.exports = { createLogger };
