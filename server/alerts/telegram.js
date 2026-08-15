'use strict';

const { createLogger } = require('../utils/logger');
const { formatUsdCompact, formatPrice, formatPct, formatMultiplier } = require('../utils/format');

const log = createLogger('alerts:telegram');

const SEVERITY_META = {
  NORMAL: { emoji: '🚨', label: 'VOLUME SPIKE' },
  HIGH: { emoji: '⚠️', label: 'HIGH VOLUME SPIKE' },
  EXTREME: { emoji: '🔥🔥🔥', label: 'EXTREME VOLUME SPIKE' },
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Formats the Telegram alert message body (HTML parse mode). */
function formatAlertMessage(token, severity) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.NORMAL;
  const name = escapeHtml(token.name);
  const symbol = escapeHtml(token.symbol);
  const dex = escapeHtml(token.dex);
  const chain = escapeHtml(token.chain);

  const lines = [
    `${meta.emoji} <b>${meta.label}</b>`,
    '',
    `🪙 <b>${name}</b> (${symbol})`,
    `Price: ${formatPrice(token.price)}`,
    '',
    `📊 5m Volume: ${formatUsdCompact(token.volume?.m5)}`,
    `📈 1h Volume: ${formatUsdCompact(token.volume?.h1)}`,
    `🔥 Volume: ${formatMultiplier(token.volumeAcceleration)}`,
    `💧 Liquidity: ${formatUsdCompact(token.liquidity)}`,
    `📈 5m: ${formatPct(token.priceChange?.m5)}`,
    `📈 1h: ${formatPct(token.priceChange?.h1)}`,
    `🏆 FOMO Score: ${token.fomoScore}`,
    '',
    `Chain: ${chain}`,
    `DEX: ${dex}`,
  ];
  return lines.join('\n');
}

/**
 * Sends a Telegram alert. Never throws - logs and returns { ok: false }
 * on any failure so a Telegram outage can never take down the scanner.
 * No-ops (with a one-time warning) if credentials are not configured.
 */
async function sendTelegramAlert(token, severity, telegramConfig, fetchImpl = fetch) {
  const { botToken, chatId } = telegramConfig || {};
  if (!botToken || !chatId) {
    log.warn('Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing) - skipping alert send.');
    return { ok: false, reason: 'not_configured' };
  }

  const text = formatAlertMessage(token, severity);
  const replyMarkup = token.url
    ? { inline_keyboard: [[{ text: 'VIEW TOKEN', url: token.url }]] }
    : undefined;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      log.error(`Telegram API error ${res.status}: ${errText}`);
      return { ok: false, reason: 'telegram_error', status: res.status };
    }
    return { ok: true };
  } catch (err) {
    log.error('failed to send Telegram alert', err.message);
    return { ok: false, reason: 'network_error' };
  }
}

module.exports = { sendTelegramAlert, formatAlertMessage, SEVERITY_META };
