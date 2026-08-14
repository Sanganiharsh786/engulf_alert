// Run: node lib/fibStrategy.test.mjs
// Covers the multi-target / session / limits additions to the fib strategy.
import {
  fibConfig, activeTargets, fibTarget, nearestLiquidity, inSession,
  bullishStructureBreak, bearishStructureBreak, confirmLong,
} from "./fibStrategy.js";
import { backtestPair, computeStats } from "./fibBacktest.js";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? "PASS" : "FAIL") + " - " + n); };

// --- config defaults --------------------------------------------------------
const c = fibConfig();
ok("multi-target on by default", c.useMultiTarget === true && c.targetMode === "ALL");
ok("partials 40/30/30", c.tp1Percent === 40 && c.tp2Percent === 30 && c.tp3Percent === 30);
ok("zone normalised", c.fibUpper === 0.7 && c.fibLower === 0.786);
ok("max active trades = 1", c.maxActiveTrades === 1);

// --- target modes -----------------------------------------------------------
ok("ALL enables 3", JSON.stringify(activeTargets({ targetMode: "ALL" })) === '{"rr":true,"liq":true,"fib":true}');
const rl = activeTargets({ targetMode: "RR_LIQ" });
ok("RR_LIQ excludes fib", rl.rr && rl.liq && !rl.fib);

// --- fib target (TP3) -------------------------------------------------------
ok("fib ratio 0 = swing high (long)", fibTarget("bullish", 4500, 4000, 0) === 4500);
ok("fib ratio .7 = 0.700 line (long)", Math.abs(fibTarget("bullish", 4500, 4000, 0.7) - 4150) < 1e-9);
ok("fib short mirrors", fibTarget("bearish", 4500, 4000, 0) === 4000);

// --- structure-break confirmation ------------------------------------------
const prev = { open: 10, high: 11, low: 9, close: 9.5 };
ok("bull structure break", bullishStructureBreak(prev, { open: 9.6, high: 12, low: 9.5, close: 11.5 }));
ok("no break if closes below prev high", !bullishStructureBreak(prev, { open: 9.6, high: 12, low: 9.5, close: 10.8 }));
ok("no break if bearish body", !bullishStructureBreak(prev, { open: 11.6, high: 12, low: 9.5, close: 11.2 }));
ok("bear structure break", bearishStructureBreak({ open: 10, high: 11, low: 9, close: 10.5 }, { open: 10.4, high: 10.5, low: 8, close: 8.5 }));
ok("confirmLong STRUCTURE mode", confirmLong(prev, { open: 9.6, high: 12, low: 9.5, close: 11.5 }, "STRUCTURE"));
ok("combo ENGULFING_OR_STRUCTURE", confirmLong(prev, { open: 9.6, high: 12, low: 9.5, close: 11.5 }, "ENGULFING_OR_STRUCTURE"));

// --- liquidity (TP2) --------------------------------------------------------
const highs = [{ index: 10, price: 120 }, { index: 20, price: 110 }, { index: 5, price: 105 }];
ok("nearest liq above entry", nearestLiquidity("bullish", 100, 25, highs, [], 60) === 105);
ok("lookback excludes old pivots", nearestLiquidity("bullish", 100, 25, highs, [], 10) === 110);
ok("none above -> null (no fake target)", nearestLiquidity("bullish", 200, 25, highs, [], 60) === null);
const lows = [{ index: 10, price: 80 }, { index: 20, price: 90 }];
ok("nearest liq below (short)", nearestLiquidity("bearish", 100, 25, [], lows, 60) === 90);

// --- sessions (UTC) ---------------------------------------------------------
const at = (h) => Date.UTC(2024, 0, 15, h, 0, 0);
ok("ALL always true", inSession(at(3), { sessionFilter: "ALL" }));
ok("London in/out", inSession(at(10), { sessionFilter: "LONDON" }) && !inSession(at(3), { sessionFilter: "LONDON" }));
ok("NY in/out", inSession(at(15), { sessionFilter: "NEWYORK" }) && !inSession(at(10), { sessionFilter: "NEWYORK" }));
ok("LONDON_NY union", inSession(at(10), { sessionFilter: "LONDON_NY" }) && inSession(at(20), { sessionFilter: "LONDON_NY" }) && !inSession(at(2), { sessionFilter: "LONDON_NY" }));
const cs = { sessionFilter: "CUSTOM", customSessionStart: "22:00", customSessionEnd: "02:00" };
ok("custom wraps midnight", inSession(at(23), cs) && inSession(at(1), cs) && !inSession(at(12), cs));

// --- end-to-end: synthetic candles through backtestPair ---------------------
// Build a clean LONG setup: down leg to a pivot low, impulse up to a pivot
// high, pullback into the 0.70–0.786 zone, engulfing confirmation, rally to
// all targets. pivotLeft/right = 2 to keep the series short.
function bar(ts, o, h, l, cl) { return [ts, o, h, l, cl, 1000]; }
const T0 = Date.UTC(2024, 0, 1);
const H = 3600e3;
const rows = [];
let t = 0;
const add = (o, h, l, cl) => rows.push(bar(T0 + (t++) * H, o, h, l, cl));

// descent: pivot low at 100 (index 4)
add(118, 119, 112, 113); add(113, 114, 108, 109); add(109, 110, 104, 105);
add(105, 106, 101, 102); add(102, 103, 100, 100.5); // pivot low @100
// impulse up: pivot high at 130 (index 9)
add(100.5, 107, 100.4, 106.5); add(106.5, 114, 106, 113.5); add(113.5, 121, 113, 120.5);
add(120.5, 127, 120, 126.5); add(126.5, 130, 126, 129); // pivot high @130
// pivot confirms 2 bars later; drift down toward the zone
add(129, 129.5, 124, 124.5); add(124.5, 125, 119, 119.5);
// zone for 100->130 is 106.42 (0.786) .. 109 (0.700): dip in, bearish then bullish engulfing
add(119.5, 120, 112, 112.5);
add(112.5, 113, 107.5, 108);                 // bearish candle inside zone
add(107.6, 112.5, 107, 112.2);               // bullish engulfing -> entry @112.2
// rally through all targets
add(112.2, 118, 112, 117.5); add(117.5, 124, 117, 123.5);
add(123.5, 131, 123, 130.5); add(130.5, 140, 130, 139.5);
add(139.5, 145, 139, 144); add(144, 150, 143, 149);

const cfg = fibConfig({
  pivotLeft: 2, pivotRight: 2, minimumImpulsePercent: 5,
  confirmationMode: "ENGULFING", zoneExpiryBars: 300,
});
const pair = { name: "TEST", timeframe: "1h" };
const { trades } = await backtestPair(pair, cfg, { rows });
ok("e2e: exactly one trade", trades.length === 1);
if (trades.length === 1) {
  const tr = trades[0];
  ok("e2e: long", tr.direction === "bullish");
  ok("e2e: has TP1/TP2/TP3 fields", "tp1" in tr && "tp2" in tr && "tp3" in tr);
  ok("e2e: TP1 = entry + 2R", tr.tp1 != null && Math.abs(tr.tp1 - (tr.entry + 2 * (tr.entry - tr.stop))) < 0.01);
  ok("e2e: TP3 = swing high (ratio 0)", tr.tp3 === 130);
  ok("e2e: outcome win", tr.outcome === "win");
  ok("e2e: TP1+TP3 hit flags", tr.tp1Hit === true && tr.tp3Hit === true);
  ok("e2e: blended r positive", tr.r > 0);
  const stats = computeStats([tr], cfg);
  ok("e2e: stats tp1HitRate 100", stats.tp1HitRate === 100);
  ok("e2e: stats slHitRate 0", stats.slHitRate === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
