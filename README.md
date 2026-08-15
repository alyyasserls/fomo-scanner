# SURGE — Live Crypto Volume Scanner

Monitoring-only crypto volume scanner: FOMO-style dashboard, 0-100 momentum
score, Telegram alerts. No trading, no wallet, ever.

## Run it locally

1. Install Node.js from nodejs.org (LTS version)
2. In this folder, run: npm install
3. Copy .env.example to a new file named .env
4. Run: npm start
5. Open http://localhost:3000

Works immediately with zero API keys (uses free public market data via
polling). Add a Mobula API key in .env for a live push WebSocket feed
instead. Add TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env to enable
Telegram alerts.
