import { formatUsd, formatPrice, formatPct, formatMultiplier, formatRatio, pctClass } from './format.js';

const COLUMNS = [
  { key: 'fomoRank', label: '#', sortable: false },
  { key: 'token', label: 'Token', sortable: false },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'marketCap', label: 'Market Cap', sortable: true },
  { key: 'liquidity', label: 'Liquidity', sortable: true },
  { key: 'volume5m', label: '5m Volume', sortable: true },
  { key: 'volume1h', label: '1h Volume', sortable: true },
  { key: 'change5m', label: '5m Change', sortable: true },
  { key: 'change1h', label: '1h Change', sortable: true },
  { key: 'volumeAcceleration', label: 'Volume ×', sortable: true },
  { key: 'buySellRatio', label: 'Buy/Sell', sortable: false },
  { key: 'fomoScore', label: 'FOMO Score', sortable: true },
];

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sortTokens(tokens, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  const getVal = (t) => {
    switch (sortKey) {
      case 'price':
        return t.price ?? -Infinity;
      case 'marketCap':
        return t.marketCap ?? -Infinity;
      case 'liquidity':
        return t.liquidity ?? -Infinity;
      case 'volume5m':
        return t.volume?.m5 ?? -Infinity;
      case 'volume1h':
        return t.volume?.h1 ?? -Infinity;
      case 'change5m':
        return t.priceChange?.m5 ?? -Infinity;
      case 'change1h':
        return t.priceChange?.h1 ?? -Infinity;
      case 'volumeAcceleration':
        return t.volumeAcceleration ?? -Infinity;
      case 'fomoScore':
      default:
        return t.fomoScore ?? -Infinity;
    }
  };
  return [...tokens].sort((a, b) => (getVal(a) - getVal(b)) * dir);
}

export function renderTableHeader(theadEl, { sortKey, sortDir }, onSort) {
  theadEl.innerHTML = '';
  const tr = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.sortable) {
      th.classList.add('sortable');
      if (col.key === sortKey) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      th.addEventListener('click', () => onSort(col.key));
    }
    tr.appendChild(th);
  }
  theadEl.appendChild(tr);
}

function scoreClass(score) {
  if (score >= 90) return 'score-extreme';
  if (score >= 75) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

function rowHtml(token) {
  const accel = token.volumeAcceleration;
  const isSpike = Number.isFinite(accel) && accel >= 5;
  const symbol = escapeHtml(token.symbol);
  const name = escapeHtml(token.name);
  const dex = escapeHtml(token.dex);
  const buySell = Number.isFinite(token.buySellRatio)
    ? formatRatio(token.buySellRatio)
    : token.trades?.buys > 0 && !token.trades?.sells
      ? '∞'
      : '—';

  return `
    <td class="rank-cell">${token.fomoRank ?? '—'}</td>
    <td class="token-cell">
      <div class="token-name">${symbol}</div>
      <div class="token-sub">${name} · ${dex}</div>
    </td>
    <td class="mono">${formatPrice(token.price)}</td>
    <td class="mono">${formatUsd(token.marketCap)}</td>
    <td class="mono">${formatUsd(token.liquidity)}</td>
    <td class="mono">${formatUsd(token.volume?.m5)}</td>
    <td class="mono">${formatUsd(token.volume?.h1)}</td>
    <td class="mono ${pctClass(token.priceChange?.m5)}">${formatPct(token.priceChange?.m5)}</td>
    <td class="mono ${pctClass(token.priceChange?.h1)}">${formatPct(token.priceChange?.h1)}</td>
    <td class="mono ${isSpike ? 'volume-spike' : ''}">${formatMultiplier(accel)}</td>
    <td class="mono">${buySell}</td>
    <td><span class="score-pill ${scoreClass(token.fomoScore)}">${token.fomoScore ?? 0}</span></td>
  `;
}

export function renderTokenRows(tbodyEl, tokens, onRowClick) {
  const existing = new Map();
  for (const child of tbodyEl.children) existing.set(child.dataset.id, child);

  const seen = new Set();
  tokens.forEach((token, index) => {
    seen.add(token.id);
    let tr = existing.get(token.id);
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.id = token.id;
      tr.addEventListener('click', () => onRowClick(token.id));
    }
    tr.className = Number.isFinite(token.volumeAcceleration) && token.volumeAcceleration >= 8 ? 'row-extreme' : '';
    tr.innerHTML = rowHtml(token);
    tbodyEl.appendChild(tr); // appendChild on an existing child reorders it
    void index;
  });

  for (const [id, el] of existing) {
    if (!seen.has(id)) el.remove();
  }

  if (!tokens.length) {
    tbodyEl.innerHTML = `<tr class="empty-row"><td colspan="${COLUMNS.length}">No tokens match the current filters yet.</td></tr>`;
  }
}
