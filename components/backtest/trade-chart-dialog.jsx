"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/backtest/spinner";
import { TradingViewChart } from "@/components/backtest/charts";
import { fmt } from "@/components/backtest/utils";

function DetailStat({ label, value, className = "" }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold sm:text-base ${className}`}>{value}</div>
    </div>
  );
}

export function TradeChartDialog({ trade, onClose }) {
  const [chartData, setChartData] = useState(null); // { svg, rows, signalTs, tf }
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState("");

  const open = Boolean(trade);

  // Derive the TradingView symbol from the trade data
  const tvSymbol = trade
    ? trade.tvSymbol ||
      (trade.tradingview
        ? trade.tradingview
        : trade.exchange
        ? `${trade.exchange.toUpperCase()}:${trade.pair}`
        : "")
    : "";

  // Parse level string like "62842.5-63104.4" into low/high values
  let levelLow, levelHigh;
  if (trade?.level && typeof trade.level === "string" && trade.level.includes("-")) {
    const parts = trade.level.split("-");
    levelLow = parseFloat(parts[0]);
    levelHigh = parseFloat(parts[1]);
  }

  // Fetch chart data (rows + svg) once when the modal opens — both tabs share it.
  useEffect(() => {
    if (!trade) return;
    let cancelled = false;
    (async () => {
      setChartLoading(true);
      setChartError("");
      setChartData(null);
      try {
        const response = await fetch("/api/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairName: trade.pair,
            timestamp: trade.ts,
            entry: trade.entry,
            stop: trade.stop,
            tp: trade.tp,
            direction: trade.direction,
            levelLow,
            levelHigh,
          }),
        });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        if (data.error) setChartError(data.error);
        else setChartData(data);
      } catch (e) {
        if (!cancelled) setChartError(String(e.message || e));
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.ts, trade?.pair]);

  if (!trade) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {trade.pair}
            <Badge
              variant="outline"
              className={
                trade.direction === "bullish"
                  ? "border-bull/40 bg-bull/10 text-bull"
                  : "border-bear/40 bg-bear/10 text-bear"
              }
            >
              {trade.direction?.toUpperCase()} ENGULFING
            </Badge>
            <Badge
              variant="outline"
              className={
                trade.outcome === "win"
                  ? "border-bull/40 bg-bull/10 text-bull"
                  : trade.outcome === "loss"
                  ? "border-bear/40 bg-bear/10 text-bear"
                  : "border-border text-muted-foreground"
              }
            >
              {trade.outcome?.toUpperCase()}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {trade.time} IST · Level {trade.level}
            {tvSymbol && <span className="ml-2 font-mono">{tvSymbol}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {chartLoading ? (
            <div className="flex h-72 items-center justify-center sm:h-96">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Spinner />
                <span className="text-sm">Loading chart data…</span>
              </div>
            </div>
          ) : chartError ? (
            <div className="flex h-72 items-center justify-center text-center sm:h-96">
              <div className="text-bear">
                <div className="mb-2 text-lg font-semibold">Chart error</div>
                <div className="text-sm">{chartError}</div>
              </div>
            </div>
          ) : !chartData ? null : (
            <Tabs defaultValue="tradingview">
              <TabsList>
                <TabsTrigger value="tradingview">TradingView</TabsTrigger>
                <TabsTrigger value="svg">SVG chart</TabsTrigger>
              </TabsList>
              <TabsContent value="tradingview" className="mt-3">
                <div className="h-[300px] w-full overflow-hidden rounded-lg border border-border sm:h-[450px]">
                  <TradingViewChart trade={trade} rows={chartData.rows} signalTs={chartData.signalTs} />
                </div>
              </TabsContent>
              <TabsContent value="svg" className="mt-3">
                <div className="h-[300px] w-full overflow-hidden rounded-lg bg-[#0e1422] sm:h-[450px]">
                  <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: chartData.svg }} />
                </div>
              </TabsContent>
            </Tabs>
          )}

          {/* Trade details */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            <DetailStat label="Entry" value={fmt(trade.entry)} className="text-primary" />
            <DetailStat label="Stop loss" value={fmt(trade.stop)} className="text-bear" />
            <DetailStat label="Take profit" value={fmt(trade.tp)} className="text-bull" />
            <DetailStat
              label="Risk/Reward"
              value={trade.r > 0 ? `+${trade.r}R` : `${trade.r}R`}
              className={trade.r > 0 ? "text-bull" : trade.r < 0 ? "text-bear" : ""}
            />
            <DetailStat label="Bars held" value={trade.barsHeld || "—"} />
          </div>

          {tvSymbol && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  Open full chart on TradingView
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
