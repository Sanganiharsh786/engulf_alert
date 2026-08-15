import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { fetchOHLCV, fetchOHLCVRange, tfSeconds } from "@/lib/market";
import { buildChartSVG } from "@/lib/chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  
  try {
    const { pairName, timestamp, entry, stop, tp, direction, levelLow, levelHigh, exitTs } = await req.json();

    if (!pairName || !timestamp) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const store = await readStore(user);
    const pair = store.pairs.find(p => p.name === pairName);
    
    if (!pair) {
      return NextResponse.json({ error: "pair not found" }, { status: 404 });
    }

    // Chart window: 20 candles of lead-in, then enough candles AFTER the signal
    // to always include the bar the trade closed on plus a little breathing room.
    // A fixed forward window silently cut off any trade that took longer than it
    // to reach TP/SL, which made the risk/reward boxes look wrong.
    const tf = pair.timeframe || store.settings.timeframe || "15m";
    const tfMs = tfSeconds(tf) * 1000;
    const signalTs = Number(timestamp);

    const LEAD_BARS = 20;
    const MIN_FORWARD_BARS = 30; // still-open trades, or when no exit is known
    const TRAIL_BARS = 8; // candles shown after the exit, for context
    const MAX_FORWARD_BARS = 400; // guard against a runaway fetch

    const exit = Number(exitTs);
    const barsToExit =
      Number.isFinite(exit) && exit > signalTs ? Math.ceil((exit - signalTs) / tfMs) : 0;
    const forwardBars = Math.min(
      MAX_FORWARD_BARS,
      Math.max(MIN_FORWARD_BARS, barsToExit + TRAIL_BARS)
    );

    // fetch a little wider than we render, so slicing has room on both sides
    const startMs = signalTs - (LEAD_BARS + 5) * tfMs;
    const endMs = signalTs + (forwardBars + 5) * tfMs;

    let chartData;
    try {
      // Fetch historical candles around the signal time
      chartData = await fetchOHLCVRange(pair, tf, startMs, endMs);
    } catch (e) {
      console.warn("Historical fetch failed, falling back to recent candles:", e.message);
      chartData = await fetchOHLCV(pair, tf, LEAD_BARS + forwardBars);
    }

    // Find the signal candle
    const signalIndex = chartData.findIndex(candle => candle[0] === signalTs);
    let windowStart = 0;
    let windowEnd = chartData.length;

    if (signalIndex !== -1) {
      windowStart = Math.max(0, signalIndex - LEAD_BARS);
      windowEnd = Math.min(chartData.length, signalIndex + forwardBars + 1);
      // never clip the exit bar out of the window
      if (Number.isFinite(exit)) {
        const exitIndex = chartData.findIndex((c) => c[0] >= exit);
        if (exitIndex !== -1) {
          windowEnd = Math.min(
            chartData.length,
            Math.max(windowEnd, exitIndex + TRAIL_BARS + 1)
          );
        }
      }
    }

    const windowData = chartData.slice(windowStart, windowEnd);

    // Generate the SVG chart with trade details
    const svg = buildChartSVG({
      pair,
      tf,
      rows: windowData,
      signalTs: signalTs,
      direction,
      entry: parseFloat(entry),
      stop: parseFloat(stop),
      tp: parseFloat(tp),
      levelLow: levelLow !== undefined ? parseFloat(levelLow) : null,
      levelHigh: levelHigh !== undefined ? parseFloat(levelHigh) : null,
    });

    // Also return raw OHLCV rows so the interactive (lightweight-charts) view
    // can render the same candles + overlays without a second fetch.
    return NextResponse.json({
      svg,
      rows: windowData,
      tf,
      signalTs,
      exitTs: Number.isFinite(exit) ? exit : null,
      pairName: pair.name,
    });
  } catch (e) {
    console.error("Trade chart error:", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}