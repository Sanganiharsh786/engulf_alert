import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── In-memory cache (5-second TTL) ────────────────────────────────
const CACHE_TTL_MS = 5_000;
const cache = { data: null, ts: 0 };

// ── Yahoo Finance symbol helpers ─────────────────────────────────
// XAU/USD → XAUUSD=X , GBP/USD → GBPUSD=X
function toYahooSymbol(pair) {
  return pair.replace("/", "") + "=X";
}

// ── Fetch a single pair from Yahoo Finance ────────────────────────
async function fetchYahooPrice(pair) {
  const symbol = encodeURIComponent(toYahooSymbol(pair));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Yahoo Finance ${pair} ${res.status}: ${body.slice(0, 120)}`);
  }

  const data = await res.json();

  // Check for API-level errors
  if (data?.chart?.error) {
    throw new Error(`Yahoo Finance ${pair}: ${data.chart.error.description || data.chart.error.code}`);
  }

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo Finance ${pair}: no result in response`);

  const meta = result.meta;
  const price = meta?.regularMarketPrice;
  const prevClose = meta?.previousClose;
  const ts = meta?.regularMarketTime
    ? meta.regularMarketTime * 1000
    : Date.now();

  if (price == null) throw new Error(`Yahoo Finance ${pair}: no regularMarketPrice`);

  return {
    pair,
    price: Number(price),
    prevClose: prevClose != null ? Number(prevClose) : null,
    ts,
    currency: meta?.currency || "USD",
    marketState: meta?.marketState || "unknown",
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

    // Fetch both pairs in parallel, tracking which pair each belongs to
    const pairs = ["XAU/USD", "GBP/USD"];
    const fetches = pairs.map(async (pair) => {
      try {
        const r = await fetchYahooPrice(pair);
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
