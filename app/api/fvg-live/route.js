import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { FVG_PAIRS } from "@/lib/paxgFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── In-memory cache (5-second TTL) ────────────────────────────────
const CACHE_TTL_MS = 5_000;
const cache = { data: null, ts: 0 };

// ── Binance symbol helper ─────────────────────────────────────────
// "PAXG/USDT" → "PAXGUSDT"
function toBinanceSymbol(pair) {
  return pair.replace(/:.*/, "").replace(/\//g, "").toUpperCase();
}

// ── Fetch a single pair's live price from Binance (public mirror) ──
// Uses data-api.binance.vision (not geo-blocked on cloud/US IPs).
async function fetchBinancePrice(pair) {
  const symbol = toBinanceSymbol(pair);
  const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance ${pair} ${res.status}: ${body.slice(0, 120)}`);
  }

  const data = await res.json();
  const price = data?.lastPrice;
  if (price == null) throw new Error(`Binance ${pair}: no lastPrice`);

  return {
    pair,
    price: Number(price),
    prevClose: data.prevClosePrice != null ? Number(data.prevClosePrice) : null,
    ts: data.closeTime || Date.now(),
    currency: "USDT",
    marketState: "REGULAR", // crypto trades 24/7
  };
}

// ── GET ──────────────────────────────────────────────────────────
export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    // Check cache first
    const now = Date.now();
    if (cache.data && now - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json({
        ...cache.data,
        cached: true,
        cacheAge: now - cache.ts,
      });
    }

    // Fetch all FVG pairs in parallel, tracking which pair each belongs to
    const pairs = FVG_PAIRS.map((p) => p.name);
    const fetches = pairs.map(async (pair) => {
      try {
        const r = await fetchBinancePrice(pair);
        return { pair, status: "fulfilled", value: r };
      } catch (e) {
        return { pair, status: "rejected", reason: e };
      }
    });
    const results = await Promise.all(fetches);

    const prices = {};
    const errors = {};

    for (const result of results) {
      if (result.status === "fulfilled") {
        const r = result.value;
        prices[r.pair] = {
          price: r.price,
          prevClose: r.prevClose,
          ts: r.ts,
          currency: r.currency,
          marketState: r.marketState,
        };
      } else {
        errors[result.pair] = result.reason?.message || "Unknown error";
      }
    }

    const data = {
      prices,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      ts: Date.now(),
    };

    // Update cache
    cache.data = data;
    cache.ts = now;

    return NextResponse.json({ ...data, cached: false, cacheAge: 0 });
  } catch (e) {
    // Serve stale cache on error
    if (cache.data) {
      return NextResponse.json({
        ...cache.data,
        cached: true,
        stale: true,
        cacheAge: Date.now() - cache.ts,
      });
    }

    return NextResponse.json(
      { error: String(e.message || e) },
      { status: 500 }
    );
  }
}
