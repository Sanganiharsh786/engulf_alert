// Run: node lib/reversalStrategy.test.mjs
//
// Validation suite for the candle-reversal / first-opposite-candle strategy
// (REVERSAL_STRATEGY_README.md §7). Hand-built fixtures with exact OHLC values,
// so every expected index and price below is arithmetic, not a fitted number.

import {
  runReversal, reversalConfig, STATES, TIMEFRAMES,
  aggregateRows, htfTrendSeries, isBull, isBear, hasLeg, atExtreme, tfMs,
  sessionKeyOfTs, SESSIONS,
} from "./reversalStrategy.js";
import {
  parseCsv, detectTimeframe, checkGaps, fillPrice, positionSize,
  priceTrades, computeStats, backtestRows, fetchPlan, runReversalBacktest,
  breakdown, istParts,
} from "./reversalBacktest.js";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? "PASS" : "FAIL") + " - " + n); };
const near = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) < eps;

const TF = 15 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);

// [open, close] -> OHLC with a 0.1 wick on each side, unless high/low given.
function mk(specs, pad = 0.1) {
  return specs.map((s, i) => {
    const [o, cl, hi, lo] = s;
    return [
      T0 + i * TF,
      o,
      hi != null ? hi : Math.max(o, cl) + pad,
      lo != null ? lo : Math.min(o, cl) - pad,
      cl,
      100,
    ];
  });
}

// Mirror a series about K: bullish <-> bearish, highs <-> lows.
const K = 200;
const mirror = (rows) => rows.map((r) => [r[0], K - r[1], K - r[3], K - r[2], K - r[4], r[5]]);

// ---------------------------------------------------------------------------
// The canonical LONG fixture, matching the described chart step by step.
//
//  i0-i6  steady down-leg (step 1)
//  i7     first bullish candle at the bottom            (step 2)
//  i8     price dips to a new low                       (step 3)
//  i9     second bullish candle at the new bottom       (step 4) -> ENTRY
//  i10    strong up move                                (step 5)
//  i11-12 TWO bearish candles = temporary pullback      (step 8, must NOT exit)
//  i13    new high => continuation resumed, exit armed  (step 9)
//  i14    another bullish candle
//  i15    first bearish candle after the resume         -> EXIT
//  i16    tail bar, used by the NEXT_OPEN fill test
// ---------------------------------------------------------------------------
const LONG_SPECS = [
  [100.0, 99.5], [99.5, 99.0], [99.0, 98.5], [98.5, 98.0],
  [98.0, 97.5], [97.5, 97.0], [97.0, 96.5],
  [96.5, 97.0],          // i7  first bullish, low 96.4
  [97.0, 96.2],          // i8  dip, low 96.1
  [96.2, 96.9],          // i9  second bullish, low 96.1 -> entry at 96.9
  [96.9, 99.5],          // i10 strong up, high 99.6
  [99.5, 99.1],          // i11 pullback red 1
  [99.1, 98.7],          // i12 pullback red 2
  [98.7, 100.0],         // i13 high 100.1 > 99.6 -> resumed, armed
  [100.0, 100.5],        // i14
  [100.5, 100.0],        // i15 first red after resume -> exit at close 100.0
  [99.8, 99.5],          // i16 tail (open 99.8 for the NEXT_OPEN test)
];
const LONG = mk(LONG_SPECS);
const LONG_ONLY = { allowShort: false };

const ENTRY = 96.9;
const SWING = 96.1;
const STOP = 96.1 * 0.999; // slBufferPercent 0.1
const RISK = ENTRY - STOP;

// ---------------------------------------------------------------------------
console.log("\n== config ==");
const c0 = reversalConfig();
ok("defaults: exit arms after 1 pullback->resume cycle", c0.armAfterCycles === 1);
ok("defaults: resume = new high", c0.resumeMode === "NEW_HIGH");
ok("defaults: pullback bounded at 3 candles / 61.8%",
  c0.maxPullbackCandles === 3 && c0.maxPullbackRetracePercent === 61.8);
ok("defaults: realistic costs on", c0.feePercentPerSide > 0 && c0.spreadPercent > 0 && c0.slippagePercent > 0);
ok("timeframes are the 7 requested",
  TIMEFRAMES.join(",") === "1m,5m,10m,15m,1h,4h,1d");

console.log("\n== candle colour ==");
ok("bullish", isBull({ open: 1, close: 2 }, c0) && !isBear({ open: 1, close: 2 }, c0));
ok("bearish", isBear({ open: 2, close: 1 }, c0) && !isBull({ open: 2, close: 1 }, c0));
ok("doji is neither by default",
  !isBull({ open: 1, close: 1 }, c0) && !isBear({ open: 1, close: 1 }, c0));
ok("dojiPolicy BULL counts it as bullish",
  isBull({ open: 1, close: 1 }, reversalConfig({ dojiPolicy: "BULL" })));

console.log("\n== step 1/2: leg + 'at the bottom' ==");
ok("down-leg detected at i7", hasLeg(LONG, 7, "long", c0));
ok("no down-leg mid up-move (i14)", !hasLeg(LONG, 14, "long", c0));
ok("minLegPercent 0 disables the leg requirement",
  hasLeg(LONG, 14, "long", reversalConfig({ minLegPercent: 0 })));
ok("i7 is at the window bottom", atExtreme(LONG, 7, "long", c0));
ok("i10 is not at the bottom", !atExtreme(LONG, 10, "long", c0));

// ---------------------------------------------------------------------------
console.log("\n== bullish reversal pattern (LONG) ==");
const L = runReversal(LONG, LONG_ONLY, { timeframe: "15m" });
ok("exactly one long trade", L.trades.length === 1);
const t = L.trades[0] || {};
ok("direction long", t.direction === "long");
ok("first reversal candle = i7", t.annotations?.reversal1 === 7);
ok("dip recorded at i8", t.annotations?.dipIndex === 8);
ok("second reversal candle = i9", t.annotations?.reversal2 === 9);
ok("entry on i9 at its close (96.9)", t.entryIndex === 9 && near(t.entryPrice, ENTRY));
ok("stop below the confirmed reversal swing low", near(t.stopPrice, STOP, 1e-9));
ok("swing low recorded = 96.1", near(t.swingPrice, SWING));

console.log("\n== temporary opposite candles must NOT exit ==");
ok("two red candles (i11,i12) did not close the trade", t.exitIndex > 12);
ok("one pullback recorded, spanning i11-i13",
  t.annotations?.pullbacks?.length === 1 &&
  t.annotations.pullbacks[0].start === 11 &&
  t.annotations.pullbacks[0].candles === 2);

console.log("\n== continuation resumed, then first opposite candle ==");
ok("resume at i13", JSON.stringify(t.annotations?.resumes) === "[13]");
ok("exit armed at i13 (not before)", t.annotations?.armedIndex === 13);
ok("resume bar itself is never the exit bar", t.exitIndex !== 13);
ok("exit on i15 — the first red after the resume", t.exitIndex === 15);
ok("exit reason firstOpposite", t.exitReason === "firstOpposite");
ok("exit at that candle's close (100.0)", near(t.exitPrice, 100.0));
ok("barsHeld = 6", t.barsHeld === 6);
ok("raw R = 3.1 / risk", near(t.rawR, (100.0 - ENTRY) / RISK, 1e-9));

console.log("\n== bearish reversal pattern (SHORT) — exact mirror ==");
const S = runReversal(mirror(LONG), { allowLong: false }, { timeframe: "15m" });
ok("exactly one short trade", S.trades.length === 1);
const s = S.trades[0] || {};
ok("direction short", s.direction === "short");
ok("same pattern indices as the long case",
  s.annotations?.reversal1 === 7 && s.annotations?.reversal2 === 9 && s.entryIndex === 9);
ok("mirrored entry price", near(s.entryPrice, K - ENTRY));
ok("mirrored stop price", near(s.stopPrice, (K - SWING) * 1.001, 1e-9));
ok("exit on the first GREEN candle after the resume", s.exitIndex === 15 && s.exitReason === "firstOpposite");
// The price move mirrors exactly. R does not, because slBufferPercent is a
// percentage and the mirrored series sits at a higher price (103.1 vs 96.9),
// so the same 0.1% buffer is a larger absolute distance. That is correct, not
// a mirroring bug — assert the move is exact and R is only buffer-close.
ok("mirrored gross move is identical", near(s.grossPerUnit, t.grossPerUnit, 1e-9));
ok("mirrored R differs only by the percentage stop buffer",
  Math.abs(s.rawR - t.rawR) < 0.05);
ok("single pullback of 2 green candles",
  s.annotations?.pullbacks?.length === 1 && s.annotations.pullbacks[0].candles === 2);

// ---------------------------------------------------------------------------
console.log("\n== exit configuration ==");
const armed0 = runReversal(LONG, { ...LONG_ONLY, armAfterCycles: 0 }, {});
ok("armAfterCycles 0 exits on the first red after entry (i11)",
  armed0.trades[0]?.exitIndex === 11 && armed0.trades[0]?.exitReason === "firstOpposite");

const nextOpen = runReversal(LONG, { ...LONG_ONLY, exitFill: "NEXT_OPEN" }, {});
ok("NEXT_OPEN fills at i16's open (99.8), signal still i15",
  nextOpen.trades[0]?.exitIndex === 16 &&
  near(nextOpen.trades[0]?.exitPrice, 99.8) &&
  nextOpen.trades[0]?.exitSignalIndex === 15);

console.log("\n== resume modes ==");
const rPull = runReversal(LONG, { ...LONG_ONLY, resumeMode: "CLOSE_ABOVE_PULLBACK_EXTREME" }, {});
// i13 closes 100.0 > pullback high 99.6 -> resumes on the same bar as NEW_HIGH
ok("CLOSE_ABOVE_PULLBACK_EXTREME resumes at i13", rPull.trades[0]?.annotations?.armedIndex === 13);
const rPrior = runReversal(LONG, { ...LONG_ONLY, resumeMode: "CLOSE_ABOVE_PRIOR_BAR" }, {});
// i13 closes 100.0 > i12's high 99.2
ok("CLOSE_ABOVE_PRIOR_BAR resumes at i13", rPrior.trades[0]?.annotations?.armedIndex === 13);
const rHighOnly = runReversal(LONG, { ...LONG_ONLY, minResumePercent: 50 }, {});
ok("an unreachable minResumePercent prevents the resume (so no firstOpposite exit)",
  (rHighOnly.trades[0]?.exitReason || "endOfData") !== "firstOpposite");

console.log("\n== structure break (pullback bounds exceeded) ==");
const failSpecs = LONG_SPECS.slice(0, 13).concat([[98.7, 98.5]]);
const failRun = runReversal(mk(failSpecs), {
  ...LONG_ONLY, maxPullbackCandles: 2, maxPullbackRetracePercent: 0,
}, {});
ok("a 3rd pullback candle past maxPullbackCandles exits as failedContinuation",
  failRun.trades[0]?.exitIndex === 13 && failRun.trades[0]?.exitReason === "failedContinuation");
const holdRun = runReversal(mk(failSpecs), {
  ...LONG_ONLY, maxPullbackCandles: 2, maxPullbackRetracePercent: 0, exitOnFailedContinuation: false,
}, {});
ok("exitOnFailedContinuation false holds instead",
  holdRun.trades[0]?.exitReason !== "failedContinuation");

console.log("\n== stop-loss execution ==");
// same pattern, but the bar after entry collapses through the stop (96.0039)
const stopSpecs = LONG_SPECS.slice(0, 10).concat([[96.9, 95.5], [95.5, 95.2]]);
const stopRun = runReversal(mk(stopSpecs), LONG_ONLY, {});
ok("stop hit intrabar on i10", stopRun.trades[0]?.exitIndex === 10 && stopRun.trades[0]?.exitReason === "stop");
ok("filled at the stop price", near(stopRun.trades[0]?.exitPrice, STOP, 1e-9));
ok("raw R = -1 at the stop", near(stopRun.trades[0]?.rawR, -1, 1e-9));

// a bar that both stops out and would signal an exit must book the stop
const bothSpecs = LONG_SPECS.slice(0, 15).concat([[100.5, 100.0, 100.6, 95.0]]);
const bothRun = runReversal(mk(bothSpecs), LONG_ONLY, {});
ok("stop wins over a same-bar first-opposite signal",
  bothRun.trades[0]?.exitIndex === 15 && bothRun.trades[0]?.exitReason === "stop");

console.log("\n== emergency stop + max holding duration ==");
const emgRun = runReversal(LONG, { ...LONG_ONLY, emergencyStopPercent: 0.2 }, {});
// 0.2% below 96.9 = 96.7062; i10's low is 96.8, i11's low 99.0 -> never hit here
ok("emergency stop above the bar lows is not triggered spuriously",
  emgRun.trades[0]?.exitReason === "firstOpposite");
const emgHit = runReversal(mk(LONG_SPECS), { ...LONG_ONLY, emergencyStopPercent: 0.05 }, {});
// 0.05% below 96.9 = 96.85155 > i10's low 96.8 -> hit on i10, before the swing stop
ok("emergency stop fires before the swing stop when it is tighter",
  emgHit.trades[0]?.exitIndex === 10 && emgHit.trades[0]?.exitReason === "emergencyStop");
const holdCap = runReversal(LONG, { ...LONG_ONLY, maxHoldBars: 3 }, {});
ok("maxHoldBars closes at i12", holdCap.trades[0]?.exitIndex === 12 && holdCap.trades[0]?.exitReason === "maxHold");

console.log("\n== direction toggles ==");
ok("allowLong false suppresses the long", runReversal(LONG, { allowLong: false, allowShort: false }, {}).trades.length === 0);

// ---------------------------------------------------------------------------
console.log("\n== no look-ahead / no repainting ==");
// Prefix invariance: the engine fed only the first k bars must produce exactly
// the trades that had already closed by bar k-1. If any decision peeked at a
// future bar, some prefix would disagree.
function prefixInvariant(rows, cfg) {
  const full = runReversal(rows, cfg, {}).trades;
  for (let k = 20; k <= rows.length; k++) {
    const part = runReversal(rows.slice(0, k), cfg, {}).trades;
    const closedPart = part.filter((x) => !x.stillOpen);
    for (const p of closedPart) {
      const m = full.find((f) => f.entryIndex === p.entryIndex && f.direction === p.direction);
      if (!m) return `prefix ${k}: trade at entry ${p.entryIndex} does not exist in the full run`;
      if (m.exitIndex !== p.exitIndex || !near(m.exitPrice, p.exitPrice, 1e-9) ||
          !near(m.entryPrice, p.entryPrice, 1e-9) || m.exitReason !== p.exitReason) {
        return `prefix ${k}: trade at entry ${p.entryIndex} differs (${p.exitIndex}/${p.exitReason} vs ${m.exitIndex}/${m.exitReason})`;
      }
    }
  }
  return null;
}
const pi1 = prefixInvariant(LONG, LONG_ONLY);
ok("prefix-invariant on the long fixture" + (pi1 ? ": " + pi1 : ""), pi1 === null);
const pi2 = prefixInvariant(mirror(LONG), { allowLong: false });
ok("prefix-invariant on the short fixture" + (pi2 ? ": " + pi2 : ""), pi2 === null);

// A longer pseudo-random series exercises many more paths.
function randomSeries(n, seed = 7) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const cl = +(o * (1 + (rnd() - 0.5) * 0.012)).toFixed(4);
    const hi = +(Math.max(o, cl) * (1 + rnd() * 0.004)).toFixed(4);
    const lo = +(Math.min(o, cl) * (1 - rnd() * 0.004)).toFixed(4);
    rows.push([T0 + i * TF, o, hi, lo, cl, 100]);
    p = cl;
  }
  return rows;
}
const RND = randomSeries(600);
const rndRun = runReversal(RND, {}, { timeframe: "15m" });
ok("random series produces trades (engine actually fires)", rndRun.trades.length > 0);
const pi4 = prefixInvariant(RND.slice(0, 220), {});
ok("prefix-invariant on a 220-bar random series" + (pi4 ? ": " + pi4 : ""), pi4 === null);
ok("no trade exits before it enters", rndRun.trades.every((x) => x.exitIndex == null || x.exitIndex > x.entryIndex));
ok("never more than maxConcurrentPositions open at once", (() => {
  const ev = [];
  for (const x of rndRun.trades) { ev.push([x.entryIndex, 1]); ev.push([(x.exitIndex ?? 1e9) + 0.5, -1]); }
  ev.sort((a, b) => a[0] - b[0]);
  let open = 0, max = 0;
  for (const [, d] of ev) { open += d; max = Math.max(max, open); }
  return max <= 1;
})());

// ---------------------------------------------------------------------------
console.log("\n== fees, spread and slippage ==");
const freeCfg = reversalConfig({
  feePercentPerSide: 0, spreadPercent: 0, slippagePercent: 0,
  sizingMode: "FIXED_QTY", fixedQty: 1,
});
const costCfg = reversalConfig({ sizingMode: "FIXED_QTY", fixedQty: 1 });
const freeT = priceTrades(L.trades, freeCfg)[0];
const costT = priceTrades(L.trades, costCfg)[0];
ok("frictionless net P&L = raw move (3.1)", near(freeT.netPnl, 3.1, 1e-9));
ok("costs reduce net P&L", costT.netPnl < freeT.netPnl);
// edge = spread/200 + slip/100 = 0.0001 + 0.0001 = 0.0002
ok("entry fill pays the half-spread + slippage", near(costT.entryFill, +(96.9 * 1.0002).toFixed(4), 1e-9));
ok("exit fill gives it up", near(costT.exitFill, +(100.0 * 0.9998).toFixed(4), 1e-9));
const expFees = +((96.9 * 1.0002 + 100.0 * 0.9998) * 0.0004).toFixed(2);
ok("fees charged both sides on the notional", near(costT.fees, expFees, 1e-9));
ok("net = gross - fees", near(costT.netPnl, +(costT.exitFill - costT.entryFill - costT.fees).toFixed(2), 0.011));
ok("fillPrice: long entry up, long exit down",
  fillPrice(100, "long", "entry", costCfg) > 100 && fillPrice(100, "long", "exit", costCfg) < 100);
ok("fillPrice: short entry down, short exit up",
  fillPrice(100, "short", "entry", costCfg) < 100 && fillPrice(100, "short", "exit", costCfg) > 100);
// slippage widens the real risk, so a stop-out loses slightly more than 1R
const stopPriced = priceTrades(stopRun.trades, costCfg)[0];
ok("a stop-out after costs is worse than -1R", stopPriced.r < -1 && stopPriced.r > -1.3);

console.log("\n== position sizing ==");
ok("RISK_PERCENT: 1% of 10k over 2.0 risk = 50 units",
  near(positionSize(reversalConfig({ riskPercent: 1 }), 10000, 2, 100), 50));
ok("RISK_PERCENT compounds with equity",
  near(positionSize(reversalConfig({ riskPercent: 1 }), 20000, 2, 100), 100));
ok("FIXED_RISK: 100 cash / 2.0 risk = 50 units",
  near(positionSize(reversalConfig({ sizingMode: "FIXED_RISK", fixedRiskAmount: 100 }), 99999, 2, 100), 50));
ok("FIXED_QTY ignores risk",
  near(positionSize(reversalConfig({ sizingMode: "FIXED_QTY", fixedQty: 3 }), 10000, 2, 100), 3));
ok("FIXED_NOTIONAL: 1000 / price 100 = 10 units",
  near(positionSize(reversalConfig({ sizingMode: "FIXED_NOTIONAL", fixedNotional: 1000 }), 10000, 2, 100), 10));
ok("zero risk => zero size (trade skipped, not divided by zero)",
  positionSize(reversalConfig(), 10000, 0, 100) === 0);

console.log("\n== metrics ==");
const rndPriced = priceTrades(rndRun.trades, reversalConfig());
const st = computeStats(rndPriced, reversalConfig());
ok("trade count matches closed trades", st.totalTrades === rndPriced.filter((x) => !x.skipped && !x.stillOpen).length);
ok("wins + losses + flat = total", st.wins + st.losses <= st.totalTrades);
ok("win rate consistent", near(st.winRate, st.totalTrades ? +((st.wins / st.totalTrades) * 100).toFixed(2) : 0, 0.011));
ok("net profit = final equity - initial", near(st.netProfit, +(st.finalEquity - st.initialCapital).toFixed(2), 0.011));
ok("profit factor = gross profit / gross loss",
  st.profitFactor == null || near(st.profitFactor, +(st.grossProfit / st.grossLoss).toFixed(2), 0.011));
ok("max drawdown is non-negative", st.maxDrawdown >= 0);
ok("equity curve has one point per closed trade + the opening point",
  st.equityCurve.length === st.totalTrades + 1);
ok("drawdown curve matches the equity curve length", st.drawdownCurve.length === st.equityCurve.length);
ok("fees are accounted", st.totalFees > 0);
ok("avg holding duration reported", st.avgBarsHeld > 0 && st.avgHoldMinutes > 0);
ok("by-direction breakdown present", st.byDirection.length > 0);
ok("by-exit-reason breakdown present", st.byExitReason.length > 0);
ok("exit reasons are all known", st.byExitReason.every((r) =>
  ["firstOpposite", "stop", "emergencyStop", "failedContinuation", "maxHold", "endOfData"].includes(r.key)));
const empty = computeStats([], reversalConfig());
ok("empty result set does not divide by zero",
  empty.totalTrades === 0 && empty.winRate === 0 && empty.netProfit === 0 && empty.profitFactor === 0);

// ---------------------------------------------------------------------------
console.log("\n== timeframes ==");
ok("10m is derived from 5m 2:1", fetchPlan("10m").fetchTf === "5m" && fetchPlan("10m").factor === 2);
ok("15m is native", fetchPlan("15m").fetchTf === "15m" && fetchPlan("15m").factor === 1);
const m5 = Array.from({ length: 8 }, (_, i) => [T0 + i * 300000, 10 + i, 11 + i, 9 + i, 10.5 + i, 1]);
const m10 = aggregateRows(m5, 300000, 600000);
ok("5m -> 10m aggregation: 8 bars -> 4", m10.length === 4);
ok("aggregated bar takes first open / last close / max high / min low / summed volume",
  m10[0][1] === 10 && m10[0][4] === 11.5 && m10[0][2] === 12 && m10[0][3] === 9 && m10[0][5] === 2);
const partial = aggregateRows(m5.slice(0, 7), 300000, 600000);
ok("an incomplete trailing bucket is dropped (no repaint)", partial.length === 3);
ok("tfMs covers every supported timeframe", TIMEFRAMES.every((x) => tfMs(x) > 0));
ok("config carries no ATR / entry-mode / pivot knobs",
  ["minLegATR","minBodyATR","atrStopMultiple","minResumeATR","atrPeriod","entryMode",
   "confirmationExpiryBars","pivotLeft","pivotRight","resumeBullCandles","legMode"]
    .every((k) => !(k in c0)));

let tfOk = true;
const tfReport = [];
for (const tf of TIMEFRAMES) {
  try {
    const r = backtestRows(RND, tf, {}, { symbol: "TEST" });
    tfReport.push(`${tf}:${r.stats.totalTrades}`);
    if (r.stats.totalTrades < 0 || !r.stats.equityCurve) tfOk = false;
  } catch (e) { tfOk = false; tfReport.push(`${tf}:ERR ${e.message}`); }
}
ok("every supported timeframe backtests without error [" + tfReport.join(" ") + "]", tfOk);

// A real multi-timeframe run: one 1m series, resampled per timeframe, each
// backtested independently. Each timeframe must see its own bar count and its
// own trades — this is what the comparison table is built from.
const ONE_MIN = (() => {
  let x = 11;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = [];
  let p = 100;
  for (let i = 0; i < 4320; i++) { // 3 days of 1m candles
    const o = p;
    const cl = +(o * (1 + (rnd() - 0.5) * 0.004)).toFixed(4);
    rows.push([
      Date.UTC(2024, 0, 1) + i * 60000, o,
      +(Math.max(o, cl) * (1 + rnd() * 0.0015)).toFixed(4),
      +(Math.min(o, cl) * (1 - rnd() * 0.0015)).toFixed(4),
      cl, 100,
    ]);
    p = cl;
  }
  return rows;
})();
const mtf = await runReversalBacktest({
  rows: ONE_MIN, timeframes: ["1m", "5m", "10m", "15m", "1h"], source: "test", symbol: "TEST",
});
ok("multi-timeframe run returns one result per timeframe", mtf.results.length === 5 && mtf.errors.length === 0);
ok("bar counts shrink as the timeframe rises",
  (() => {
    const b = mtf.results.map((r) => r.bars);
    for (let i = 1; i < b.length; i++) if (!(b[i] < b[i - 1])) return false;
    return b[0] === 4320 && b[1] === 864 && b[2] === 432 && b[3] === 288;
  })());
ok("comparison table carries one row per timeframe with the headline metrics",
  mtf.comparison.length === 5 &&
  mtf.comparison.every((r) => "winRate" in r && "netProfit" in r && "profitFactor" in r &&
    "maxDrawdown" in r && "expectancy" in r && "avgHoldMinutes" in r));
ok("timeframes produce genuinely different results (not the same run relabelled)",
  new Set(mtf.comparison.map((r) => `${r.totalTrades}/${r.netProfit}`)).size > 1);
ok("source is labelled so sample data can never pass as live", mtf.source === "test");

console.log("\n== higher-timeframe confirmation (no look-ahead) ==");
const h = htfTrendSeries(RND, "15m", reversalConfig({ htfMode: "CANDLE_COLOR", htfTimeframe: "1h" }));
ok("htf series aligned to rows", h.length === RND.length);
ok("htf is null until the first HTF bar has closed", h[0] === null);
ok("htf resolves later in the series", h.some((v) => v === "up" || v === "down"));
// the value at bar i must come from an HTF bar that closed at or before rows[i].ts
const buckets1h = aggregateRows(RND, TF, 3600000);
let htfCausal = true;
for (let i = 0; i < RND.length; i++) {
  if (h[i] == null) continue;
  const last = buckets1h.filter((b) => b[0] + 3600000 <= RND[i][0]).pop();
  if (!last) { htfCausal = false; break; }
  const want = last[4] > last[1] ? "up" : last[4] < last[1] ? "down" : null;
  if (want != null && h[i] !== want) { htfCausal = false; break; }
}
ok("htf value only ever reflects a CLOSED higher-timeframe bar", htfCausal);
const noHtf = runReversal(RND, {}, { timeframe: "15m" }).trades.length;
const withHtf = runReversal(RND, { htfMode: "CANDLE_COLOR", htfTimeframe: "1h" }, { timeframe: "15m" }).trades.length;
ok("htf filter only removes trades", withHtf <= noHtf);

// ---------------------------------------------------------------------------
console.log("\n== CSV ingestion and validation ==");
const goodCsv = [
  "time,open,high,low,close,volume",
  "1704067200000,100,101,99,100.5,10",
  "1704068100000,100.5,102,100,101.5,11",
  "1704069000000,101.5,103,101,102.5,12",
].join("\n");
const g = parseCsv(goodCsv);
ok("clean CSV parses 3 rows with no errors", g.rows.length === 3 && g.report.errors.length === 0);
ok("values mapped to [ts,o,h,l,c,v]",
  g.rows[0][0] === 1704067200000 && g.rows[0][1] === 100 && g.rows[0][4] === 100.5);

ok("missing close column is an error",
  parseCsv("time,open,high,low\n1,1,1,1").report.errors.some((e) => /close/i.test(e)));
ok("header-only CSV is an error", parseCsv("time,open,high,low,close").report.errors.length > 0);

const dup = parseCsv("time,open,high,low,close\n1704067200000,1,2,0.5,1.5\n1704067200000,1,2,0.5,1.5");
ok("duplicate timestamps detected and dropped",
  dup.report.duplicateTimestamps === 1 && dup.rows.length === 1);

const badOhlc = parseCsv([
  "time,open,high,low,close",
  "1704067200000,100,99,101,100",   // high < low
  "1704068100000,100,100.5,99,102", // close above high
  "1704069000000,100,101,99,100",   // valid
].join("\n"));
ok("OHLC violations rejected, valid row kept",
  badOhlc.report.badOhlc === 2 && badOhlc.rows.length === 1);
ok("non-positive price rejected",
  parseCsv("time,open,high,low,close\n1704067200000,0,1,0,0.5").report.badOhlc === 1);
ok("unparseable timestamp rejected",
  parseCsv("time,open,high,low,close\nnot-a-date,100,101,99,100").report.badTimestamp === 1);

const unordered = parseCsv([
  "time,open,high,low,close",
  "1704068100000,100,101,99,100",
  "1704067200000,100,101,99,100",
].join("\n"));
ok("out-of-order rows reported and sorted",
  unordered.report.outOfOrder === 1 && unordered.rows[0][0] < unordered.rows[1][0]);

ok("ISO date strings accepted",
  parseCsv("date,open,high,low,close\n2024-01-01T00:00:00Z,100,101,99,100").rows.length === 1);
ok("second-epoch timestamps scaled to ms",
  parseCsv("time,open,high,low,close\n1704067200,100,101,99,100").rows[0][0] === 1704067200000);
ok("column aliases (o/h/l/c) accepted",
  parseCsv("timestamp,o,h,l,c\n1704067200000,100,101,99,100").rows.length === 1);
ok("semicolon-separated CSV accepted",
  parseCsv("time;open;high;low;close\n1704067200000;100;101;99;100").rows.length === 1);

const gapRows = [
  [T0, 100, 101, 99, 100, 1],
  [T0 + TF, 100, 101, 99, 100, 1],
  [T0 + TF * 5, 100, 101, 99, 100, 1], // 3 candles missing
  [T0 + TF * 6, 100, 101, 99, 100, 1],
];
ok("timeframe detected from the modal bar spacing", detectTimeframe(gapRows) === TF);
const gapReport = checkGaps(gapRows, TF, { missingCandles: 0, gaps: [], warnings: [] });
ok("missing candles counted", gapReport.missingCandles === 3 && gapReport.gaps.length === 1);


// ---------------------------------------------------------------------------
console.log("\n== breakdowns: month / week / weekday / session ==");
// A hand-built set of priced trades, so every bucket below is countable by eye.
const ist = (y, mo, d, h, mi = 0) => Date.UTC(y, mo, d, h, mi) - 5.5 * 3600e3;
const fake = (entryTs, netPnl, r, dir = "long", bars = 3) => {
  const ep = istParts(entryTs);
  return {
    direction: dir, netPnl, r, fees: 1, barsHeld: bars, holdMinutes: bars * 15,
    entryTs, exitTs: entryTs + bars * 9e5, exitReason: "firstOpposite",
    monthKey: ep.monthKey, monthLabel: ep.monthLabel, weekKey: ep.weekKey,
    dowIndex: ep.dowIndex, dowLabel: ep.dowLabel,
    session: sessionKeyOfTs(entryTs), pair: "TEST",
  };
};
// 2024-01-15 is a Monday (IST). 14:00 IST = London, 20:00 IST = New York.
const FAKE = [
  fake(ist(2024, 0, 15, 14), 100, 1),        // Mon, Jan, week of Jan 15, London
  fake(ist(2024, 0, 16, 20), -50, -1),       // Tue, Jan, same week,     New York
  fake(ist(2024, 0, 22, 14), 200, 2),        // Mon, Jan, week of Jan 22, London
  fake(ist(2024, 1, 5, 9), -50, -1),         // Mon, Feb, week of Feb 5,  Tokyo
  fake(ist(2024, 1, 5, 3), 25, 0.5),         // Mon, Feb, same week,      Sydney
];
const fst = computeStats(FAKE, reversalConfig());

ok("byMonth splits Jan / Feb", fst.byMonth.length === 2);
ok("byMonth is chronological with readable labels",
  fst.byMonth[0].label === "Jan 2024" && fst.byMonth[1].label === "Feb 2024");
ok("Jan: 3 trades, 2 wins, net +250",
  fst.byMonth[0].trades === 3 && fst.byMonth[0].wins === 2 && fst.byMonth[0].netProfit === 250);
ok("Feb: 2 trades, net -25", fst.byMonth[1].trades === 2 && fst.byMonth[1].netProfit === -25);
ok("month win rate", near(fst.byMonth[0].winRate, 66.67, 0.01));
ok("month profit factor = 300/50", fst.byMonth[0].profitFactor === 6);

ok("byWeek splits 3 Monday-start weeks", fst.byWeek.length === 3);
ok("weeks are keyed by their Monday (IST)",
  fst.byWeek.map((w) => w.key).join(",") === "2024-01-15,2024-01-22,2024-02-05");
ok("Mon+Tue land in the same week bucket", fst.byWeek[0].trades === 2);

ok("byDayOfWeek buckets by entry weekday",
  fst.byDayOfWeek.map((d) => `${d.label}:${d.trades}`).join(",") === "Mon:4,Tue:1");
ok("weekday order starts at Monday", fst.byDayOfWeek[0].label === "Mon");

ok("bySession uses the app's IST session windows",
  JSON.stringify(fst.bySession.map((x) => `${x.key}:${x.trades}`)) ===
  JSON.stringify(["sydney:1", "tokyo:1", "london:2", "newyork:1"]));
ok("session labels come from lib/sessions.js",
  fst.bySession.find((x) => x.key === "london").label === "London");
ok("London net = +300", fst.bySession.find((x) => x.key === "london").netProfit === 300);

ok("every breakdown reports the same column set", (() => {
  const cols = ["key","label","trades","wins","losses","winRate","netProfit","grossProfit",
    "grossLoss","fees","profitFactor","expectancy","avgBarsHeld","maxDrawdown"];
  return [fst.byMonth, fst.byWeek, fst.byDayOfWeek, fst.bySession, fst.byDirection,
          fst.byExitReason, fst.byPair]
    .every((t) => t.every((row) => cols.every((c) => c in row)));
})());
ok("every breakdown's trade counts sum to the total", (() => {
  const sum = (t) => t.reduce((a, x) => a + x.trades, 0);
  return [fst.byMonth, fst.byWeek, fst.byDayOfWeek, fst.bySession, fst.byDirection, fst.byPair]
    .every((t) => sum(t) === fst.totalTrades);
})());
ok("every breakdown's net sums to the overall net", (() => {
  const sum = (t) => +t.reduce((a, x) => a + x.netProfit, 0).toFixed(2);
  return [fst.byMonth, fst.byWeek, fst.byDayOfWeek, fst.bySession, fst.byPair]
    .every((t) => Math.abs(sum(t) - fst.netProfit) < 0.011);
})());
// per-bucket drawdown is measured on that bucket's own run of trades
ok("per-bucket max drawdown is local to the bucket",
  fst.byMonth[1].maxDrawdown === 50 && fst.byMonth[0].maxDrawdown === 50);
ok("breakdown() skips null keys", breakdown([{ netPnl: 1, r: 1 }], () => null).length === 0);

console.log("\n== session filter ==");
const allSess = runReversal(RND, {}, { timeframe: "15m" }).trades;
const lonOnly = runReversal(RND, { sessionFilter: "LONDON" }, { timeframe: "15m" }).trades;
ok("session filter only removes trades", lonOnly.length <= allSess.length);
ok("every trade taken under LONDON is in the London session",
  lonOnly.length > 0 && lonOnly.every((t) => t.session === "london"));
const lnNy = runReversal(RND, { sessionFilter: "LONDON_NY" }, { timeframe: "15m" }).trades;
ok("combo filter admits both of its sessions",
  lnNy.every((t) => t.session === "london" || t.session === "newyork") && lnNy.length >= lonOnly.length);
ok("trades carry the session they were entered in",
  allSess.every((t) => SESSIONS.some((s) => s.key === t.session)));
const custom = runReversal(RND, {
  sessionFilter: "CUSTOM", customSessionStart: "14:00", customSessionEnd: "15:00",
}, { timeframe: "15m" }).trades;
ok("a 1-hour custom IST window is honoured",
  custom.every((t) => {
    const m = new Date(t.entryTs + 5.5 * 3600e3).getUTCHours();
    return m === 14;
  }));

console.log("\n== multiple instruments in one run ==");
const SERIES_A = randomSeries(400, 3);
const SERIES_B = randomSeries(400, 99).map((r) => [r[0], r[1] * 20, r[2] * 20, r[3] * 20, r[4] * 20, r[5]]);
const multi = await runReversalBacktest({
  pairs: [
    { name: "BTCUSDT.P", market: "crypto", _rows: SERIES_A },
    { name: "PAXGUSDT.P", market: "gold", _rows: SERIES_B },
  ],
  timeframes: ["15m", "1h"], source: "test",
});
ok("two pairs x two timeframes = four results", multi.results.length === 4 && multi.errors.length === 0);
ok("each result is identified by pair|timeframe",
  multi.results.map((r) => r.id).sort().join(",") ===
  "BTCUSDT.P|15m,BTCUSDT.P|1h,PAXGUSDT.P|15m,PAXGUSDT.P|1h");
ok("gold carries its market tag",
  multi.results.find((r) => r.pair === "PAXGUSDT.P").market === "gold");
ok("comparison table has a row per pair x timeframe",
  multi.comparison.length === 4 && multi.comparison.every((r) => r.pair && r.timeframe));
ok("trades are tagged with their pair",
  multi.results.every((r) => r.trades.every((t) => t.pair === r.pair)));
ok("each pair is sized off its own equity curve (results are independent)", (() => {
  const solo = await0(SERIES_A);
  const inMulti = multi.results.find((r) => r.id === "BTCUSDT.P|15m");
  return solo.stats.netProfit === inMulti.stats.netProfit &&
    solo.stats.totalTrades === inMulti.stats.totalTrades;
})());
function await0(rows) { return backtestRows(rows, "15m", {}, { pair: "BTCUSDT.P" }); }
ok("pairs list echoed back", JSON.stringify(multi.pairs) === '["BTCUSDT.P","PAXGUSDT.P"]');

// ---------------------------------------------------------------------------
console.log("\n== states are explicit ==");
ok("all 9 documented states exported", [
  "SEEKING_REVERSAL", "FIRST_REVERSAL_CANDLE", "WAITING_FOR_SECOND_REVERSAL_CANDLE",
  "WAITING_FOR_DIRECTIONAL_CONFIRMATION", "POSITION_OPEN", "TEMPORARY_PULLBACK",
  "CONTINUATION_RESUMED", "EXIT_ON_FIRST_OPPOSITE_CANDLE", "CLOSED",
].every((k) => STATES[k] === k));
ok("the long run records a TEMPORARY_PULLBACK state", L.states.includes(STATES.TEMPORARY_PULLBACK));
ok("the long run records CONTINUATION_RESUMED", L.states.includes(STATES.CONTINUATION_RESUMED));
ok("the long run records WAITING_FOR_SECOND_REVERSAL_CANDLE",
  L.states.includes(STATES.WAITING_FOR_SECOND_REVERSAL_CANDLE));

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
