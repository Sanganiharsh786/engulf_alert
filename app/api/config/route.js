import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const store = await readStore(user);
    return NextResponse.json({ ...store, user });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function PUT(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const store = await readStore(user);
    if (body.settings) store.settings = body.settings;
    if (Array.isArray(body.pairs)) store.pairs = body.pairs;
    await writeStore(user, store);
    return NextResponse.json({ ok: true, store });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
