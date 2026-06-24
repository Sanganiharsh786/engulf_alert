import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await readStore();
    return NextResponse.json(store);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const body = await req.json();
    const store = await readStore();
    if (body.settings) store.settings = body.settings;
    if (Array.isArray(body.pairs)) store.pairs = body.pairs;
    await writeStore(store);
    return NextResponse.json({ ok: true, store });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
