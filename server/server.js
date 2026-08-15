'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const { createLogger } = require('./utils/logger');
const { TokenStore } = require('./scanner/tokenStore');
const { ScannerEngine } = require('./scanner/engine');
const { ProviderManager } = require('./providers');
const { AlertEngine } = require('./alerts/alertEngine');
const { BUILTIN_PRESETS } = require('./scanner/presets');
const { setupWebSocketServer } = require('./websocket');
const { createApiRouter } = require('./routes/api');

const log = createLogger('server');
const startedAt = Date.now();

const app = express();
app.disable('x-powered-by');

// --- Security / hygiene middleware -----------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const corsOrigins = config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((o) => o.trim());
app.use(cors({ origin: corsOrigins }));

// --- Core wiring -------------------------------------------------------
const tokenStore = new TokenStore();
const alertEngine = new AlertEngine({ config });
const providerManager = new ProviderManager(config);
const scannerEngine = new ScannerEngine({ config, tokenStore, alertEngine, providerManager });

// --- REST API ------------------------------------------------------------
app.use(
  '/api',
  createApiRouter({ config, tokenStore, alertEngine, scannerEngine, startedAt })
);

// --- Static frontend -------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// 404 for unmatched API routes; everything else falls through to index.html
// for a simple single-page dashboard.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Final error handler - never leak internals to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log.error('unhandled express error', err && err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = http.createServer(app);

const ws = setupWebSocketServer({
  httpServer,
  path: '/ws',
  tokenStore,
  getStatus: () => scannerEngine.getStatus(),
  getPresets: () => BUILTIN_PRESETS,
});

scannerEngine.on('update', (payload) => ws.broadcast({ type: 'update', ...payload, ts: Date.now() }));
scannerEngine.on('remove', (payload) => ws.broadcast({ type: 'remove', ...payload, ts: Date.now() }));
scannerEngine.on('status', (status) => ws.broadcast({ type: 'status', status, ts: Date.now() }));
alertEngine.on('alert', (alert) => ws.broadcast({ type: 'alert', alert, ts: Date.now() }));

async function main() {
  try {
    await scannerEngine.start();
  } catch (err) {
    log.error('failed to start scanner engine', err);
  }

  httpServer.listen(config.port, () => {
    log.info(`FOMO Scanner listening on http://localhost:${config.port}`);
    log.info(`WebSocket endpoint at ws://localhost:${config.port}/ws`);
    log.info(`Active data mode: ${scannerEngine.getStatus().mode}`);
  });
}

main();

// --- Graceful shutdown -----------------------------------------------------
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`received ${signal}, shutting down gracefully...`);

  scannerEngine.stop();
  ws.shutdown();

  httpServer.close(() => {
    log.info('HTTP server closed. Bye.');
    process.exit(0);
  });

  // Force-exit if something hangs.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
process.on('uncaughtException', (err) => log.error('uncaughtException', err));

module.exports = { app, httpServer };
