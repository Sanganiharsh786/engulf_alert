// Liquidity Sweep backtest.
// Replays: engulfing candle AT a watched level -> stop beyond the nearest swing
// pivot -> target the next opposite swing liquidity. Reward:risk is dynamic
// (measured to the liquidity target), unlike the fixed-RR engulfing backtest.
//
// Mirrors the structure of zoneOriginEngulfingBacktest.js so the results page,
// trade table, and chart dialog all work unchanged.

import { fetchOHLCV, fetchOHLCVRange, tfSeconds } from "./market.js";
import {
  detectEngulfing,
  candleTouchesAnyMode,
  closedCandles,
  toCandle,
} from "./engulfing.js";
import { buildSweepPlan, sweepConfig } from "./liquiditySweep.js";

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

export async function backtestPair(pair, settings, opts) {
  if (!opts) opts = {};
  const days = opts.days || 10;
  const bars = opts.bars;
  const from = opts.from;
  const to = opts.to;
  const debug = !!opts.debug;
  const minRr = opts.minRr != null ? Number(opts.minRr) : 0; // optional RR floor

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
  const cfg = sweepConfig(settings);
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

      // Build the swing-stop / liquidity-target plan. Skips the signal when no
      // structural swing stop or opposite-side liquidity exists.
      const plan = buildSweepPlan(rows, i, direction, cfg);
      if (!plan) {
        if (debug) {
          debugLog.push({
            ts: curr.ts,
            time: istParts(curr.ts).time,
            pair: pair.name,
            level: `${round(low)}-${round(high)}`,
            direction,
            valid: false,
            reason: "✗ No swing stop or next-liquidity target within lookback",
          });
        }
        continue;
      }

      const { entry, stop, tp, rr } = plan;
      if (minRr > 0 && rr < minRr) {
        if (debug) {
          debugLog.push({
            ts: curr.ts,
            time: istParts(curr.ts).time,
            pair: pair.name,
            level: `${round(low)}-${round(high)}`,
            direction,
            valid: false,
            reason: `✗ RR ${round(rr, 2)} below minimum ${minRr}`,
          });
        }
        continue;
      }

      if (debug) {
        debugLog.push({
          ts: curr.ts,
          time: istParts(curr.ts).time,
          pair: pair.name,
          level: `${round(low)}-${round(high)}`,
          direction,
          valid: true,
          reason: `✓ Engulfing at level · stop @ ${round(stop)} · liquidity @ ${round(tp)} · ${round(rr, 2)}R`,
        });
      }

      // Walk forward to see which is hit first (worst-case on same-bar tie).
      let outcome = "open";
      let barsHeld = 0;
      for (let j = i + 1; j < rows.length; j++) {
        const c = toCandle(rows[j]);
        barsHeld = j - i;
        if (direction === "bullish") {
          const slHit = c.low <= stop;
          const tpHit = c.high >= tp;
          if (slHit) { outcome = "loss"; break; }
          if (tpHit) { outcome = "win"; break; }
        } else {
          const slHit = c.high >= stop;
          const tpHit = c.low <= tp;
          if (slHit) { outcome = "loss"; break; }
          if (tpHit) { outcome = "win"; break; }
        }
      }

      const { time, day } = istParts(curr.ts);
      // dynamic reward:risk — a win banks the measured RR, a loss is -1R.
      const r = outcome === "win" ? rr : outcome === "loss" ? -1 : 0;
      trades.push({
        pair: pair.name,
        ts: curr.ts,
        time,
        day,
        direction,
        strategy: "liquidity-sweep",
        level: `${round(low)}-${round(high)}`,
        entry: round(entry),
        stop: round(stop),
        tp: round(tp),
        rr: round(rr, 2),
        outcome,
        barsHeld: outcome === "open" ? "" : barsHeld,
        r: round(r, 2),
        // Chart-dialog metadata so the RR chart + TradingView link resolve.
        tvSymbol: pair.tradingview || (pair.exchange ? `${pair.exchange.toUpperCase()}:${pair.name}` : ""),
        tradingview: pair.tradingview,
        exchange: pair.exchange,
        market: pair.market,
        tf,
      });
    }
  }

  const closed = trades.filter((t) => t.outcome !== "open");
  const wins = closed.filter((t) => t.outcome === "win").length;
  const losses = closed.filter((t) => t.outcome === "loss").length;
  const netR = round(closed.reduce((a, t) => a + t.r, 0), 2);
  const summary = {
    pair: pair.name,
    market: pair.market || "",
    signals: trades.length,
    closed: closed.length,
    wins,
    losses,
    open: trades.length - closed.length,
    winRate: closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0,
    netR,
    tf,
  };
  return { summary, trades, debugLog };
}

export async function runLiquiditySweepBacktest(store, opts = {}) {
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
      summaries.push({ pair: pair.name, error: String(e.message || e) });
    }
  }
  allTrades.sort((a, b) => (a.time < b.time ? 1 : -1));
  allDebug.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { ranAt: Date.now(), summaries, trades: allTrades, debug: allDebug };
}
