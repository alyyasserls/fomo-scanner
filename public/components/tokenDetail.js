import { formatUsd, formatPrice, formatPct, formatMultiplier, formatAge, formatRatio } from './format.js';
import { drawLineChart } from './charts.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function statHtml(label, value, extraClass = '') {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${extraClass}">${value}</span></div>`;
}

export function renderTokenDetail(container, token, history, onClose) {
  container.hidden = false;
  container.innerHTML = `
    <div class="detail-backdrop"></div>
    <div class="detail-card">
      <button type="button" class="detail-close" aria-label="Close">×</button>
      <div class="detail-header">
        <div>
          <div class="detail-title">${escapeHtml(token.name)} <span class="detail-symbol">${escapeHtml(token.symbol)}</span></div>
          <div class="detail-sub">${escapeHtml(token.chain)} · ${escapeHtml(token.dex)}</div>
        </div>
        <span class="score-pill score-${token.fomoScore >= 90 ? 'extreme' : token.fomoScore >= 75 ? 'high' : token.fomoScore >= 50 ? 'mid' : 'low'}">${token.fomoScore}</span>
      </div>

      <div class="detail-stats-grid">
        ${statHtml('Price', formatPrice(token.price))}
        ${statHtml('Market Cap', formatUsd(token.marketCap))}
        ${statHtml('Liquidity', formatUsd(token.liquidity))}
        ${statHtml('5m Volume', formatUsd(token.volume?.m5))}
        ${statHtml('1h Volume', formatUsd(token.volume?.h1))}
        ${statHtml('24h Volume', formatUsd(token.volume?.h24))}
        ${statHtml('Volume Acceleration', formatMultiplier(token.volumeAcceleration))}
        ${statHtml('Volume/Liquidity', token.volumeToLiquidity != null ? token.volumeToLiquidity.toFixed(3) : '—')}
        ${statHtml('5m Change', formatPct(token.priceChange?.m5))}
        ${statHtml('1h Change', formatPct(token.priceChange?.h1))}
        ${statHtml('Buy/Sell Ratio', formatRatio(token.buySellRatio))}
        ${statHtml('Token Age', formatAge(token.tokenAgeSeconds))}
      </div>

      <div class="detail-charts">
        <div class="chart-block">
          <h4>Price</h4>
          <canvas id="priceChart" class="chart-canvas"></canvas>
        </div>
        <div class="chart-block">
          <h4>5m Volume</h4>
          <canvas id="volumeChart" class="chart-canvas"></canvas>
        </div>
      </div>

      <div class="detail-footer">
        <div class="detail-address" title="${escapeHtml(token.mintAddress)}">Contract: ${escapeHtml(token.mintAddress)}</div>
        ${token.url ? `<a class="btn-primary" href="${token.url}" target="_blank" rel="noopener noreferrer">View Token ↗</a>` : ''}
      </div>
    </div>
  `;

  container.querySelector('.detail-close').addEventListener('click', onClose);
  container.querySelector('.detail-backdrop').addEventListener('click', onClose);

  const priceCanvas = container.querySelector('#priceChart');
  const volumeCanvas = container.querySelector('#volumeChart');
  drawLineChart(priceCanvas, history?.price || [], { color: '#22d3a5', fillColor: 'rgba(34,211,165,0.12)' });
  drawLineChart(volumeCanvas, history?.volume5m || [], { color: '#60a5fa', fillColor: 'rgba(96,165,250,0.12)' });
}

export function hideTokenDetail(container) {
  container.hidden = true;
  container.innerHTML = '';
}
