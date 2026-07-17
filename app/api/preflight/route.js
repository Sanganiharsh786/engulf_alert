import { NextResponse } from "next/server";
import { readStore } from "@/lib/store";
import { verifyEmail } from "@/lib/mailer";
import { detectEngulfing } from "@/lib/engulfing";
import { tradingViewLink } from "@/lib/scanner";
import { fetchOHLCV } from "@/lib/market";
import { currentUser } from "@/lib/session";
import { testDataConnection } from "@/lib/oanda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const checks = [];

  // 1 - detection logic
  try {
    const d = detectEngulfing(
      { open: 4330, close: 4318 },
      { open: 4316, close: 4332 }
    );
    checks.push({ name: "Detection logic", pass: d === "bullish" });
  } catch (e) {
    checks.push({ name: "Detection logic", pass: false, detail: String(e.message || e) });
  }

  // 2 - config + levels
  let store;
  try {
    store = await readStore(user);
    const nLevels = store.pairs.reduce((a, p) => a + p.levels.length, 0);
    checks.push({
      name: "Config + levels",
      pass: true,
      detail: `${store.pairs.length} pair, ${nLevels} levels`,
    });
  } catch (e) {
    checks.push({ name: "Config + levels", pass: false, detail: String(e.message || e) });
    return NextResponse.json({ checks });
  }

  // 3 - fetch live data
  try {
    const details = [];
    for (const p of store.pairs) {
      const tf = p.timeframe || store.settings.timeframe || "15m";
      const r = await fetchOHLCV(p, tf, 2);
      details.push(`${p.name} ${r[r.length - 1][4]}`);
    }
    checks.push({ name: "Fetch live data", pass: true, detail: details.join("  ·  ") });
  } catch (e) {
    checks.push({ name: "Fetch live data", pass: false, detail: String(e.message || e) });
  }

  // 4 - tradingview links
  checks.push({
    name: "TradingView links",
    pass: true,
    detail: store.pairs.map((p) => tradingViewLink(p)).join("\n"),
  });

  // 5 - email login
  try {
    await verifyEmail(store.settings.email);
    checks.push({ name: "Email login", pass: true, detail: "credentials OK" });
  } catch (e) {
    checks.push({ name: "Email login", pass: false, detail: String(e.message || e) });
  }

  // 6 - Twelve Data source (for 4H FVG alerts, real-time forex)
  try {
    const tdResult = await testDataConnection();
    checks.push({
      name: "Twelve Data",
      pass: tdResult.ok,
      detail: tdResult.ok
        ? `Connected to Twelve Data · ${tdResult.pairs?.length || 0} pairs loaded`
        : tdResult.error || "API key not configured",
    });
  } catch (e) {
    checks.push({ name: "Twelve Data", pass: false, detail: String(e.message || e) });
  }

  return NextResponse.json({ checks });
}
