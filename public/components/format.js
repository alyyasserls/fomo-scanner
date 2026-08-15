// Shared display-formatting helpers for the dashboard (mirrors the
// server-side rules in server/utils/format.js, kept separate since the
// browser and server are different runtimes with no shared bundle step).

export function formatUsd(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatPrice(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function formatMultiplier(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NEW';
  return `${n.toFixed(1)}x`;
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatRatio(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

export function pctClass(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'neutral';
  if (n > 0.05) return 'positive';
  if (n < -0.05) return 'negative';
  return 'neutral';
}
