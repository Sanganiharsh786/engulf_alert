"use client";

import { useEffect, useRef } from "react";

/**
 * Real TradingView chart with FVG zone markings drawn as horizontal lines.
 * Uses TradingView's Advanced Chart widget + native API to draw FVG zones
 * as built-in Horizontal Line studies on the actual TradingView chart.
 *
 * Props:
 *   - symbol: TradingView symbol (e.g. "FX:EURUSD")
 *   - fvgZones: array of { fvgLow, fvgHigh } (both required)
 *   - height: chart height in px (default 300)
 */

let chartCounter = 0;

export function FVGChart({ symbol = "FX:EURUSD", fvgZones = [], height = 300 }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const chartIdRef = useRef(`tv-fvg-${++chartCounter}`);
  const chartId = chartIdRef.current;
  const drawnRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let widget = null;
    let mounted = true;
    let readyInterval = null;

    function loadTradingView() {
      if (typeof window.TradingView === "undefined") {
        if (!document.querySelector('script[src*="tradingview.com/tv.js"]')) {
          const script = document.createElement("script");
          script.src = "https://s3.tradingview.com/tv.js";
          script.async = true;
          script.onload = initWidget;
          script.onerror = () => console.warn("Failed to load TradingView chart");
          document.head.appendChild(script);
        } else {
          readyInterval = setInterval(() => {
            if (typeof window.TradingView !== "undefined") {
              clearInterval(readyInterval);
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

      try {
        widget = new window.TradingView.widget({
          container_id: chartId,
          symbol: symbol,
          interval: "240",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0e1422",
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          hideideas: true,
          width: "100%",
          height: height,
          studies: [],
          disabled_features: ["use_localstorage_for_settings"],
          overrides: {
            "paneProperties.background": "#0e1422",
            "paneProperties.vertGridProperties.color": "#1a2035",
            "paneProperties.horzGridProperties.color": "#1a2035",
          },
        });

        widgetRef.current = widget;
        drawnRef.current = false;

        widget.onChartReady(function () {
          if (!mounted) return;
          try {
            drawFvgLines();
          } catch (e) {
            console.warn("FVGChart: onChartReady error", e);
          }
        });
      } catch (e) {
        console.warn("FVGChart: init error", e);
      }
    }

    async function drawFvgLines() {
      const w = widgetRef.current;
      if (!w || drawnRef.current) return;
      drawnRef.current = true;

      try {
        const activeChart = w.activeChart();
        if (!activeChart) return;

        for (const fvg of fvgZones) {
          if (fvg.fvgLow == null || fvg.fvgHigh == null) continue;
          try {
            await activeChart.createStudy("Horizontal Line", false, false, [Number(fvg.fvgLow)]);
            await activeChart.createStudy("Horizontal Line", false, false, [Number(fvg.fvgHigh)]);
          } catch {}
        }
      } catch {}
    }

    loadTradingView();

    return () => {
      mounted = false;
      if (readyInterval) clearInterval(readyInterval);
      if (widget) {
        try {
          widget.remove();
        } catch {}
        widgetRef.current = null;
      }
    };
  }, [symbol, height]);

  return (
    <div
      ref={containerRef}
      id={chartId}
      className="w-full overflow-hidden rounded-lg border border-border/50 bg-card/30"
      style={{ height }}
    />
  );
}
