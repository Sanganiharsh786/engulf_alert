import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { runBacktest } from "@/lib/backtest";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // paginated fetches over 3+ months take longer

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    let days = 10;
    let from = null;
    let to = null;
    let rrRatio = null;
    try {
      const b = await req.json();
      if (b && Number(b.days)) days = Math.min(370, Math.max(1, Number(b.days)));
      if (b && Number(b.from) && Number(b.to)) {
        from = Number(b.from);
        to = Number(b.to);
      }
      if (b && Number(b.rrRatio)) {
        rrRatio = Number(b.rrRatio);
      }
    } catch {
      /* default */
    }
    const store = await readStore(user);
    const opts = from && to ? { from, to } : { days };
    if (rrRatio !== null) {
      opts.rrRatio = rrRatio;
    }
    const out = await runBacktest(store, opts);
    out.days = days;
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
