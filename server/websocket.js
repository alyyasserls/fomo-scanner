'use strict';

const WebSocket = require('ws');
const { createLogger } = require('./utils/logger');

const log = createLogger('websocket');
const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Single backend WebSocket endpoint (default path /ws) that all connected
 * dashboards share - there is exactly one upstream provider connection
 * (see providers/index.js) feeding many downstream browser clients, never
 * a socket per token or per client-to-provider passthrough.
 *
 * Handles: initial snapshot on connect, ping/pong heartbeat with dead-peer
 * detection, safe broadcast (a slow/broken client can't take down the
 * others), and graceful shutdown.
 */
function setupWebSocketServer({ httpServer, path, tokenStore, getStatus, getPresets }) {
  const wss = new WebSocket.Server({ server: httpServer, path });

  function safeSend(ws, obj) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (err) {
      log.warn('send failed', err.message);
    }
  }

  function broadcast(obj) {
    if (!wss.clients.size) return;
    const payload = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          log.warn('broadcast send failed', err.message);
        }
      }
    }
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    log.info(`client connected (${wss.clients.size} total)`, req.socket.remoteAddress);

    safeSend(ws, {
      type: 'snapshot',
      tokens: tokenStore.getAll(),
      status: getStatus(),
      ts: Date.now(),
    });
    safeSend(ws, { type: 'presets', presets: getPresets() });

    ws.on('message', (raw) => {
      // Validate every inbound frame - never trust client input.
      if (raw.length > 4096) return; // reject oversized frames outright
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'ping') {
        safeSend(ws, { type: 'pong', ts: Date.now() });
      }
      // Additional client->server message types can be added here with the
      // same validate-then-handle pattern (e.g. subscribing to a filtered
      // view server-side once token counts grow large enough to warrant it).
    });

    ws.on('error', (err) => log.warn('client socket error', err.message));
    ws.on('close', () => log.info(`client disconnected (${wss.clients.size} total)`));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  function shutdown() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
    }
    wss.close();
  }

  return { broadcast, shutdown, wss };
}

module.exports = { setupWebSocketServer };
