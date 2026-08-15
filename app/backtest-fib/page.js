"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  GitCompare,
  RefreshCw,
  Sigma,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/backtest/spinner";
import { TradesTable } from "@/components/backtest/trades-table";
import { TradeChartDialog } from "@/components/backtest/trade-chart-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "../toast";

const money = (n) =>
  n == null || isNaN(n)
    ? "—"
    : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n == null || isNaN(n) ? "0%" : `${n}%`);

// Default config mirrors lib/fibStrategy.js DEFAULT_CONFIG.
const DEFAULTS = {
  fibUpper: 0.7,
  fibLower: 0.786,
  pivotLeft: 5,
  pivotRight: 5,
  minimumImpulsePercent: 1,
  minimumImpulseATR: 0,
  confirmationMode: "ENGULFING",
  entryMode: "close",
  stopLossMode: "SWING",
  slBufferPercent: 0.1,
  tpMode: "RR",
  rrRatio: 2,
  fibExtension: 1.618,
  // multi-target system (§8–§13)
  useMultiTarget: true,
  targetMode: "ALL",
  tp1RR: 2,
  tp2LiquidityLookback: 60,
  tp3FibRatio: 0,
  tp1Percent: 40,
  tp2Percent: 30,
  tp3Percent: 30,
  useBreakEven: false,
  breakEvenBufferPercent: 0,
  maxRiskPercent: 0,
  // trade limits (§14, §23)
  maxActiveTrades: 1,
  useMaxTradesPerDay: false,
  maxTradesPerDay: 3,
  useMaxDailyLoss: false,
  maxDailyLossPercent: 3,
  useMaxConsecutiveLosses: false,
  maxConsecutiveLosses: 3,
  // session (§21)
  sessionFilter: "ALL",
  customSessionStart: "00:00",
  customSessionEnd: "24:00",
  useTrendFilter: false,
  emaFast: 50,
  emaSlow: 200,
  useATRFilter: false,
  atrPeriod: 14,
  atrMin: 0,
  atrMax: 0,
  useMarketStructureFilter: false,
  allowLong: true,
  allowShort: true,
  riskPercent: 1,
  initialCapital: 10000,
  zoneExpiryBars: 150,
};

const TIMEFRAMES = ["15m", "30m", "1h", "2h", "4h", "1d"];

function Num({ label, value, onChange, step = 1, min, w = "w-24" }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 font-mono text-xs", w)}
      />
    </div>
  );
}

function Sel({ label, value, onChange, options, w = "w-40" }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 rounded-md border border-border bg-card px-2 font-mono text-xs", w)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Chk({ label, checked, onChange }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5" />
      {label}
    </label>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const accentClass =
    accent === "bull" ? "text-bull" : accent === "bear" ? "text-bear" : accent === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-lg font-bold tnum", accentClass)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function FibBacktestPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // a year by default, so the monthly breakdown has enough months to be useful
  const [days, setDays] = useState(365);
  const [timeframe, setTimeframe] = useState("1h");
  const [cfg, setCfg] = useState(DEFAULTS);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const toast = useToast();

  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }));

  async function runBacktest() {
    setLoading(true);
    setError("");
    try {
      // numbers arrive as strings from inputs — coerce the numeric ones
      const config = {};
      for (const [k, v] of Object.entries(cfg)) {
        if (typeof DEFAULTS[k] === "number") config[k] = v === "" ? DEFAULTS[k] : Number(v);
        else config[k] = v;
      }
      const res = await fetch("/api/backtest-fib", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, timeframe, config }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setData(result);
      const total = result.trades ? result.trades.length : 0;
      toast(`Backtest complete · ${total} trade${total !== 1 ? "s" : ""}`, "success");
    } catch (e) {
      setError(String(e.message || e));
      toast(`Backtest failed · ${e.message || e}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = data?.stats;
  const tradeList = useMemo(() => (data?.trades ? data.trades : []), [data]);
  const showRrExtras = cfg.tpMode === "RR";

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card">
            <Sigma className="size-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Fibonacci 0.70–0.786 Retracement</h1>
            <p className="text-xs text-muted-foreground">
              Impulse → deep fib retrace → price-action confirmation{" "}
              {data && `· ${data.trades.length} trades`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/">
              <ArrowLeft />
              Dashboard
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/backtest">
              <BarChart3 />
              Standard Backtest
            </a>
          </Button>
        </div>
      </header>

      {/* Config panel */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Strategy configuration</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Num label="Days" value={days} onChange={(v) => setDays(Number(v) || 30)} min={1} />
            <Sel label="Timeframe" value={timeframe} onChange={setTimeframe} w="w-24" options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} />
            <Num label="Fib upper" value={cfg.fibUpper} onChange={set("fibUpper")} step={0.001} />
            <Num label="Fib lower" value={cfg.fibLower} onChange={set("fibLower")} step={0.001} />
            <Num label="Pivot left" value={cfg.pivotLeft} onChange={set("pivotLeft")} min={1} w="w-20" />
            <Num label="Pivot right" value={cfg.pivotRight} onChange={set("pivotRight")} min={1} w="w-20" />
            <Num label="Min impulse %" value={cfg.minimumImpulsePercent} onChange={set("minimumImpulsePercent")} step={0.1} min={0} w="w-24" />
            <Num label="Min impulse ATR" value={cfg.minimumImpulseATR} onChange={set("minimumImpulseATR")} step={0.1} min={0} w="w-24" />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Sel
              label="Confirmation"
              value={cfg.confirmationMode}
              onChange={set("confirmationMode")}
              options={[
                { value: "STRUCTURE", label: "Structure break" },
                { value: "ENGULFING", label: "Engulfing" },
                { value: "REJECTION", label: "Rejection" },
                { value: "PINBAR", label: "Pin bar" },
                { value: "BREAK", label: "Break of high/low" },
                { value: "ENGULFING_OR_STRUCTURE", label: "Engulfing or structure" },
                { value: "ENGULFING_OR_REJECTION", label: "Engulfing or rejection" },
                { value: "ANY", label: "Any" },
              ]}
            />
            <Sel label="Entry" value={cfg.entryMode} onChange={set("entryMode")} w="w-32" options={[{ value: "close", label: "Confirm close" }, { value: "break", label: "Break of high" }]} />
            <Sel label="Stop loss" value={cfg.stopLossMode} onChange={set("stopLossMode")} w="w-36" options={[{ value: "SWING", label: "Beyond swing" }, { value: "ZONE", label: "Beyond zone" }, { value: "CANDLE", label: "Confirm candle" }]} />
            <Num label="SL buffer %" value={cfg.slBufferPercent} onChange={set("slBufferPercent")} step={0.05} min={0} w="w-24" />
            <Num label="Max risk %" value={cfg.maxRiskPercent} onChange={set("maxRiskPercent")} step={0.5} min={0} w="w-24" />
            <Chk label="Multi-target (TP1/2/3)" checked={cfg.useMultiTarget} onChange={set("useMultiTarget")} />
            {!cfg.useMultiTarget && (
              <>
                <Sel label="Take profit" value={cfg.tpMode} onChange={set("tpMode")} w="w-40" options={[{ value: "RR", label: "Risk/Reward" }, { value: "SWING", label: "Opposite swing" }, { value: "FIB_EXT", label: "Fib extension" }]} />
                {cfg.tpMode === "RR" && <Num label="RR ratio" value={cfg.rrRatio} onChange={set("rrRatio")} step={0.5} min={0.5} w="w-20" />}
                {cfg.tpMode === "FIB_EXT" && (
                  <Sel label="Extension" value={cfg.fibExtension} onChange={set("fibExtension")} w="w-24" options={[{ value: 1.0, label: "1.0" }, { value: 1.272, label: "1.272" }, { value: 1.618, label: "1.618" }]} />
                )}
              </>
            )}
          </div>

          {/* Multi-target system (§8–§13) */}
          {cfg.useMultiTarget && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
              <Sel
                label="Target mode"
                value={cfg.targetMode}
                onChange={set("targetMode")}
                w="w-44"
                options={[
                  { value: "ALL", label: "All targets" },
                  { value: "RR", label: "RR only" },
                  { value: "LIQUIDITY", label: "Liquidity only" },
                  { value: "FIB", label: "Fib only" },
                  { value: "RR_LIQ", label: "RR + Liquidity" },
                  { value: "RR_FIB", label: "RR + Fib" },
                  { value: "LIQ_FIB", label: "Liquidity + Fib" },
                ]}
              />
              <Num label="TP1 RR" value={cfg.tp1RR} onChange={set("tp1RR")} step={0.5} min={0.5} w="w-20" />
              <Num label="TP2 liq lookback" value={cfg.tp2LiquidityLookback} onChange={set("tp2LiquidityLookback")} min={5} w="w-28" />
              <Num label="TP3 fib ratio" value={cfg.tp3FibRatio} onChange={set("tp3FibRatio")} step={0.05} min={0} w="w-24" />
              <Num label="TP1 %" value={cfg.tp1Percent} onChange={set("tp1Percent")} step={5} min={0} w="w-20" />
              <Num label="TP2 %" value={cfg.tp2Percent} onChange={set("tp2Percent")} step={5} min={0} w="w-20" />
              <Num label="TP3 %" value={cfg.tp3Percent} onChange={set("tp3Percent")} step={5} min={0} w="w-20" />
              <Chk label="Break even after TP1" checked={cfg.useBreakEven} onChange={set("useBreakEven")} />
              {cfg.useBreakEven && (
                <Num label="BE buffer %" value={cfg.breakEvenBufferPercent} onChange={set("breakEvenBufferPercent")} step={0.05} min={0} w="w-24" />
              )}
              <span className="text-[10px] text-muted-foreground">
                Allocations are normalised to 100% across the targets that are valid for each trade.
              </span>
            </div>
          )}

          {/* Trade limits + session (§14, §21, §23) */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
            <Num label="Max active" value={cfg.maxActiveTrades} onChange={set("maxActiveTrades")} min={1} w="w-24" />
            <Chk label="Max trades/day" checked={cfg.useMaxTradesPerDay} onChange={set("useMaxTradesPerDay")} />
            {cfg.useMaxTradesPerDay && <Num label="Per day" value={cfg.maxTradesPerDay} onChange={set("maxTradesPerDay")} min={1} w="w-20" />}
            <Chk label="Max daily loss" checked={cfg.useMaxDailyLoss} onChange={set("useMaxDailyLoss")} />
            {cfg.useMaxDailyLoss && <Num label="Daily loss %" value={cfg.maxDailyLossPercent} onChange={set("maxDailyLossPercent")} step={0.5} min={0} w="w-24" />}
            <Chk label="Max consec. losses" checked={cfg.useMaxConsecutiveLosses} onChange={set("useMaxConsecutiveLosses")} />
            {cfg.useMaxConsecutiveLosses && <Num label="Consec." value={cfg.maxConsecutiveLosses} onChange={set("maxConsecutiveLosses")} min={1} w="w-20" />}
            <Sel
              label="Session"
              value={cfg.sessionFilter}
              onChange={set("sessionFilter")}
              w="w-40"
              options={[
                { value: "ALL", label: "All sessions" },
                { value: "LONDON", label: "London" },
                { value: "NEWYORK", label: "New York" },
                { value: "LONDON_NY", label: "London + NY" },
                { value: "CUSTOM", label: "Custom" },
              ]}
            />
            {cfg.sessionFilter === "CUSTOM" && (
              <>
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">From (UTC)</Label>
                  <Input value={cfg.customSessionStart} onChange={(e) => set("customSessionStart")(e.target.value)} className="h-8 w-20 font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">To (UTC)</Label>
                  <Input value={cfg.customSessionEnd} onChange={(e) => set("customSessionEnd")(e.target.value)} className="h-8 w-20 font-mono text-xs" />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Num label="Risk %" value={cfg.riskPercent} onChange={set("riskPercent")} step={0.25} min={0.1} w="w-20" />
            <Num label="Capital" value={cfg.initialCapital} onChange={set("initialCapital")} step={1000} min={100} w="w-28" />
            <Num label="Zone expiry (bars)" value={cfg.zoneExpiryBars} onChange={set("zoneExpiryBars")} min={5} w="w-28" />
            <Chk label="Long" checked={cfg.allowLong} onChange={set("allowLong")} />
            <Chk label="Short" checked={cfg.allowShort} onChange={set("allowShort")} />
            <Chk label="Trend filter (EMA)" checked={cfg.useTrendFilter} onChange={set("useTrendFilter")} />
            <Chk label="ATR filter" checked={cfg.useATRFilter} onChange={set("useATRFilter")} />
            <Chk label="Market structure" checked={cfg.useMarketStructureFilter} onChange={set("useMarketStructureFilter")} />
            <Button size="sm" onClick={runBacktest} disabled={loading} className="ml-auto">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              {loading ? "Running…" : "Run Backtest"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert className="mt-4 border-bear/40 bg-bear/10">
          <AlertDescription className="text-sm text-bear">{error}</AlertDescription>
        </Alert>
      )}

      {loading && !data && (
        <div className="mt-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner />
          <p className="text-sm">Running Fibonacci backtest…</p>
        </div>
      )}

      {data && stats && (
        <div className="mt-6 flex flex-col gap-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Win Rate" value={pct(stats.winRate)} accent={stats.winRate >= 50 ? "bull" : "bear"} />
            <StatCard label="Net Profit" value={money(stats.netProfit)} sub={pct(stats.netProfitPct)} accent={stats.netProfit > 0 ? "bull" : stats.netProfit < 0 ? "bear" : "muted"} />
            <StatCard label="Net R" value={`${stats.netR > 0 ? "+" : ""}${stats.netR}R`} accent={stats.netR > 0 ? "bull" : stats.netR < 0 ? "bear" : "muted"} />
            <StatCard label="Trades" value={stats.totalTrades} sub={`${stats.closedTrades} closed`} />
            <StatCard label="W / L" value={`${stats.wins} / ${stats.losses}`} />
            <StatCard label="Profit Factor" value={stats.profitFactor} accent={stats.profitFactor >= 1 ? "bull" : "bear"} />
            <StatCard label="Expectancy" value={`${stats.expectancy}R`} accent={stats.expectancy > 0 ? "bull" : "bear"} />
            <StatCard label="Avg R / trade" value={`${stats.avgR}R`} />
            <StatCard label="Avg Win" value={`+${stats.avgWinR}R`} accent="bull" />
            <StatCard label="Avg Loss" value={`${stats.avgLossR}R`} accent="bear" />
            <StatCard label="Max Drawdown" value={money(stats.maxDrawdown)} sub={pct(stats.maxDrawdownPct)} accent="bear" />
            <StatCard label="Max Streaks" value={`${stats.maxWinStreak}W / ${stats.maxLossStreak}L`} />
            <StatCard label="Largest Win" value={`+${stats.largestWinR}R`} accent="bull" />
            <StatCard label="Largest Loss" value={`${stats.largestLossR}R`} accent="bear" />
            <StatCard label="TP1 Hit Rate" value={pct(stats.tp1HitRate)} accent="bull" sub={`TP1 = ${cfg.useMultiTarget ? cfg.tp1RR : cfg.rrRatio}R`} />
            <StatCard label="TP2 Hit Rate" value={pct(stats.tp2HitRate)} accent="bull" sub="Next liquidity" />
            <StatCard label="TP3 Hit Rate" value={pct(stats.tp3HitRate)} accent="bull" sub="Fib reference" />
            <StatCard label="SL Hit Rate" value={pct(stats.slHitRate)} accent="bear" sub={stats.breakevens ? `${stats.breakevens} break-even` : undefined} />
          </div>

          {/* Portfolio limit summary */}
          {data.skipped && (data.skipped.active || data.skipped.perDay || data.skipped.dailyLoss || data.skipped.consecutive) > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {data.candidates} candidate setups — skipped by limits: {data.skipped.active} (max active),{" "}
              {data.skipped.perDay} (per day), {data.skipped.dailyLoss} (daily loss), {data.skipped.consecutive} (consecutive losses).
            </p>
          )}

          {/* Long / Short split */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DirCard title="LONG performance" icon={<TrendingUp className="size-4 text-bull" />} s={stats.long} />
            <DirCard title="SHORT performance" icon={<TrendingDown className="size-4 text-bear" />} s={stats.short} />
          </div>

          {/* Month-wise performance */}
          {stats.monthly && stats.monthly.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <CalendarDays className="size-4" /> Monthly Performance
                  <span className="text-[10px] font-normal text-muted-foreground">
                    ({stats.monthsProfitable}/{stats.monthly.length} months profitable · avg{" "}
                    {pct(stats.avgMonthlyReturnPct)} / month · equity compounds, so each month&apos;s
                    return is measured against its opening equity)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      {["Month", "Trades", "W / L", "Win Rate", "Net R", "Net Profit", "Return %", "Profit Factor", "Max DD", "TP1", "TP2", "TP3", "SL", "End Equity"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono tnum">
                    {stats.monthly.map((m) => (
                      <tr key={m.month} className="border-b border-border/60">
                        <td className="whitespace-nowrap px-3 py-2 font-semibold">{m.label}</td>
                        <td className="px-3 py-2">
                          {m.closed}
                          {m.open > 0 && <span className="ml-1 text-muted-foreground">(+{m.open} open)</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="text-bull">{m.wins}</span> / <span className="text-bear">{m.losses}</span>
                          {m.breakevens > 0 && <span className="text-muted-foreground"> / {m.breakevens}be</span>}
                        </td>
                        <td className={cn("px-3 py-2", m.winRate >= 50 ? "text-bull" : "text-bear")}>{pct(m.winRate)}</td>
                        <td className={cn("px-3 py-2", m.netR > 0 ? "text-bull" : m.netR < 0 ? "text-bear" : "")}>
                          {m.netR > 0 ? "+" : ""}{m.netR}R
                        </td>
                        <td className={cn("px-3 py-2", m.netProfit > 0 ? "text-bull" : m.netProfit < 0 ? "text-bear" : "")}>{money(m.netProfit)}</td>
                        <td className={cn("px-3 py-2", m.returnPct > 0 ? "text-bull" : m.returnPct < 0 ? "text-bear" : "")}>
                          {m.returnPct > 0 ? "+" : ""}{m.returnPct}%
                        </td>
                        <td className={cn("px-3 py-2", m.profitFactor >= 1 ? "text-bull" : "text-bear")}>{m.profitFactor}</td>
                        <td className="px-3 py-2 text-bear">{money(m.maxDrawdown)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{pct(m.tp1HitRate)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{pct(m.tp2HitRate)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{pct(m.tp3HitRate)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{pct(m.slHitRate)}</td>
                        <td className="px-3 py-2">{money(m.endEquity)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2">{stats.closedTrades}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="text-bull">{stats.wins}</span> / <span className="text-bear">{stats.losses}</span>
                      </td>
                      <td className={cn("px-3 py-2", stats.winRate >= 50 ? "text-bull" : "text-bear")}>{pct(stats.winRate)}</td>
                      <td className={cn("px-3 py-2", stats.netR > 0 ? "text-bull" : "text-bear")}>
                        {stats.netR > 0 ? "+" : ""}{stats.netR}R
                      </td>
                      <td className={cn("px-3 py-2", stats.netProfit > 0 ? "text-bull" : "text-bear")}>{money(stats.netProfit)}</td>
                      <td className={cn("px-3 py-2", stats.netProfitPct > 0 ? "text-bull" : "text-bear")}>
                        {stats.netProfitPct > 0 ? "+" : ""}{stats.netProfitPct}%
                      </td>
                      <td className={cn("px-3 py-2", stats.profitFactor >= 1 ? "text-bull" : "text-bear")}>{stats.profitFactor}</td>
                      <td className="px-3 py-2 text-bear">{money(stats.maxDrawdown)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{pct(stats.tp1HitRate)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{pct(stats.tp2HitRate)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{pct(stats.tp3HitRate)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{pct(stats.slHitRate)}</td>
                      <td className="px-3 py-2">{money(stats.finalEquity)}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}

          {/* RR comparison */}
          {data.rrComparison && data.rrComparison.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <GitCompare className="size-4" /> RR Comparison
                  <span className="text-[10px] font-normal text-muted-foreground">
                    (same entries &amp; stops, RR-based TP)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      {["RR", "Trades", "Win Rate", "Net Profit", "Profit Factor", "Max DD", "Expectancy"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono tnum">
                    {data.rrComparison.map((r) => {
                      const best = Math.max(...data.rrComparison.map((x) => x.netProfit));
                      const isBest = r.netProfit === best && best > 0;
                      return (
                        <tr key={r.rr} className={cn("border-b border-border/60", isBest && "bg-bull/5")}>
                          <td className="px-4 py-2 font-semibold">1:{r.rr}{isBest && <span className="ml-1 text-bull">★</span>}</td>
                          <td className="px-4 py-2">{r.closed}</td>
                          <td className="px-4 py-2">{pct(r.winRate)}</td>
                          <td className={cn("px-4 py-2", r.netProfit > 0 ? "text-bull" : r.netProfit < 0 ? "text-bear" : "")}>{money(r.netProfit)}</td>
                          <td className={cn("px-4 py-2", r.profitFactor >= 1 ? "text-bull" : "text-bear")}>{r.profitFactor}</td>
                          <td className="px-4 py-2 text-bear">{money(r.maxDrawdown)}</td>
                          <td className={cn("px-4 py-2", r.expectancy > 0 ? "text-bull" : "text-bear")}>{r.expectancy}R</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {data.errors && data.errors.length > 0 && (
            <Alert className="border-bear/40 bg-bear/10">
              <AlertDescription className="text-xs text-bear">
                {data.errors.map((e) => `${e.pair}: ${e.error}`).join(" · ")}
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          {tradeList.length > 0 ? (
            <TradesTable trades={tradeList} onTradeClick={setSelectedTrade} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No trades found for this configuration.</p>
          )}
        </div>
      )}

      <TradeChartDialog trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
    </main>
  );
}

function DirCard({ title, icon, s }) {
  if (!s) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-xs sm:grid-cols-6">
        <Metric label="Trades" value={s.trades} />
        <Metric label="Wins" value={s.wins} accent="bull" />
        <Metric label="Losses" value={s.losses} accent="bear" />
        <Metric label="Win Rate" value={pct(s.winRate)} accent={s.winRate >= 50 ? "bull" : "bear"} />
        <Metric label="Net R" value={`${s.netR > 0 ? "+" : ""}${s.netR}R`} accent={s.netR > 0 ? "bull" : "bear"} />
        <Metric label="Expectancy" value={`${s.expectancy}R`} accent={s.expectancy > 0 ? "bull" : "bear"} />
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, accent = "default" }) {
  const c = accent === "bull" ? "text-bull" : accent === "bear" ? "text-bear" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono font-bold tnum", c)}>{value}</div>
    </div>
  );
}
