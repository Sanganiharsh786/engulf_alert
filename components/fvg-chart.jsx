"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight-charts chart with candlestick data and FVG zone lines.
 * Uses the same approach as the engulfing dashboard's LiveChart — draws
 * FVG zone boundaries as dashed price lines on a real candlestick chart.
 *
 * Props:
 *   - candleData: array of { ts, open, high, low, close, volume } (optional)
 *   - fvgZones: array of { fvgLow, fvgHigh, type } (bullish/bearish)
 *   - height: chart height in px (default 300)
 *   - pair: pair name for display (optional)
 */

let chartCounter = 0;

export function FVGChart({ candleData = [], fvgZones = [], height = 300, pair = "" }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const chartIdRef = useRef(`fg-chart-${++chartCounter}`);

  useEffect(() => {
    if (!containerRef.current || !candleData?.length) return;

    let chart = null;
    let cancelled = false;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
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
            scaleMargins: { top: 0.08, bottom: 0.15 },
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

        // ── Candlestick series ──
        const candleSeries = chart.addCandlestickSeries({
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

        candleSeries.setData(
          candleData.map((r) => ({
            time: Math.floor(r.ts / 1000),
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
          }))
        );

        // ── Volume histogram ──
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a22",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeries.setData(
          candleData.map((r) => ({
            time: Math.floor(r.ts / 1000),
            value: r.volume || 0,
            color: r.close >= r.open ? "#26a69a22" : "#ef535022",
          }))
        );

        // ── Draw FVG zones as solid price lines (no labels) ──
        for (const fvg of fvgZones) {
          if (fvg.fvgLow == null || fvg.fvgHigh == null) continue;
          const isBull = fvg.type === "bullish";
          const color = isBull ? "#26a69a" : "#ef5350";

          try {
            candleSeries.createPriceLine({
              price: Number(fvg.fvgLow),
              color,
              lineWidth: 1,
              lineStyle: lwc.LineStyle.Solid,
              axisLabelVisible: false,
            });
            candleSeries.createPriceLine({
              price: Number(fvg.fvgHigh),
              color,
              lineWidth: 1,
              lineStyle: lwc.LineStyle.Solid,
              axisLabelVisible: false,
            });
          } catch {
            // skip bad prices
          }
        }

        chart.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) console.warn("FVGChart init error:", e);
      }
    })();

    const onResize = () => {
      if (chartRef.current && containerRef.current) {
        try {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        } catch {}
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch {}
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleData, fvgZones, height]);

  if (!candleData?.length) {
    return (
      <div
        ref={containerRef}
        id={chartIdRef.current}
        className="flex items-center justify-center w-full rounded-lg border border-border/50 bg-card/30 text-[11px] text-muted-foreground"
        style={{ height }}
      >
        Loading chart data…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id={chartIdRef.current}
      className="w-full overflow-hidden rounded-lg border border-border/50 bg-card/30"
      style={{ height }}
    />
  );
}
