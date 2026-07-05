// Backtest: replay historical engulfing-at-level signals and check whether
// price hit the take-profit or the stop-loss first. Produces per-pair win
// rates and a full trade list (with day/time) for the results page + Excel.

import { fetchOHLCV, fetchOHLCVRange, tfSeconds } from "./market.js";
import {
  closedCandles,
  toCandle,
  detectEngulfing,
  candleTouchesAnyMode,
} from "./engulfing.js";
import { computePosition } from "./position.js";
import { computeFingerprint, matchFingerprint, dnaConfig } from "./dna.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India Standard Time = UTC+5:30

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// format a UTC ms timestamp as IST wall-clock "YYYY-MM-DD HH:mm" + weekday
function istParts(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return {
    time: d.toISOString().slice(0, 16).replace("T", " "),
    day: DOW[d.getUTCDay()],
  };
}

// minute-of-day (0..1439) of a trade from its IST "YYYY-MM-DD HH:mm" time
function tradeMinute(t) {
  const [h, m] = t.time.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
}
// is `min` inside [from,to) — supports windows that wrap past midnight
function inWindow(min, from, to) {
  if (from === to) return false;
  return from < to ? min >= from && min < to : min >= from || min < to;
}

// pure helpers reused by the Excel export for filtering.
// exclFrom/exclTo are minutes-of-day (IST); trades inside that window are dropped.
export function filterTrades(trades, { from, to, pairs, exclFrom, exclTo } = {}) {
  const hasExcl = exclFrom != null && exclTo != null;
  return trades.filter((t) => {
    if (from && t.ts < from) return false;
    if (to && t.ts > to) return false;
    if (pairs && pairs.length && !pairs.includes(t.pair)) return false;
    if (hasExcl && inWindow(tradeMinute(t), exclFrom, exclTo)) return false;
    return true;
  });
}

export function summarizeTrades(trades) {
  const byPair = {};
  for (const t of trades) {
    const s = (byPair[t.pair] = byPair[t.pair] || {
      pair: t.pair, signals: 0, closed: 0, wins: 0, losses: 0, open: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome === "open") s.open++;
    else {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byPair).map((s) => ({
    ...s,
    netR: round(s.netR, 2),
    winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
  }));
}

const MAX_BARS = 18000; // safety cap (~187 days of 15m)

export async function backtestPair(pair, settings, { days = 10, bars, from, to } = {}) {
  const tf = pair.timeframe || settings.timeframe || "15m";
  let raw;
  if (from && to) {
    // explicit historical window (e.g. a whole year)
    raw = await fetchOHLCVRange(pair, tf, from, to);
  } else {
    // candles needed to cover `days` on this timeframe (unless an explicit bar
    // count is given), capped so a runaway config can't hammer the API
    const want = bars || Math.ceil((days * 86400) / tfSeconds(tf));
    const nBars = Math.min(MAX_BARS, Math.max(2, want));
    raw = await fetchOHLCV(pair, tf, nBars);
  }
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

      const { time, day } = istParts(curr.ts);
      const r = outcome === "win" ? rr : outcome === "loss" ? -1 : 0;
      const tvSymbol = pair.tradingview || `${pair.exchange.toUpperCase()}:${pair.name}`;
      trades.push({
        fp: computeFingerprint(rows, i),
        pair: pair.name,
        ts: curr.ts,
        time,
        day,
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
        tradingview: pair.tradingview || "",
        tvSymbol,
        exchange: pair.exchange,
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
  return { summary, trades };
}

// Annotate each trade with DNA match info, walk-forward: a trade is only
// matched against SAME pair+direction trades that had already CLOSED before
// its signal fired (no lookahead). Mutates trades in place, strips `fp`.
export function annotateTradesWithDna(trades, settings) {
  const cfg = dnaConfig(settings);
  const asc = [...trades].sort((a, b) => a.ts - b.ts);
  for (const t of asc) {
    // history = earlier closed trades whose exit happened before this signal
    const history = [];
    for (const h of asc) {
      if (h === t) break; // asc order: everything after is not earlier
      if (h.ts >= t.ts) continue;
      if (h.outcome !== "win" && h.outcome !== "loss") continue;
      const tfSec = tfSeconds(h.tf || "15m");
      const closeTs = h.ts + (Number(h.barsHeld) || 0) * tfSec * 1000;
      if (closeTs > t.ts) continue; // still open when this signal fired
      history.push({ pair: h.pair, direction: h.direction, fp: h.fp, outcome: h.outcome });
    }
    const m = t.fp
      ? matchFingerprint(t.fp, history, {
          pair: t.pair,
          direction: t.direction,
          minSimilarity: cfg.minSimilarity,
          minWinRate: cfg.minWinRate,
          minMatches: cfg.minMatches,
        })
      : { matches: 0, wins: 0, losses: 0, pass: false, avgSimilarity: 0 };
    t.dnaSim = m.avgSimilarity;
    t.dnaMatches = m.matches;
    t.dnaRecord = m.matches ? `${m.wins}-${m.losses}` : "";
    t.dnaPass = m.pass;
  }
  for (const t of trades) delete t.fp; // keep payloads small
  return trades;
}

// Build the historical DNA library used by LIVE scanning: replay ~180 days
// per pair and collect the fingerprint + outcome of every closed trade.
export async function buildDnaLibrary(store) {
  const entries = [];
  for (const pair of store.pairs) {
    try {
      const { trades } = await backtestPair(pair, store.settings, { days: 180 });
      for (const t of trades) {
        if (!t.fp) continue;
        if (t.outcome !== "win" && t.outcome !== "loss") continue;
        entries.push({ pair: t.pair, direction: t.direction, fp: t.fp, outcome: t.outcome });
      }
    } catch {
      // skip a failing pair but keep building the rest
    }
  }
  return { builtAt: Date.now(), entries };
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
  if (dnaConfig(store.settings).enabled) {
    annotateTradesWithDna(allTrades, store.settings);
  } else {
    for (const t of allTrades) delete t.fp;
  }
  allTrades.sort((a, b) => (a.time < b.time ? 1 : -1)); // newest first
  return { ranAt: Date.now(), summaries, trades: allTrades };
}
