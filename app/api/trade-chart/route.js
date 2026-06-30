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
    const { pairName, timestamp, entry, stop, tp, direction, levelLow, levelHigh } = await req.json();
    
    if (!pairName || !timestamp) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const store = await readStore(user);
    const pair = store.pairs.find(p => p.name === pairName);
    
    if (!pair) {
      return NextResponse.json({ error: "pair not found" }, { status: 404 });
    }

    // Fetch chart data around the trade's timestamp (historical data)
    // Show 20 candles before and 30 after the engulfing pattern
    const tf = pair.timeframe || store.settings.timeframe || "15m";
    const tfMs = tfSeconds(tf) * 1000;
    const signalTs = Number(timestamp);
    
    // Calculate time window around the signal
    const startMs = signalTs - (25 * tfMs);
    const endMs = signalTs + (35 * tfMs);
    
    let chartData;
    try {
      // Fetch historical candles around the signal time
      chartData = await fetchOHLCVRange(pair, tf, startMs, endMs);
    } catch (e) {
      console.warn("Historical fetch failed, falling back to recent candles:", e.message);
      chartData = await fetchOHLCV(pair, tf, 60);
    }
    
    // Find the signal candle
    const signalIndex = chartData.findIndex(candle => candle[0] === signalTs);
    let windowStart = 0;
    let windowEnd = chartData.length;
    
    if (signalIndex !== -1) {
      windowStart = Math.max(0, signalIndex - 20);
      windowEnd = Math.min(chartData.length, signalIndex + 30);
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
      pairName: pair.name,
    });
  } catch (e) {
    console.error("Trade chart error:", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}