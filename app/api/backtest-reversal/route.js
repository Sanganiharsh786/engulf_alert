import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { currentUser } from "@/lib/session";
import {
  runReversalBacktest, parseCsv, detectTimeframe, checkGaps, TIMEFRAMES,
} from "@/lib/reversalBacktest";
import { DEFAULT_CONFIG } from "@/lib/reversalStrategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Candles are only echoed back for the annotated chart when a timeframe is
// small enough to send. Above this the UI hides the chart for that timeframe
// rather than shipping megabytes of JSON.
const MAX_CHART_BARS = 6000;
// across all pair × timeframe results in one response
const TOTAL_CHART_BARS = 24000;

// The accepted config keys are derived from the strategy defaults, so a new
// option in DEFAULT_CONFIG is accepted here automatically with the right type.
const NUM_KEYS = [];
const STR_KEYS = [];
const BOOL_KEYS = [];
for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
  if (typeof v === "number") NUM_KEYS.push(k);
  else if (typeof v === "boolean") BOOL_KEYS.push(k);
  else if (typeof v === "string") STR_KEYS.push(k);
}

function readConfig(c = {}) {
  const config = {};
  for (const k of NUM_KEYS) if (c[k] !== undefined && c[k] !== "" && !isNaN(Number(c[k]))) config[k] = Number(c[k]);
  for (const k of STR_KEYS) if (typeof c[k] === "string" && c[k]) config[k] = c[k];
  for (const k of BOOL_KEYS) if (typeof c[k] === "boolean") config[k] = c[k];
  return config;
}

// The page asks for the instrument list on load, so the pair selector always
// reflects whatever is configured on the dashboard (BTC, ETH, EUR, gold…).
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = await readStore(user);
  return NextResponse.json({
    pairs: (store.pairs || []).map((p) => ({
      name: p.name, market: p.market || "", exchange: p.exchange, symbol: p.symbol,
    })),
  });
}

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = (await req.json()) || {};
    const config = readConfig(b.config || {});

    let timeframes = Array.isArray(b.timeframes)
      ? b.timeframes.filter((tf) => TIMEFRAMES.includes(tf))
      : [];
    if (!timeframes.length) timeframes = ["15m"];
    // keep them in the canonical order so the comparison table reads naturally
    timeframes = TIMEFRAMES.filter((tf) => timeframes.includes(tf));

    const opts = { config, timeframes };

    if (typeof b.csv === "string" && b.csv.trim()) {
      // ---- CSV upload path (§6) -------------------------------------------
      const { rows, report } = parseCsv(b.csv);
      if (report.errors.length) {
        return NextResponse.json({ error: report.errors.join(" "), validation: report }, { status: 400 });
      }
      const step = detectTimeframe(rows);
      checkGaps(rows, step, report);
      report.detectedStepMs = step;
      report.firstTs = rows[0]?.[0] ?? null;
      report.lastTs = rows[rows.length - 1]?.[0] ?? null;

      // a CSV can only be aggregated UP from its own spacing, never down
      const usable = timeframes.filter((tf) => {
        const want = { "1m": 60e3, "5m": 300e3, "10m": 600e3, "15m": 900e3, "1h": 3600e3, "4h": 144e5, "1d": 864e5 }[tf];
        return !step || want >= step;
      });
      if (!usable.length) {
        return NextResponse.json({
          error: `The CSV's bar spacing (${step ? Math.round(step / 60000) + "m" : "unknown"}) is larger than every timeframe you selected. Pick a timeframe at or above the file's own timeframe.`,
          validation: report,
        }, { status: 400 });
      }
      report.skippedTimeframes = timeframes.filter((tf) => !usable.includes(tf));

      opts.rows = rows;
      opts.timeframes = usable;
      opts.validation = report;
      opts.source = "csv";
      opts.symbol = b.symbol || "CSV";
    } else {
      // ---- exchange path ---------------------------------------------------
      const store = await readStore(user);
      const pairs = store.pairs || [];
      if (!pairs.length) {
        return NextResponse.json({ error: "No pairs configured. Add a pair on the dashboard, or upload a CSV." }, { status: 400 });
      }
      // accept a list of names; fall back to the first configured pair
      const wanted = Array.isArray(b.pairs) ? b.pairs : b.pair ? [b.pair] : [];
      const selected = pairs.filter((p) => wanted.includes(p.name));
      opts.pairs = selected.length ? selected : [pairs[0]];
      opts.source = "exchange";
      if (Number(b.from) && Number(b.to)) {
        opts.from = Number(b.from);
        opts.to = Number(b.to);
      } else {
        opts.days = Math.min(370, Math.max(1, Number(b.days) || 30));
      }
    }

    const out = await runReversalBacktest(opts);

    // trim the payload: drop the per-bar state array, and only ship candles
    // for timeframes small enough to chart
    // Trim the payload: drop the per-bar state array, and ship candles only
    // while they fit a total budget. With several pairs × several timeframes
    // the raw candles would otherwise run to tens of megabytes. Smallest
    // series are served first, so the high timeframes you actually want to
    // eyeball keep their charts.
    const order = [...out.results].sort((a, z) => (a.rows?.length || 0) - (z.rows?.length || 0));
    const shipped = new Set();
    let budget = TOTAL_CHART_BARS;
    for (const r of order) {
      const n = r.rows?.length || 0;
      if (n && n <= MAX_CHART_BARS && n <= budget) { shipped.add(r.id); budget -= n; }
    }
    out.results = out.results.map((r) => {
      const { states, rows, ...rest } = r;
      const keep = shipped.has(r.id);
      return { ...rest, rows: keep ? rows : null, rowsOmitted: !keep };
    });
    out.days = opts.days || null;
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
