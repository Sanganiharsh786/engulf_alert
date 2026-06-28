// Market-data fetching.
//
// Binance's main API (api.binance.com / fapi.binance.com) returns HTTP 451
// "restricted location" for US / cloud IPs — which is where Vercel and most
// CI runners live. Binance also publishes a PUBLIC market-data mirror at
// data-api.binance.vision that is NOT geo-blocked, so we use that for any
// "binance" pair. Other exchanges still go through ccxt.

import ccxt from "ccxt";

const TF_SECONDS = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800,
  "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800,
};

export function tfSeconds(tf) {
  return TF_SECONDS[tf] || 900;
}

// "BTC/USDT:USDT" or "BTC/USDT" -> "BTCUSDT"
function toBinanceSymbol(symbol) {
  return symbol.replace(/:.*/, "").replace(/\//g, "").toUpperCase();
}

// Binance public market-data mirror — works from cloud/US IPs (no 451).
async function fetchBinanceVision(symbol, tf, limit) {
  const s = toBinanceSymbol(symbol);
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`binance.vision ${s} ${res.status} ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  // kline row: [openTime, open, high, low, close, volume, ...]
  return data.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
}

const ccxtCache = {};
function getCcxt(id) {
  if (!ccxtCache[id]) ccxtCache[id] = new ccxt[id]({ enableRateLimit: true });
  return ccxtCache[id];
}

// Unified OHLCV fetch. Returns rows as [ts, open, high, low, close, volume].
export async function fetchOHLCV(pair, tf, limit = 60) {
  if (pair.exchange === "binance") {
    return fetchBinanceVision(pair.symbol, tf, limit);
  }
  const ex = getCcxt(pair.exchange);
  return ex.fetchOHLCV(pair.symbol, tf, undefined, limit);
}
