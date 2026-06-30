import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { fetchOHLCV } from "@/lib/market";
import { buildChartSVG } from "@/lib/chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  
  try {
    const { pairName, timestamp, entry, stop, tp, direction } = await req.json();
    
    if (!pairName || !timestamp) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const store = await readStore(user);
    const pair = store.pairs.find(p => p.name === pairName);
    
    if (!pair) {
      return NextResponse.json({ error: "pair not found" }, { status: 404 });
    }

    // Fetch chart data - get more candles around the signal for context
    // Show 20 candles before and 30 after the engulfing pattern
    const tf = pair.timeframe || store.settings.timeframe || "15m";
    const chartData = await fetchOHLCV(pair, tf, 50);
    
    // Find the signal candle and create a window around it
    const signalIndex = chartData.findIndex(candle => candle[0] === timestamp);
    let windowStart = Math.max(0, signalIndex - 20);
    let windowEnd = Math.min(chartData.length, signalIndex + 30);
    
    // If signal not found, just show recent candles
    if (signalIndex === -1) {
      windowStart = Math.max(0, chartData.length - 50);
      windowEnd = chartData.length;
    }
    
    const windowData = chartData.slice(windowStart, windowEnd);
    
    // Generate the SVG chart with trade details
    const svg = buildChartSVG({
      pair,
      tf,
      rows: windowData,
      signalTs: timestamp,
      direction,
      entry: parseFloat(entry),
      stop: parseFloat(stop),
      tp: parseFloat(tp)
    });

    return NextResponse.json({ svg });
  } catch (e) {
    console.error("Trade chart error:", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}