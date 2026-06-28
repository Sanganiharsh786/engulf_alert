import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { fetchOHLCV } from "@/lib/market";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const pairId = searchParams.get("pairId");
    const store = await readStore(user);
    const pair = store.pairs.find((p) => p.id === pairId);
    if (!pair) {
      return NextResponse.json({ error: "pair not found" }, { status: 404 });
    }
    const tf = pair.timeframe || store.settings.timeframe || "15m";
    const rows = await fetchOHLCV(pair, tf, 60);
    return NextResponse.json({ rows, tf });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
