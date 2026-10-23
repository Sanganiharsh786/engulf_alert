// Backtest layer for the candle-reversal / first-opposite-candle strategy.
//
// Keeps the signal engine (lib/reversalStrategy.js) price-pure and adds the
// things a realistic backtest needs on top:
//   * spread / slippage / fees on every fill (§4)
//   * position sizing against a compounding equity curve
//   * the performance metrics the dashboard shows (§7)
//   * CSV ingestion + OHLCV validation (§6)
//   * multi-timeframe runs and a cross-timeframe comparison table (§5)

import { fetchOHLCV, fetchOHLCVRange } from "./market.js";
import {
  runReversal, reversalConfig, aggregateRows, tfMs, TIMEFRAMES, SESSIONS,
} from "./reversalStrategy.js";

export { TIMEFRAMES, SESSIONS };

const MAX_BARS = 18000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function round(n, dp = 4) {
  if (n == null || !isFinite(n)) return n == null ? null : 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Every calendar bucket in this file is on the IST clock, matching the session
// windows in lib/sessions.js and the time column in the trades table.
function istParts(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  // Monday-start week, keyed by that Monday's IST date
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, mo, day - mondayOffset));
  return {
    date: `${y}-${p(mo + 1)}-${p(day)}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    monthKey: `${y}-${p(mo + 1)}`,
    monthLabel: `${MONTHS[mo]} ${y}`,
    weekKey: `${monday.getUTCFullYear()}-${p(monday.getUTCMonth() + 1)}-${p(monday.getUTCDate())}`,
    dowIndex: dow,
    dowLabel: DOW[dow],
  };
}

export { istParts };

// ---------------------------------------------------------------------------
// Timeframes the exchange does not serve natively are built by aggregation.
// 10m is the one the spec asks for that Binance has no interval for.
// ---------------------------------------------------------------------------
const DERIVED_TF = {
  "10m": { base: "5m", factor: 2 },
};

export function fetchPlan(tf) {
  const d = DERIVED_TF[tf];
  return d ? { fetchTf: d.base, factor: d.factor } : { fetchTf: tf, factor: 1 };
}

// ---------------------------------------------------------------------------
// §6 CSV parsing + OHLCV validation
// ---------------------------------------------------------------------------
const COL_ALIASES = {
  ts: ["time", "timestamp", "date", "datetime", "open_time", "opentime", "ts"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "price"],
  volume: ["volume", "vol", "v", "basevolume"],
};

function splitLine(line) {
  // handles comma or semicolon or tab separated, with optional quotes
  const sep = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ",";
  const out = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === sep && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseTs(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // 10-digit = seconds, 13-digit = ms, 16-digit = microseconds
    if (s.length <= 10) return n * 1000;
    if (s.length <= 13) return n;
    return Math.round(n / 1000);
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  // "2024-01-15 10:30:00" without a zone is parsed as UTC for determinism
  const t2 = Date.parse(s.replace(" ", "T") + "Z");
  return isNaN(t2) ? null : t2;
}

// Returns { rows, report }. `rows` holds only the rows that passed; `report`
// lists every problem found so the UI can show it.
export function parseCsv(text) {
  const report = {
    totalLines: 0, parsed: 0, dropped: 0,
    errors: [], warnings: [],
    duplicateTimestamps: 0, outOfOrder: 0, badOhlc: 0, badTimestamp: 0,
    missingCandles: 0, gaps: [],
  };
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  report.totalLines = lines.length;
  if (lines.length < 2) {
    report.errors.push("CSV needs a header row and at least one data row.");
    return { rows: [], report };
  }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const idx = {};
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    idx[key] = header.findIndex((h) => aliases.includes(h));
  }
  for (const k of ["ts", "open", "high", "low", "close"]) {
    if (idx[k] < 0) {
      report.errors.push(
        `Missing required column "${k === "ts" ? "time/timestamp/date" : k}". Found: ${header.join(", ") || "(none)"}`
      );
    }
  }
  if (report.errors.length) return { rows: [], report };

  const rows = [];
  const seen = new Map();
  for (let i = 1; i < lines.length; i++) {
    const f = splitLine(lines[i]);
    const ts = parseTs(f[idx.ts]);
    const o = Number(f[idx.open]), h = Number(f[idx.high]);
    const l = Number(f[idx.low]), c = Number(f[idx.close]);
    const v = idx.volume >= 0 ? Number(f[idx.volume]) || 0 : 0;

    if (ts == null) { report.badTimestamp++; report.dropped++; continue; }
    if (![o, h, l, c].every((n) => isFinite(n) && n > 0)) { report.badOhlc++; report.dropped++; continue; }
    if (h < l || h < Math.max(o, c) - 1e-9 || l > Math.min(o, c) + 1e-9) {
      report.badOhlc++; report.dropped++; continue;
    }
    if (seen.has(ts)) { report.duplicateTimestamps++; report.dropped++; continue; }
    seen.set(ts, true);
    rows.push([ts, o, h, l, c, v]);
  }

  // order check before sorting, so we can report it
  for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0]) report.outOfOrder++;
  rows.sort((a, b) => a[0] - b[0]);
  report.parsed = rows.length;

  if (report.badTimestamp) report.warnings.push(`${report.badTimestamp} row(s) dropped: unparseable timestamp.`);
  if (report.badOhlc) report.warnings.push(`${report.badOhlc} row(s) dropped: invalid OHLC (non-positive, or high/low inconsistent with open/close).`);
  if (report.duplicateTimestamps) report.warnings.push(`${report.duplicateTimestamps} duplicate timestamp(s) dropped (first kept).`);
  if (report.outOfOrder) report.warnings.push(`${report.outOfOrder} row(s) were out of chronological order and have been sorted.`);
  if (!rows.length) report.errors.push("No valid candles after validation.");
  return { rows, report };
}

// Detect the bar spacing of a series (the modal gap), then count missing bars.
export function detectTimeframe(rows) {
  if (rows.length < 3) return null;
  const counts = new Map();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] - rows[i - 1][0];
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
  return best;
}

export function checkGaps(rows, stepMs, report, maxReported = 20) {
  if (!stepMs || rows.length < 2) return report;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i][0] - rows[i - 1][0];
    if (d > stepMs) {
      const missing = Math.round(d / stepMs) - 1;
      if (missing > 0) {
        report.missingCandles += missing;
        if (report.gaps.length < maxReported) {
          report.gaps.push({ afterTs: rows[i - 1][0], beforeTs: rows[i][0], missing });
        }
      }
    }
  }
  if (report.missingCandles) {
    report.warnings.push(
      `${report.missingCandles} missing candle(s) across ${report.gaps.length}${report.gaps.length >= maxReported ? "+" : ""} gap(s). Gaps are not filled — the engine treats adjacent rows as consecutive bars.`
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// §4 Execution model: spread + slippage on the fill, fees on the notional.
// ---------------------------------------------------------------------------
export function fillPrice(price, dir, side, cfg) {
  const edge = (cfg.spreadPercent / 200 + cfg.slippagePercent / 100);
  const long = dir === "long";
  // buying (long entry / short exit) pays up; selling (long exit / short entry) gets less
  const buying = (long && side === "entry") || (!long && side === "exit");
  return buying ? price * (1 + edge) : price * (1 - edge);
}

export function positionSize(cfg, equity, riskPerUnit, entryFill) {
  const mode = String(cfg.sizingMode || "RISK_PERCENT").toUpperCase();
  if (mode === "FIXED_QTY") return Math.max(0, cfg.fixedQty);
  if (mode === "FIXED_NOTIONAL") return entryFill > 0 ? Math.max(0, cfg.fixedNotional) / entryFill : 0;
  const riskCash = mode === "FIXED_RISK"
    ? Math.max(0, cfg.fixedRiskAmount)
    : Math.max(0, equity) * (cfg.riskPercent / 100);
  return riskPerUnit > 0 ? riskCash / riskPerUnit : 0;
}

// Price the raw engine trades: walk them chronologically against a compounding
// equity curve, applying execution costs and sizing.
export function priceTrades(rawTrades, cfg) {
  const chrono = [...rawTrades].sort((a, b) => a.entryTs - b.entryTs);
  let equity = cfg.initialCapital;
  const out = [];

  for (const t of chrono) {
    const entryFill = fillPrice(t.entryPrice, t.direction, "entry", cfg);
    const exitFill = t.exitPrice == null ? null : fillPrice(t.exitPrice, t.direction, "exit", cfg);
    // risk is measured on the real fills, so slippage widens the real risk
    const stopFill = fillPrice(t.stopPrice, t.direction, "exit", cfg);
    const riskPerUnit = Math.abs(entryFill - stopFill);
    const qty = positionSize(cfg, equity, riskPerUnit, entryFill);

    if (!(qty > 0) || exitFill == null || !(riskPerUnit > 0)) {
      out.push({ ...t, skipped: true, reason: "no valid size/risk" });
      continue;
    }

    const grossPerUnit = t.direction === "long" ? exitFill - entryFill : entryFill - exitFill;
    const grossPnl = grossPerUnit * qty;
    const fees = (entryFill + exitFill) * qty * (cfg.feePercentPerSide / 100);
    const netPnl = grossPnl - fees;
    const riskCash = riskPerUnit * qty;
    const r = riskCash > 0 ? netPnl / riskCash : 0;

    equity += netPnl;

    const ep = istParts(t.entryTs);
    const xp = t.exitTs ? istParts(t.exitTs) : { date: "", time: "" };
    out.push({
      ...t,
      entryFill: round(entryFill),
      exitFill: round(exitFill),
      stopFill: round(stopFill),
      qty: round(qty, 6),
      notional: round(entryFill * qty, 2),
      riskPerUnit: round(riskPerUnit),
      riskCash: round(riskCash, 2),
      grossPnl: round(grossPnl, 2),
      fees: round(fees, 2),
      netPnl: round(netPnl, 2),
      r: round(r, 3),
      outcome: netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "flat",
      equityAfter: round(equity, 2),
      entryDate: ep.date,
      entryTime: ep.time,
      exitDate: xp.date,
      exitTime: xp.time,
      // IST calendar buckets, used by the month / week / weekday breakdowns
      monthKey: ep.monthKey,
      monthLabel: ep.monthLabel,
      weekKey: ep.weekKey,
      dowIndex: ep.dowIndex,
      dowLabel: ep.dowLabel,
      holdMinutes: t.exitTs ? Math.round((t.exitTs - t.entryTs) / 60000) : null,
      entryPrice: round(t.entryPrice),
      exitPrice: round(t.exitPrice),
      stopPrice: round(t.stopPrice),
      swingPrice: round(t.swingPrice),
      rawR: round(t.rawR, 3),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic breakdown. Buckets closed trades by `keyOf` and computes the same
// metric set for each bucket, including a per-bucket max drawdown measured on
// that bucket's own running P&L (so a weekday row shows the worst run you would
// have had trading only that weekday).
//
// This is the single implementation behind the month / week / weekday /
// session / direction / exit-reason tables — one code path, one set of tests.
// ---------------------------------------------------------------------------
export function breakdown(trades, keyOf, labelOf, sortOf) {
  const map = new Map();
  for (const t of trades) {
    const key = keyOf(t);
    if (key == null) continue;
    let b = map.get(key);
    if (!b) {
      b = {
        key, label: labelOf ? labelOf(t) : String(key), sort: sortOf ? sortOf(t) : key,
        trades: 0, wins: 0, losses: 0, netProfit: 0, grossProfit: 0, grossLoss: 0,
        fees: 0, rSum: 0, barsSum: 0, barsN: 0,
        _run: 0, _peak: 0, maxDrawdown: 0,
      };
      map.set(key, b);
    }
    const pnl = t.netPnl;
    b.trades++;
    if (pnl > 0) { b.wins++; b.grossProfit += pnl; }
    else if (pnl < 0) { b.losses++; b.grossLoss += -pnl; }
    b.netProfit += pnl;
    b.fees += t.fees || 0;
    b.rSum += t.r || 0;
    if (t.barsHeld != null) { b.barsSum += t.barsHeld; b.barsN++; }
    b._run += pnl;
    if (b._run > b._peak) b._peak = b._run;
    const dd = b._peak - b._run;
    if (dd > b.maxDrawdown) b.maxDrawdown = dd;
  }
  return [...map.values()]
    .sort((a, z) => (a.sort > z.sort ? 1 : a.sort < z.sort ? -1 : 0))
    .map(({ _run, _peak, sort, ...b }) => ({
      key: b.key,
      label: b.label,
      trades: b.trades,
      wins: b.wins,
      losses: b.losses,
      winRate: b.trades ? round((b.wins / b.trades) * 100, 2) : 0,
      netProfit: round(b.netProfit, 2),
      grossProfit: round(b.grossProfit, 2),
      grossLoss: round(b.grossLoss, 2),
      fees: round(b.fees, 2),
      profitFactor: b.grossLoss > 0 ? round(b.grossProfit / b.grossLoss, 2) : b.grossProfit > 0 ? null : 0,
      expectancy: b.trades ? round(b.rSum / b.trades, 3) : 0,
      avgBarsHeld: b.barsN ? round(b.barsSum / b.barsN, 1) : 0,
      maxDrawdown: round(b.maxDrawdown, 2),
    }));
}

// ---------------------------------------------------------------------------
// §7 Metrics. Closed trades only, after fees.
// ---------------------------------------------------------------------------
export function computeStats(trades, cfg) {
  const closed = trades.filter((t) => !t.skipped && !t.stillOpen && t.netPnl != null);
  const chrono = [...closed].sort((a, b) => (a.exitTs || a.entryTs) - (b.exitTs || b.entryTs));

  let equity = cfg.initialCapital;
  let peak = equity;
  let maxDD = 0;
  let maxDDPct = 0;
  const equityCurve = [{ ts: chrono.length ? chrono[0].entryTs : null, equity: round(equity, 2) }];
  const drawdownCurve = [{ ts: chrono.length ? chrono[0].entryTs : null, drawdown: 0, drawdownPct: 0 }];

  let grossProfit = 0, grossLoss = 0, fees = 0, rSum = 0;
  let wins = 0, losses = 0, barsSum = 0, barsN = 0, holdSum = 0, holdN = 0;
  let winSum = 0, lossSum = 0;
  let consecW = 0, consecL = 0, maxConsecW = 0, maxConsecL = 0;

  for (const t of chrono) {
    const pnl = t.netPnl;
    equity += pnl;
    fees += t.fees || 0;
    rSum += t.r || 0;
    if (pnl > 0) { wins++; grossProfit += pnl; winSum += pnl; consecW++; consecL = 0; }
    else if (pnl < 0) { losses++; grossLoss += -pnl; lossSum += -pnl; consecL++; consecW = 0; }
    maxConsecW = Math.max(maxConsecW, consecW);
    maxConsecL = Math.max(maxConsecL, consecL);
    if (t.barsHeld != null) { barsSum += t.barsHeld; barsN++; }
    if (t.holdMinutes != null) { holdSum += t.holdMinutes; holdN++; }

    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    equityCurve.push({ ts: t.exitTs || t.entryTs, equity: round(equity, 2) });
    drawdownCurve.push({
      ts: t.exitTs || t.entryTs,
      drawdown: round(-dd, 2),
      drawdownPct: round(peak > 0 ? -(dd / peak) * 100 : 0, 2),
    });
  }

  const n = chrono.length;
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    totalTrades: n,
    openTrades: trades.filter((t) => t.stillOpen).length,
    skippedTrades: trades.filter((t) => t.skipped).length,
    wins,
    losses,
    winRate: n ? round((wins / n) * 100, 2) : 0,
    initialCapital: round(cfg.initialCapital, 2),
    finalEquity: round(equity, 2),
    netProfit: round(equity - cfg.initialCapital, 2),
    netProfitPct: cfg.initialCapital > 0 ? round(((equity - cfg.initialCapital) / cfg.initialCapital) * 100, 2) : 0,
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    totalFees: round(fees, 2),
    profitFactor: pf === Infinity ? null : round(pf, 2),
    expectancy: n ? round(rSum / n, 3) : 0, // in R
    expectancyMoney: n ? round((equity - cfg.initialCapital) / n, 2) : 0,
    avgWin: wins ? round(winSum / wins, 2) : 0,
    avgLoss: losses ? round(lossSum / losses, 2) : 0,
    avgWinLossRatio: losses && wins ? round((winSum / wins) / (lossSum / losses), 2) : null,
    maxDrawdown: round(maxDD, 2),
    maxDrawdownPct: round(maxDDPct, 2),
    avgBarsHeld: barsN ? round(barsSum / barsN, 1) : 0,
    avgHoldMinutes: holdN ? round(holdSum / holdN, 1) : 0,
    maxConsecWins: maxConsecW,
    maxConsecLosses: maxConsecL,
    equityCurve,
    drawdownCurve,
    // All breakdowns share one implementation (`breakdown`) so every table
    // reports the same metric set and is covered by the same tests.
    byDirection: breakdown(chrono, (t) => t.direction),
    byExitReason: breakdown(chrono, (t) => t.exitReason || "unknown"),
    byMonth: breakdown(chrono, (t) => t.monthKey, (t) => t.monthLabel),
    byWeek: breakdown(chrono, (t) => t.weekKey, (t) => `w/c ${t.weekKey}`),
    byDayOfWeek: breakdown(chrono, (t) => t.dowLabel, (t) => t.dowLabel,
      // Monday first, matching the week buckets
      (t) => (t.dowIndex + 6) % 7),
    bySession: breakdown(chrono, (t) => t.session,
      (t) => SESSIONS.find((s) => s.key === t.session)?.label || t.session,
      (t) => SESSIONS.findIndex((s) => s.key === t.session)),
    byPair: breakdown(chrono, (t) => t.pair || t.symbol || "—"),
  };
}

// ---------------------------------------------------------------------------
// Run one timeframe over one series.
// ---------------------------------------------------------------------------
export function backtestRows(rows, timeframe, overrides = {}, meta = {}) {
  const cfg = reversalConfig(overrides);
  const { trades: raw, states } = runReversal(rows, cfg, { ...meta, timeframe });
  const trades = priceTrades(raw, cfg).map((t) => ({
    ...t,
    annotationTs: annotationsToTs(t.annotations, rows),
  }));
  const stats = computeStats(trades, cfg);
  return { timeframe, bars: rows.length, trades, stats, states, config: cfg };
}

// Restate the annotation indices as timestamps, so the chart can render them
// against any slice of candles instead of depending on array alignment.
export function annotationsToTs(a, rows) {
  if (!a) return null;
  const ts = (i) => (i == null || !rows[i] ? null : rows[i][0]);
  return {
    legStart: ts(a.legStartIndex),
    reversal1: ts(a.reversal1),
    dip: ts(a.dipIndex),
    reversal2: ts(a.reversal2),
    entry: ts(a.entryIndex),
    armed: ts(a.armedIndex),
    exit: ts(a.exitIndex),
    pullbacks: (a.pullbacks || []).map((p) => ({
      start: ts(p.start), end: ts(p.end), resumedAt: ts(p.resumedAt), candles: p.candles,
    })),
    resumes: (a.resumes || []).map(ts).filter((x) => x != null),
  };
}

// Fetch (and aggregate when needed) the candles for one timeframe.
export async function loadRows(pair, timeframe, opts = {}) {
  const { fetchTf, factor } = fetchPlan(timeframe);
  let raw;
  if (opts.from && opts.to) {
    raw = await fetchOHLCVRange(pair, fetchTf, opts.from, opts.to);
  } else {
    const days = opts.days || 30;
    const want = opts.bars || Math.ceil((days * 86400 * 1000) / tfMs(fetchTf));
    raw = await fetchOHLCV(pair, fetchTf, Math.min(MAX_BARS, Math.max(50, want * factor)));
  }
  // drop the forming candle — only fully-closed bars reach the engine
  const step = tfMs(fetchTf);
  const now = Date.now();
  let rows = raw.filter((r) => r[0] + step <= now);
  if (factor > 1) rows = aggregateRows(rows, step, tfMs(timeframe));
  return rows;
}

// ---------------------------------------------------------------------------
// Multi-timeframe entry point (§5). Returns one result per timeframe plus a
// comparison table. `source` labels where the candles came from so the UI can
// never present sample data as a live result.
// ---------------------------------------------------------------------------
export async function runReversalBacktest(opts = {}) {
  const cfg = reversalConfig(opts.config || {});
  const timeframes = (opts.timeframes && opts.timeframes.length ? opts.timeframes : ["15m"])
    .filter((tf) => TIMEFRAMES.includes(tf));

  // One or many instruments. A CSV is a single unnamed instrument; the
  // exchange path takes a list of pairs so BTC and gold can be compared in the
  // same run. Every pair is backtested on its own equity curve, so one pair's
  // drawdown never distorts another's numbers.
  const pairs = opts.rows
    ? [{ name: opts.symbol || "CSV", market: "csv", _rows: opts.rows }]
    : (opts.pairs?.length ? opts.pairs : opts.pair ? [opts.pair] : []);

  const results = [];
  const errors = [];

  for (const pair of pairs) {
    for (const tf of timeframes) {
      try {
        let rows;
        if (pair._rows) {
          // CSV / pre-supplied series: aggregate up from its native spacing
          const step = detectTimeframe(pair._rows);
          const want = tfMs(tf);
          rows = step && want > step ? aggregateRows(pair._rows, step, want) : pair._rows;
        } else {
          rows = await loadRows(pair, tf, opts);
        }
        if (!rows || rows.length < 20) {
          errors.push({ pair: pair.name, timeframe: tf, error: `only ${rows ? rows.length : 0} candles available` });
          continue;
        }
        const r = backtestRows(rows, tf, cfg, {
          pair: pair.name, symbol: pair.name, market: pair.market || "",
        });
        r.pair = pair.name;
        r.market = pair.market || "";
        r.id = `${pair.name}|${tf}`;
        // the raw candles are kept so the UI can draw the annotated chart
        r.rows = rows;
        results.push(r);
      } catch (e) {
        errors.push({ pair: pair.name, timeframe: tf, error: String(e.message || e) });
      }
    }
  }

  const comparison = results.map((r) => ({
    id: r.id,
    pair: r.pair,
    market: r.market,
    timeframe: r.timeframe,
    bars: r.bars,
    totalTrades: r.stats.totalTrades,
    winRate: r.stats.winRate,
    netProfit: r.stats.netProfit,
    netProfitPct: r.stats.netProfitPct,
    profitFactor: r.stats.profitFactor,
    expectancy: r.stats.expectancy,
    maxDrawdown: r.stats.maxDrawdown,
    maxDrawdownPct: r.stats.maxDrawdownPct,
    avgBarsHeld: r.stats.avgBarsHeld,
    avgHoldMinutes: r.stats.avgHoldMinutes,
    totalFees: r.stats.totalFees,
  }));

  return {
    ranAt: Date.now(),
    source: opts.source || (opts.rows ? "csv" : "exchange"),
    pairs: pairs.map((p) => p.name),
    config: cfg,
    timeframes,
    results,
    comparison,
    validation: opts.validation || null,
    errors,
  };
}
