// Fibonacci 0.70–0.786 retracement backtester (§18–§21, §24).
//
// Walk-forward, no repaint, no lookahead. Each Fibonacci setup runs a strict
// lifecycle and produces AT MOST one trade (§16):
//   IDENTIFIED -> FIB_ZONE_CREATED -> PRICE_ENTERED_ZONE -> WAITING_CONFIRMATION
//   -> TRADE_TRIGGERED -> (TP | SL) -> COMPLETED   (or INVALIDATED / EXPIRED)
//
// Produces: trade list (compatible with the shared TradesTable / chart dialog),
// full statistics with LONG/SHORT split, and an RR comparison table (§20).

import { fetchOHLCV, fetchOHLCVRange, tfSeconds } from "./market.js";
import {
  fibConfig,
  toCandle,
  isPivotHigh,
  isPivotLow,
  fibZoneLong,
  fibZoneShort,
  fibExtensionLong,
  fibExtensionShort,
  confirmLong,
  confirmShort,
  ema,
  atr,
} from "./fibStrategy.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_BARS = 18000;
const RR_PRESETS = [1.5, 2, 2.5, 3, 4, 5];

function round(n, dp = 4) {
  if (n == null || isNaN(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function istParts(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return { time: d.toISOString().slice(0, 16).replace("T", " "), day: DOW[d.getUTCDay()] };
}

// Resolve a single trade forward from `entryIndex+1`: which of SL/TP is hit
// first? Same-bar ambiguity resolves to the loss (worst case).
function resolve(rows, entryIndex, direction, stop, tp) {
  for (let j = entryIndex + 1; j < rows.length; j++) {
    const h = rows[j][2], l = rows[j][3];
    if (direction === "bullish") {
      if (l <= stop) return { outcome: "loss", exitIndex: j };
      if (h >= tp) return { outcome: "win", exitIndex: j };
    } else {
      if (h >= stop) return { outcome: "loss", exitIndex: j };
      if (l <= tp) return { outcome: "win", exitIndex: j };
    }
  }
  return { outcome: "open", exitIndex: null };
}

// Compute the take-profit price for a triggered setup under a given config.
function takeProfit(cfg, direction, entry, stop, setup, rrOverride) {
  const risk = Math.abs(entry - stop);
  if (cfg.tpMode === "SWING") {
    return direction === "bullish" ? setup.swingHigh : setup.swingLow;
  }
  if (cfg.tpMode === "FIB_EXT") {
    return direction === "bullish"
      ? fibExtensionLong(setup.swingLow, setup.swingHigh, cfg.fibExtension)
      : fibExtensionShort(setup.swingHigh, setup.swingLow, cfg.fibExtension);
  }
  // default: risk/reward
  const rr = rrOverride != null ? rrOverride : cfg.rrRatio;
  return direction === "bullish" ? entry + rr * risk : entry - rr * risk;
}

// -----------------------------------------------------------------------------
// Core: replay one pair and return the list of TRIGGERED trades (each carries
// enough state to re-price the TP for RR comparison).
// -----------------------------------------------------------------------------
export async function backtestPair(pair, cfg, opts = {}) {
  const tf = pair.timeframe || opts.timeframe || "15m";
  let raw;
  if (opts.rows) {
    raw = opts.rows; // pre-fetched candles (tests / re-use)
  } else if (opts.from && opts.to) {
    raw = await fetchOHLCVRange(pair, tf, opts.from, opts.to);
  } else {
    const days = opts.days || 30;
    const want = opts.bars || Math.ceil((days * 86400) / tfSeconds(tf));
    raw = await fetchOHLCV(pair, tf, Math.min(MAX_BARS, Math.max(2, want)));
  }
  // only fully-closed candles (no repaint of the forming candle)
  const tfMs = tfSeconds(tf) * 1000;
  const now = Date.now();
  const rows = raw.filter((r) => r[0] + tfMs <= now);
  const offset = Number(pair.levelOffset) || 0;
  const applyOffset = (r) => (offset ? [r[0], r[1] + offset, r[2] + offset, r[3] + offset, r[4] + offset, r[5]] : r);
  const cRows = offset ? rows.map(applyOffset) : rows;

  const emaFast = cfg.useTrendFilter ? ema(cRows, cfg.emaFast) : null;
  const emaSlow = cfg.useTrendFilter ? ema(cRows, cfg.emaSlow) : null;
  const atrArr = cfg.useATRFilter || cfg.minimumImpulseATR > 0 ? atr(cRows, cfg.atrPeriod) : null;

  const { pivotLeft: L, pivotRight: R } = cfg;
  const highs = []; // confirmed swing highs { index, price }
  const lows = []; // confirmed swing lows
  const active = []; // live setups
  const trades = [];

  const tvSymbol = pair.tradingview || (pair.exchange ? `${pair.exchange.toUpperCase()}:${pair.name}` : "");

  for (let i = 0; i < cRows.length; i++) {
    const curr = toCandle(cRows[i]);
    const prev = i > 0 ? toCandle(cRows[i - 1]) : null;

    // 1) A pivot at index p = i - R becomes CONFIRMED now (R candles have closed
    //    after it). This is the no-repaint / no-lookahead boundary.
    //    LONG impulse  = swing LOW  -> swing HIGH (created on a new swing HIGH).
    //    SHORT impulse = swing HIGH -> swing LOW  (created on a new swing LOW).
    const p = i - R;
    if (p >= L) {
      if (isPivotHigh(cRows, p, L, R)) {
        highs.push({ index: p, price: cRows[p][2] });
        if (cfg.allowLong) {
          const loBefore = lastBefore(lows, p);
          if (loBefore) {
            maybeCreate(active, "bullish",
              { swingLow: loBefore.price, swingHigh: cRows[p][2], loIndex: loBefore.index, hiIndex: p },
              cfg, atrArr, i);
          }
        }
      }
      if (isPivotLow(cRows, p, L, R)) {
        lows.push({ index: p, price: cRows[p][3] });
        if (cfg.allowShort) {
          const hiBefore = lastBefore(highs, p);
          if (hiBefore) {
            maybeCreate(active, "bearish",
              { swingHigh: hiBefore.price, swingLow: cRows[p][3], hiIndex: hiBefore.index, loIndex: p },
              cfg, atrArr, i);
          }
        }
      }
    }

    // 2) Advance every active setup against the CURRENT candle.
    for (let s = active.length - 1; s >= 0; s--) {
      const setup = active[s];
      if (!prev) continue;

      // Invalidation (§12): price breaks past the origin swing before trigger.
      if (setup.direction === "bullish" && curr.low < setup.swingLow) { active.splice(s, 1); continue; }
      if (setup.direction === "bearish" && curr.high > setup.swingHigh) { active.splice(s, 1); continue; }

      // Expiry: never triggered within the allowed window.
      if (i - setup.createdIndex > cfg.zoneExpiryBars) { active.splice(s, 1); continue; }

      // Waiting for a break-entry after confirmation?
      if (setup.state === "WAITING_BREAK") {
        const hit = setup.direction === "bullish" ? curr.high >= setup.breakLevel : curr.low <= setup.breakLevel;
        if (hit) { triggerTrade(setup, setup.breakLevel, i); }
        else continue;
      } else {
        // Zone entry (§1 condition 3)
        if (!setup.enteredZone) {
          const inZone = curr.low <= setup.zoneTop && curr.high >= setup.zoneBottom;
          if (inZone) setup.enteredZone = true;
        }
        // Confirmation (§4 / §13) once price is inside the zone
        if (setup.enteredZone) {
          const ok = setup.direction === "bullish"
            ? confirmLong(prev, curr, cfg.confirmationMode)
            : confirmShort(prev, curr, cfg.confirmationMode);
          if (ok && passesFilters(cfg, setup.direction, i, emaFast, emaSlow, atrArr, highs, lows)) {
            if (cfg.entryMode === "break") {
              setup.state = "WAITING_BREAK";
              setup.breakLevel = setup.direction === "bullish" ? curr.high : curr.low;
              continue;
            }
            triggerTrade(setup, curr.close, i);
          }
        }
      }

      // If it triggered this candle, finalise the trade record and drop it.
      if (setup.state === "TRIGGERED") {
        const t = finaliseTrade(setup, cfg, cRows, pair, tf, tvSymbol);
        if (t) trades.push(t);
        active.splice(s, 1);
      }
    }
  }

  // return the offset-adjusted closed rows too, so the caller can re-price for
  // the RR comparison without fetching the data a second time.
  return { trades, tf, rows: cRows };

  // --- inner helpers (close over cRows / cfg) ---
  function triggerTrade(setup, entry, entryIndex) {
    setup.entry = entry;
    setup.entryIndex = entryIndex;
    setup.state = "TRIGGERED";
  }
}

// Most recent confirmed pivot strictly before index `p`.
function lastBefore(list, p) {
  for (let k = list.length - 1; k >= 0; k--) if (list[k].index < p) return list[k];
  return null;
}

// Create a setup if the impulse passes the size filters (§10).
function maybeCreate(active, direction, s, cfg, atrArr, i) {
  const { swingLow, swingHigh } = s;
  const range = swingHigh - swingLow;
  if (range <= 0) return;
  const impulsePct = (range / swingLow) * 100;
  if (impulsePct < cfg.minimumImpulsePercent) return;
  if (cfg.minimumImpulseATR > 0) {
    const a = atrArr ? atrArr[s.hiIndex] || atrArr[s.loIndex] : null;
    if (!a || range < cfg.minimumImpulseATR * a) return;
  }
  const zone = direction === "bullish" ? fibZoneLong(swingLow, swingHigh, cfg) : fibZoneShort(swingHigh, swingLow, cfg);
  active.push({
    direction,
    swingLow,
    swingHigh,
    loIndex: s.loIndex,
    hiIndex: s.hiIndex,
    zoneTop: zone.top,
    zoneBottom: zone.bottom,
    range,
    createdIndex: i,
    state: "FIB_ZONE_CREATED",
    enteredZone: false,
  });
}

// Optional filters, evaluated at the entry candle (§14). Off by default.
function passesFilters(cfg, direction, i, emaFast, emaSlow, atrArr, highs, lows) {
  if (cfg.useTrendFilter && emaFast && emaSlow) {
    const f = emaFast[i], s = emaSlow[i];
    if (f == null || s == null) return false;
    if (direction === "bullish" && !(f > s)) return false;
    if (direction === "bearish" && !(f < s)) return false;
  }
  if (cfg.useATRFilter && atrArr) {
    const a = atrArr[i];
    if (a == null) return false;
    if (cfg.atrMin > 0 && a < cfg.atrMin) return false;
    if (cfg.atrMax > 0 && a > cfg.atrMax) return false;
  }
  if (cfg.useMarketStructureFilter) {
    // bullish structure = HH + HL; bearish = LH + LL, from the last two pivots.
    if (direction === "bullish") {
      if (highs.length < 2 || lows.length < 2) return false;
      const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
      const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
      if (!(hh && hl)) return false;
    } else {
      if (highs.length < 2 || lows.length < 2) return false;
      const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
      const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
      if (!(lh && ll)) return false;
    }
  }
  return true;
}

// Build the final trade record: compute SL, TP, resolve outcome, tag metadata.
function finaliseTrade(setup, cfg, rows, pair, tf, tvSymbol) {
  const { direction, entry, entryIndex } = setup;
  const buf = cfg.slBufferPercent / 100;
  let stop;
  if (cfg.stopLossMode === "ZONE") {
    stop = direction === "bullish" ? setup.zoneBottom * (1 - buf) : setup.zoneTop * (1 + buf);
  } else {
    stop = direction === "bullish" ? setup.swingLow * (1 - buf) : setup.swingHigh * (1 + buf);
  }
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const tp = takeProfit(cfg, direction, entry, stop, setup);
  const reward = Math.abs(tp - entry);
  if (reward <= 0) return null;
  if ((direction === "bullish" && tp <= entry) || (direction === "bearish" && tp >= entry)) return null;

  const res = resolve(rows, entryIndex, direction, stop, tp);
  const rr = reward / risk;
  const r = res.outcome === "win" ? rr : res.outcome === "loss" ? -1 : 0;
  const { time, day } = istParts(rows[entryIndex][0]);
  const pip = Number(pair.pipSize) || 1;

  return {
    pair: pair.name,
    ts: rows[entryIndex][0],
    time,
    day,
    direction,
    strategy: "fib",
    level: `${round(setup.zoneBottom)}-${round(setup.zoneTop)}`,
    swingLow: round(setup.swingLow),
    swingHigh: round(setup.swingHigh),
    fib700: round(direction === "bullish" ? setup.zoneTop : setup.zoneBottom),
    fib786: round(direction === "bullish" ? setup.zoneBottom : setup.zoneTop),
    entry: round(entry),
    stop: round(stop),
    tp: round(tp),
    rr: round(rr, 2),
    slPips: round(risk / pip, 1),
    lots: null, // filled by the sizing pass
    outcome: res.outcome,
    barsHeld: res.exitIndex ? res.exitIndex - entryIndex : "",
    r: round(r, 2),
    // re-pricing info for RR comparison (stripped before returning to client)
    _entryIndex: entryIndex,
    _risk: risk,
    _swingLow: setup.swingLow,
    _swingHigh: setup.swingHigh,
    tvSymbol,
    tradingview: pair.tradingview,
    exchange: pair.exchange,
    market: pair.market,
    tf,
  };
}

// -----------------------------------------------------------------------------
// Statistics (§19). Works off closed trades + an equity curve.
// -----------------------------------------------------------------------------
export function computeStats(trades, cfg) {
  const chrono = [...trades].sort((a, b) => a.ts - b.ts);
  const closed = chrono.filter((t) => t.outcome !== "open");

  let equity = cfg.initialCapital;
  let peak = equity;
  let maxDD = 0; // currency
  let maxDDPct = 0;
  let grossWin = 0, grossLoss = 0;
  let curWinStreak = 0, curLossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  const curve = [{ ts: chrono.length ? chrono[0].ts : Date.now(), equity }];

  for (const t of closed) {
    const riskAmt = equity * (cfg.riskPercent / 100);
    const pnl = t.r * riskAmt; // r already reward/risk on win, -1 on loss
    t.pnl = round(pnl, 2);
    equity += pnl;
    curve.push({ ts: t.ts, equity: round(equity, 2) });
    if (pnl >= 0) grossWin += pnl; else grossLoss += Math.abs(pnl);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    if (t.outcome === "win") { curWinStreak++; curLossStreak = 0; if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak; }
    else if (t.outcome === "loss") { curLossStreak++; curWinStreak = 0; if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak; }
  }

  const wins = closed.filter((t) => t.outcome === "win");
  const losses = closed.filter((t) => t.outcome === "loss");
  const rSum = closed.reduce((a, t) => a + t.r, 0);
  const winRs = wins.map((t) => t.r);
  const lossRs = losses.map((t) => t.r);
  const rVals = closed.map((t) => t.r);

  function agg(list) {
    const c = list.filter((t) => t.outcome !== "open");
    const w = c.filter((t) => t.outcome === "win").length;
    const net = round(c.reduce((a, t) => a + t.r, 0), 2);
    return {
      trades: list.length,
      closed: c.length,
      wins: w,
      losses: c.length - w,
      winRate: c.length ? round((w / c.length) * 100, 1) : 0,
      netR: net,
      expectancy: c.length ? round(net / c.length, 3) : 0,
    };
  }

  return {
    initialCapital: cfg.initialCapital,
    finalEquity: round(equity, 2),
    netProfit: round(equity - cfg.initialCapital, 2),
    netProfitPct: round(((equity - cfg.initialCapital) / cfg.initialCapital) * 100, 2),
    totalTrades: chrono.length,
    closedTrades: closed.length,
    openTrades: chrono.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 999 : 0,
    netR: round(rSum, 2),
    avgR: closed.length ? round(rSum / closed.length, 3) : 0,
    expectancy: closed.length ? round(rSum / closed.length, 3) : 0,
    avgWinR: winRs.length ? round(winRs.reduce((a, b) => a + b, 0) / winRs.length, 2) : 0,
    avgLossR: lossRs.length ? round(lossRs.reduce((a, b) => a + b, 0) / lossRs.length, 2) : 0,
    largestWinR: rVals.length ? round(Math.max(...rVals), 2) : 0,
    largestLossR: rVals.length ? round(Math.min(...rVals), 2) : 0,
    maxDrawdown: round(maxDD, 2),
    maxDrawdownPct: round(maxDDPct, 2),
    maxWinStreak,
    maxLossStreak,
    long: agg(chrono.filter((t) => t.direction === "bullish")),
    short: agg(chrono.filter((t) => t.direction === "bearish")),
    equityCurve: curve,
  };
}

// Assign position size (lots) per trade from risk % of INITIAL capital, for the
// table display (compounding is reflected in the equity curve / stats).
function sizeTrades(trades, cfg, pairsByName) {
  for (const t of trades) {
    const pair = pairsByName[t.pair] || {};
    const cs = Number(pair.contractSize) || 1;
    const pip = Number(pair.pipSize) || 1;
    const riskAmt = cfg.initialCapital * (cfg.riskPercent / 100);
    const slPips = t._risk / pip;
    const pipValuePerLot = pip * cs;
    const lots = slPips > 0 ? riskAmt / (slPips * pipValuePerLot) : 0;
    t.lots = round(lots, 2);
  }
}

// RR comparison (§20): re-price every triggered trade at each preset RR using
// the SAME entry + stop, re-resolve, and tabulate.
function rrComparison(trades, rows_by_pair, cfg) {
  const table = [];
  for (const rr of RR_PRESETS) {
    let wins = 0, losses = 0, open = 0, netR = 0, grossWin = 0, grossLoss = 0;
    let equity = cfg.initialCapital, peak = equity, maxDD = 0;
    const chrono = [...trades].sort((a, b) => a.ts - b.ts);
    for (const t of chrono) {
      const rows = rows_by_pair[t.pair];
      const stop = t.stop; // rounded is fine for comparison
      const risk = t._risk;
      const tp = t.direction === "bullish" ? t.entry + rr * risk : t.entry - rr * risk;
      const res = resolve(rows, t._entryIndex, t.direction, stop, tp);
      if (res.outcome === "open") { open++; continue; }
      const r = res.outcome === "win" ? rr : -1;
      netR += r;
      const riskAmt = equity * (cfg.riskPercent / 100);
      const pnl = r * riskAmt;
      equity += pnl;
      if (pnl >= 0) grossWin += pnl; else grossLoss += Math.abs(pnl);
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
      if (res.outcome === "win") wins++; else losses++;
    }
    const closed = wins + losses;
    table.push({
      rr,
      trades: chrono.length,
      closed,
      winRate: closed ? round((wins / closed) * 100, 1) : 0,
      netProfit: round(equity - cfg.initialCapital, 2),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 999 : 0,
      maxDrawdown: round(maxDD, 2),
      expectancy: closed ? round(netR / closed, 3) : 0,
    });
  }
  return table;
}

// -----------------------------------------------------------------------------
// Entry point: run the strategy across every pair in the store.
// -----------------------------------------------------------------------------
export async function runFibBacktest(store, opts = {}) {
  const cfg = fibConfig(opts.config || {});
  const allTrades = [];
  const rowsByPair = {};
  const pairsByName = {};
  const errors = [];

  for (const pair of store.pairs) {
    pairsByName[pair.name] = pair;
    try {
      const { trades, rows } = await backtestPair(pair, cfg, opts);
      allTrades.push(...trades);
      rowsByPair[pair.name] = rows; // offset-adjusted closed rows, for RR re-pricing
    } catch (e) {
      errors.push({ pair: pair.name, error: String(e.message || e) });
    }
  }

  sizeTrades(allTrades, cfg, pairsByName);
  const stats = computeStats(allTrades, cfg);
  const rrTable = rrComparison(allTrades, rowsByPair, cfg);

  // strip internal fields before returning to the client
  const clean = allTrades
    .map(({ _entryIndex, _risk, _swingLow, _swingHigh, ...t }) => t)
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  return { ranAt: Date.now(), config: cfg, stats, rrComparison: rrTable, trades: clean, errors };
}
