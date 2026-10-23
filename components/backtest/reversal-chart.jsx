"use client";

import { useEffect, useRef, useState } from "react";

// Annotated candlestick chart for one candle-reversal trade (§6).
//
// Everything drawn here comes from the engine's own annotation payload — the
// chart never re-derives the pattern, so what you see is exactly what the
// backtest decided, including the bars it chose NOT to exit on.
//
// Markers:
//   ⬇ leg      start of the initial directional move
//   R1         first reversal candle
//   dip        the bar that made the new extreme between the reversal candles
//   R2         second reversal candle
//   ENTRY      the fill
//   PB1..n     temporary pullback (opposite-colour candles that did NOT exit)
//   RESUME     continuation resumed — this is where the exit arms
//   EXIT       the first opposite candle after the resume
// Price lines: entry, stop, exit.

const COL = {
  up: "#26a69a",
  down: "#ef5350",
  grid: "#1e2840",
  text: "#e8edff",
  bg: "#0e1422",
  entry: "#60a5fa",
  stop: "#f87171",
  exit: "#fbbf24",
  pullback: "#a78bfa",
  resume: "#34d399",
};

const sec = (ms) => (ms == null ? null : Math.floor(Number(ms) / 1000));

export function ReversalChart({ trade, rows, height = 420 }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!containerRef.current || !rows || !rows.length || !trade) return;
    let chart = null;
    let cancelled = false;
    let onResize = null;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: COL.bg },
            textColor: COL.text,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } },
          crosshair: { mode: lwc.CrosshairMode.Normal },
          rightPriceScale: { borderColor: COL.grid, scaleMargins: { top: 0.12, bottom: 0.2 } },
          timeScale: { borderColor: COL.grid, timeVisible: true, secondsVisible: false },
          width: containerRef.current.clientWidth,
          height,
        });

        const series = chart.addCandlestickSeries({
          upColor: COL.up, downColor: COL.down,
          borderUpColor: COL.up, borderDownColor: COL.down,
          wickUpColor: COL.up, wickDownColor: COL.down,
        });

        const a = trade.annotationTs || {};
        const long = trade.direction === "long";

        // Window the candles around the trade so the pattern is readable.
        const from = a.legStart ?? trade.entryTs;
        const to = a.exit ?? trade.exitTs ?? trade.entryTs;
        const idxFrom = Math.max(0, rows.findIndex((r) => r[0] >= from) - 15);
        let idxTo = rows.findIndex((r) => r[0] >= to);
        idxTo = idxTo < 0 ? rows.length - 1 : Math.min(rows.length - 1, idxTo + 15);
        const win = rows.slice(idxFrom, idxTo + 1);

        series.setData(
          win.map((r) => ({ time: sec(r[0]), open: r[1], high: r[2], low: r[3], close: r[4] }))
        );

        // ---- markers -------------------------------------------------------
        const markers = [];
        const add = (ts, position, color, shape, text) => {
          const t = sec(ts);
          if (t == null) return;
          markers.push({ time: t, position, color, shape, text });
        };

        add(a.legStart, long ? "aboveBar" : "belowBar", "#94a3b8", long ? "arrowDown" : "arrowUp",
          long ? "down move starts" : "up move starts");
        add(a.reversal1, long ? "belowBar" : "aboveBar", COL.up, "circle", "R1");
        if (a.dip && a.dip !== a.reversal1 && a.dip !== a.reversal2) {
          add(a.dip, long ? "belowBar" : "aboveBar", "#94a3b8", "circle", long ? "new low" : "new high");
        }
        add(a.reversal2, long ? "belowBar" : "aboveBar", COL.up, "circle", "R2");
        add(a.entry, long ? "belowBar" : "aboveBar", COL.entry, long ? "arrowUp" : "arrowDown",
          `ENTRY ${long ? "LONG" : "SHORT"}`);

        (a.pullbacks || []).forEach((p, i) => {
          add(p.start, long ? "aboveBar" : "belowBar", COL.pullback, "square",
            `PB${i + 1} (${p.candles} candle${p.candles === 1 ? "" : "s"}, held)`);
        });
        (a.resumes || []).forEach((ts) => {
          add(ts, long ? "belowBar" : "aboveBar", COL.resume, long ? "arrowUp" : "arrowDown", "RESUME");
        });
        if (a.exit) {
          const label = trade.exitReason === "firstOpposite"
            ? `EXIT · first ${long ? "red" : "green"} after resume`
            : `EXIT · ${trade.exitReason}`;
          add(a.exit, long ? "aboveBar" : "belowBar", COL.exit, long ? "arrowDown" : "arrowUp", label);
        }

        markers.sort((x, y) => x.time - y.time);
        series.setMarkers(markers);

        // ---- price lines ---------------------------------------------------
        const line = (price, color, title, style = 0) => {
          if (price == null || !isFinite(price)) return;
          series.createPriceLine({
            price: Number(price), color, lineWidth: 1, lineStyle: style,
            axisLabelVisible: true, title,
          });
        };
        line(trade.entryFill ?? trade.entryPrice, COL.entry, "entry");
        line(trade.stopPrice, COL.stop, "stop", 2);
        line(trade.exitFill ?? trade.exitPrice, COL.exit, "exit", 2);
        if (trade.emergencyPrice != null) line(trade.emergencyPrice, "#fb923c", "emergency", 3);

        chart.timeScale().fitContent();

        onResize = () => {
          if (containerRef.current && chart) {
            chart.applyOptions({ width: containerRef.current.clientWidth });
          }
        };
        window.addEventListener("resize", onResize);
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener("resize", onResize);
      if (chart) chart.remove();
    };
  }, [trade, rows, height]);

  if (error) {
    return <div className="p-4 text-xs text-destructive">Chart failed to load: {error}</div>;
  }
  return (
    <div className="space-y-2">
      <div ref={containerRef} style={{ height }} className="w-full overflow-hidden rounded-md" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <Legend color="#94a3b8" label="initial move" />
        <Legend color={COL.up} label="reversal candles R1 / R2" />
        <Legend color={COL.entry} label="entry" />
        <Legend color={COL.pullback} label="temporary pullback (held)" />
        <Legend color={COL.resume} label="continuation resumed (exit arms)" />
        <Legend color={COL.exit} label="first opposite candle = exit" />
        <Legend color={COL.stop} label="stop loss" />
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
