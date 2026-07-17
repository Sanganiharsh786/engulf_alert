"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";

/**
 * FVG Candlestick Chart with FVG zone overlays.
 * Uses TradingView's lightweight-charts library (free, open-source).
 *
 * Props:
 *   - candles: array of { ts, open, high, low, close } or raw [ts,o,h,l,c] arrays
 *   - fvgZones: array of { fvgLow, fvgHigh, type } (bullish/bearish)
 *   - height: chart height in px (default 300)
 */
export function FVGChart({ candles, fvgZones = [], height = 300 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles?.length) return;

    // Parse candles into lightweight-charts format
    const seriesData = candles.map((c) => {
      const ts = c.ts || c[0];
      const open = c.open ?? c[1];
      const high = c.high ?? c[2];
      const low = c.low ?? c[3];
      const close = c.close ?? c[4];
      return { time: Math.floor(ts / 1000), open, high, low, close };
    }).filter((d) => d.time && d.open && d.high && d.low && d.close);

    if (seriesData.length < 2) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0e1422" },
        textColor: "#8b97b8",
      },
      grid: {
        vertLines: { color: "#1e2840" },
        horzLines: { color: "#1e2840" },
      },
      width: containerRef.current.clientWidth,
      height,
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: "#1e2840",
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: "#1e2840",
      },
    });

    // Candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderDownColor: "#ef5350",
      borderUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      wickUpColor: "#26a69a",
    });
    candlestickSeries.setData(seriesData);

    // Draw FVG zones as price lines (horizontal markers on the chart)
    if (fvgZones?.length > 0) {
      for (const fvg of fvgZones) {
        const isBull = fvg.type === "bullish";
        const color = isBull ? "#26a69a" : "#ef5350";

        chart.addPriceLine({
          price: fvg.fvgLow,
          color,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          title: `FVG ${isBull ? "↑" : "↓"} ${fvg.fvgLow.toFixed(4)}`,
          axisLabelVisible: true,
        });

        chart.addPriceLine({
          price: fvg.fvgHigh,
          color,
          lineWidth: 1,
          lineStyle: 2,
          title: `FVG ${isBull ? "↑" : "↓"} ${fvg.fvgHigh.toFixed(4)}`,
          axisLabelVisible: true,
        });
      }
    }

    chartRef.current = chart;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, fvgZones, height]);

  if (!candles?.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border/50 bg-card/30 text-xs text-muted-foreground"
        style={{ height }}
      >
        No candle data available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-lg border border-border/50"
      style={{ height }}
    />
  );
}
