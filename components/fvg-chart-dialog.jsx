"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { FVGChart } from "@/components/fvg-chart";

export function FVGChartDialog({ open, onClose, pair, scan, candleData, tf = "4h" }) {
  if (!pair || !scan) return null;

  const activeFVGs = scan?.activeFVGs || [];
  const tvSymbol = scan?.tvSymbol;
  const freshFVG = scan?.freshFVG;
  const touched = scan?.touchedNow;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {pair}
            {freshFVG && (
              <Badge
                variant="outline"
                className={
                  freshFVG.type === "bullish"
                    ? "border-bull/40 bg-bull/10 text-bull"
                    : "border-bear/40 bg-bear/10 text-bear"
                }
              >
                {freshFVG.type.toUpperCase()} FVG
              </Badge>
            )}
            {touched && (
              <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">
                TOUCHED
              </Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">
              {tf}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Full-size chart */}
          <div className="h-[50vh] min-h-[300px] w-full overflow-hidden rounded-lg border border-border sm:h-[60vh] sm:min-h-[450px]">
            <FVGChart
              key={`chart-${scan?.scannedAt || 0}`}
              pair={pair}
              candleData={candleData || []}
              fvgZones={activeFVGs}
              height="100%"
            />
          </div>

          {/* FVG zone info */}
          {activeFVGs.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                FVG Zones ({activeFVGs.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {activeFVGs.slice(0, 8).map((fvg, i) => (
                  <div
                    key={i}
                    className={`rounded-md border px-2.5 py-1.5 text-[11px] ${
                      fvg.type === "bullish"
                        ? "border-bull/20 bg-bull/5"
                        : "border-bear/20 bg-bear/5"
                    }`}
                  >
                    <span className="font-mono font-medium">
                      {Number(fvg.fvgLow).toFixed(5)} → {Number(fvg.fvgHigh).toFixed(5)}
                    </span>
                    <span className={`ml-1.5 text-[10px] ${fvg.type === "bullish" ? "text-bull" : "text-bear"}`}>
                      {fvg.type.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open in TradingView */}
          {tvSymbol && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="mr-1 size-3.5" />
                  Open on TradingView
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
