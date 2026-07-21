// FVG data provider for PAX Gold (PAXG/USDT) via Binance.
//
// Replaces the old forex (XAU/USD, GBP/USD via Twelve Data) source. PAXG is a
// gold-pegged token, so 4H FVG alerts track gold priced in USDT on Binance.
//
// Uses the public Binance market-data mirror (data-api.binance.vision) via
// lib/market.js — NOT geo-blocked on Vercel/US cloud IPs, and needs no API key.

import { fetchOHLCV } from "./market.js";

// The single pair the FVG dashboard/alerts watch. Keep this the source of truth
// so routes and UI stay in sync.
export const FVG_PAIRS = [
  {
    name: "PAXG/USDT",
    display: "PAX Gold",
    symbol: "PAXG/USDT",
    exchange: "binance",
    tvSymbol: "BINANCE:PAXGUSDT",
  },
];

export const FVG_PAIR_NAMES = FVG_PAIRS.map((p) => p.name);

// Fetch OHLCV for every FVG pair. Mirrors the old fetchTwelveData interface:
// returns { results: { [pairName]: rows[] }, errors: { [pairName]: msg } }
// where rows are [ts_ms, open, high, low, close, volume], oldest first.
export async function fetchFvgData(tf = "4h", count = 100) {
  const results = {};
  const errors = {};

  await Promise.all(
    FVG_PAIRS.map(async (p) => {
      try {
        const rows = await fetchOHLCV({ exchange: p.exchange, symbol: p.symbol }, tf, count);
        if (!Array.isArray(rows) || rows.length === 0) {
          errors[p.name] = "No values returned";
          return;
        }
        // Binance klines are ascending already; ensure oldest-first regardless.
        results[p.name] = rows.slice().sort((a, b) => a[0] - b[0]);
      } catch (e) {
        errors[p.name] = String(e.message || e);
      }
    })
  );

  return { results, errors };
}

// Back-compat alias (old code called fetchAllPairs).
export async function fetchFvgAllPairs(tf = "4h", count = 100) {
  return fetchFvgData(tf, count);
}

// Health check for the FVG data source (used by /api/preflight, /api/check-fvg).
export async function testFvgConnection() {
  try {
    const { results, errors } = await fetchFvgData("1h", 2);
    const worked = Object.keys(results).length;
    const failed = Object.keys(errors).length;
    const first = FVG_PAIR_NAMES.find((n) => results[n]);
    return {
      ok: worked > 0,
      source: "Binance (PAXG)",
      pairs: Object.keys(results),
      sample: first
        ? { ts: results[first][0][0], open: results[first][0][1], close: results[first][0][4] }
        : null,
      worked,
      failed,
      errors: failed > 0 ? errors : undefined,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), source: "Binance (PAXG)" };
  }
}
