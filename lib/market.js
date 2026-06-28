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

const VISION = "https://data-api.binance.vision/api/v3/klines";

// one request (Binance caps limit at 1000 per call)
async function visionBatch(s, tf, batch, endTime) {
  let url = `${VISION}?symbol=${s}&interval=${tf}&limit=${batch}`;
  if (endTime) url += `&endTime=${endTime}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`binance.vision ${s} ${res.status} ${body.slice(0, 120)}`);
  }
  return res.json();
}

// Binance public market-data mirror — works from cloud/US IPs (no 451).
// Paginates backwards when more than 1000 candles are requested.
async function fetchBinanceVision(symbol, tf, limit) {
  const s = toBinanceSymbol(symbol);

  if (limit <= 1000) {
    const data = await visionBatch(s, tf, limit);
    return data.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
  }

  let remaining = limit;
  let endTime; // undefined = most recent
  let all = [];
  // hard stop so a bad config can't loop forever
  for (let guard = 0; guard < 60 && remaining > 0; guard++) {
    const batch = Math.min(1000, remaining);
    const data = await visionBatch(s, tf, batch, endTime);
    if (!data.length) break;
    all = data.concat(all); // prepend older candles
    endTime = data[0][0] - 1; // step back before the oldest candle
    remaining -= data.length;
    if (data.length < batch) break; // reached start of available history
  }
  return all.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
}

// Fetch a specific historical window [startMs, endMs] by paging forward.
async function fetchBinanceVisionRange(s, tf, startMs, endMs) {
  let all = [];
  let start = startMs;
  for (let guard = 0; guard < 400 && start < endMs; guard++) {
    let url = `${VISION}?symbol=${s}&interval=${tf}&limit=1000&startTime=${start}&endTime=${endMs}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`binance.vision ${s} ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    if (!data.length) break;
    all = all.concat(data);
    start = data[data.length - 1][0] + 1; // step past the newest candle
    if (data.length < 1000) break; // reached the end of the window
  }
  return all.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
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

// Fetch a specific historical window [startMs, endMs].
export async function fetchOHLCVRange(pair, tf, startMs, endMs) {
  if (pair.exchange === "binance") {
    return fetchBinanceVisionRange(toBinanceSymbol(pair.symbol), tf, startMs, endMs);
  }
  // ccxt fallback: page forward from `since`
  const ex = getCcxt(pair.exchange);
  const step = tfSeconds(tf) * 1000;
  let since = startMs;
  let all = [];
  for (let guard = 0; guard < 400 && since < endMs; guard++) {
    const batch = await ex.fetchOHLCV(pair.symbol, tf, since, 1000);
    if (!batch.length) break;
    all = all.concat(batch.filter((r) => r[0] <= endMs));
    since = batch[batch.length - 1][0] + step;
    if (batch.length < 1000) break;
  }
  return all;
}
