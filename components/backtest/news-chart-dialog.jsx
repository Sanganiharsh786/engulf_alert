"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimpleNewsChart } from "@/components/backtest/charts";
import { NewsCandleBadge, NewsTypeBadge } from "@/components/backtest/news-badge";
import { IST_OFFSET_MS } from "@/components/backtest/utils";

function Ohlc({ label, value, className = "" }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${className}`}>{value}</div>
    </div>
  );
}

export function NewsChartDialog({ event, onClose }) {
  const open = Boolean(event);
  const symbols = event ? event.analysis.filter((a) => !a.error) : [];
  const [selectedSymbol, setSelectedSymbol] = useState(null);

  if (!event) return null;

  const activeSymbol = selectedSymbol && symbols.some((a) => a.symbol === selectedSymbol)
    ? selectedSymbol
    : symbols[0]?.symbol;

  const d = new Date(event.ts);
  const istDate = new Date(d.getTime() + IST_OFFSET_MS);
  const dateStr = istDate.toISOString().slice(0, 10);
  const timeStr = istDate.toISOString().slice(11, 16);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {event.label}
            <NewsTypeBadge type={event.type} />
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {dateStr} at {timeStr} IST · {event.timeET} ET
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {event.isUpcoming ? (
            <div className="flex h-64 items-center justify-center sm:h-80">
              <div className="max-w-md text-center">
                <CalendarClock className="mx-auto mb-4 size-10 text-bull" aria-hidden="true" />
                <h4 className="mb-2 text-lg font-bold text-bull">Upcoming event</h4>
                <p className="text-sm text-muted-foreground text-pretty">
                  This event hasn&apos;t occurred yet. Candle data will be available after the release at{" "}
                  <span className="font-medium text-foreground">
                    {dateStr} {timeStr} IST
                  </span>
                  .
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-bull" />
                  <span>Waiting for release</span>
                </div>
              </div>
            </div>
          ) : symbols.length > 0 ? (
            <Tabs value={activeSymbol} onValueChange={setSelectedSymbol}>
              <TabsList>
                {symbols.map((a) => (
                  <TabsTrigger key={a.symbol} value={a.symbol}>
                    {a.symbol}
                  </TabsTrigger>
                ))}
              </TabsList>
              {symbols.map((a) => (
                <TabsContent key={a.symbol} value={a.symbol} className="mt-3">
                  {a.chartRows && a.chartRows.length > 0 ? (
                    <SimpleNewsChart rows={a.chartRows} eventTs={event.ts} analysis={a} />
                  ) : (
                    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground sm:h-80">
                      No candle data available
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                    <Ohlc label="Open" value={a.candle.o.toFixed(4)} />
                    <Ohlc label="High" value={a.candle.h.toFixed(4)} className="text-bull" />
                    <Ohlc label="Low" value={a.candle.l.toFixed(4)} className="text-bear" />
                    <Ohlc label="Close" value={a.candle.c.toFixed(4)} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      Classification: <NewsCandleBadge analysis={a} />
                    </span>
                    <span>
                      Change:{" "}
                      <span className={a.changePct >= 0 ? "text-bull" : "text-bear"}>
                        {a.changePct > 0 ? "+" : ""}
                        {a.changePct}%
                      </span>
                    </span>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground sm:h-80">
              No candle data available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
