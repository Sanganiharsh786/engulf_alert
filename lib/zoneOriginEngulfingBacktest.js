// Zone Origin Engulfing Backtest
// Strategy: Only engulfing patterns at the STARTING POINT (origin/base)
// of a 4H Support/Resistance zone are valid.
//
// Key rule: An engulfing is ONLY valid if it forms at the 4H candle
// starting point where price touches the zone boundary. The 4H zone
// origin is defined by the 4H candle boundaries:
//   - 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 (IST timezone)
//
// Every time price returns to the level at a 4H starting candle,
// it is a new potential zone origin. Engulfings on non-4H-starting
// candles inside the zone are INVALID.
//
// Reuses existing engulfing detection and level-touch logic.

import { fetchOHLCV, fetchOHLCVRange, tfSeconds } from "./market.js";
import {
  detectEngulfing,
  candleTouchesAnyMode,
  closedCandles,
  toCandle,
  is4HStartingCandle,
} from "./engulfing.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function round(n, dp) {
  if (dp === undefined) dp = 4;
  if (n == null || isNaN(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function istParts(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return {
    time: d.toISOString().slice(0, 16).replace("T", " "),
    day: DOW[d.getUTCDay()],
  };
}

const MAX_BARS = 18000;

// Run the Zone Origin Engulfing backtest for a single pair.
export async function backtestPair(pair, settings, opts) {
  if (!opts) opts = {};
  const days = opts.days || 10;
  const bars = opts.bars;
  const from = opts.from;
  const to = opts.to;
  const rrRatio = opts.rrRatio;
  const debug = !!opts.debug;

  const tf = pair.timeframe || settings.timeframe || "15m";
  let raw;
  if (from && to) {
    raw = await fetchOHLCVRange(pair, tf, from, to);
  } else {
    const want = bars || Math.ceil((days * 86400) / tfSeconds(tf));
    const nBars = Math.min(MAX_BARS, Math.max(2, want));
    raw = await fetchOHLCV(pair, tf, nBars);
  }
  const rows = closedCandles(raw, tfSeconds(tf), Date.now());
  const modes =
    Array.isArray(settings.touchModes) && settings.touchModes.length
      ? settings.touchModes
      : [settings.touchMode || "range"];
  const rr =
    rrRatio !== undefined && rrRatio !== null
      ? Number(rrRatio)
      : Number((settings.risk && settings.risk.rewardRatio) || 2);
  const offset = Number(pair.levelOffset) || 0;
  const trades = [];
  const debugLog = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = toCandle(rows[i - 1]);
    const curr = toCandle(rows[i]);
    const direction = detectEngulfing(prev, curr);
    if (!direction) continue;

    for (const lvl of pair.levels) {
      const low = Math.min(lvl.low, lvl.high) + offset;
      const high = Math.max(lvl.low, lvl.high) + offset;
      if (!candleTouchesAnyMode(curr, low, high, modes)) continue;

      // === ZONE ORIGIN VALIDATION ===
      // The engulfing is ONLY valid if it occurs at a 4H candle starting point
      // at the zone boundary. Every touch of the level at a 4H start is a
      // potential new zone origin - we evaluate each independently.
      const is4HStart = is4HStartingCandle(curr.ts);
      let valid = false;
      let rejectReason = "";

      if (is4HStart) {
        valid = true;
        if (debug) {
          debugLog.push({
            ts: curr.ts,
            time: istParts(curr.ts).time,
            pair: pair.name,
            level: `${low}-${high}`,
            direction,
            valid: true,
            reason: "✓ 4H zone origin engulfing at Support/Resistance",
          });
        }
      } else {
        rejectReason = "✗ Not a 4H starting candle (engulfing inside zone, not at origin)";
        if (debug) {
          debugLog.push({
            ts: curr.ts,
            time: istParts(curr.ts).time,
            pair: pair.name,
            level: `${low}-${high}`,
            direction,
            valid: false,
            reason: rejectReason,
          });
        }
        continue; // Skip this trade - not at 4H zone origin
      }

      // === TRADE EXECUTION ===
      const entry = curr.close;
      const stop = direction === "bullish" ? curr.low : curr.high;
      const dist = Math.abs(entry - stop);
      if (dist <= 0) continue;
      const tp = direction === "bullish" ? entry + dist * rr : entry - dist * rr;

      // Walk forward to find which is hit first
      let outcome = "open";
      let barsHeld = 0;
      for (let j = i + 1; j < rows.length; j++) {
        const c = toCandle(rows[j]);
        barsHeld = j - i;
        if (direction === "bullish") {
          const slHit = c.low <= stop;
          const tpHit = c.high >= tp;
          if (slHit && tpHit) {
            outcome = "loss";
            break;
          }
          if (slHit) {
            outcome = "loss";
            break;
          }
          if (tpHit) {
            outcome = "win";
            break;
          }
        } else {
          const slHit = c.high >= stop;
          const tpHit = c.low <= tp;
          if (slHit && tpHit) {
            outcome = "loss";
            break;
          }
          if (slHit) {
            outcome = "loss";
            break;
          }
          if (tpHit) {
            outcome = "win";
            break;
          }
        }
      }

      const { time, day } = istParts(curr.ts);
      const r = outcome === "win" ? rr : outcome === "loss" ? -1 : 0;
      trades.push({
        pair: pair.name,
        ts: curr.ts,
        time,
        day,
        direction,
        strategy: "zone-origin",
        level: `${low}-${high}`,
        entry: round(entry),
        stop: round(stop),
        tp: round(tp),
        outcome,
        barsHeld: outcome === "open" ? "" : barsHeld,
        r: round(r, 2),
        // Chart-dialog metadata so the RR chart + TradingView link resolve.
        tvSymbol: pair.tradingview || (pair.exchange ? `${pair.exchange.toUpperCase()}:${pair.name}` : ""),
        tradingview: pair.tradingview,
        exchange: pair.exchange,
        market: pair.market,
      });
    }
  }

  const closed = trades.filter((t) => t.outcome !== "open");
  const wins = closed.filter((t) => t.outcome === "win").length;
  const losses = closed.filter((t) => t.outcome === "loss").length;
  const netR = round(
    closed.reduce((a, t) => a + t.r, 0),
    2
  );
  const summary = {
    pair: pair.name,
    market: pair.market || "",
    signals: trades.length,
    closed: closed.length,
    wins,
    losses,
    open: trades.length - closed.length,
    winRate: closed.length
      ? Math.round((wins / closed.length) * 1000) / 10
      : 0,
    netR,
    tf,
  };
  return { summary, trades, debugLog };
}

// Run the zone origin backtest across all pairs in the store
export async function runZoneOriginBacktest(store, opts = {}) {
  const summaries = [];
  const allTrades = [];
  const allDebug = [];
  for (const pair of store.pairs) {
    try {
      const result = await backtestPair(pair, store.settings, opts);
      summaries.push(result.summary);
      allTrades.push(...result.trades);
      allDebug.push(...result.debugLog);
    } catch (e) {
      summaries.push({
        pair: pair.name,
        error: String(e.message || e),
      });
    }
  }
  allTrades.sort((a, b) => (a.time < b.time ? 1 : -1));
  allDebug.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { ranAt: Date.now(), summaries, trades: allTrades, debug: allDebug };
}
