"use client";

import { useEffect, useRef, useId } from "react";

/**
 * Real TradingView chart with FVG zone markings drawn as horizontal lines.
 * Uses TradingView's Advanced Chart widget + native API to draw FVG zones
 * as built-in Horizontal Line studies on the actual TradingView chart.
 *
 * Props:
 *   - symbol: TradingView symbol (e.g. "FX:EURUSD")
 *   - fvgZones: array of { fvgLow, fvgHigh, type } (bullish/bearish)
 *   - height: chart height in px (default 300)
 */
export function FVGChart({ symbol = "FX:EURUSD", fvgZones = [], height = 300 }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const id = useId();
  const chartId = `tv-fvg-${id.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    if (!containerRef.current) return;

    let widget = null;
    let mounted = true;

    function loadTradingView() {
      if (typeof window.TradingView === "undefined") {
        // Only add script if not already in head
        if (!document.querySelector('script[src*="tradingview.com/tv.js"]')) {
          const script = document.createElement("script");
          script.src = "https://s3.tradingview.com/tv.js";
          script.async = true;
          script.onload = initWidget;
          script.onerror = () => console.warn("Failed to load TradingView chart");
          document.head.appendChild(script);
        } else {
          // Script added but not loaded yet, wait for it
          const check = setInterval(() => {
            if (typeof window.TradingView !== "undefined") {
              clearInterval(check);
              initWidget();
            }
          }, 200);
        }
      } else {
        initWidget();
      }
    }

    function initWidget() {
      if (!mounted || !containerRef.current) return;

      widget = new window.TradingView.widget({
        container_id: chartId,
        symbol: symbol,
        interval: "240", // 4H
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1", // Candles
        locale: "en",
        toolbar_bg: "#0e1422",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        hideideas: true,
        width: "100%",
        height: height,
        studies: [],
      });

      widgetRef.current = widget;

      // Draw FVG zones after chart is fully loaded
      widget.onChartReady(function () {
        if (!mounted) return;
        const chart = widget.chart();
        if (!chart) return;

        // Wait a moment for the chart to fully render
        setTimeout(() => {
          if (!mounted || !chart) return;

          for (const fvg of fvgZones) {
            const isBull = fvg.type === "bullish";
            const color = isBull ? "#26a69a" : "#ef5350";
            const label = isBull ? "BULL FVG" : "BEAR FVG";

            try {
              // Add horizontal line at FVG low
              chart.createStudy("Horizontal Line", false, false, [fvg.fvgLow]);
              // Add horizontal line at FVG high
              chart.createStudy("Horizontal Line", false, false, [fvg.fvgHigh]);
            } catch (e) {
              // Silently ignore drawing errors
            }
          }
        }, 500);
      });
    }

    loadTradingView();

    return () => {
      mounted = false;
      if (widget) {
        try { widget.remove(); } catch {}
        widgetRef.current = null;
      }
    };
  }, [symbol, height]); // Only re-init on symbol/height change

  return (
    <div
      ref={containerRef}
      id={chartId}
      className="w-full overflow-hidden rounded-lg border border-border/50 bg-card/30"
      style={{ height }}
    />
  );
}
