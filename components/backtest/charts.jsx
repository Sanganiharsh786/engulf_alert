"use client";

import { useEffect, useRef, useState } from "react";

/* ---------- TradingView-style Chart (lightweight-charts) ---------- */
// Uses TradingView's free open-source lightweight-charts library so we can
// overlay Entry / Stop / Take-Profit zones, the level band, and a marker
// on the engulfing candle.

// Custom drawing primitive: filled rectangle between two (time, price) corners.
function positionsBox(p1, p2, ratio) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  return {
    position: Math.round(min * ratio),
    length: Math.max(1, Math.round((max - min) * ratio)),
  };
}

function makeZonePrimitive(startTime, endTime, priceA, priceB, fillColor, borderColor) {
  return {
    _chart: null,
    _series: null,
    _p1: { x: null, y: null },
    _p2: { x: null, y: null },
    attached({ chart, series }) {
      this._chart = chart;
      this._series = series;
    },
    detached() {},
    updateAllViews() {
      if (!this._chart || !this._series) return;
      const ts = this._chart.timeScale();
      this._p1 = {
        x: ts.timeToCoordinate(startTime),
        y: this._series.priceToCoordinate(priceA),
      };
      this._p2 = {
        x: ts.timeToCoordinate(endTime),
        y: this._series.priceToCoordinate(priceB),
      };
    },
    paneViews() {
      const p1 = this._p1;
      const p2 = this._p2;
      return [
        {
          renderer: () => ({
            draw(target) {
              target.useBitmapCoordinateSpace((scope) => {
                if (
                  p1.x == null || p1.y == null ||
                  p2.x == null || p2.y == null
                ) return;
                const hbox = positionsBox(p1.x, p2.x, scope.horizontalPixelRatio);
                const vbox = positionsBox(p1.y, p2.y, scope.verticalPixelRatio);
                const ctx = scope.context;
                ctx.fillStyle = fillColor;
                ctx.fillRect(hbox.position, vbox.position, hbox.length, vbox.length);
                if (borderColor) {
                  ctx.strokeStyle = borderColor;
                  ctx.lineWidth = Math.max(1, scope.verticalPixelRatio);
                  ctx.strokeRect(hbox.position, vbox.position, hbox.length, vbox.length);
                }
              });
            },
          }),
        },
      ];
    },
  };
}

export function TradingViewChart({ trade, rows, signalTs }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!containerRef.current || !rows || rows.length === 0) return;

    let chart = null;
    let cancelled = false;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: "#0e1422" },
            textColor: "#e8edff",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: {
            vertLines: { color: "#1e2840" },
            horzLines: { color: "#1e2840" },
          },
          crosshair: { mode: lwc.CrosshairMode.Normal },
          rightPriceScale: {
            borderColor: "#1e2840",
            scaleMargins: { top: 0.1, bottom: 0.25 },
          },
          timeScale: {
            borderColor: "#1e2840",
            timeVisible: true,
            secondsVisible: false,
          },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        chartRef.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#26a69a",
          downColor: "#ef5350",
          borderUpColor: "#26a69a",
          borderDownColor: "#ef5350",
          wickUpColor: "#26a69a",
          wickDownColor: "#ef5350",
        });

        candleSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            open: r[1],
            high: r[2],
            low: r[3],
            close: r[4],
          }))
        );

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a44",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            value: r[5],
            color: r[4] >= r[1] ? "#26a69a44" : "#ef535044",
          }))
        );

        // SL / TP filled risk-reward zones (start at signal candle, extend to last bar)
        const sigSec = Math.floor(Number(signalTs ?? trade.ts) / 1000);
        const lastSec = Math.floor(rows[rows.length - 1][0] / 1000);
        if (sigSec && lastSec > sigSec && trade.entry != null) {
          if (trade.tp != null) {
            candleSeries.attachPrimitive(
              makeZonePrimitive(
                sigSec,
                lastSec,
                Number(trade.entry),
                Number(trade.tp),
                "rgba(38, 166, 154, 0.22)",
                "rgba(38, 166, 154, 0.55)"
              )
            );
          }
          if (trade.stop != null) {
            candleSeries.attachPrimitive(
              makeZonePrimitive(
                sigSec,
                lastSec,
                Number(trade.entry),
                Number(trade.stop),
                "rgba(239, 83, 80, 0.22)",
                "rgba(239, 83, 80, 0.55)"
              )
            );
          }
        }
        // Marker on the engulfing signal candle.
        const sigTs = Number(signalTs ?? trade.ts);
        if (sigTs) {
          const bullish = trade.direction === "bullish";
          candleSeries.setMarkers([
            {
              time: Math.floor(sigTs / 1000),
              position: bullish ? "belowBar" : "aboveBar",
              color: "#3b82f6",
              shape: bullish ? "arrowUp" : "arrowDown",
              text: `${(trade.direction || "").toUpperCase()} ENGULFING`,
              size: 2,
            },
          ]);
        }

        chart.timeScale().fitContent();
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
      window.removeEventListener("resize", onResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (e) { /* silent */ }
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, signalTs, trade.entry, trade.stop, trade.tp, trade.direction, trade.ts]);

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center text-center text-bear">
        <div>
          <div className="mb-2 text-lg">Chart Error</div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[300px] w-full overflow-hidden rounded-lg bg-[#0e1422] sm:min-h-[450px]"
    />
  );
}

/* ---------- Simplified lightweight-charts for news events ---------- */

export function SimpleNewsChart({ rows, eventTs, analysis }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!containerRef.current || !rows || rows.length === 0) return;
    let chart = null;
    let cancelled = false;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: "#0e1422" },
            textColor: "#e8edff",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: { vertLines: { color: "#1e2840" }, horzLines: { color: "#1e2840" } },
          rightPriceScale: { borderColor: "#1e2840", scaleMargins: { top: 0.1, bottom: 0.25 } },
          timeScale: { borderColor: "#1e2840", timeVisible: true, secondsVisible: false },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        chartRef.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#26a69a", downColor: "#ef5350",
          borderUpColor: "#26a69a", borderDownColor: "#ef5350",
          wickUpColor: "#26a69a", wickDownColor: "#ef5350",
        });

        const seriesData = rows.map((r) => ({
          time: Math.floor(r[0] / 1000),
          open: r[1], high: r[2], low: r[3], close: r[4],
        }));
        candleSeries.setData(seriesData);

        // Volume histogram
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a44",
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        volumeSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            value: r[5],
            color: r[4] >= r[1] ? "#26a69a44" : "#ef535044",
          }))
        );

        // Marker at the event candle
        candleSeries.setMarkers([
          {
            time: Math.floor(eventTs / 1000),
            position: "aboveBar",
            color: "#f1c40f",
            shape: "circle",
            text: `NEWS ${analysis?.classification?.toUpperCase() || ""}`.trim(),
            size: 2,
          },
        ]);

        chart.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e));
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
      window.removeEventListener("resize", onResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* silent */ }
        chartRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, eventTs]);

  if (err) return <div className="flex h-80 items-center justify-center text-sm text-bear">{err}</div>;

  return (
    <div
      ref={containerRef}
      className="h-[280px] min-h-[280px] w-full overflow-hidden rounded-lg bg-[#0e1422] sm:h-[400px] sm:min-h-[400px]"
    />
  );
}
