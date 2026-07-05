import { NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/store";
import { runScan, ensureDnaLibrary } from "@/lib/scanner";
import { currentUser } from "@/lib/session";
import { listUsers } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET is used by the cron (GitHub Actions / Vercel Cron) with an
// Authorization: Bearer <CRON_SECRET> header. It scans EVERY user and emails
// each person their own alerts. Without the secret it falls back to scanning
// just the logged-in user.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isCron = secret && auth === `Bearer ${secret}`;

  if (isCron) {
    const users = {};
    for (const user of listUsers()) {
      try {
        const store = await readStore(user);
        await ensureDnaLibrary(store);
        const out = await runScan(store, {});
        await writeStore(user, store);
        users[user] = out.results.reduce(
          (a, r) => a + ((r.alerts && r.alerts.length) || 0),
          0
        );
      } catch (e) {
        users[user] = `error: ${String(e.message || e)}`;
      }
    }
    return NextResponse.json({ ok: true, scannedAt: Date.now(), users });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const store = await readStore(user);
    await ensureDnaLibrary(store);
    const out = await runScan(store, {});
    await writeStore(user, store);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    let dryRun = false;
    try {
      const b = await req.json();
      dryRun = !!b.dryRun;
    } catch {
      /* no body is fine */
    }
    const store = await readStore(user);
    await ensureDnaLibrary(store);
    const out = await runScan(store, { dryRun });
    await writeStore(user, store);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
