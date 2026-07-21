import { NextResponse } from "next/server";
import { fetchFvgData, FVG_PAIRS, FVG_PAIR_NAMES } from "@/lib/paxgFeed";
import { detectFVG, toCandle, scanHistoryForFVG } from "@/lib/fvg";
import { closedCandles } from "@/lib/engulfing";
import { tfSeconds } from "@/lib/market";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TF = "4h";

// ── Server-side cache ────────────────────────────────────────────
// Binance public mirror is free with generous limits; a short cache keeps
// live-polling cheap and smooths bursts.
const CACHE_TTL_MS = 150_000;

// More candles for smaller timeframes so the chart has enough history to detect FVGs
const CANDLE_COUNT = { "5m": 200, "15m": 200, "30m": 150, "1h": 120, "4h": 120 };
const cache = new Map(); // key: `${tf}` -> { data, ts }

function getCached(tf) {
  const key = tf || DEFAULT_TF;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCached(tf, data) {
  const key = tf || DEFAULT_TF;
  cache.set(key, { data, ts: Date.now() });
}

// ── GET ──────────────────────────────────────────────────────────
export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const tf = url.searchParams.get("tf") || DEFAULT_TF;
    const count = CANDLE_COUNT[tf] || 120;

    // Try cache first
    const cached = getCached(tf);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true,
        cacheAge: Date.now() - cache.get(tf || DEFAULT_TF).ts,
        scannedAt: cached.scannedAt || Date.now(),
      });
    }

    // Fetch fresh data from Binance (PAXG/USDT)
    const { results, errors } = await fetchFvgData(tf, count);

    // Build per-pair candle + FVG data
    const pairs = FVG_PAIR_NAMES;
    const scans = [];

    for (const name of pairs) {
      const raw = results[name];
      if (!raw || !raw.length) {
        scans.push({ pair: name, status: "error", error: errors?.[name] || "No data" });
        continue;
      }

      const rows = closedCandles(raw, tfSeconds(tf), Date.now());
      if (rows.length < 3) {
        scans.push({ pair: name, status: "waiting", candles: rows.length });
        continue;
      }

      const lastCandle = toCandle(rows[rows.length - 1]);
      const secondLast = toCandle(rows[rows.length - 2]);
      const freshFVG = detectFVG(rows);
      const allFVGs = scanHistoryForFVG(rows);

      // Check if fresh FVG is touched now
      let touchedNow = false;
      if (freshFVG && freshFVG.formedAt < lastCandle.ts) {
        const currentTouches =
          lastCandle.low <= freshFVG.fvgHigh && lastCandle.high >= freshFVG.fvgLow;
        const prevTouches = secondLast &&
          secondLast.low <= freshFVG.fvgHigh && secondLast.high >= freshFVG.fvgLow;
        touchedNow = currentTouches && !prevTouches;
      }

      // Filter untouced FVGs visible in last 60 candles
      const visibleStart = rows.length > 60 ? rows[rows.length - 60][0] : rows[0][0];
      const chartFVGs = allFVGs.filter((f) =>
        f.formedAt >= visibleStart &&
        !f.touchedAt &&
        f.formedAt < lastCandle.ts
      );

      scans.push({
        pair: name,
        status: "ok",
        currentPrice: lastCandle.close,
        currentCandle: lastCandle,
        prevCandle: secondLast,
        candleData: rows.slice(-60).map((r) => ({
          ts: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5],
        })),
        freshFVG,
        activeFVGs: chartFVGs,
        touchedNow,
        candles: rows.length,
        scannedAt: Date.now(),
        tvSymbol: FVG_PAIRS.find((p) => p.name === name)?.tvSymbol || "",
      });
    }

    const result = {
      scans,
      totalAlerts: 0,
      newAlerts: [],
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      scannedAt: Date.now(),
      tf,
    };

    setCached(tf, result);

    return NextResponse.json({ ...result, cached: false, cacheAge: 0 });
  } catch (e) {
    // On error, try to serve stale cache
    const cached = getCached(tf || DEFAULT_TF);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true, stale: true, cacheAge: Date.now() - cache.get(tf || DEFAULT_TF).ts });
    }
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
