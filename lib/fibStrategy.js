// Fibonacci 0.70–0.786 retracement strategy — pure, dependency-free core logic.
// Runs in Next API routes, the worker, the browser, and plain node tests.
//
// Pipeline (see FIB_STRATEGY_README.md for the full spec):
//   confirmed swing -> opposite swing -> impulse validation -> fib zone
//   -> price enters 0.700–0.786 zone -> price-action confirmation
//   -> entry / stop / target / position size.
//
// Session windows come from lib/sessions.js (the single source of truth shared
// with the trades-table session labels) — re-exported so callers can keep
// importing `inSession` from the strategy core.
export { inSession, sessionKeyOfTs, SESSIONS, SESSION_FILTERS } from "./sessions.js";

// NO REPAINT: a pivot at index k is only "known" once `pivotRight` candles have
// closed after it (at candle k + pivotRight). NO LOOKAHEAD: confirmation only
// reads the current + previous candle; setups only advance on candles that
// closed after the pivot was confirmed.

// ---------------------------------------------------------------------------
// Central configuration (§22). Everything the strategy needs, in one place.
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  // Fibonacci retracement zone (LONG: measured Swing Low -> Swing High)
  fibUpper: 0.7, // shallower edge of the entry zone
  fibLower: 0.786, // deeper edge of the entry zone

  // Swing detection
  pivotLeft: 5,
  pivotRight: 5,

  // Impulse validation
  minimumImpulsePercent: 1, // % move required between the two swings
  minimumImpulseATR: 0, // >0 => also require impulse >= N * ATR

  // Confirmation: ENGULFING | REJECTION | PINBAR | BREAK | ANY, or combos with
  // "_OR_" e.g. "ENGULFING_OR_REJECTION".
  confirmationMode: "ENGULFING",

  // Entry: "close" (confirmation candle close) or "break" (break of the
  // confirmation candle's high/low).
  entryMode: "close",

  // Stop loss: "SWING" (beyond the origin swing) or "ZONE" (beyond the fib zone)
  stopLossMode: "SWING",
  slBufferPercent: 0.1, // buffer added beyond the swing/zone, in %

  // Take profit: "RR" | "SWING" (opposite swing) | "FIB_EXT"
  // Only used when useMultiTarget = false (legacy single-target mode).
  tpMode: "RR",
  rrRatio: 2,
  fibExtension: 1.618, // used when tpMode = "FIB_EXT" (1.0 | 1.272 | 1.618)

  // -- Multi-target system (§8–§12) -----------------------------------------
  // TP1 = fixed RR, TP2 = next liquidity, TP3 = fib reference. All three can
  // run at once with a partial-exit allocation.
  useMultiTarget: true,
  // RR | LIQUIDITY | FIB | RR_LIQ | RR_FIB | LIQ_FIB | ALL
  targetMode: "ALL",
  tp1RR: 2, // TP1 risk:reward
  tp2LiquidityLookback: 60, // bars to search back for a liquidity level
  // TP3 fib ratio of the impulse. 0 = swing origin (full retrace). The literal
  // 0.700 line IS the entry zone, so it is not a usable target — see README.
  tp3FibRatio: 0,
  tp1Percent: 40, // partial allocation, auto-normalised to 100% (§12)
  tp2Percent: 30,
  tp3Percent: 30,

  // Break-even (§13): after TP1 fills, move the stop to entry (+/- buffer).
  useBreakEven: false,
  breakEvenBufferPercent: 0,

  // -- Trade limits (§14, §23) ----------------------------------------------
  maxActiveTrades: 1,
  useMaxTradesPerDay: false,
  maxTradesPerDay: 3,
  useMaxDailyLoss: false,
  maxDailyLossPercent: 3,
  useMaxConsecutiveLosses: false,
  maxConsecutiveLosses: 3,
  maxRiskPercent: 0, // 0 = off; skip a setup whose stop is wider than this % of entry

  // -- Session filter (§21), UTC ---------------------------------------------
  sessionFilter: "ALL", // ALL | LONDON | NEWYORK | LONDON_NY | CUSTOM
  customSessionStart: "00:00",
  customSessionEnd: "24:00",

  // Optional filters (off by default — §14)
  useTrendFilter: false,
  emaFast: 50,
  emaSlow: 200,
  useATRFilter: false,
  atrPeriod: 14,
  atrMin: 0,
  atrMax: 0, // 0 = no upper bound
  useMarketStructureFilter: false,

  // Direction toggles
  allowLong: true,
  allowShort: true,

  // Risk / lifecycle
  riskPercent: 1,
  initialCapital: 10000,
  zoneExpiryBars: 150, // drop a setup that never triggers within N candles
};

// Merge user overrides onto the defaults.
export function fibConfig(overrides = {}) {
  const c = { ...DEFAULT_CONFIG, ...(overrides || {}) };
  // normalise the zone so fibUpper is always the shallower (smaller) ratio
  if (c.fibUpper > c.fibLower) {
    const t = c.fibUpper;
    c.fibUpper = c.fibLower;
    c.fibLower = t;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Candle helpers ([ts, open, high, low, close, volume] rows)
// ---------------------------------------------------------------------------
export function toCandle(row) {
  return { ts: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] };
}

// ---------------------------------------------------------------------------
// Swing detection (§9). Confirmed pivots only.
// ---------------------------------------------------------------------------
export function isPivotHigh(rows, k, left, right) {
  const h = rows[k][2];
  for (let s = 1; s <= left; s++) if (!rows[k - s] || rows[k - s][2] >= h) return false;
  for (let s = 1; s <= right; s++) if (!rows[k + s] || rows[k + s][2] >= h) return false;
  return true;
}

export function isPivotLow(rows, k, left, right) {
  const l = rows[k][3];
  for (let s = 1; s <= left; s++) if (!rows[k - s] || rows[k - s][3] <= l) return false;
  for (let s = 1; s <= right; s++) if (!rows[k + s] || rows[k + s][3] <= l) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Fibonacci (§1, §2). LONG measured low->high; SHORT measured high->low.
// Returns { top, bottom } price bounds of the entry zone plus level helpers.
// ---------------------------------------------------------------------------
export function fibZoneLong(swingLow, swingHigh, cfg) {
  const range = swingHigh - swingLow;
  // retracement level x => price = high - x*range (x in [0,1])
  const price = (x) => swingHigh - x * range;
  const top = price(cfg.fibUpper); // 0.700 (higher price)
  const bottom = price(cfg.fibLower); // 0.786 (lower price)
  return { top, bottom, range };
}

export function fibZoneShort(swingHigh, swingLow, cfg) {
  const range = swingHigh - swingLow;
  // retracement level x => price = low + x*range
  const price = (x) => swingLow + x * range;
  const bottom = price(cfg.fibUpper); // 0.700 (lower price)
  const top = price(cfg.fibLower); // 0.786 (higher price)
  return { top, bottom, range };
}

// Fibonacci extension target price (§5 method C).
export function fibExtensionLong(swingLow, swingHigh, ext) {
  return swingLow + ext * (swingHigh - swingLow);
}
export function fibExtensionShort(swingHigh, swingLow, ext) {
  return swingHigh - ext * (swingHigh - swingLow);
}

// ---------------------------------------------------------------------------
// Confirmation engine (§13). Each returns a boolean for a (prev, curr) pair.
// ---------------------------------------------------------------------------
function body(c) { return Math.abs(c.close - c.open); }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }
function upperWick(c) { return c.high - Math.max(c.open, c.close); }

export function bullishEngulfing(prev, curr) {
  const prevBear = prev.close < prev.open;
  const currBull = curr.close > curr.open;
  return prevBear && currBull && curr.open <= prev.close && curr.close >= prev.open;
}
export function bearishEngulfing(prev, curr) {
  const prevBull = prev.close > prev.open;
  const currBear = curr.close < curr.open;
  return prevBull && currBear && curr.open >= prev.close && curr.close <= prev.open;
}
// Strong bullish rejection: long lower wick, close in the upper half of the range.
export function bullishRejection(prev, curr) {
  const rng = curr.high - curr.low;
  if (rng <= 0) return false;
  return lowerWick(curr) >= 2 * body(curr) && lowerWick(curr) >= upperWick(curr) && curr.close >= curr.low + rng * 0.5;
}
export function bearishRejection(prev, curr) {
  const rng = curr.high - curr.low;
  if (rng <= 0) return false;
  return upperWick(curr) >= 2 * body(curr) && upperWick(curr) >= lowerWick(curr) && curr.close <= curr.high - rng * 0.5;
}
// Pin bar: small body, dominant single wick.
export function bullishPinBar(prev, curr) {
  const rng = curr.high - curr.low;
  if (rng <= 0) return false;
  return lowerWick(curr) >= rng * 0.6 && body(curr) <= rng * 0.3 && upperWick(curr) <= rng * 0.2;
}
export function bearishPinBar(prev, curr) {
  const rng = curr.high - curr.low;
  if (rng <= 0) return false;
  return upperWick(curr) >= rng * 0.6 && body(curr) <= rng * 0.3 && lowerWick(curr) <= rng * 0.2;
}
export function breakOfHigh(prev, curr) { return curr.high > prev.high; }
export function breakOfLow(prev, curr) { return curr.low < prev.low; }

// Structure break (§3, the mandatory confirmation step): the candle must close
// in the trade direction AND close beyond the previous candle's extreme.
export function bullishStructureBreak(prev, curr) {
  return curr.close > curr.open && curr.close > prev.high;
}
export function bearishStructureBreak(prev, curr) {
  return curr.close < curr.open && curr.close < prev.low;
}

const LONG_CHECKS = {
  STRUCTURE: bullishStructureBreak,
  ENGULFING: bullishEngulfing,
  REJECTION: bullishRejection,
  PINBAR: bullishPinBar,
  BREAK: breakOfHigh,
};
const SHORT_CHECKS = {
  STRUCTURE: bearishStructureBreak,
  ENGULFING: bearishEngulfing,
  REJECTION: bearishRejection,
  PINBAR: bearishPinBar,
  BREAK: breakOfLow,
};

function checksFor(mode, table) {
  const m = String(mode || "ENGULFING").toUpperCase();
  if (m === "ANY") return Object.values(table);
  return m.split("_OR_").map((k) => table[k]).filter(Boolean);
}

export function confirmLong(prev, curr, mode) {
  const checks = checksFor(mode, LONG_CHECKS);
  return checks.length ? checks.some((fn) => fn(prev, curr)) : false;
}
export function confirmShort(prev, curr, mode) {
  const checks = checksFor(mode, SHORT_CHECKS);
  return checks.length ? checks.some((fn) => fn(prev, curr)) : false;
}

// ---------------------------------------------------------------------------
// Indicators for optional filters (§14)
// ---------------------------------------------------------------------------
// EMA over closes, aligned to rows index (null until seeded).
export function ema(rows, period) {
  const out = new Array(rows.length).fill(null);
  if (rows.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += rows[i][4];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < rows.length; i++) {
    prev = rows[i][4] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Target mode helpers (§11). Which of TP1/TP2/TP3 are enabled?
// ---------------------------------------------------------------------------
export function activeTargets(cfg) {
  const m = String(cfg.targetMode || "ALL").toUpperCase();
  return {
    rr: m === "RR" || m === "RR_LIQ" || m === "RR_FIB" || m === "ALL",
    liq: m === "LIQUIDITY" || m === "RR_LIQ" || m === "LIQ_FIB" || m === "ALL",
    fib: m === "FIB" || m === "RR_FIB" || m === "LIQ_FIB" || m === "ALL",
  };
}

// TP3: fib reference level of the impulse (§10).
export function fibTarget(direction, swingHigh, swingLow, ratio) {
  const range = swingHigh - swingLow;
  return direction === "bullish" ? swingHigh - ratio * range : swingLow + ratio * range;
}

// TP2: nearest liquidity beyond `entry` in the trade direction (§9).
// `highs`/`lows` must contain ONLY pivots already confirmed at entry time —
// that is what keeps this free of lookahead.
export function nearestLiquidity(direction, entry, entryIndex, highs, lows, lookback) {
  let best = null;
  if (direction === "bullish") {
    for (const h of highs) {
      if (entryIndex - h.index > lookback) continue;
      if (h.price > entry && (best == null || h.price < best)) best = h.price;
    }
  } else {
    for (const l of lows) {
      if (entryIndex - l.index > lookback) continue;
      if (l.price < entry && (best == null || l.price > best)) best = l.price;
    }
  }
  return best;
}

// Wilder ATR aligned to rows index (null until seeded).
export function atr(rows, period) {
  const out = new Array(rows.length).fill(null);
  if (rows.length < period + 1) return out;
  const tr = (i) => {
    const h = rows[i][2], l = rows[i][3], pc = rows[i - 1][4];
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  };
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < rows.length; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out[i] = prev;
  }
  return out;
}
