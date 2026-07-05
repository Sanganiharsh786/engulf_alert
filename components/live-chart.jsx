"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ---------- Live TradingView-style chart (lightweight-charts) ----------
 * Polls /api/candles on an interval and streams updates into the chart so
 * the last candle ticks live. Overlays the pair's level zones as price
 * lines and marks the latest engulfing signal candle.
 */

const REFRESH_MS = 10_000;

function toCandle(r) {
  return {
    time: Math.floor(r[0] / 1000),
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
  };
}

function toVolume(r) {
  return {
    time: Math.floor(r[0] / 1000),
    value: r[5],
    color: r[4] >= r[1] ? "#26a69a44" : "#ef535044",
  };
}

export function LiveChart({ pair, signalTs = null, direction = null, refreshMs = REFRESH_MS }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [error, setError] = useState("");
  const [last, setLast] = useState(null); // { close, prevClose, ts }
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tf, setTf] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let interval = null;
    let firstLoad = true;

    async function fetchRows() {
      const res = await fetch(`/api/candles?pairId=${pair.id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    }

    function drawLevels(lwc) {
      // clear old price lines
      priceLinesRef.current.forEach((pl) => {
        try {
          candleRef.current.removePriceLine(pl);
        } catch {
          /* silent */
        }
      });
      priceLinesRef.current = [];

      const off = Number(pair.levelOffset) || 0;
      (pair.levels || []).forEach((lvl) => {
        if (lvl.low == null || lvl.high == null) return;
        const color = lvl.direction === "bearish" ? "#ef5350" : "#26a69a";
        [
          { price: Number(lvl.low) + off, title: `${lvl.direction || "level"} low` },
          { price: Number(lvl.high) + off, title: `${lvl.direction || "level"} high` },
        ].forEach(({ price, title }) => {
          if (!Number.isFinite(price)) return;
          priceLinesRef.current.push(
            candleRef.current.createPriceLine({
              price,
              color,
              lineWidth: 1,
              lineStyle: lwc.LineStyle.Dashed,
              axisLabelVisible: true,
              title,
            })
          );
        });
      });
    }

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        const chart = lwc.createChart(containerRef.current, {
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

        candleRef.current = chart.addCandlestickSeries({
          upColor: "#26a69a",
          downColor: "#ef5350",
          borderUpColor: "#26a69a",
          borderDownColor: "#ef5350",
          wickUpColor: "#26a69a",
          wickDownColor: "#ef5350",
        });

        volumeRef.current = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a44",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });

        async function refresh() {
          try {
            const data = await fetchRows();
            if (cancelled || !candleRef.current) return;
            const rows = data.rows || [];
            if (!rows.length) return;

            candleRef.current.setData(rows.map(toCandle));
            volumeRef.current.setData(rows.map(toVolume));

            const lastRow = rows[rows.length - 1];
            const prevRow = rows.length > 1 ? rows[rows.length - 2] : lastRow;
            setLast({ close: lastRow[4], prevClose: prevRow[4], ts: lastRow[0] });
            setUpdatedAt(Date.now());
            setTf(data.tf || null);
            setError("");

            if (signalTs) {
              const bullish = direction === "bullish";
              candleRef.current.setMarkers([
                {
                  time: Math.floor(Number(signalTs) / 1000),
                  position: bullish ? "belowBar" : "aboveBar",
                  color: "#3b82f6",
                  shape: bullish ? "arrowUp" : "arrowDown",
                  text: `${(direction || "").toUpperCase()} ENGULFING`,
                  size: 2,
                },
              ]);
            }

            drawLevels(lwc);

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
      priceLinesRef.current = [];
      candleRef.current = null;
      volumeRef.current = null;
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {
          /* silent */
        }
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair.id, pair.symbol, pair.exchange, pair.timeframe, signalTs, direction, refreshMs]);

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-center text-xs text-bear">
        Could not load candles — {error}
      </div>
    );
  }

  const up = last ? last.close >= last.prevClose : true;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md border border-bull/40 bg-bull/10 px-2 py-0.5 font-semibold text-bull">
          <span className="size-1.5 animate-pulse rounded-full bg-bull" />
          LIVE
        </span>
        {tf && (
          <span className="rounded-md border border-border bg-card px-2 py-0.5 text-muted-foreground">{tf}</span>
        )}
        {last && (
          <span className={cn("font-mono font-semibold tnum", up ? "text-bull" : "text-bear")}>
            {Number(last.close).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </span>
        )}
        {updatedAt && (
          <span className="ml-auto text-muted-foreground">
            Updated {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className="h-[300px] min-h-[300px] w-full overflow-hidden rounded-lg bg-[#0e1422] sm:h-[380px] sm:min-h-[380px]"
      />
    </div>
  );
}
