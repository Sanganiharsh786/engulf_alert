"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bug,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/backtest/spinner";
import { TradesTable } from "@/components/backtest/trades-table";
import { TradeChartDialog } from "@/components/backtest/trade-chart-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "../toast";
import { fmt } from "@/components/backtest/utils";

function round(n, dp) {
  if (dp === undefined) dp = 2;
  if (n == null || isNaN(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function pct(n) {
  if (n == null || isNaN(n)) return "0%";
  return round(n, 1) + "%";
}

export default function ZoneOriginBacktestPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [rrRatio, setRrRatio] = useState("");
  const [debugMode, setDebugMode] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const toast = useToast();

  async function runBacktest() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const body = { days };
      if (rrRatio) body.rrRatio = parseFloat(rrRatio);
      if (debugMode) body.debug = true;
      const res = await fetch("/api/backtest-zone-origin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setData(result);
      const total = result.trades ? result.trades.length : 0;
      toast(`Backtest complete · ${total} trade${total !== 1 ? "s" : ""} found`, "success");
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

  const summary = useMemo(() => {
    if (!data || !data.trades) return null;
    const trades = data.trades;
    const closed = trades.filter((t) => t.outcome !== "open");
    const wins = closed.filter((t) => t.outcome === "win");
    const losses = closed.filter((t) => t.outcome === "loss");
    const total = trades.length;
    const closedCount = closed.length;
    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = closedCount ? round((winCount / closedCount) * 100, 1) : 0;
    const netR = round(closed.reduce((a, t) => a + t.r, 0), 2);

    let grossGains = 0;
    let grossLosses = 0;
    let cumR = 0;
    let peak = 0;
    let maxDD = 0;
    const chronological = [...closed].sort((a, b) => a.ts - b.ts);
    for (const t of chronological) {
      cumR += t.r;
      if (cumR > peak) peak = cumR;
      const dd = peak > 0 ? ((peak - cumR) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    for (const t of closed) {
      if (t.r > 0) grossGains += t.r;
      else if (t.r < 0) grossLosses += Math.abs(t.r);
    }

    const profitFactor = grossLosses > 0 ? round(grossGains / grossLosses, 2) : grossGains > 0 ? 999 : 0;
    const avgRR = closedCount ? round(cumR / closedCount, 2) : 0;
    const avgWin = winCount ? round(wins.reduce((a, t) => a + t.r, 0) / winCount, 2) : 0;
    const avgLoss = lossCount ? round(Math.abs(losses.reduce((a, t) => a + t.r, 0)) / lossCount, 2) : 0;
    const bestTrade = closed.length ? Math.max(...closed.map((t) => t.r)) : 0;
    const worstTrade = closed.length ? Math.min(...closed.map((t) => t.r)) : 0;

    return {
      total,
      closedCount,
      winCount,
      lossCount,
      winRate,
      netR,
      profitFactor,
      avgRR,
      avgWin,
      avgLoss,
      maxDD: round(maxDD, 2),
      bestTrade,
      worstTrade,
    };
  }, [data]);

  const byPair = useMemo(() => {
    if (!data || !data.trades) return [];
    const map = {};
    for (const t of data.trades) {
      const s = (map[t.pair] = map[t.pair] || {
        pair: t.pair,
        signals: 0,
        wins: 0,
        losses: 0,
        netR: 0,
      });
      s.signals++;
      if (t.outcome === "win") {
        s.wins++;
        s.netR += t.r;
      } else if (t.outcome === "loss") {
        s.losses++;
        s.netR += t.r;
      }
    }
    return Object.values(map).map((s) => ({
      ...s,
      netR: round(s.netR, 2),
      winRate: s.signals ? round((s.wins / s.signals) * 100, 1) : 0,
    }));
  }, [data]);

  const tradeList = useMemo(() => {
    if (!data || !data.trades) return [];
    return [...data.trades].sort((a, b) => (a.time < b.time ? 1 : -1));
  }, [data]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card">
            <TrendingUp className="size-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Zone Origin Engulfing
            </h1>
            <p className="text-xs text-muted-foreground">
              Only engulfing at 4H starting point of Support/Resistance zone{" "}
              {data && `· ${data.trades.length} trades found`}
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
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a href="/backtest">
              <BarChart3 />
              Standard Backtest
            </a>
          </Button>
        </div>
      </header>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Days of history
          </Label>
          <Input
            type="number"
            min={1}
            max={370}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value || "10", 10))}
            className="h-8 w-24 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            R:R Ratio (optional)
          </Label>
          <Input
            type="number"
            step="0.5"
            min={0.5}
            value={rrRatio}
            onChange={(e) => setRrRatio(e.target.value)}
            placeholder="Default"
            className="h-8 w-24 font-mono text-xs"
          />
        </div>
        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 text-xs">
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
            className="size-3.5"
          />
          <Bug className="size-3.5" />
          Debug mode
        </label>
        <Button size="sm" onClick={runBacktest} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          {loading ? "Running…" : "Run Backtest"}
        </Button>
      </div>

      {error && (
        <Alert className="mt-4 border-bear/40 bg-bear/10">
          <AlertDescription className="text-sm text-bear">{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="mt-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner />
          <p className="text-sm">Running zone-origin backtest…</p>
        </div>
      )}

      {/* Results */}
      {data && summary && (
        <div className="mt-6 flex flex-col gap-6">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Win Rate" value={pct(summary.winRate)} accent={summary.winRate >= 50 ? "bull" : "bear"} />
            <StatCard
              label="Net R"
              value={`${summary.netR > 0 ? "+" : ""}${summary.netR}R`}
              accent={summary.netR > 0 ? "bull" : summary.netR < 0 ? "bear" : "muted"}
            />
            <StatCard label="Trades" value={summary.total} sub={`${summary.closedCount} closed`} />
            <StatCard label="W / L" value={`${summary.winCount} / ${summary.lossCount}`} />
            <StatCard label="Profit Factor" value={summary.profitFactor} accent={summary.profitFactor >= 1 ? "bull" : "bear"} />
            <StatCard label="Max Drawdown" value={pct(summary.maxDD)} accent="bear" />
            <StatCard label="Avg R / trade" value={`${summary.avgRR}R`} />
            <StatCard label="Avg Win" value={`+${summary.avgWin}R`} accent="bull" />
            <StatCard label="Avg Loss" value={`-${summary.avgLoss}R`} accent="bear" />
            <StatCard label="Best Trade" value={`+${round(summary.bestTrade, 2)}R`} accent="bull" />
            <StatCard label="Worst Trade" value={`${round(summary.worstTrade, 2)}R`} accent="bear" />
          </div>

          {/* Per-pair breakdown */}
          {byPair.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">By Pair</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {byPair.map((p) => (
                    <div key={p.pair} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs">
                      <span className="w-20 font-semibold">{p.pair}</span>
                      <span className="text-muted-foreground">{p.signals} signals</span>
                      <span className="flex items-center gap-1 text-bull">
                        <TrendingUp className="size-3.5" /> {p.wins}W
                      </span>
                      <span className="flex items-center gap-1 text-bear">
                        <TrendingDown className="size-3.5" /> {p.losses}L
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(p.winRate >= 50 ? "border-bull/40 text-bull" : "border-bear/40 text-bear")}
                      >
                        {pct(p.winRate)}
                      </Badge>
                      <span
                        className={cn(
                          "ml-auto font-mono font-bold tnum",
                          p.netR > 0 ? "text-bull" : p.netR < 0 ? "text-bear" : "text-muted-foreground"
                        )}
                      >
                        {p.netR > 0 ? `+${p.netR}` : p.netR}R
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Trades table */}
          {tradeList.length > 0 ? (
            <TradesTable trades={tradeList} onTradeClick={setSelectedTrade} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No trades found for this period.
            </p>
          )}

          {/* Debug output */}
          {debugMode && data.debug && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bug className="size-4" /> Debug Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-96 overflow-auto rounded-md bg-popover p-3 font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(data.debug, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Trade chart dialog — TradingView chart + risk/reward, same as backtest */}
      <TradeChartDialog trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
    </main>
  );
}

function StatCard({ label, value, sub, accent = "default" }) {
  const accentClass =
    accent === "bull"
      ? "text-bull"
      : accent === "bear"
      ? "text-bear"
      : accent === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-lg font-bold tnum", accentClass)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
