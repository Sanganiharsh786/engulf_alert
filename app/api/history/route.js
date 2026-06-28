import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";
import { runHistory } from "@/lib/scanner";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Find past engulfing-at-level signals (with trade plans) and email the ones
// not already alerted. Triggered by the "Past signals" button.
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    let send = true;
    try {
      const b = await req.json();
      if (b && b.send === false) send = false;
    } catch {
      /* default: send */
    }
    const store = await readStore(user);
    const out = await runHistory(store, { send, bars: 150 });
    await writeStore(user, store);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
