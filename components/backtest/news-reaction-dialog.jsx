"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { NewsReactionChart } from "@/components/backtest/charts";
import { NewsCandleBadge, NewsTypeBadge, VerdictBadge } from "@/components/backtest/news-badge";
import { IST_OFFSET_MS } from "@/components/backtest/utils";

const TFS = ["1m", "15m", "1h"];

function Cell({ label, value, className = "" }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${className}`}>{value}</div>
    </div>
  );
}

function HorizonCard({ tf, h, news }) {
  if (!h || h.error) {
    return (
      <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
        {tf} close · {h?.error || "no data"}
      </div>
    );
  }
  const cont = h.verdict === "continuation";
  return (
    <div
      className={`rounded-lg border p-3 ${
        cont ? "border-bull/40 bg-bull/5" : h.verdict === "reversal" ? "border-bear/40 bg-bear/5" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">
          {tf} close
          <span className="ml-1.5 font-normal text-muted-foreground">
            +{h.minutesAfterNews}m after news
          </span>
        </span>
        <VerdictBadge horizon={h} tf={tf} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground">vs news close</div>
          <div className={`font-mono font-bold ${h.closeVsNewsR >= 0 ? "text-bull" : "text-bear"}`}>
            {h.closeVsNewsR > 0 ? "+" : ""}
            {h.closeVsNewsR}R
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">ran further</div>
          <div className="font-mono font-bold text-bull">{h.mfeR}R</div>
        </div>
        <div>
          <div className="text-muted-foreground">pulled back</div>
          <div className="font-mono font-bold text-bear">{h.maeR}R</div>
        </div>
        <div>
          <div className="text-muted-foreground">hit first</div>
          <div className="font-mono font-bold">
            {h.firstTouch === "continuation"
              ? news.dir < 0
                ? "news low"
                : "news high"
              : h.firstTouch === "reversal"
              ? "news open"
              : h.firstTouch === "both"
              ? "both (1m)"
              : "neither"}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">
        {tf} candle body: {h.candleDir}
        {h.candleAgrees ? " (same colour as the news candle)" : " (opposite colour to the news candle)"} ·
        the verdict is measured from the news candle&apos;s close, not this candle&apos;s open
        {h.complete ? "" : " · candle incomplete in the fetched window"}
      </div>
    </div>
  );
}

export function NewsReactionDialog({ event, onClose }) {
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [tf, setTf] = useState("1m");

  if (!event) return null;

  const symbols = event.symbols.filter((s) => !s.error && s.news);
  const activeSymbol =
    selectedSymbol && symbols.some((s) => s.symbol === selectedSymbol)
      ? selectedSymbol
      : symbols[0]?.symbol;

  const ist = new Date(event.ts + IST_OFFSET_MS);
  const dateStr = ist.toISOString().slice(0, 10);
  const timeStr = ist.toISOString().slice(11, 16);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {event.label}
            <NewsTypeBadge type={event.type} />
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {dateStr} at {timeStr} IST · {event.timeET} ET · reaction measured from the 1m news
            candle close
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {symbols.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No candle data for this release
            </div>
          ) : (
            <Tabs value={activeSymbol} onValueChange={setSelectedSymbol}>
              <TabsList>
                {symbols.map((s) => (
                  <TabsTrigger key={s.symbol} value={s.symbol}>
                    {s.symbol}
                  </TabsTrigger>
                ))}
              </TabsList>

              {symbols.map((s) => (
                <TabsContent key={s.symbol} value={s.symbol} className="mt-3">
                  <div className="mb-3 flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Chart timeframe
                      </Label>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={tf}
                        onValueChange={(v) => v && setTf(v)}
                        className="justify-start"
                      >
                        {TFS.map((t) => (
                          <ToggleGroupItem key={t} value={t} aria-label={`Show ${t} candles`}>
                            {t}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-xs">
                      news candle: <NewsCandleBadge analysis={{ ...s.news, changePct: s.news.changePct }} />
                    </div>
                  </div>

                  <NewsReactionChart rows={s.rows} news={s.news} tf={tf} />

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 border-t border-dashed border-gold" /> news candle high
                      &amp; low
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-gold">▲▼</span> the news candle
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
                    <Cell label="Open" value={s.news.o} />
                    <Cell label="High" value={s.news.h} className="text-bull" />
                    <Cell label="Low" value={s.news.l} className="text-bear" />
                    <Cell label="Close" value={s.news.c} className="text-gold" />
                    <Cell
                      label="Range"
                      value={`${s.news.rangePct}%`}
                      className="text-muted-foreground"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {["15m", "1h"].map((t) => (
                      <HorizonCard key={t} tf={t} h={s.horizons?.[t]} news={s.news} />
                    ))}
                  </div>

                  <p className="mt-3 text-[11px] text-muted-foreground">
                    R = one news-candle range ({s.news.range}). The {`15m`} and {`1h`} verdicts compare
                    that candle&apos;s close with the 1m news candle&apos;s close, so a positive number
                    always means price kept moving the way the news candle pushed it.
                  </p>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
