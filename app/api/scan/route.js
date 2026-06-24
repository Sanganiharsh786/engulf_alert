import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";
import { runScan } from "@/lib/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Cron only issues GET requests, with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set in env vars.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const store = await readStore();
    const out = await runScan(store, {});
    await writeStore(store);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    let dryRun = false;
    try {
      const b = await req.json();
      dryRun = !!b.dryRun;
    } catch {
      /* no body is fine */
    }
    const store = await readStore();
    const out = await runScan(store, { dryRun });
    await writeStore(store);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
