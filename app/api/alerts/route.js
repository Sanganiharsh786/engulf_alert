import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every alert ever generated for this user, newest first. Powers /totalalerts.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const store = await readStore(user);
    const alerts = [...(store.alerts || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return NextResponse.json({ alerts });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// Tick / untick whether the user actually placed a trade for an alert.
// Body: { id, placed }
export async function PATCH(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const { id, placed } = body || {};
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const store = await readStore(user);
    const alert = (store.alerts || []).find((a) => a.id === id);
    if (!alert) return NextResponse.json({ error: "alert not found" }, { status: 404 });
    alert.placed = !!placed;
    await writeStore(user, store);
    return NextResponse.json({ ok: true, id, placed: alert.placed });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
