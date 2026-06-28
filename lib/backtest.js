// Backtest: replay historical engulfing-at-level signals and check whether
// price hit the take-profit or the stop-loss first. Produces per-pair win
// rates and a full trade list (with day/time) for the results page + Excel.

import { fetchOHLCV, tfSeconds } from "./market.js";
import {
  closedCandles,
  toCandle,
  detectEngulfing,
  candleTouchesAnyMode,
} from "./engulfing.js";
import { computePosition } from "./position.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function backtestPair(pair, settings, { bars = 1000 } = {}) {
  const tf = pair.timeframe || settings.timeframe || "15m";
  const raw = await fetchOHLCV(pair, tf, bars);
  const rows = closedCandles(raw, tfSeconds(tf), Date.now());
  const modes =
    Array.isArray(settings.touchModes) && settings.touchModes.length
      ? settings.touchModes
      : [settings.touchMode || "range"];
  const rr = Number((settings.risk && settings.risk.rewardRatio) || 2);
  const offset = Number(pair.levelOffset) || 0;
  const trades = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = toCandle(rows[i - 1]);
    const curr = toCandle(rows[i]);
    const direction = detectEngulfing(prev, curr);
    if (!direction) continue;

    for (const lvl of pair.levels) {
      const low = Math.min(lvl.low, lvl.high) + offset;
      const high = Math.max(lvl.low, lvl.high) + offset;
      if (!candleTouchesAnyMode(curr, low, high, modes)) continue;

      const entry = curr.close;
      const stop = direction === "bullish" ? curr.low : curr.high;
      const dist = Math.abs(entry - stop);
      if (dist <= 0) continue;
      const tp = direction === "bullish" ? entry + dist * rr : entry - dist * rr;

      const pos = computePosition({
        direction, entry, stop, settings,
        leverage: pair.leverage,
        contractSize: pair.contractSize,
        pipSize: pair.pipSize,
      });

      // walk forward to find which is hit first
      let outcome = "open";
      let barsHeld = 0;
      for (let j = i + 1; j < rows.length; j++) {
        const c = toCandle(rows[j]);
        barsHeld = j - i;
        if (direction === "bullish") {
          const slHit = c.low <= stop;
          const tpHit = c.high >= tp;
          if (slHit && tpHit) { outcome = "loss"; break; } // ambiguous -> worst case
          if (slHit) { outcome = "loss"; break; }
          if (tpHit) { outcome = "win"; break; }
        } else {
          const slHit = c.high >= stop;
          const tpHit = c.low <= tp;
          if (slHit && tpHit) { outcome = "loss"; break; }
          if (slHit) { outcome = "loss"; break; }
          if (tpHit) { outcome = "win"; break; }
        }
      }

      const d = new Date(curr.ts);
      const r = outcome === "win" ? rr : outcome === "loss" ? -1 : 0;
      trades.push({
        pair: pair.name,
        time: d.toISOString().slice(0, 16).replace("T", " "),
        day: DOW[d.getUTCDay()],
        direction,
        level: `${low}-${high}`,
        entry: round(entry),
        stop: round(stop),
        tp: round(tp),
        slPips: pos ? pos.slPips : round(dist / (Number(pair.pipSize) || 1), 1),
        lots: pos ? pos.lots : null,
        outcome,
        barsHeld: outcome === "open" ? "" : barsHeld,
        r: round(r, 2),
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
  return { summary, trades };
}

export async function runBacktest(store, opts = {}) {
  const summaries = [];
  const allTrades = [];
  for (const pair of store.pairs) {
    try {
      const { summary, trades } = await backtestPair(pair, store.settings, opts);
      summaries.push(summary);
      allTrades.push(...trades);
    } catch (e) {
      summaries.push({ pair: pair.name, error: String(e.message || e) });
    }
  }
  allTrades.sort((a, b) => (a.time < b.time ? 1 : -1)); // newest first
  return { ranAt: Date.now(), summaries, trades: allTrades };
}
