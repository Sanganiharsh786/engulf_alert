import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { runFibBacktest } from "@/lib/fibBacktest";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Whitelist of numeric config keys we accept from the client.
const NUM_KEYS = [
  "fibUpper", "fibLower", "pivotLeft", "pivotRight", "minimumImpulsePercent",
  "minimumImpulseATR", "rrRatio", "fibExtension", "slBufferPercent",
  "emaFast", "emaSlow", "atrPeriod", "atrMin", "atrMax",
  "riskPercent", "initialCapital", "zoneExpiryBars",
];
const STR_KEYS = ["confirmationMode", "entryMode", "stopLossMode", "tpMode"];
const BOOL_KEYS = [
  "useTrendFilter", "useATRFilter", "useMarketStructureFilter", "allowLong", "allowShort",
];

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    let days = 30;
    let from = null;
    let to = null;
    let timeframe = null;
    const config = {};
    try {
      const b = (await req.json()) || {};
      if (Number(b.days)) days = Math.min(370, Math.max(1, Number(b.days)));
      if (Number(b.from) && Number(b.to)) { from = Number(b.from); to = Number(b.to); }
      if (typeof b.timeframe === "string") timeframe = b.timeframe;
      const c = b.config || {};
      for (const k of NUM_KEYS) if (c[k] !== undefined && c[k] !== "" && !isNaN(Number(c[k]))) config[k] = Number(c[k]);
      for (const k of STR_KEYS) if (typeof c[k] === "string" && c[k]) config[k] = c[k];
      for (const k of BOOL_KEYS) if (typeof c[k] === "boolean") config[k] = c[k];
    } catch {
      /* defaults */
    }
    const store = await readStore(user);
    const opts = from && to ? { from, to, config } : { days, config };
    if (timeframe) opts.timeframe = timeframe;
    const out = await runFibBacktest(store, opts);
    out.days = days;
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
