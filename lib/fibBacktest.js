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
  inSession,
  sessionKeyOfTs,
  SESSIONS,
  activeTargets,
  fibTarget,
  nearestLiquidity,
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
// "2024-03" — sortable month key on the same IST clock as the `time` column.
function istMonthKey(tsMs) {
  return new Date(tsMs + IST_OFFSET_MS).toISOString().slice(0, 7);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function istMonthLabel(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

// Multi-target walk-forward resolution (§8–§13).
//
// Walks strictly forward from entryIndex+1 holding a position that is scaled out
// across TP1/TP2/TP3. Returns the blended R of the whole trade.
//
// Conservative bar-level rules (same spirit as `resolve`):
//   * the stop is checked BEFORE targets on each bar, so a bar that spans both
//     books the stop (worst case);
//   * targets are filled nearest-first within a bar.
//
// `targets` = [{ key, price, alloc }] with alloc summing to 1.
function resolveMulti(rows, entryIndex, direction, initialStop, entry, targets, cfg) {
  const long = direction === "bullish";
  const risk = Math.abs(entry - initialStop);
  if (risk <= 0) return null;

  // nearest target first, so partials fill in the order price would reach them
  const legs = [...targets].sort((a, b) =>
    long ? a.price - b.price : b.price - a.price
  );

  let stop = initialStop;
  let remaining = 1;
  let totalR = 0;
  const hits = {};
  let movedToBE = false;

  const rOf = (price) => (long ? price - entry : entry - price) / risk;

  for (let j = entryIndex + 1; j < rows.length; j++) {
    const h = rows[j][2];
    const l = rows[j][3];

    // 1) stop first (worst-case tie handling)
    const stopped = long ? l <= stop : h >= stop;
    if (stopped) {
      totalR += remaining * rOf(stop);
      remaining = 0;
      return {
        outcome: totalR > 1e-9 ? "win" : totalR < -1e-9 ? "loss" : "breakeven",
        exitIndex: j,
        r: totalR,
        hits,
        stoppedOut: true,
        movedToBE,
      };
    }

    // 2) fill any targets touched on this bar, nearest first
    for (const leg of legs) {
      if (hits[leg.key]) continue;
      const touched = long ? h >= leg.price : l <= leg.price;
      if (!touched) continue;
      const part = Math.min(leg.alloc, remaining);
      totalR += part * rOf(leg.price);
      remaining -= part;
      hits[leg.key] = true;
      // break-even after TP1 (§13)
      if (leg.key === "tp1" && cfg.useBreakEven && !movedToBE) {
        const buf = (cfg.breakEvenBufferPercent || 0) / 100;
        stop = long ? entry * (1 + buf) : entry * (1 - buf);
        movedToBE = true;
      }
      if (remaining <= 1e-9) {
        return {
          outcome: totalR > 1e-9 ? "win" : totalR < -1e-9 ? "loss" : "breakeven",
          exitIndex: j,
          r: totalR,
          hits,
          stoppedOut: false,
          movedToBE,
        };
      }
    }
  }

  // ran out of data with part of the position still open
  return { outcome: "open", exitIndex: null, r: totalR, hits, stoppedOut: false, movedToBE };
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
          if (ok && inSession(curr.ts, cfg) && passesFilters(cfg, setup.direction, i, emaFast, emaSlow, atrArr, highs, lows)) {
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
        const t = finaliseTrade(setup, cfg, cRows, pair, tf, tvSymbol, highs, lows);
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
function finaliseTrade(setup, cfg, rows, pair, tf, tvSymbol, highs = [], lows = []) {
  const { direction, entry, entryIndex } = setup;
  const buf = cfg.slBufferPercent / 100;
  const long = direction === "bullish";
  let stop;
  if (cfg.stopLossMode === "ZONE") {
    stop = long ? setup.zoneBottom * (1 - buf) : setup.zoneTop * (1 + buf);
  } else if (cfg.stopLossMode === "CANDLE") {
    // §7 default: beyond the confirmation candle itself
    const c = toCandle(rows[entryIndex]);
    stop = long ? c.low * (1 - buf) : c.high * (1 + buf);
  } else {
    stop = long ? setup.swingLow * (1 - buf) : setup.swingHigh * (1 + buf);
  }
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  // §14: reject a setup whose stop is unreasonably wide
  if (cfg.maxRiskPercent > 0 && entry > 0 && (risk / entry) * 100 > cfg.maxRiskPercent) return null;

  // --- build the target set --------------------------------------------------
  let tp; // primary/headline target (TP1 in multi mode)
  let rr;
  let res;
  let legs = [];
  let tp1 = null, tp2 = null, tp3 = null;

  if (cfg.useMultiTarget) {
    const on = activeTargets(cfg);
    const beyond = (p) => p != null && (long ? p > entry : p < entry);

    tp1 = on.rr ? (long ? entry + cfg.tp1RR * risk : entry - cfg.tp1RR * risk) : null;
    tp2 = on.liq
      ? nearestLiquidity(direction, entry, entryIndex, highs, lows, cfg.tp2LiquidityLookback)
      : null;
    tp3 = on.fib ? fibTarget(direction, setup.swingHigh, setup.swingLow, cfg.tp3FibRatio) : null;

    // §9: no fake targets — a level that is not beyond entry is dropped
    if (!beyond(tp1)) tp1 = null;
    if (!beyond(tp2)) tp2 = null;
    if (!beyond(tp3)) tp3 = null;

    const raw = [
      { key: "tp1", price: tp1, w: cfg.tp1Percent },
      { key: "tp2", price: tp2, w: cfg.tp2Percent },
      { key: "tp3", price: tp3, w: cfg.tp3Percent },
    ].filter((x) => x.price != null && x.w > 0);

    // §12: allocations are normalised to 100% across the surviving targets
    const totW = raw.reduce((a, x) => a + x.w, 0);
    if (!raw.length || totW <= 0) return null;
    legs = raw.map((x) => ({ key: x.key, price: x.price, alloc: x.w / totW }));

    res = resolveMulti(rows, entryIndex, direction, stop, entry, legs, cfg);
    if (!res) return null;
    // headline target = the furthest one actually in play
    tp = legs.reduce((a, x) => (a == null ? x.price : long ? Math.max(a, x.price) : Math.min(a, x.price)), null);
    // blended reward:risk actually achieved by the allocation
    rr = legs.reduce((a, x) => a + x.alloc * (Math.abs(x.price - entry) / risk), 0);
  } else {
    tp = takeProfit(cfg, direction, entry, stop, setup);
    const reward = Math.abs(tp - entry);
    if (reward <= 0) return null;
    if ((long && tp <= entry) || (!long && tp >= entry)) return null;
    res = resolve(rows, entryIndex, direction, stop, tp);
    rr = reward / risk;
    res.r = res.outcome === "win" ? rr : res.outcome === "loss" ? -1 : 0;
    res.hits = res.outcome === "win" ? { tp1: true } : {};
    res.stoppedOut = res.outcome === "loss";
    tp1 = tp;
  }

  const r = res.outcome === "open" ? 0 : res.r;
  const { time, day } = istParts(rows[entryIndex][0]);
  const pip = Number(pair.pipSize) || 1;

  return {
    // the session the entry actually fell in — lets you verify the filter
    session: sessionKeyOfTs(rows[entryIndex][0]),
    tp1: tp1 == null ? null : round(tp1),
    tp2: tp2 == null ? null : round(tp2),
    tp3: tp3 == null ? null : round(tp3),
    tp1Hit: !!res.hits.tp1,
    tp2Hit: !!res.hits.tp2,
    tp3Hit: !!res.hits.tp3,
    slHit: !!res.stoppedOut,
    movedToBE: !!res.movedToBE,
    alloc: legs.map((l) => ({ key: l.key, price: round(l.price), pct: round(l.alloc * 100, 1) })),
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
    // Exit timestamp — the chart uses this to end the risk/reward boxes at the
    // bar the trade actually closed on, and to guarantee that bar is on screen.
    exitTs: res.exitIndex != null ? rows[res.exitIndex][0] : null,
    exitTime: res.exitIndex != null ? istParts(rows[res.exitIndex][0]).time : "",
    // re-pricing info for RR comparison (stripped before returning to client)
    _entryIndex: entryIndex,
    _exitTs: res.exitIndex != null ? rows[res.exitIndex][0] : Infinity,
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
// Portfolio gating (§14, §23). Candidate setups are generated per pair; these
// limits are account-wide, so they must be applied chronologically across ALL
// pairs at once. A rejected candidate is dropped, not deferred — you could not
// have taken it.
// -----------------------------------------------------------------------------
function applyPortfolioLimits(trades, cfg) {
  const chrono = [...trades].sort((a, b) => a.ts - b.ts);
  const maxActive = Math.max(1, Number(cfg.maxActiveTrades) || 1);
  const kept = [];
  const skipped = { active: 0, perDay: 0, dailyLoss: 0, consecutive: 0 };

  let openExits = []; // exit timestamps of accepted, still-running trades
  let dayKey = null;
  let dayCount = 0;
  let dayR = 0;
  let consec = 0;

  const keyOf = (ts) => new Date(ts).toISOString().slice(0, 10);

  for (const t of chrono) {
    const k = keyOf(t.ts);
    if (k !== dayKey) {
      // new day resets the per-day counters and releases a consecutive-loss halt
      dayKey = k;
      dayCount = 0;
      dayR = 0;
      consec = 0;
    }
    openExits = openExits.filter((x) => x > t.ts);

    if (openExits.length >= maxActive) { skipped.active++; continue; }
    if (cfg.useMaxTradesPerDay && dayCount >= cfg.maxTradesPerDay) { skipped.perDay++; continue; }
    if (cfg.useMaxConsecutiveLosses && consec >= cfg.maxConsecutiveLosses) { skipped.consecutive++; continue; }
    // daily loss measured in % of capital: each 1R risks `riskPercent`
    if (cfg.useMaxDailyLoss && -dayR * cfg.riskPercent >= cfg.maxDailyLossPercent) {
      skipped.dailyLoss++;
      continue;
    }

    kept.push(t);
    openExits.push(t._exitTs);
    dayCount++;
    if (t.outcome !== "open") {
      dayR += t.r;
      if (t.outcome === "loss") consec++;
      else if (t.outcome === "win") consec = 0;
    }
  }

  return { kept, skipped };
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

  // Month-wise buckets, keyed YYYY-MM in IST (same clock as the `time` column).
  const months = new Map();
  const monthBucket = (ts) => {
    const key = istMonthKey(ts);
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        label: istMonthLabel(ts),
        trades: 0, closed: 0, wins: 0, losses: 0, breakevens: 0, open: 0,
        netR: 0, grossWin: 0, grossLoss: 0,
        tp1: 0, tp2: 0, tp3: 0, sl: 0,
        startEquity: null, endEquity: null,
        peak: null, maxDrawdown: 0,
      });
    }
    return months.get(key);
  };

  // every trade (incl. still-open) counts toward the month's setup count
  for (const t of chrono) {
    const m = monthBucket(t.ts);
    m.trades++;
    if (t.outcome === "open") m.open++;
  }

  for (const t of closed) {
    const riskAmt = equity * (cfg.riskPercent / 100);
    const pnl = t.r * riskAmt; // r already reward/risk on win, -1 on loss
    t.pnl = round(pnl, 2);

    const m = monthBucket(t.ts);
    // equity at the START of this month's first trade, for the monthly return %
    if (m.startEquity == null) { m.startEquity = equity; m.peak = equity; }

    equity += pnl;
    curve.push({ ts: t.ts, equity: round(equity, 2) });
    if (pnl >= 0) grossWin += pnl; else grossLoss += Math.abs(pnl);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    if (t.outcome === "win") { curWinStreak++; curLossStreak = 0; if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak; }
    else if (t.outcome === "loss") { curLossStreak++; curWinStreak = 0; if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak; }

    // month roll-up
    m.closed++;
    m.netR += t.r;
    if (t.outcome === "win") m.wins++;
    else if (t.outcome === "loss") m.losses++;
    else m.breakevens++;
    if (pnl >= 0) m.grossWin += pnl; else m.grossLoss += Math.abs(pnl);
    if (t.tp1Hit) m.tp1++;
    if (t.tp2Hit) m.tp2++;
    if (t.tp3Hit) m.tp3++;
    if (t.slHit) m.sl++;
    m.endEquity = equity;
    // drawdown measured WITHIN the month (peak resets at the month boundary)
    if (equity > m.peak) m.peak = equity;
    const mdd = m.peak - equity;
    if (mdd > m.maxDrawdown) m.maxDrawdown = mdd;
  }

  const monthly = [...months.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => {
      const decided = m.wins + m.losses;
      const start = m.startEquity == null ? null : m.startEquity;
      const net = m.startEquity == null ? 0 : m.endEquity - m.startEquity;
      return {
        month: m.month,
        label: m.label,
        trades: m.trades,
        closed: m.closed,
        open: m.open,
        wins: m.wins,
        losses: m.losses,
        breakevens: m.breakevens,
        // win rate over decided trades only (break-evens excluded)
        winRate: decided ? round((m.wins / decided) * 100, 1) : 0,
        netR: round(m.netR, 2),
        netProfit: round(net, 2),
        returnPct: start ? round((net / start) * 100, 2) : 0,
        startEquity: start == null ? null : round(start, 2),
        endEquity: m.endEquity == null ? null : round(m.endEquity, 2),
        profitFactor: m.grossLoss > 0 ? round(m.grossWin / m.grossLoss, 2) : m.grossWin > 0 ? 999 : 0,
        maxDrawdown: round(m.maxDrawdown, 2),
        expectancy: m.closed ? round(m.netR / m.closed, 3) : 0,
        tp1HitRate: m.closed ? round((m.tp1 / m.closed) * 100, 1) : 0,
        tp2HitRate: m.closed ? round((m.tp2 / m.closed) * 100, 1) : 0,
        tp3HitRate: m.closed ? round((m.tp3 / m.closed) * 100, 1) : 0,
        slHitRate: m.closed ? round((m.sl / m.closed) * 100, 1) : 0,
      };
    });

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
    // Target hit rates (§18) — share of closed trades that reached each level.
    tp1HitRate: closed.length ? round((closed.filter((t) => t.tp1Hit).length / closed.length) * 100, 1) : 0,
    tp2HitRate: closed.length ? round((closed.filter((t) => t.tp2Hit).length / closed.length) * 100, 1) : 0,
    tp3HitRate: closed.length ? round((closed.filter((t) => t.tp3Hit).length / closed.length) * 100, 1) : 0,
    slHitRate: closed.length ? round((closed.filter((t) => t.slHit).length / closed.length) * 100, 1) : 0,
    breakevens: closed.filter((t) => t.outcome === "breakeven").length,
    long: agg(chrono.filter((t) => t.direction === "bullish")),
    short: agg(chrono.filter((t) => t.direction === "bearish")),
    // Per-session split. With a session filter active only that session should
    // have trades — a quick way to confirm the filter actually applied.
    sessions: SESSIONS.map((s) => ({
      key: s.key,
      label: s.label,
      window: s.window,
      ...agg(chrono.filter((t) => t.session === s.key)),
    })).filter((s) => s.trades > 0),
    // Month-by-month performance (§24). Equity compounds across months, so
    // each month's return % is measured against the equity it opened with.
    monthly,
    monthsProfitable: monthly.filter((m) => m.netProfit > 0).length,
    monthsLosing: monthly.filter((m) => m.netProfit < 0).length,
    bestMonth: monthly.length ? monthly.reduce((a, m) => (m.netProfit > a.netProfit ? m : a)) : null,
    worstMonth: monthly.length ? monthly.reduce((a, m) => (m.netProfit < a.netProfit ? m : a)) : null,
    avgMonthlyReturnPct: monthly.length
      ? round(monthly.reduce((a, m) => a + m.returnPct, 0) / monthly.length, 2)
      : 0,
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

  // Account-wide limits are applied across all pairs, chronologically (§14/§23).
  const { kept, skipped } = applyPortfolioLimits(allTrades, cfg);

  sizeTrades(kept, cfg, pairsByName);
  const stats = computeStats(kept, cfg);
  const rrTable = rrComparison(kept, rowsByPair, cfg);

  // strip internal fields before returning to the client
  const clean = kept
    .map(({ _entryIndex, _exitTs, _risk, _swingLow, _swingHigh, ...t }) => t)
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  return {
    ranAt: Date.now(),
    config: cfg,
    stats,
    rrComparison: rrTable,
    trades: clean,
    candidates: allTrades.length,
    skipped,
    errors,
  };
}
