// Candle-reversal entry / first-opposite-candle exit strategy — pure core.
//
// Dependency-free so it runs in Next API routes, the worker, the browser and
// plain `node` tests. See REVERSAL_STRATEGY_README.md for the full rule spec;
// every subjective decision in that spec is a key in DEFAULT_CONFIG below.
//
// Concept (LONG; SHORT is the exact mirror):
//   downward leg -> bullish candle at the bottom -> price dips again ->
//   second bullish candle near the bottom -> entry at its close -> hold through
//   temporary pullbacks -> once continuation RESUMES, exit on the first
//   bearish candle.
//
// NO LOOKAHEAD: single forward pass; bar i reads only bars <= i. Entry is the
// close of a bar that has closed; exits fill at that bar's close or the next
// bar's open.

import { ema } from "./fibStrategy.js";
import { inSession, sessionKeyOfTs, SESSIONS, SESSION_FILTERS } from "./sessions.js";

export { ema, inSession, sessionKeyOfTs, SESSIONS, SESSION_FILTERS };

// ---------------------------------------------------------------------------
// States (§2). Exported so the UI and tests can name them.
// ---------------------------------------------------------------------------
export const STATES = {
  SEEKING_REVERSAL: "SEEKING_REVERSAL",
  FIRST_REVERSAL_CANDLE: "FIRST_REVERSAL_CANDLE",
  WAITING_FOR_SECOND_REVERSAL_CANDLE: "WAITING_FOR_SECOND_REVERSAL_CANDLE",
  WAITING_FOR_DIRECTIONAL_CONFIRMATION: "WAITING_FOR_DIRECTIONAL_CONFIRMATION",
  POSITION_OPEN: "POSITION_OPEN",
  TEMPORARY_PULLBACK: "TEMPORARY_PULLBACK",
  CONTINUATION_RESUMED: "CONTINUATION_RESUMED",
  EXIT_ON_FIRST_OPPOSITE_CANDLE: "EXIT_ON_FIRST_OPPOSITE_CANDLE",
  CLOSED: "CLOSED",
};

export const TIMEFRAMES = ["1m", "5m", "10m", "15m", "1h", "4h", "1d"];

export const TF_SECONDS = {
  "1m": 60, "5m": 300, "10m": 600, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400,
};

export function tfMs(tf) {
  return (TF_SECONDS[tf] || 900) * 1000;
}

// ---------------------------------------------------------------------------
// Configuration.
//
// Deliberately small: the only knobs here are the ones that change what the
// strategy DOES. Entry is always the close of the second reversal candle, so
// there are no entry-mode or swing-pivot settings; sizing is in percent and
// price terms, so there are no ATR settings.
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  // -- direction toggles ----------------------------------------------------
  allowLong: true,
  allowShort: true,

  // -- candle colour (§1) ---------------------------------------------------
  dojiPolicy: "NEUTRAL", // NEUTRAL | BULL | BEAR
  minBodyPercentOfRange: 0, // reversal candle body as % of its high-low (0 = off)

  // -- step 1: the prior directional leg ------------------------------------
  legLookback: 5, // bars back used as the leg reference close
  minLegPercent: 0.3, // required leg size, % of the reference close (0 = off)

  // -- step 2/4: "at the bottom" / "near the bottom" ------------------------
  bottomTolerancePercent: 0.1, // candle low within this % of the window low

  // -- step 3: "price moves down again" -------------------------------------
  dipReference: "CANDLE_LOW", // CANDLE_LOW | CANDLE_CLOSE
  maxBarsBetweenReversals: 10, // r1 -> r2 window
  maxDipPercent: 2, // dip deeper than this past r1 invalidates (0 = off)
  reanchorFirst: true, // a better first candle before the dip re-anchors r1

  // -- stop loss (§3.2) -----------------------------------------------------
  slBufferPercent: 0.1, // beyond the confirmed reversal swing
  emergencyStopPercent: 0, // hard % stop from entry, always active (0 = off)
  maxHoldBars: 0, // force close after N bars (0 = off)

  // -- pullback vs structure break (§3.3) -----------------------------------
  maxPullbackCandles: 3,
  maxPullbackRetracePercent: 61.8,
  exitOnFailedContinuation: true,

  // -- continuation resumed (§3.4) ------------------------------------------
  // NEW_HIGH | CLOSE_ABOVE_PULLBACK_EXTREME | CLOSE_ABOVE_PRIOR_BAR
  resumeMode: "NEW_HIGH",
  minResumePercent: 0, // minimum travel off the pullback low (0 = off)

  // -- exit (§3.5) ----------------------------------------------------------
  armAfterCycles: 1, // pullback->resume cycles before the exit arms
  exitFill: "CLOSE", // CLOSE | NEXT_OPEN

  // -- session filter (IST windows, shared with the rest of the app) --------
  sessionFilter: "ALL", // ALL | SYDNEY | TOKYO | LONDON | NEWYORK | ...combos | CUSTOM
  customSessionStart: "00:00",
  customSessionEnd: "24:00",

  // -- higher-timeframe confirmation (§5) -----------------------------------
  htfMode: "NONE", // NONE | CANDLE_COLOR | EMA
  htfTimeframe: "4h",
  htfEmaPeriod: 50,

  // -- portfolio ------------------------------------------------------------
  maxConcurrentPositions: 1,

  // -- execution + sizing (§4) — used by reversalBacktest.js ----------------
  initialCapital: 10000,
  sizingMode: "RISK_PERCENT", // RISK_PERCENT | FIXED_RISK | FIXED_QTY | FIXED_NOTIONAL
  riskPercent: 1,
  fixedRiskAmount: 100,
  fixedQty: 1,
  fixedNotional: 1000,
  feePercentPerSide: 0.04,
  spreadPercent: 0.02,
  slippagePercent: 0.01,
};

export function reversalConfig(overrides = {}) {
  const c = { ...DEFAULT_CONFIG, ...(overrides || {}) };
  c.legLookback = Math.max(1, Math.round(c.legLookback));
  c.maxBarsBetweenReversals = Math.max(1, Math.round(c.maxBarsBetweenReversals));
  c.maxPullbackCandles = Math.max(1, Math.round(c.maxPullbackCandles));
  c.armAfterCycles = Math.max(0, Math.round(c.armAfterCycles));
  c.maxConcurrentPositions = Math.max(1, Math.round(c.maxConcurrentPositions));
  return c;
}

// ---------------------------------------------------------------------------
// Candle helpers. Rows are [ts, open, high, low, close, volume].
// ---------------------------------------------------------------------------
export function toCandle(row) {
  return { ts: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] };
}

export function isBull(c, cfg) {
  if (c.close > c.open) return true;
  if (c.close < c.open) return false;
  return String(cfg.dojiPolicy).toUpperCase() === "BULL";
}

export function isBear(c, cfg) {
  if (c.close < c.open) return true;
  if (c.close > c.open) return false;
  return String(cfg.dojiPolicy).toUpperCase() === "BEAR";
}

// Direction-aware colour tests: "with" = same colour as the trade direction.
function isWith(c, dir, cfg) {
  return dir === "long" ? isBull(c, cfg) : isBear(c, cfg);
}
function isAgainst(c, dir, cfg) {
  return dir === "long" ? isBear(c, cfg) : isBull(c, cfg);
}

function body(c) { return Math.abs(c.close - c.open); }

// A reversal candle must have a real body if the body filter is enabled.
export function hasReversalBody(c, cfg) {
  if (!(cfg.minBodyPercentOfRange > 0)) return true;
  const rng = c.high - c.low;
  if (!(rng > 0)) return false;
  return (body(c) / rng) * 100 >= cfg.minBodyPercentOfRange;
}

// ---------------------------------------------------------------------------
// Step 1: is there a qualifying directional leg ending at bar i?
// LONG wants a DOWN leg, SHORT wants an UP leg.
// ---------------------------------------------------------------------------
export function hasLeg(rows, i, dir, cfg) {
  if (!(cfg.minLegPercent > 0)) return true;
  const k = i - cfg.legLookback;
  if (k < 0) return false;
  const ref = rows[k][4]; // reference close, legLookback bars ago
  if (!(ref > 0)) return false;
  const move = dir === "long" ? ref - rows[i][3] : rows[i][2] - ref;
  if (move <= 0) return false;
  return (move / ref) * 100 >= cfg.minLegPercent;
}

// Step 2: is bar i "at the bottom" (long) / "at the top" (short) of the window?
export function atExtreme(rows, i, dir, cfg) {
  const from = Math.max(0, i - cfg.legLookback);
  const tol = cfg.bottomTolerancePercent / 100;
  if (dir === "long") {
    let lo = Infinity;
    for (let j = from; j <= i; j++) lo = Math.min(lo, rows[j][3]);
    return rows[i][3] <= lo * (1 + tol) + Number.EPSILON;
  }
  let hi = -Infinity;
  for (let j = from; j <= i; j++) hi = Math.max(hi, rows[j][2]);
  return rows[i][2] >= hi * (1 - tol) - Number.EPSILON;
}

// Step 4: is bar i's extreme "near" the running pattern extreme?
export function nearPatternExtreme(c, dir, patternExtreme, cfg) {
  const tol = cfg.bottomTolerancePercent / 100;
  return dir === "long"
    ? c.low <= patternExtreme * (1 + tol) + Number.EPSILON
    : c.high >= patternExtreme * (1 - tol) - Number.EPSILON;
}

// ---------------------------------------------------------------------------
// §3.4 Continuation resumed. Decided on bar `c`'s close; reads no future bar.
// ---------------------------------------------------------------------------
export function continuationResumed(c, prev, pos, dir, cfg) {
  const long = dir === "long";
  const mode = String(cfg.resumeMode || "NEW_HIGH").toUpperCase();
  let base;
  switch (mode) {
    case "CLOSE_ABOVE_PULLBACK_EXTREME":
      base = isWith(c, dir, cfg) &&
        (long ? c.close > pos.pullbackExtreme : c.close < pos.pullbackExtreme);
      break;
    case "CLOSE_ABOVE_PRIOR_BAR":
      base = isWith(c, dir, cfg) && !!prev &&
        (long ? c.close > prev.high : c.close < prev.low);
      break;
    default: // NEW_HIGH — exceeds the pre-pullback swing extreme
      base = long ? c.high > pos.runExtreme : c.low < pos.runExtreme;
  }
  if (!base) return false;
  if (cfg.minResumePercent > 0) {
    if (!(pos.pullbackLow > 0)) return false;
    const travel = long ? c.close - pos.pullbackLow : pos.pullbackLow - c.close;
    if ((travel / pos.pullbackLow) * 100 < cfg.minResumePercent) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// §5 Higher-timeframe trend, with no look-ahead.
//
// Aggregates the base series into HTF buckets, then for each base index i
// reports the trend implied by the last HTF bucket that CLOSED at or before
// rows[i][0]. A forming HTF bar is never read.
// ---------------------------------------------------------------------------
export function htfTrendSeries(rows, baseTf, cfg) {
  const out = new Array(rows.length).fill(null);
  const mode = String(cfg.htfMode || "NONE").toUpperCase();
  if (mode === "NONE" || !rows.length) return out;
  const bMs = tfMs(baseTf);
  const hMs = tfMs(cfg.htfTimeframe);
  if (!(hMs > bMs)) return out; // HTF must be strictly higher
  const buckets = aggregateRows(rows, bMs, hMs);
  if (!buckets.length) return out;

  const trends = new Array(buckets.length).fill(null);
  if (mode === "EMA") {
    const e = ema(buckets, cfg.htfEmaPeriod);
    for (let k = 0; k < buckets.length; k++) {
      if (e[k] == null) continue;
      trends[k] = buckets[k][4] > e[k] ? "up" : "down";
    }
  } else { // CANDLE_COLOR
    for (let k = 0; k < buckets.length; k++) {
      trends[k] = buckets[k][4] > buckets[k][1] ? "up" : buckets[k][4] < buckets[k][1] ? "down" : null;
    }
  }

  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    while (k + 1 < buckets.length && buckets[k + 1][0] + hMs <= rows[i][0]) k++;
    out[i] = k >= 0 ? trends[k] : null;
  }
  return out;
}

// Aggregate [ts,o,h,l,c,v] rows of `fromMs` into `toMs` buckets.
// A bucket is emitted only when it is complete, so a partial trailing bucket is
// dropped rather than repainted.
export function aggregateRows(rows, fromMs, toMs) {
  if (!(toMs > fromMs)) return rows.slice();
  const need = Math.round(toMs / fromMs);
  const out = [];
  let cur = null;
  let count = 0;
  for (const r of rows) {
    const start = Math.floor(r[0] / toMs) * toMs;
    if (!cur || cur[0] !== start) {
      if (cur && count === need) out.push(cur);
      cur = [start, r[1], r[2], r[3], r[4], r[5] || 0];
      count = 1;
    } else {
      cur[2] = Math.max(cur[2], r[2]);
      cur[3] = Math.min(cur[3], r[3]);
      cur[4] = r[4];
      cur[5] = (cur[5] || 0) + (r[5] || 0);
      count++;
    }
  }
  if (cur && count === need) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// The engine. One forward pass over `rows`.
// ---------------------------------------------------------------------------
export function runReversal(rows, overrides = {}, meta = {}) {
  const cfg = reversalConfig(overrides);
  const tf = meta.timeframe || "15m";
  const trades = [];
  const states = new Array(rows.length).fill(STATES.SEEKING_REVERSAL);
  if (!Array.isArray(rows) || rows.length < 3) return { trades, states, config: cfg };

  const htf = htfTrendSeries(rows, tf, cfg);
  const setups = { long: null, short: null }; // at most one pending setup per side
  const positions = [];

  const dirs = [];
  if (cfg.allowLong) dirs.push("long");
  if (cfg.allowShort) dirs.push("short");

  for (let i = 0; i < rows.length; i++) {
    const c = toCandle(rows[i]);
    const prev = i > 0 ? toCandle(rows[i - 1]) : null;

    // -- 1) manage open positions FIRST ------------------------------------
    for (let k = positions.length - 1; k >= 0; k--) {
      const pos = positions[k];
      if (pos.entryIndex === i) continue; // the entry bar itself is not managed
      if (stepPosition(pos, i, c, prev, cfg)) {
        trades.push(finaliseTrade(pos, rows, tf, meta));
        positions.splice(k, 1);
      }
    }

    // -- 2) advance / create setups ----------------------------------------
    const slotFree = () => positions.length < cfg.maxConcurrentPositions;
    for (const dir of dirs) {
      let s = setups[dir];

      if (s) {
        const res = stepSetup(s, i, c, cfg);
        if (res === "reset") {
          setups[dir] = null;
          s = null;
        } else if (res === "entry") {
          // Gates evaluated at the entry bar. The session filter and the HTF
          // trend both read only information available when that bar closed.
          const want = dir === "long" ? "up" : "down";
          const htfOk = String(cfg.htfMode).toUpperCase() === "NONE" || htf[i] === want;
          if (slotFree() && htfOk && inSession(c.ts, cfg)) {
            positions.push(openPosition(s, dir, i, c, cfg, htf[i]));
          }
          setups[dir] = null;
          s = null;
        }
      }

      // A fresh first reversal candle can start (or re-anchor) a setup. Not
      // while the position slot is full — with a 1-position account a setup
      // tracked through a live trade could never have been taken anyway.
      if (slotFree() && (!s || (cfg.reanchorFirst && s.state === STATES.FIRST_REVERSAL_CANDLE && !s.dipped))) {
        if (
          isWith(c, dir, cfg) &&
          hasReversalBody(c, cfg) &&
          hasLeg(rows, i, dir, cfg) &&
          atExtreme(rows, i, dir, cfg)
        ) {
          setups[dir] = {
            dir,
            state: STATES.FIRST_REVERSAL_CANDLE,
            legStartIndex: Math.max(0, i - cfg.legLookback),
            r1: i,
            r1Ref: String(cfg.dipReference).toUpperCase() === "CANDLE_CLOSE"
              ? c.close
              : (dir === "long" ? c.low : c.high),
            patternExtreme: dir === "long" ? c.low : c.high,
            dipped: false,
            dipIndex: null,
            r2: null,
          };
        }
      }

      const cur = setups[dir];
      if (cur) states[i] = cur.state;
    }
    if (positions.length) states[i] = positions[positions.length - 1].state;
  }

  // positions still open at the end of the data are reported as such
  for (const pos of positions) {
    pos.exitReason = "endOfData";
    pos.exitIndex = rows.length - 1;
    pos.exitPrice = rows[rows.length - 1][4];
    pos.state = STATES.CLOSED;
    pos.open = true;
    trades.push(finaliseTrade(pos, rows, tf, meta));
  }

  trades.sort((x, y) => x.entryTs - y.entryTs);
  return { trades, states, config: cfg };
}

// ---------------------------------------------------------------------------
// Setup advance. Returns "hold" | "reset" | "entry".
// Entry is always the close of the second reversal candle, so a setup that
// reaches step 4 enters on that same bar.
// ---------------------------------------------------------------------------
function stepSetup(s, i, c, cfg) {
  if (i <= s.r1) return "hold";
  const long = s.dir === "long";

  // running pattern extreme (the confirmed reversal swing low/high)
  s.patternExtreme = long
    ? Math.min(s.patternExtreme, c.low)
    : Math.max(s.patternExtreme, c.high);

  // timeout on the r1 -> r2 window
  if (i - s.r1 > cfg.maxBarsBetweenReversals) return "reset";

  if (!s.dipped) {
    // step 3: price moves down (long) / up (short) again past the first candle
    const dipped = long ? c.low < s.r1Ref : c.high > s.r1Ref;
    if (!dipped) return "hold";
    // too deep => this is not a bottom any more
    if (cfg.maxDipPercent > 0 && s.r1Ref > 0) {
      const depth = (Math.abs(s.r1Ref - (long ? c.low : c.high)) / s.r1Ref) * 100;
      if (depth > cfg.maxDipPercent) return "reset";
    }
    s.dipped = true;
    s.dipIndex = i;
    s.state = STATES.WAITING_FOR_SECOND_REVERSAL_CANDLE;
  }

  // step 4: a second same-direction candle near the running pattern extreme.
  // The dip and the second candle may be the SAME bar (a bullish candle that
  // prints a new low and closes up) — that is the screenshot's case.
  if (
    isWith(c, s.dir, cfg) &&
    hasReversalBody(c, cfg) &&
    nearPatternExtreme(c, s.dir, s.patternExtreme, cfg)
  ) {
    s.r2 = i;
    s.patternExtremeAtR2 = s.patternExtreme;
    s.state = STATES.WAITING_FOR_DIRECTIONAL_CONFIRMATION;
    s.entryPrice = c.close;
    s.entryIndex = i;
    return "entry";
  }
  return "hold";
}

// ---------------------------------------------------------------------------
// Open a position. Stop = beyond the confirmed reversal swing extreme.
// ---------------------------------------------------------------------------
function openPosition(s, dir, i, c, cfg, htfAtEntry) {
  const long = dir === "long";
  const entry = s.entryPrice;
  const swing = s.patternExtremeAtR2 != null ? s.patternExtremeAtR2 : s.patternExtreme;
  const buf = cfg.slBufferPercent / 100;
  const stop = long ? swing * (1 - buf) : swing * (1 + buf);

  let emergency = null;
  if (cfg.emergencyStopPercent > 0) {
    emergency = long
      ? entry * (1 - cfg.emergencyStopPercent / 100)
      : entry * (1 + cfg.emergencyStopPercent / 100);
  }

  return {
    dir,
    state: STATES.POSITION_OPEN,
    phase: "CONTINUATION",
    entryIndex: i,
    entryTs: c.ts,
    entryPrice: entry,
    stop,
    emergency,
    swing,
    // annotation indices
    legStartIndex: s.legStartIndex,
    r1: s.r1,
    r2: s.r2,
    dipIndex: s.dipIndex ?? null,
    pullbacks: [],
    resumes: [],
    // bookkeeping
    runExtreme: long ? Math.max(entry, c.high) : Math.min(entry, c.low),
    pullbackExtreme: null,
    pullbackLow: null,
    pullbackCount: 0,
    cycles: 0,
    // armAfterCycles 0 = classic behaviour: armed from entry, so the very
    // first opposite candle closes the trade.
    armedIndex: cfg.armAfterCycles === 0 ? i : null,
    htfAtEntry: htfAtEntry || null,
    exitIndex: null,
    exitPrice: null,
    exitReason: null,
    pendingExitAtNextOpen: false,
  };
}

// ---------------------------------------------------------------------------
// Advance an open position by one bar. Returns true when the trade closed.
//
// Ordering is deliberately conservative (§3.2): protective stops are checked
// against the bar's range BEFORE any close-based logic, so a bar that both
// stops out and would have signalled an exit books the stop.
// ---------------------------------------------------------------------------
function stepPosition(pos, i, c, prev, cfg) {
  const long = pos.dir === "long";

  // a NEXT_OPEN exit decided on the previous bar fills here, at this open
  if (pos.pendingExitAtNextOpen) {
    pos.exitIndex = i;
    pos.exitPrice = c.open;
    pos.state = STATES.CLOSED;
    return true;
  }

  // 1) protective stops, intrabar, always active
  if (long ? c.low <= pos.stop : c.high >= pos.stop) {
    pos.exitIndex = i;
    pos.exitPrice = pos.stop;
    pos.exitReason = "stop";
    pos.state = STATES.CLOSED;
    return true;
  }
  if (pos.emergency != null && (long ? c.low <= pos.emergency : c.high >= pos.emergency)) {
    pos.exitIndex = i;
    pos.exitPrice = pos.emergency;
    pos.exitReason = "emergencyStop";
    pos.state = STATES.CLOSED;
    return true;
  }

  // 2) maximum holding duration
  if (cfg.maxHoldBars > 0 && i - pos.entryIndex >= cfg.maxHoldBars) {
    pos.exitIndex = i;
    pos.exitPrice = c.close;
    pos.exitReason = "maxHold";
    pos.state = STATES.CLOSED;
    return true;
  }

  // 3) candle-colour state machine, on this bar's close
  const against = isAgainst(c, pos.dir, cfg);

  if (pos.phase === "CONTINUATION") {
    // the pre-pullback swing extreme only moves while continuation is intact
    pos.runExtreme = long ? Math.max(pos.runExtreme, c.high) : Math.min(pos.runExtreme, c.low);

    // armed + first opposite candle => the strategy's primary exit
    if (pos.armedIndex != null && i > pos.armedIndex && against) {
      pos.state = STATES.EXIT_ON_FIRST_OPPOSITE_CANDLE;
      pos.exitReason = "firstOpposite";
      pos.exitSignalIndex = i;
      if (String(cfg.exitFill).toUpperCase() === "NEXT_OPEN") {
        pos.pendingExitAtNextOpen = true;
        return false;
      }
      pos.exitIndex = i;
      pos.exitPrice = c.close;
      pos.state = STATES.CLOSED;
      return true;
    }

    // an opposite candle opens a (so far temporary) pullback — never an exit
    if (against) {
      pos.phase = "PULLBACK";
      pos.state = STATES.TEMPORARY_PULLBACK;
      pos.pullbackCount = 1;
      pos.pullbackExtreme = long ? c.high : c.low;
      pos.pullbackLow = long ? c.low : c.high;
      pos.pullbacks.push({ start: i, end: null, resumedAt: null, candles: 1 });
    }
    return false;
  }

  // -- phase PULLBACK -------------------------------------------------------
  const pb = pos.pullbacks[pos.pullbacks.length - 1];
  // The adverse extreme includes THIS bar — a bar that dips further and then
  // closes up still counts its dip.
  pos.pullbackLow = long
    ? Math.min(pos.pullbackLow, c.low)
    : Math.max(pos.pullbackLow, c.high);
  // `pullbackExtreme` (the favourable cap of the pullback so far) is left as of
  // BEFORE this bar, because CLOSE_ABOVE_PULLBACK_EXTREME asks whether this bar
  // closes above it. Folding this bar's own high in first would make that
  // condition unsatisfiable. It is updated after the resume decision below.
  if (against) {
    pos.pullbackCount++;
    if (pb) pb.candles = pos.pullbackCount;
  }
  if (pb) pb.end = i;

  // Did continuation resume? Checked BEFORE the failure bounds, so a bar that
  // both resumes and would breach a bound counts as a resume.
  if (continuationResumed(c, prev, pos, pos.dir, cfg)) {
    pos.phase = "CONTINUATION";
    pos.state = STATES.CONTINUATION_RESUMED;
    pos.cycles++;
    if (pb) { pb.end = i; pb.resumedAt = i; }
    pos.resumes.push(i);
    // the resume bar itself can never be the exit bar: the exit requires a bar
    // strictly after armedIndex.
    if (pos.cycles >= cfg.armAfterCycles && pos.armedIndex == null) pos.armedIndex = i;
    pos.runExtreme = long ? Math.max(pos.runExtreme, c.high) : Math.min(pos.runExtreme, c.low);
    pos.pullbackCount = 0;
    return false;
  }

  // no resume on this bar — now fold its high into the pullback cap
  pos.pullbackExtreme = long
    ? Math.max(pos.pullbackExtreme, c.high)
    : Math.min(pos.pullbackExtreme, c.low);

  // §3.3 bounds: beyond these it is a structure break, not a pullback
  let failed = pos.pullbackCount > cfg.maxPullbackCandles;
  if (!failed && cfg.maxPullbackRetracePercent > 0) {
    const run = Math.abs(pos.runExtreme - pos.entryPrice);
    if (run > 0) {
      const give = Math.abs(pos.runExtreme - pos.pullbackLow);
      if ((give / run) * 100 > cfg.maxPullbackRetracePercent) failed = true;
    }
  }
  if (failed && cfg.exitOnFailedContinuation) {
    pos.exitReason = "failedContinuation";
    pos.exitSignalIndex = i;
    if (String(cfg.exitFill).toUpperCase() === "NEXT_OPEN") {
      pos.pendingExitAtNextOpen = true;
      return false;
    }
    pos.exitIndex = i;
    pos.exitPrice = c.close;
    pos.state = STATES.CLOSED;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raw (fee-free) trade record + the annotation payload the chart needs.
// ---------------------------------------------------------------------------
function finaliseTrade(pos, rows, tf, meta) {
  const long = pos.dir === "long";
  const risk = Math.abs(pos.entryPrice - pos.stop);
  const exitIndex = pos.exitIndex;
  const exitPrice = pos.exitPrice;
  const gross = long ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  return {
    symbol: meta.symbol || meta.pair || "",
    pair: meta.pair || meta.symbol || "",
    market: meta.market || "",
    tf,
    direction: pos.dir,
    entryIndex: pos.entryIndex,
    entryTs: rows[pos.entryIndex][0],
    entryPrice: pos.entryPrice,
    stopPrice: pos.stop,
    emergencyPrice: pos.emergency,
    swingPrice: pos.swing,
    riskPerUnit: risk,
    exitIndex,
    exitTs: exitIndex != null ? rows[exitIndex][0] : null,
    exitPrice,
    exitReason: pos.exitReason || "endOfData",
    exitSignalIndex: pos.exitSignalIndex ?? exitIndex,
    grossPerUnit: gross,
    rawR: risk > 0 ? gross / risk : 0,
    barsHeld: exitIndex != null ? exitIndex - pos.entryIndex : null,
    stillOpen: !!pos.open,
    htfAtEntry: pos.htfAtEntry,
    session: sessionKeyOfTs(rows[pos.entryIndex][0]),
    pullbackCount: pos.pullbacks.length,
    resumeCount: pos.resumes.length,
    // §6 chart annotations — all indices into the rows array passed in
    annotations: {
      legStartIndex: pos.legStartIndex,
      reversal1: pos.r1,
      dipIndex: pos.dipIndex,
      reversal2: pos.r2,
      entryIndex: pos.entryIndex,
      pullbacks: pos.pullbacks.map((p) => ({ ...p })),
      resumes: pos.resumes.slice(),
      armedIndex: pos.armedIndex,
      exitIndex,
    },
  };
}
