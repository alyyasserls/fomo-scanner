const FIELDS = [
  { key: 'minLiquidity', label: 'Min Liquidity', type: 'number', prefix: '$' },
  { key: 'min5mVolume', label: 'Min 5m Volume', type: 'number', prefix: '$' },
  { key: 'min1hVolume', label: 'Min 1h Volume', type: 'number', prefix: '$' },
  { key: 'minMarketCap', label: 'Min Market Cap', type: 'number', prefix: '$' },
  { key: 'maxMarketCap', label: 'Max Market Cap', type: 'number', prefix: '$' },
  { key: 'min5mChange', label: 'Min 5m Change %', type: 'number', prefix: '' },
  { key: 'minVolumeMultiplier', label: 'Min Volume ×', type: 'number', prefix: '' },
  { key: 'minFomoScore', label: 'Min FOMO Score', type: 'number', prefix: '' },
  { key: 'maxTokenAgeHours', label: 'Max Token Age (h)', type: 'number', prefix: '' },
  { key: 'minBuySellRatio', label: 'Min Buy/Sell Ratio', type: 'number', prefix: '' },
];

function fieldRowHtml(field, value) {
  return `
    <label class="filter-field" data-key="${field.key}">
      <span>${field.label}</span>
      <input type="number" step="any" inputmode="decimal" value="${value ?? ''}" placeholder="off" />
    </label>
  `;
}

export function initFilterPanel(container, { filters, presets, chains, onChange, onPresetSelect, onSavePreset, onDeletePreset, onReset }) {
  container.innerHTML = `
    <div class="panel-section">
      <h3>Presets</h3>
      <div class="preset-row" id="presetRow"></div>
      <button type="button" class="btn-ghost" id="savePresetBtn">+ Save current filters as preset</button>
    </div>
    <div class="panel-section">
      <h3>Chain</h3>
      <select id="chainSelect"></select>
    </div>
    <div class="panel-section">
      <h3>Filters</h3>
      <div class="filter-grid" id="filterGrid"></div>
      <button type="button" class="btn-ghost" id="resetFiltersBtn">Reset to defaults</button>
    </div>
  `;

  const chainSelect = container.querySelector('#chainSelect');
  chainSelect.innerHTML = chains.map((c) => `<option value="${c}">${c[0].toUpperCase()}${c.slice(1)}</option>`).join('');
  chainSelect.value = filters.chain || chains[0];
  chainSelect.addEventListener('change', () => onChange('chain', chainSelect.value));

  const grid = container.querySelector('#filterGrid');
  grid.innerHTML = FIELDS.map((f) => fieldRowHtml(f, filters[f.key])).join('');
  grid.querySelectorAll('.filter-field').forEach((el) => {
    const key = el.dataset.key;
    const input = el.querySelector('input');
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      onChange(key, raw === '' ? null : Number(raw));
    });
  });

  container.querySelector('#resetFiltersBtn').addEventListener('click', () => onReset());

  container.querySelector('#savePresetBtn').addEventListener('click', () => {
    const name = window.prompt('Preset name?');
    if (name && name.trim()) onSavePreset(name.trim());
  });

  function renderPresets(list) {
    const row = container.querySelector('#presetRow');
    row.innerHTML = list
      .map(
        (p) => `
        <button type="button" class="preset-chip" data-id="${p.id}">
          ${p.name}
          ${p.builtin ? '' : '<span class="preset-del" data-del="' + p.id + '">×</span>'}
        </button>`
      )
      .join('');
    row.querySelectorAll('.preset-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.dataset.del) {
          e.stopPropagation();
          onDeletePreset(e.target.dataset.del);
          return;
        }
        onPresetSelect(list.find((p) => p.id === btn.dataset.id));
      });
    });
  }

  renderPresets(presets);

  return {
    refreshPresets: renderPresets,
    syncValues: (nextFilters) => {
      chainSelect.value = nextFilters.chain || chains[0];
      grid.querySelectorAll('.filter-field').forEach((el) => {
        const key = el.dataset.key;
        const input = el.querySelector('input');
        input.value = nextFilters[key] ?? '';
      });
    },
  };
}
