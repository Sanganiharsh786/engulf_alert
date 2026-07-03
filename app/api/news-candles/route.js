import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { fetchOHLCVRange, fetchOHLCV, tfSeconds } from "@/lib/market";
import { generateNewsEvents, classifyCandle, candleChangePct } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // may fetch many 1m slices

/**
 * POST /api/news-candles
 * Body: { newsTypes, symbols, fromYear, toYear, limit }
 *
 * Returns news events alongside the 1‑minute candle that was forming
 * at the event timestamp, classified as bullish / bearish / doji.
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { newsTypes, fromYear, toYear, limit = 50 } = await req.json();

    // Store pairs are used only to resolve symbol→pair metadata
    const store = await readStore(user);

    // Symbols to analyse — default to BTC and Gold (PAXG) if they exist in store
    const requestedSymbols = store.pairs
      .filter((p) => /BTC|PAXG/i.test(p.name))
      .slice(0, 4);

    if (requestedSymbols.length === 0) {
      return NextResponse.json({ error: "No BTC or Gold pairs found in store" }, { status: 400 });
    }

    // Generate events
    const allEvents = generateNewsEvents({
      types: newsTypes || ["NFP","FOMC","CPI"],
      fromYear: fromYear || 2023,
      toYear: toYear || 2025,
    });

    // Honour limit
    const events = allEvents.slice(0, limit);

    // For each event, fetch a small window of 1m candles and analyse the
    // candle that covers the event timestamp.
    const tf = "1m";
    const tfMs = tfSeconds(tf) * 1000; // 60 000

    const results = [];
    // Process events in batches of 3 to avoid overwhelming Binance API
    const BATCH_SIZE = 3;
    for (let batchStart = 0; batchStart < events.length; batchStart += BATCH_SIZE) {
      const batch = events.slice(batchStart, batchStart + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (ev) => {
        const windowStart = ev.ts - 60 * tfMs;  // 1 hour before
        const windowEnd   = ev.ts + 60 * tfMs;  // 1 hour after

        // Fetch ALL symbols for this event in parallel
        const symbolAnalyses = await Promise.all(requestedSymbols.map(async (pair) => {
          try {
            let rows;
            try {
              rows = await fetchOHLCVRange(pair, tf, windowStart, windowEnd);
            } catch {
              rows = await fetchOHLCV(pair, tf, 120);
            }

            // Find the candle whose open time is <= ev.ts and close time > ev.ts
            const atNews = rows.find((r) => r[0] <= ev.ts && r[0] + tfMs > ev.ts);

            if (atNews) {
              const [ts, o, h, l, c, v] = atNews;
              const classification = classifyCandle(o, h, l, c);
              const changePct = candleChangePct(o, c);
              const range = h - l;
              const body = Math.abs(c - o);
              // Determine ~60 candles around the event time for chart display
              const eventIdx = rows.findIndex((r) => r[0] <= ev.ts && r[0] + tfMs > ev.ts);
              const chartStart = Math.max(0, (eventIdx >= 0 ? eventIdx : Math.floor(rows.length/2)) - 30);
              return {
                symbol: pair.name,
                candle: { ts: atNews[0], o, h, l, c, v },
                classification,
                changePct: +changePct.toFixed(4),
                bodyPct: range > 0 ? +(body / range * 100).toFixed(1) : 0,
                chartRows: rows.slice(chartStart, chartStart + 60),
              };
            } else {
              // No 1m candle found exactly at event time — grab nearest
              const nearest = rows.reduce((prev, cur) =>
                Math.abs(cur[0] - ev.ts) < Math.abs(prev[0] - ev.ts) ? cur : prev
              , rows[0]);
              if (nearest) {
                const [ts, o, h, l, c, v] = nearest;
                const classification = classifyCandle(o, h, l, c);
                return {
                  symbol: pair.name,
                  candle: { ts, o, h, l, c, v },
                  classification,
                  changePct: +candleChangePct(o, c).toFixed(4),
                  bodyPct: (h - l) > 0 ? +(Math.abs(c - o) / (h - l) * 100).toFixed(1) : 0,
                  nearest: true,
                  chartRows: rows.slice(-60),
                };
              }
            }
            return { symbol: pair.name, error: "No candle data found" };
          } catch (e) {
            return { symbol: pair.name, error: e.message };
          }
        }));

        return {
          type: ev.type,
          label: ev.label,
          ts: ev.ts,
          timeET: ev.timeET,
          dateUTC: new Date(ev.ts).toISOString(),
          importance: ev.importance,
          analysis: symbolAnalyses,
        };
      }));
      results.push(...batchResults);
    }

    return NextResponse.json({ events: results, total: allEvents.length, returned: results.length });
  } catch (e) {
    console.error("/api/news-candles error:", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
