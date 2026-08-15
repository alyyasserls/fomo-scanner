import { initFilterPanel } from './components/filterPanel.js';
import { renderTableHeader, renderTokenRows, sortTokens } from './components/tokenTable.js';
import { renderTokenDetail, hideTokenDetail } from './components/tokenDetail.js';
import { formatUsd, formatPrice, formatPct, timeAgo } from './components/format.js';

const CHAINS = ['solana'];

const DEFAULT_FILTERS = {
  chain: 'solana',
  minLiquidity: 50000,
  min5mVolume: 10000,
  min1hVolume: 50000,
  minMarketCap: null,
  maxMarketCap: null,
  min5mChange: null,
  minVolumeMultiplier: 3,
  minFomoScore: null,
  maxTokenAgeHours: null,
  minBuySellRatio: null,
};

// Base used when applying a preset: presets are self-contained filter sets,
// so every filter not mentioned by the preset must be OFF (null) rather
// than silently inheriting the dashboard's default thresholds - otherwise
// a leftover default like minVolumeMultiplier could hide tokens a preset
// was explicitly designed to surface.
const EMPTY_FILTERS = Object.fromEntries(
  Object.keys(DEFAULT_FILTERS).map((key) => [key, key === 'chain' ? DEFAULT_FILTERS.chain : null])
);

const state = {
  tokens: new Map(),
  filters: { ...DEFAULT_FILTERS },
  sortKey: 'fomoScore',
  sortDir: 'desc',
  presets: [],
  selectedTokenId: null,
  status: { mode: 'DISCONNECTED', connected: false, monitoredCount: 0, lastUpdateAt: null },
};

const el = {
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  modeBadge: document.getElementById('modeBadge'),
  modeChip: document.getElementById('modeChip'),
  lastUpdate: document.getElementById('lastUpdate'),
  tokenCount: document.getElementById('tokenCount'),
  visibleCount: document.getElementById('visibleCount'),
  filtersPanel: document.getElementById('filtersPanel'),
  tableHead: document.getElementById('tokenTableHead'),
  tableBody: document.getElementById('tokenTableBody'),
  alertsFeed: document.getElementById('alertsFeed'),
  detailPanel: document.getElementById('detailPanel'),
};

// ---------------------------------------------------------------------------
// Filtering / rendering
// ---------------------------------------------------------------------------

function passesFilters(t, f) {
  if (f.chain && t.chain !== f.chain) return false;
  if (f.minLiquidity != null && !(t.liquidity >= f.minLiquidity)) return false;
  if (f.min5mVolume != null && !(t.volume?.m5 >= f.min5mVolume)) return false;
  if (f.min1hVolume != null && !(t.volume?.h1 >= f.min1hVolume)) return false;
  if (f.minMarketCap != null && !(t.marketCap >= f.minMarketCap)) return false;
  if (f.maxMarketCap != null && !(t.marketCap <= f.maxMarketCap)) return false;
  if (f.min5mChange != null && !(t.priceChange?.m5 >= f.min5mChange)) return false;
  if (f.minVolumeMultiplier != null) {
    if (t.volumeAcceleration == null || !(t.volumeAcceleration >= f.minVolumeMultiplier)) return false;
  }
  if (f.minFomoScore != null && !(t.fomoScore >= f.minFomoScore)) return false;
  if (f.maxTokenAgeHours != null) {
    if (t.tokenAgeSeconds == null || !(t.tokenAgeSeconds / 3600 <= f.maxTokenAgeHours)) return false;
  }
  if (f.minBuySellRatio != null) {
    if (t.buySellRatio == null || !(t.buySellRatio >= f.minBuySellRatio)) return false;
  }
  return true;
}

function renderTable() {
  const all = Array.from(state.tokens.values());
  const filtered = all.filter((t) => passesFilters(t, state.filters));
  const sorted = sortTokens(filtered, state.sortKey, state.sortDir);
  renderTableHeader(el.tableHead, { sortKey: state.sortKey, sortDir: state.sortDir }, onSort);
  renderTokenRows(el.tableBody, sorted, onRowClick);
  el.visibleCount.textContent = `(${sorted.length} of ${all.length})`;
}

function onSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = 'desc';
  }
  renderTable();
}

function onRowClick(id) {
  openDetail(id);
}

function renderStatus() {
  const { connected, mode, monitoredCount, lastUpdateAt } = state.status;
  el.connDot.className = 'conn-dot' + (connected ? ' online' : ' offline');
  el.connText.textContent = connected ? 'Connected' : 'Disconnected';

  el.modeBadge.textContent = mode === 'LIVE_WEBSOCKET' ? 'LIVE WEBSOCKET' : mode === 'POLLING_FALLBACK' ? 'POLLING FALLBACK' : mode;
  el.modeChip.className = 'status-chip mode-chip ' + (mode === 'LIVE_WEBSOCKET' ? 'mode-live' : mode === 'POLLING_FALLBACK' ? 'mode-poll' : '');

  el.tokenCount.textContent = `${monitoredCount} tokens`;
  el.lastUpdate.textContent = lastUpdateAt ? timeAgo(lastUpdateAt) : '—';
}

setInterval(() => {
  if (state.status.lastUpdateAt) el.lastUpdate.textContent = timeAgo(state.status.lastUpdateAt);
}, 5000);

// ---------------------------------------------------------------------------
// Alerts feed
// ---------------------------------------------------------------------------

function renderAlert(alert) {
  if (el.alertsFeed.querySelector('.alerts-empty')) el.alertsFeed.innerHTML = '';
  const item = document.createElement('div');
  item.className = `alert-item severity-${alert.severity.toLowerCase()}`;
  item.innerHTML = `
    <div class="alert-top">
      <span class="alert-symbol">${escapeHtml(alert.symbol)}</span>
      <span class="alert-severity">${alert.severity}</span>
    </div>
    <div class="alert-meta">
      Score ${alert.fomoScore} · ${formatUsd(alert.volume5m)} 5m vol · ${formatPrice(alert.price)}
    </div>
    <div class="alert-time">${timeAgo(alert.sentAt)}</div>
  `;
  el.alertsFeed.prepend(item);
  while (el.alertsFeed.children.length > 40) el.alertsFeed.removeChild(el.alertsFeed.lastChild);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Token detail panel
// ---------------------------------------------------------------------------

async function openDetail(id) {
  state.selectedTokenId = id;
  const token = state.tokens.get(id);
  if (!token) return;
  let history = { price: [], volume5m: [] };
  try {
    const res = await fetch(`/api/tokens/${encodeURIComponent(id)}/history`);
    if (res.ok) history = await res.json();
  } catch {
    // network hiccup - render with empty history rather than failing the panel
  }
  renderTokenDetail(el.detailPanel, token, history, closeDetail);
}

function closeDetail() {
  state.selectedTokenId = null;
  hideTokenDetail(el.detailPanel);
}

function refreshOpenDetailIfNeeded(changedIds) {
  if (!state.selectedTokenId || !changedIds.includes(state.selectedTokenId)) return;
  const token = state.tokens.get(state.selectedTokenId);
  if (!token) return;
  // Cheap re-render using the last-fetched chart data still in the DOM canvases;
  // simplest correct approach is just re-opening the panel (history refetch is
  // small JSON and this only happens for the currently-open token).
  openDetail(state.selectedTokenId);
}

// ---------------------------------------------------------------------------
// Filter panel + presets
// ---------------------------------------------------------------------------

let filterPanelHandle = null;

function onFilterChange(key, value) {
  state.filters = { ...state.filters, [key]: value };
  renderTable();
}

function onFilterReset() {
  state.filters = { ...DEFAULT_FILTERS };
  filterPanelHandle.syncValues(state.filters);
  renderTable();
}

function onPresetSelect(preset) {
  if (!preset) return;
  state.filters = { ...EMPTY_FILTERS, ...preset.filters };
  filterPanelHandle.syncValues(state.filters);
  renderTable();
}

async function onSavePreset(name) {
  try {
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: state.filters }),
    });
    if (res.ok) await loadPresets();
  } catch {
    // ignore - preset saving is a non-critical convenience feature
  }
}

async function onDeletePreset(id) {
  try {
    await fetch(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadPresets();
  } catch {
    // ignore
  }
}

async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    if (!res.ok) return;
    const body = await res.json();
    state.presets = body.presets || [];
    if (filterPanelHandle) filterPanelHandle.refreshPresets(state.presets);
  } catch {
    // ignore - presets are supplementary; built-ins already arrive over WS
  }
}

function initFilters() {
  filterPanelHandle = initFilterPanel(el.filtersPanel, {
    filters: state.filters,
    presets: state.presets,
    chains: CHAINS,
    onChange: onFilterChange,
    onPresetSelect,
    onSavePreset,
    onDeletePreset,
    onReset: onFilterReset,
  });
}

// ---------------------------------------------------------------------------
// WebSocket connection: reconnect w/ backoff, heartbeat, message handling
// ---------------------------------------------------------------------------

let ws = null;
let reconnectDelay = 1000;
let pingTimer = null;
let pongTimeout = null;

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function connect() {
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    startHeartbeat();
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    state.status = { ...state.status, connected: false };
    renderStatus();
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  });
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function startHeartbeat() {
  stopHeartbeat();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
      clearTimeout(pongTimeout);
      pongTimeout = setTimeout(() => {
        // No pong within window - treat the connection as dead and force a reconnect.
        try {
          ws.close();
        } catch {
          // ignore
        }
      }, 10000);
    }
  }, 20000);
}

function stopHeartbeat() {
  clearInterval(pingTimer);
  clearTimeout(pongTimeout);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'snapshot': {
      state.tokens = new Map(msg.tokens.map((t) => [t.id, t]));
      state.status = { ...state.status, ...msg.status, connected: true };
      renderStatus();
      renderTable();
      break;
    }
    case 'update': {
      const changedIds = [];
      for (const t of msg.tokens) {
        state.tokens.set(t.id, t);
        changedIds.push(t.id);
      }
      state.status = { ...state.status, connected: true, monitoredCount: msg.monitoredCount, lastUpdateAt: msg.ts };
      renderStatus();
      renderTable();
      refreshOpenDetailIfNeeded(changedIds);
      break;
    }
    case 'remove': {
      for (const id of msg.ids) state.tokens.delete(id);
      if (state.selectedTokenId && msg.ids.includes(state.selectedTokenId)) closeDetail();
      renderTable();
      break;
    }
    case 'status': {
      state.status = { ...state.status, ...msg.status, connected: true };
      renderStatus();
      break;
    }
    case 'presets': {
      state.presets = msg.presets || [];
      if (filterPanelHandle) filterPanelHandle.refreshPresets(state.presets);
      break;
    }
    case 'alert': {
      renderAlert(msg.alert);
      break;
    }
    case 'pong': {
      clearTimeout(pongTimeout);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initFilters();
renderStatus();
renderTable();
loadPresets();
connect();
