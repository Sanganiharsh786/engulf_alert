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
 * FVG zones are rendered as real filled boxes (series primitives) that are
 * anchored to the gap's time range and extend to the right edge, updating
 * live on every poll.
 *
 * Props:
 *   - pair: "XAU/USD" | "GBP/USD"
 *   - tf: timeframe string (default "4h")
 *   - refreshMs: poll interval (default 15_000)
 *   - height: chart height in px (default 380)
 *   - onFvgs: optional callback(fvgZones[]) fired on each poll with the
 *             active FVG zones so parent cards can show live values.
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

// Normalise the various FVG shapes coming from the API into one flat zone.
function normalizeFvg(fvg, { fresh = false } = {}) {
  if (!fvg || fvg.fvgLow == null || fvg.fvgHigh == null) return null;
  const low = Number(fvg.fvgLow);
  const high = Number(fvg.fvgHigh);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  // Times arrive in ms; the chart uses seconds.
  const startMs = fvg.candle1?.ts ?? fvg.formedAt ?? null;
  const formedMs = fvg.formedAt ?? fvg.candle3?.ts ?? startMs;
  return {
    type: fvg.type === "bearish" ? "bearish" : "bullish",
    low: Math.min(low, high),
    high: Math.max(low, high),
    startTime: startMs != null ? Math.floor(startMs / 1000) : null,
    formedTime: formedMs != null ? Math.floor(formedMs / 1000) : null,
    fresh,
  };
}

// ── FVG box primitive (lightweight-charts v4 series primitive) ───────
class FVGRenderer {
  constructor(source) {
    this._source = source;
  }
  draw(target) {
    const src = this._source;
    const chart = src._chart;
    const series = src._series;
    if (!chart || !series || !src._zones?.length) return;
    const timeScale = chart.timeScale();

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const rightEdge = scope.bitmapSize.width;

      for (const z of src._zones) {
        const yHigh = series.priceToCoordinate(z.high);
        const yLow = series.priceToCoordinate(z.low);
        if (yHigh == null || yLow == null) continue;

        let x1 = z.startTime != null ? timeScale.timeToCoordinate(z.startTime) : null;
        if (x1 == null && z.formedTime != null) x1 = timeScale.timeToCoordinate(z.formedTime);
        const left = (x1 != null ? Math.max(0, x1) : 0) * hRatio;

        const top = Math.min(yHigh, yLow) * vRatio;
        const bottom = Math.max(yHigh, yLow) * vRatio;
        const width = rightEdge - left;
        if (width <= 0 || bottom - top <= 0) continue;

        const isBull = z.type === "bullish";
        const base = isBull ? "38,166,154" : "239,83,80";
        ctx.fillStyle = `rgba(${base},${z.fresh ? 0.22 : 0.13})`;
        ctx.fillRect(left, top, width, bottom - top);

        ctx.strokeStyle = `rgba(${base},${z.fresh ? 1 : 0.7})`;
        ctx.lineWidth = z.fresh ? 1.5 : 1;
        ctx.setLineDash(z.fresh ? [] : [4, 3]);
        ctx.strokeRect(left, top, width, bottom - top);
        ctx.setLineDash([]);

        // Zone value label pinned to the left of the box.
        const label = `${z.type === "bullish" ? "▲" : "▼"} ${z.high.toFixed(5)} – ${z.low.toFixed(5)}`;
        const fontPx = 10 * vRatio;
        ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillStyle = `rgba(${base},1)`;
        const pad = 4 * hRatio;
        const labelY = Math.max(top + fontPx + 2 * vRatio, top - 2 * vRatio);
        ctx.fillText(label, left + pad, labelY);
      }
    });
  }
}

class FVGPaneView {
  constructor(source) {
    this._source = source;
  }
  renderer() {
    return new FVGRenderer(this._source);
  }
  zOrder() {
    return "top";
  }
}

class FVGPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._paneViews = [new FVGPaneView(this)];
  }
  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }
  setZones(zones) {
    this._zones = zones || [];
    this._requestUpdate?.();
  }
  updateAllViews() {}
  paneViews() {
    return this._paneViews;
  }
}

export function FVGLiveChart({ pair, tf = "4h", refreshMs = REFRESH_MS, height = 380, onFvgs }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const fvgPrimitiveRef = useRef(null);
  const onFvgsRef = useRef(onFvgs);
  const [error, setError] = useState("");
  const [lastPrice, setLastPrice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [zones, setZones] = useState([]);
  const [touched, setTouched] = useState(false);

  // Keep the latest callback without re-running the chart effect.
  useEffect(() => {
    onFvgsRef.current = onFvgs;
  }, [onFvgs]);

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

        // Attach the FVG box primitive to the candlestick series.
        const fvgPrimitive = new FVGPrimitive();
        fvgPrimitiveRef.current = fvgPrimitive;
        cs.attachPrimitive(fvgPrimitive);

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

            // Build the zone list: active (untouched) FVGs + the fresh one.
            const active = (scan.activeFVGs || [])
              .map((f) => normalizeFvg(f))
              .filter(Boolean);
            const freshZone = normalizeFvg(scan.freshFVG, { fresh: true });
            const zoneList = [...active];
            if (freshZone) {
              // Avoid duplicating a fresh FVG already present in active list.
              const dup = zoneList.find(
                (z) => z.type === freshZone.type && z.formedTime === freshZone.formedTime
              );
              if (dup) dup.fresh = true;
              else zoneList.push(freshZone);
            }

            fvgPrimitiveRef.current?.setZones(zoneList);

            setLastPrice(scan.currentPrice);
            setLastUpdate(Date.now());
            setZones(zoneList);
            setTouched(!!scan.touchedNow);
            setError("");
            onFvgsRef.current?.(zoneList);

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
      fvgPrimitiveRef.current = null;
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
        {zones.length > 0 && (
          <span className="text-muted-foreground/60">
            {zones.length} FVG{zones.length !== 1 ? "s" : ""}
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

      {/* FVG zone values */}
      {zones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {zones.map((z, i) => {
            const isBull = z.type === "bullish";
            return (
              <span
                key={`${z.type}-${z.formedTime}-${i}`}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono",
                  isBull ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear",
                  z.fresh && "font-semibold ring-1 ring-inset ring-current/30"
                )}
                title={`${z.type} FVG zone`}
              >
                {isBull ? "▲" : "▼"} {z.high.toFixed(5)}–{z.low.toFixed(5)}
                {z.fresh && <span className="opacity-70">NEW</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Chart canvas */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg border border-border/40 bg-[#0e1422]"
        style={{ height }}
      />
    </div>
  );
}
