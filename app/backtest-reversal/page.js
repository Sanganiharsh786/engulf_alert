"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, Download, FileUp, Play, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/backtest/spinner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ReversalChart } from "@/components/backtest/reversal-chart";
import { DEFAULT_CONFIG, TIMEFRAMES } from "@/lib/reversalStrategy";
import { cn } from "@/lib/utils";

const money = (n) =>
  n == null || isNaN(n)
    ? "—"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const num = (n, dp = 2) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(dp));
const pct = (n) => (n == null || isNaN(n) ? "—" : `${Number(n).toFixed(2)}%`);
const when = (ts) => (ts ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") : "—");

// ---------------------------------------------------------------------------
// small form controls (same look as the other backtest pages)
// ---------------------------------------------------------------------------
function Num({ label, value, onChange, step = 1, min, hint, w = "w-28" }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground" title={hint}>{label}</Label>
      <Input
        type="number" step={step} min={min} value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 font-mono text-xs", w)}
      />
    </div>
  );
}

function Sel({ label, value, onChange, options, hint, w = "w-56" }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground" title={hint}>{label}</Label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 rounded-md border border-border bg-card px-2 font-mono text-xs", w)}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Chk({ label, checked, onChange, hint }) {
  return (
    <label className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-card px-2 text-xs" title={hint}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

// Minimal inline SVG line chart — avoids pulling a chart lib for two curves.
function LineChart({ points, valueKey, height = 160, color = "#60a5fa", zeroBase = false }) {
  if (!points || points.length < 2) {
    return <div className="py-8 text-center text-xs text-muted-foreground">Not enough closed trades to draw a curve.</div>;
  }
  const vals = points.map((p) => p[valueKey]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (zeroBase) max = Math.max(max, 0);
  if (min === max) { min -= 1; max += 1; }
  const W = 1000;
  const H = height;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => H - ((v - min) / (max - min)) * H;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p[valueKey]).toFixed(2)}`).join(" ");
  const area = `${d} L${W},${H} L0,${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
        <path d={area} fill={color} opacity="0.12" />
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{num(min)}</span>
        <span>{points.length} points</span>
        <span>{num(max)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const ENTRY_MODES = ["SECOND_CANDLE_CLOSE", "SECOND_CANDLE_HIGH_BREAK", "SWING_HIGH_BREAK"];
const RESUME_MODES = [
  "NEW_HIGH", "BULL_CLOSE_ABOVE_PULLBACK_HIGH", "BULL_CLOSE_ABOVE_PRIOR_HIGH", "N_BULL_CANDLES",
];
const LEG_MODES = ["NONE", "PERCENT", "ATR", "EITHER", "BOTH"];
const SIZING_MODES = ["RISK_PERCENT", "FIXED_RISK", "FIXED_QTY", "FIXED_NOTIONAL"];
const HTF_MODES = ["NONE", "CANDLE_COLOR", "EMA"];
const HTF_TFS = ["15m", "1h", "4h", "1d"];
const EXIT_FILLS = ["CLOSE", "NEXT_OPEN"];
const DIP_REFS = ["CANDLE_LOW", "CANDLE_CLOSE"];
const DOJI = ["NEUTRAL", "BULL", "BEAR"];

export default function ReversalBacktestPage() {
  const [cfg, setCfg] = useState({ ...DEFAULT_CONFIG });
  const [timeframes, setTimeframes] = useState(["5m", "15m", "1h", "4h"]);
  const [days, setDays] = useState(30);
  const [csv, setCsv] = useState(null); // { name, text }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState(null);
  const [activeTf, setActiveTf] = useState(null);
  const [chartTrade, setChartTrade] = useState(null);
  const fileRef = useRef(null);

  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }));

  const active = useMemo(() => {
    if (!res) return null;
    return res.results.find((r) => r.timeframe === activeTf) || res.results[0] || null;
  }, [res, activeTf]);

  const toggleTf = (tf) =>
    setTimeframes((list) => (list.includes(tf) ? list.filter((x) => x !== tf) : [...list, tf]));

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsv({ name: f.name, text });
    setError("");
  }

  async function run() {
    if (!timeframes.length) { setError("Pick at least one timeframe."); return; }
    setRunning(true);
    setError("");
    try {
      const body = { config: cfg, timeframes, days: Number(days) || 30 };
      if (csv) { body.csv = csv.text; body.symbol = csv.name; }
      const r = await fetch("/api/backtest-reversal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `Request failed (${r.status})`);
        setRes(j.validation ? { ...j, results: [], comparison: [] } : null);
        return;
      }
      setRes(j);
      setActiveTf(j.results[0]?.timeframe || null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!active) return;
    const cols = [
      "direction", "entryDate", "entryTime", "entryPrice", "entryFill", "stopPrice",
      "exitDate", "exitTime", "exitPrice", "exitFill", "exitReason",
      "qty", "riskCash", "grossPnl", "fees", "netPnl", "r", "barsHeld", "holdMinutes",
      "pullbackCount", "resumeCount",
    ];
    const lines = [["timeframe", ...cols].join(",")];
    for (const t of active.trades) {
      lines.push([active.timeframe, ...cols.map((c) => t[c] ?? "")].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `reversal-trades-${active.timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const v = res?.validation;
  const st = active?.stats;

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4">
      {/* ---- header ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href="/"><ArrowLeft /> Dashboard</a>
        </Button>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <BarChart3 className="h-5 w-5" />
          Candle-Reversal / First-Opposite-Candle Backtester
        </h1>
        {res && (
          <Badge variant={res.source === "csv" ? "secondary" : "outline"} className="font-mono text-[10px]">
            {res.source === "csv" ? `CSV · ${res.symbol}` : `LIVE · ${res.pair || res.symbol}`}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Two reversal candles at a swing extreme, then hold through temporary pullbacks and exit on the
        first opposite-colour candle <em>after</em> continuation resumes. Every subjective rule below is a
        setting — see <code className="font-mono">REVERSAL_STRATEGY_README.md</code> for the exact definitions.
      </p>

      {/* ---- data source ------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1 · Data</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Num label="Days of history" value={days} onChange={setDays} min={1} w="w-24" />
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Timeframes</Label>
            <div className="flex flex-wrap gap-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => toggleTf(tf)}
                  className={cn(
                    "h-8 rounded-md border px-2 font-mono text-xs",
                    timeframes.includes(tf)
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <Separator orientation="vertical" className="h-10" />
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Or upload OHLCV CSV</Label>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="hidden" />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <FileUp /> {csv ? csv.name : "Choose CSV"}
              </Button>
              {csv && <Button variant="ghost" size="sm" onClick={() => { setCsv(null); if (fileRef.current) fileRef.current.value = ""; }}>clear</Button>}
            </div>
          </div>
          <Button size="sm" onClick={run} disabled={running}>
            {running ? <RefreshCw className="animate-spin" /> : <Play />}
            {running ? "Running…" : "Run backtest"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---- CSV validation report --------------------------------------- */}
      {v && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">CSV validation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label="Lines" value={v.totalLines} />
              <Stat label="Valid candles" value={v.parsed} />
              <Stat label="Dropped" value={v.dropped} tone={v.dropped ? "text-amber-500" : ""} />
              <Stat label="Duplicates" value={v.duplicateTimestamps} tone={v.duplicateTimestamps ? "text-amber-500" : ""} />
              <Stat label="Bad OHLC" value={v.badOhlc} tone={v.badOhlc ? "text-amber-500" : ""} />
              <Stat label="Bad timestamps" value={v.badTimestamp} tone={v.badTimestamp ? "text-amber-500" : ""} />
              <Stat label="Missing candles" value={v.missingCandles} tone={v.missingCandles ? "text-amber-500" : ""} />
            </div>
            <div className="text-muted-foreground">
              Detected bar spacing:{" "}
              <span className="font-mono">{v.detectedStepMs ? `${Math.round(v.detectedStepMs / 60000)}m` : "unknown"}</span>
              {" · "}range <span className="font-mono">{when(v.firstTs)} → {when(v.lastTs)}</span>
            </div>
            {v.skippedTimeframes?.length > 0 && (
              <div className="text-amber-500">
                Skipped {v.skippedTimeframes.join(", ")} — below the file&apos;s own bar spacing (a CSV can only be
                aggregated up, never down).
              </div>
            )}
            {v.warnings?.map((w, i) => <div key={i} className="text-amber-500">⚠ {w}</div>)}
          </CardContent>
        </Card>
      )}

      {/* ---- configuration ----------------------------------------------- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">2 · Strategy rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pattern</div>
            <div className="flex flex-wrap items-end gap-3">
              <Sel label="Leg requirement" value={cfg.legMode} onChange={set("legMode")} options={LEG_MODES} w="w-36"
                hint="How the prior directional move is required to qualify" />
              <Num label="Leg lookback (bars)" value={cfg.legLookback} onChange={set("legLookback")} min={1} />
              <Num label="Min leg %" value={cfg.minLegPercent} onChange={set("minLegPercent")} step={0.1} min={0} />
              <Num label="Min leg × ATR" value={cfg.minLegATR} onChange={set("minLegATR")} step={0.1} min={0} />
              <Num label="Bottom tolerance %" value={cfg.bottomTolerancePercent} onChange={set("bottomTolerancePercent")} step={0.05} min={0}
                hint="How far above the window low a reversal candle's low may sit" />
              <Sel label="Dip reference" value={cfg.dipReference} onChange={set("dipReference")} options={DIP_REFS} w="w-40" />
              <Num label="Max bars R1→R2" value={cfg.maxBarsBetweenReversals} onChange={set("maxBarsBetweenReversals")} min={1} />
              <Num label="Max dip %" value={cfg.maxDipPercent} onChange={set("maxDipPercent")} step={0.1} min={0}
                hint="A dip deeper than this past the first reversal candle invalidates the setup" />
              <Sel label="Doji policy" value={cfg.dojiPolicy} onChange={set("dojiPolicy")} options={DOJI} w="w-28" />
              <Num label="Min body × ATR" value={cfg.minBodyATR} onChange={set("minBodyATR")} step={0.1} min={0} />
              <Num label="Min body % of range" value={cfg.minBodyPercentOfRange} onChange={set("minBodyPercentOfRange")} step={5} min={0} />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entry</div>
            <div className="flex flex-wrap items-end gap-3">
              <Sel label="Entry confirmation" value={cfg.entryMode} onChange={set("entryMode")} options={ENTRY_MODES}
                hint="Second-candle close, break of its high, or break of a confirmed swing high" />
              <Num label="Confirmation expiry (bars)" value={cfg.confirmationExpiryBars} onChange={set("confirmationExpiryBars")} min={1} />
              <Num label="Pivot left" value={cfg.pivotLeft} onChange={set("pivotLeft")} min={1} w="w-20" />
              <Num label="Pivot right" value={cfg.pivotRight} onChange={set("pivotRight")} min={1} w="w-20" />
              <Chk label="Longs" checked={cfg.allowLong} onChange={set("allowLong")} />
              <Chk label="Shorts" checked={cfg.allowShort} onChange={set("allowShort")} />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pullback vs. continuation — the rules that decide the exit
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Num label="Max pullback candles" value={cfg.maxPullbackCandles} onChange={set("maxPullbackCandles")} min={1}
                hint="More opposite candles than this = structure break, not a pullback" />
              <Num label="Max pullback retrace %" value={cfg.maxPullbackRetracePercent} onChange={set("maxPullbackRetracePercent")} step={1} min={0}
                hint="Retracement of the move from entry to the pre-pullback extreme. 0 = off" />
              <Chk label="Exit on failed continuation" checked={cfg.exitOnFailedContinuation} onChange={set("exitOnFailedContinuation")} />
              <Sel label="Continuation resumed when" value={cfg.resumeMode} onChange={set("resumeMode")} options={RESUME_MODES} w="w-72" />
              <Num label="Resume bull candles" value={cfg.resumeBullCandles} onChange={set("resumeBullCandles")} min={1} />
              <Num label="Min resume %" value={cfg.minResumePercent} onChange={set("minResumePercent")} step={0.1} min={0} />
              <Num label="Min resume × ATR" value={cfg.minResumeATR} onChange={set("minResumeATR")} step={0.1} min={0} />
              <Num label="Arm exit after N cycles" value={cfg.armAfterCycles} onChange={set("armAfterCycles")} min={0}
                hint="1 = a red candle in the first leg up is a pullback, not an exit. 0 = exit on the first red after entry" />
              <Sel label="Exit fill" value={cfg.exitFill} onChange={set("exitFill")} options={EXIT_FILLS} w="w-36" />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Risk &amp; execution</div>
            <div className="flex flex-wrap items-end gap-3">
              <Num label="SL buffer %" value={cfg.slBufferPercent} onChange={set("slBufferPercent")} step={0.05} min={0} />
              <Num label="SL ATR buffer ×" value={cfg.atrStopMultiple} onChange={set("atrStopMultiple")} step={0.1} min={0} />
              <Num label="Emergency stop %" value={cfg.emergencyStopPercent} onChange={set("emergencyStopPercent")} step={0.1} min={0} hint="0 = off" />
              <Num label="Max hold (bars)" value={cfg.maxHoldBars} onChange={set("maxHoldBars")} min={0} hint="0 = off" />
              <Num label="ATR period" value={cfg.atrPeriod} onChange={set("atrPeriod")} min={2} w="w-20" />
              <Separator orientation="vertical" className="h-10" />
              <Num label="Initial capital" value={cfg.initialCapital} onChange={set("initialCapital")} step={100} min={1} />
              <Sel label="Sizing" value={cfg.sizingMode} onChange={set("sizingMode")} options={SIZING_MODES} w="w-44" />
              <Num label="Risk % per trade" value={cfg.riskPercent} onChange={set("riskPercent")} step={0.1} min={0} />
              <Num label="Fixed risk $" value={cfg.fixedRiskAmount} onChange={set("fixedRiskAmount")} step={10} min={0} />
              <Num label="Fixed qty" value={cfg.fixedQty} onChange={set("fixedQty")} step={0.1} min={0} />
              <Num label="Fixed notional $" value={cfg.fixedNotional} onChange={set("fixedNotional")} step={100} min={0} />
              <Separator orientation="vertical" className="h-10" />
              <Num label="Fee % / side" value={cfg.feePercentPerSide} onChange={set("feePercentPerSide")} step={0.01} min={0} />
              <Num label="Spread %" value={cfg.spreadPercent} onChange={set("spreadPercent")} step={0.01} min={0} />
              <Num label="Slippage %" value={cfg.slippagePercent} onChange={set("slippagePercent")} step={0.01} min={0} />
              <Separator orientation="vertical" className="h-10" />
              <Sel label="HTF trend filter" value={cfg.htfMode} onChange={set("htfMode")} options={HTF_MODES} w="w-40" />
              <Sel label="HTF timeframe" value={cfg.htfTimeframe} onChange={set("htfTimeframe")} options={HTF_TFS} w="w-28" />
              <Num label="HTF EMA period" value={cfg.htfEmaPeriod} onChange={set("htfEmaPeriod")} min={2} />
            </div>
          </div>
        </CardContent>
      </Card>

      {running && <div className="flex justify-center py-8"><Spinner /></div>}

      {/* ---- cross-timeframe comparison ---------------------------------- */}
      {res?.comparison?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              3 · Results by timeframe
              <span className="ml-2 font-normal text-muted-foreground">
                computed from {res.source === "csv" ? "your uploaded candles" : "live exchange candles"} · run at {when(res.ranAt)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  {["TF", "Bars", "Trades", "Win %", "Net P&L", "Net %", "PF", "Expectancy (R)", "Max DD", "Max DD %", "Avg bars", "Avg hold", "Fees"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {res.comparison.map((r) => (
                  <tr
                    key={r.timeframe}
                    onClick={() => setActiveTf(r.timeframe)}
                    className={cn(
                      "cursor-pointer border-b border-border/50 hover:bg-muted/40",
                      activeTf === r.timeframe && "bg-primary/10"
                    )}
                  >
                    <td className="px-2 py-1.5 font-bold">{r.timeframe}</td>
                    <td className="px-2 py-1.5 text-right">{r.bars}</td>
                    <td className="px-2 py-1.5 text-right">{r.totalTrades}</td>
                    <td className="px-2 py-1.5 text-right">{pct(r.winRate)}</td>
                    <td className={cn("px-2 py-1.5 text-right font-bold", r.netProfit > 0 ? "text-emerald-500" : r.netProfit < 0 ? "text-red-500" : "")}>
                      {money(r.netProfit)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{pct(r.netProfitPct)}</td>
                    <td className="px-2 py-1.5 text-right">{r.profitFactor == null ? "∞" : num(r.profitFactor)}</td>
                    <td className="px-2 py-1.5 text-right">{num(r.expectancy, 3)}</td>
                    <td className="px-2 py-1.5 text-right">{money(r.maxDrawdown)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(r.maxDrawdownPct)}</td>
                    <td className="px-2 py-1.5 text-right">{num(r.avgBarsHeld, 1)}</td>
                    <td className="px-2 py-1.5 text-right">{r.avgHoldMinutes ? `${num(r.avgHoldMinutes, 0)}m` : "—"}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{money(r.totalFees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {res.errors?.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] text-amber-500">
                {res.errors.map((e, i) => <div key={i}>⚠ {e.timeframe}: {e.error}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- single-timeframe detail ------------------------------------- */}
      {st && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                4 · {active.timeframe} detail
                <span className="ml-2 font-normal text-muted-foreground">{active.bars} candles</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <Stat label="Total trades" value={st.totalTrades} />
                <Stat label="Win rate" value={pct(st.winRate)} />
                <Stat label="Net profit (after fees)" value={money(st.netProfit)}
                  tone={st.netProfit > 0 ? "text-emerald-500" : st.netProfit < 0 ? "text-red-500" : ""} />
                <Stat label="Profit factor" value={st.profitFactor == null ? "∞" : num(st.profitFactor)} />
                <Stat label="Expectancy" value={`${num(st.expectancy, 3)} R`} />
                <Stat label="Max drawdown" value={`${money(st.maxDrawdown)} (${pct(st.maxDrawdownPct)})`} tone="text-red-400" />
                <Stat label="Avg win" value={money(st.avgWin)} tone="text-emerald-500" />
                <Stat label="Avg loss" value={money(st.avgLoss)} tone="text-red-500" />
                <Stat label="Avg hold" value={`${num(st.avgBarsHeld, 1)} bars / ${num(st.avgHoldMinutes, 0)}m`} />
                <Stat label="Gross profit / loss" value={`${money(st.grossProfit)} / ${money(st.grossLoss)}`} />
                <Stat label="Total fees" value={money(st.totalFees)} tone="text-muted-foreground" />
                <Stat label="Max consec W / L" value={`${st.maxConsecWins} / ${st.maxConsecLosses}`} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Equity curve</div>
                  <LineChart points={st.equityCurve} valueKey="equity" color="#60a5fa" />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Drawdown</div>
                  <LineChart points={st.drawdownCurve} valueKey="drawdown" color="#f87171" zeroBase />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By direction</div>
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-1 text-left">Direction</th>
                        <th className="px-2 py-1 text-right">Trades</th>
                        <th className="px-2 py-1 text-right">Win %</th>
                        <th className="px-2 py-1 text-right">Net P&amp;L</th>
                        <th className="px-2 py-1 text-right">Expectancy</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {st.byDirection.map((d) => (
                        <tr key={d.direction} className="border-b border-border/50">
                          <td className="px-2 py-1">{d.direction}</td>
                          <td className="px-2 py-1 text-right">{d.trades}</td>
                          <td className="px-2 py-1 text-right">{pct(d.winRate)}</td>
                          <td className={cn("px-2 py-1 text-right", d.netProfit > 0 ? "text-emerald-500" : "text-red-500")}>{money(d.netProfit)}</td>
                          <td className="px-2 py-1 text-right">{num(d.expectancy, 3)} R</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    By exit reason — how often the first-opposite-candle rule actually closed the trade
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-1 text-left">Reason</th>
                        <th className="px-2 py-1 text-right">Trades</th>
                        <th className="px-2 py-1 text-right">Win %</th>
                        <th className="px-2 py-1 text-right">Net P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {st.byExitReason.map((r) => (
                        <tr key={r.reason} className="border-b border-border/50">
                          <td className="px-2 py-1">{r.reason}</td>
                          <td className="px-2 py-1 text-right">{r.trades}</td>
                          <td className="px-2 py-1 text-right">{pct(r.winRate)}</td>
                          <td className={cn("px-2 py-1 text-right", r.netProfit > 0 ? "text-emerald-500" : "text-red-500")}>{money(r.netProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ---- trade history ------------------------------------------- */}
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">5 · Trade history ({active.trades.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={exportCsv}><Download /> Export CSV</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {active.rowsOmitted && (
                <div className="mb-2 text-[11px] text-muted-foreground">
                  The annotated chart is unavailable for this timeframe ({active.bars} candles is above the
                  payload limit). Run a shorter window or a higher timeframe to inspect trades visually.
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    {["Dir", "Entry time", "Entry", "Stop", "Exit time", "Exit", "Reason", "Qty", "Fees", "Net P&L", "R", "Bars", "PB", "Chart"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {active.trades.map((t, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/40">
                      <td className={cn("px-2 py-1.5 font-bold", t.direction === "long" ? "text-emerald-500" : "text-red-500")}>
                        {t.direction === "long" ? "LONG" : "SHORT"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{t.entryDate} {t.entryTime}</td>
                      <td className="px-2 py-1.5 text-right">{num(t.entryFill, 4)}</td>
                      <td className="px-2 py-1.5 text-right text-red-400">{num(t.stopPrice, 4)}</td>
                      <td className="px-2 py-1.5 text-right">{t.exitDate} {t.exitTime}</td>
                      <td className="px-2 py-1.5 text-right">{num(t.exitFill, 4)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Badge variant={t.exitReason === "firstOpposite" ? "default" : "secondary"} className="text-[9px]">
                          {t.exitReason}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{num(t.qty, 4)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">{money(t.fees)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-bold", t.netPnl > 0 ? "text-emerald-500" : "text-red-500")}>{money(t.netPnl)}</td>
                      <td className="px-2 py-1.5 text-right">{num(t.r, 2)}</td>
                      <td className="px-2 py-1.5 text-right">{t.barsHeld ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right" title={`${t.pullbackCount} pullback(s), ${t.resumeCount} resume(s)`}>
                        {t.pullbackCount}/{t.resumeCount}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {active.rows ? (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setChartTrade(t)}>
                            view
                          </Button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!active.trades.length && (
                    <tr><td colSpan={14} className="py-6 text-center text-muted-foreground">
                      No trades on {active.timeframe} with these rules. Loosen the leg or bottom-tolerance settings.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ---- annotated chart dialog -------------------------------------- */}
      <Dialog open={!!chartTrade} onOpenChange={(o) => !o && setChartTrade(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {chartTrade?.direction === "long" ? "LONG" : "SHORT"} · {active?.timeframe} ·{" "}
              {chartTrade?.entryDate} {chartTrade?.entryTime} → {chartTrade?.exitReason}
            </DialogTitle>
          </DialogHeader>
          {chartTrade && active?.rows && <ReversalChart trade={chartTrade} rows={active.rows} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}
