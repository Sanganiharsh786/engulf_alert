import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import ccxt from "ccxt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const pairId = searchParams.get("pairId");
    const store = await readStore();
    const pair = store.pairs.find((p) => p.id === pairId);
    if (!pair) {
      return NextResponse.json({ error: "pair not found" }, { status: 404 });
    }
    const ex = new ccxt[pair.exchange]({ enableRateLimit: true });
    const tf = pair.timeframe || store.settings.timeframe || "15m";
    const rows = await ex.fetchOHLCV(pair.symbol, tf, undefined, 60);
    return NextResponse.json({ rows, tf });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
