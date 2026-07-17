"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Live-updating lightweight-charts chart for FVG pairs.
 *
 * Polls /api/fvg-candles every `refreshMs` ms and streams the latest
 * candle data + FVG zones into the chart — same visual style as the
 * dashboard's LiveChart but tailored for forex FVG pairs via Twelve Data.
 *
 * Props:
 *   - pair: "XAU/USD" | "GBP/USD"
 *   - tf: timeframe string (default "4h")
 *   - refreshMs: poll interval (default 15_000)
 *   - height: chart height in px (default 380)
 */

const REFRESH_MS = 15_000;

function toCandle(r) {
  return {
    time: Math.floor(r.ts / 1000),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
  };
}

function toVolume(r) {
  return {
    time: Math.floor(r.ts / 1000),
    value: r.volume || 0,
    color: r.close >= r.open ? "#26a69a22" : "#ef535022",
  };
}

export function FVGLiveChart({ pair, tf = "4h", refreshMs = REFRESH_MS, height = 380 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const fvgLinesRef = useRef([]);
  const [error, setError] = useState("");
  const [lastPrice, setLastPrice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [fvgCount, setFvgCount] = useState(0);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let interval = null;
    let firstLoad = true;

    async function fetchData() {
      const res = await fetch(`/api/fvg-candles?tf=${tf}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    }

    function clearFVGLines(lwc) {
      fvgLinesRef.current.forEach((pl) => {
        try { candleRef.current?.removePriceLine(pl); } catch { /* silent */ }
      });
      fvgLinesRef.current = [];
    }

    function drawFVGLines(lwc, fvgZones) {
      for (const fvg of fvgZones || []) {
        if (fvg.fvgLow == null || fvg.fvgHigh == null) continue;
        const isBull = fvg.type === "bullish";
        const color = isBull ? "#26a69a" : "#ef5350";
        const price = Number(fvg.fvgLow);
        const priceH = Number(fvg.fvgHigh);
        if (!Number.isFinite(price) || !Number.isFinite(priceH)) continue;
        try {
          fvgLinesRef.current.push(
            candleRef.current.createPriceLine({
              price,
              color,
              lineWidth: 1,
              lineStyle: lwc.LineStyle.Solid,
              axisLabelVisible: false,
            })
          );
          fvgLinesRef.current.push(
            candleRef.current.createPriceLine({
              price: priceH,
              color,
              lineWidth: 1,
              lineStyle: lwc.LineStyle.Solid,
              axisLabelVisible: false,
            })
          );
        } catch { /* skip bad prices */ }
      }
    }

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        const chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: "#0e1422" },
            textColor: "#8b95a6",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: {
            vertLines: { color: "#1a2035" },
            horzLines: { color: "#1a2035" },
          },
          crosshair: { mode: lwc.CrosshairMode.Normal },
          rightPriceScale: {
            borderColor: "#1a2035",
            scaleMargins: { top: 0.08, bottom: 0.2 },
          },
          timeScale: {
            borderColor: "#1a2035",
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        chartRef.current = chart;

        const cs = chart.addCandlestickSeries({
          upColor: "#26a69a",
          downColor: "#ef5350",
          borderUpColor: "#26a69a",
          borderDownColor: "#ef5350",
          wickUpColor: "#26a69a",
          wickDownColor: "#ef5350",
          priceFormat: {
            type: "price",
            precision: pair.includes("JPY") ? 3 : 5,
            minMove: pair.includes("JPY") ? 0.001 : 0.00001,
          },
        });
        candleRef.current = cs;

        const vs = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a22",
        });
        volumeRef.current = vs;
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });

        async function refresh() {
          try {
            const data = await fetchData();
            if (cancelled || !candleRef.current) return;

            // Find this pair's scan data
            const scan = (data.scans || []).find((s) => s.pair === pair);
            if (!scan) {
              if (firstLoad) setError(`No data for ${pair}`);
              return;
            }

            const rows = scan.candleData || [];
            if (!rows.length) return;

            candleRef.current.setData(rows.map(toCandle));
            volumeRef.current.setData(rows.map(toVolume));

            // Update indicators
            setLastPrice(scan.currentPrice);
            setLastUpdate(Date.now());
            setFvgCount(scan.activeFVGs?.length || 0);
            setTouched(!!scan.touchedNow);
            setError("");

            // Redraw FVG lines
            clearFVGLines(lwc);
            drawFVGLines(lwc, scan.activeFVGs || []);

            if (firstLoad) {
              chart.timeScale().fitContent();
              firstLoad = false;
            }
          } catch (e) {
            if (!cancelled && firstLoad) setError(String(e.message || e));
          }
        }

        await refresh();
        interval = setInterval(refresh, Math.max(3000, refreshMs));
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();

    const onResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("resize", onResize);
      fvgLinesRef.current = [];
      candleRef.current = null;
      volumeRef.current = null;
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* silent */ }
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, tf, refreshMs, height]);

  if (error) {
    return (
      <div className="flex items-center justify-center w-full rounded-lg border border-bear/30 bg-bear/5 text-xs text-bear"
           style={{ height }}>
        ⚠ Could not load candles — {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Live indicator bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md border border-bull/40 bg-bull/10 px-2 py-0.5 font-semibold text-bull">
          <span className="size-1.5 animate-pulse rounded-full bg-bull" />
          LIVE
        </span>
        <span className="rounded-md border border-border bg-card px-2 py-0.5 text-muted-foreground">{tf}</span>
        {lastPrice != null && (
          <span className="font-mono font-semibold tnum text-foreground">
            {Number(lastPrice).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 })}
          </span>
        )}
        {fvgCount > 0 && (
          <span className="text-muted-foreground/60">
            {fvgCount} FVG{fvgCount !== 1 ? "s" : ""}
          </span>
        )}
        {touched && (
          <span className="animate-pulse rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
            TOUCHED
          </span>
        )}
        {lastUpdate && (
          <span className="ml-auto text-muted-foreground/60">
            {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}
      </div>
      {/* Chart canvas */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg border border-border/40 bg-[#0e1422]"
        style={{ height }}
      />
    </div>
  );
}
