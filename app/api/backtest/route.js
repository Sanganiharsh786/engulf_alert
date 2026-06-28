import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { runBacktest } from "@/lib/backtest";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const store = await readStore(user);
    const out = await runBacktest(store, { bars: 1000 });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
