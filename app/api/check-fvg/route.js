import { NextResponse } from "next/server";
import { testFvgConnection } from "@/lib/paxgFeed";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check for the FVG data source (Binance PAXG/USDT).
// Requires login (protected via middleware).
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await testFvgConnection();
    return NextResponse.json({ ...result, user });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e.message || e) },
      { status: 500 }
    );
  }
}
