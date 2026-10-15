import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { fetchOHLCVRange, tfSeconds } from "@/lib/market";
import { generateNewsEvents } from "@/lib/news";
import { analyzeNewsReaction, summarizeReactions, averagePaths } from "@/lib/newsReaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // one 1m slice per event per symbol

const MIN_BEFORE = 30;   // minutes of context before the release
const MIN_AFTER = 95;    // enough to cover the 1h close even for an :01 release
const PATH_MINUTES = 60;
const HORIZONS = ["15m", "1h"];

/**
 * POST /api/news-reaction
 * Body: { newsTypes, fromYear, toYear, limit, symbols }
 *
 * For every past news release: take the 1m candle that printed on the release,
 * then judge what price did AFTER it closed, at the 15m and the 1h close —
 * continuation (kept going the same way) or reversal (flipped).
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const { newsTypes, fromYear, toYear, limit = 60, symbols } = body;

    const store = await readStore(user);
    const pairs = (symbols?.length
      ? store.pairs.filter((p) => symbols.includes(p.name))
      : store.pairs.filter((p) => /BTC|PAXG/i.test(p.name))
    ).slice(0, 4);

    if (pairs.length === 0) {
      return NextResponse.json({ error: "No matching pairs found in store" }, { status: 400 });
    }

    const currentYear = new Date().getFullYear();
    const all = generateNewsEvents({
      types: newsTypes?.length ? newsTypes : ["NFP", "FOMC", "CPI"],
      fromYear: fromYear || 2023,
      toYear: toYear || currentYear,
    });

    // Only releases that have already happened AND whose 1h candle has closed —
    // a half-formed HTF candle would score as a verdict it hasn't earned yet.
    const cutoff = Date.now() - MIN_AFTER * 60_000;
    const past = all.filter((ev) => ev.ts < cutoff);
    // newest first, so a small limit shows the most recent releases
    const events = past.slice(-limit).reverse();

    const tfMs = tfSeconds("1m") * 1000;
    const records = [];
    const details = [];

    // Batches of 3 events keep the number of in-flight Binance requests sane.
    const BATCH = 3;
    for (let i = 0; i < events.length; i += BATCH) {
      const batch = events.slice(i, i + BATCH);
      const done = await Promise.all(
        batch.map(async (ev) => {
          const windowStart = ev.ts - MIN_BEFORE * tfMs;
          const windowEnd = ev.ts + MIN_AFTER * tfMs;

          const perSymbol = await Promise.all(
            pairs.map(async (pair) => {
              try {
                const rows = await fetchOHLCVRange(pair, "1m", windowStart, windowEnd);
                const res = analyzeNewsReaction({
                  rows,
                  eventTs: ev.ts,
                  horizons: HORIZONS,
                  pathMinutes: PATH_MINUTES,
                });
                if (res.error) return { symbol: pair.name, error: res.error };
                return {
                  symbol: pair.name,
                  news: res.news,
                  horizons: res.horizons,
                  path: res.path,
                  rows, // 1m window, used by the chart dialog
                };
              } catch (e) {
                return { symbol: pair.name, error: String(e.message || e) };
              }
            })
          );
          return { ev, perSymbol };
        })
      );

      for (const { ev, perSymbol } of done) {
        for (const s of perSymbol) {
          if (s.error) continue;
          records.push({
            symbol: s.symbol,
            type: ev.type,
            ts: ev.ts,
            news: s.news,
            horizons: s.horizons,
            path: s.path,
          });
        }
        details.push({
          type: ev.type,
          label: ev.label,
          dataLabel: ev.dataLabel,
          releaseDate: ev.releaseDate,
          ts: ev.ts,
          timeET: ev.timeET,
          dateUTC: new Date(ev.ts).toISOString(),
          symbols: perSymbol.map((s) =>
            s.error
              ? { symbol: s.symbol, error: s.error }
              : {
                  symbol: s.symbol,
                  news: s.news,
                  horizons: s.horizons,
                  rows: s.rows,
                }
          ),
        });
      }
    }

    details.sort((a, b) => b.ts - a.ts);

    return NextResponse.json({
      events: details,
      stats: summarizeReactions(records, HORIZONS),
      paths: averagePaths(records, { pathMinutes: PATH_MINUTES, splitTf: "15m" }),
      horizons: HORIZONS,
      pathMinutes: PATH_MINUTES,
      symbols: pairs.map((p) => p.name),
      totalEvents: past.length,
      analyzed: details.length,
    });
  } catch (e) {
    console.error("/api/news-reaction error:", e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
