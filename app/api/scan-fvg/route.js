import { NextResponse } from "next/server";
import { fetchAllPairs } from "@/lib/oanda";
import { detectFVG, candleTouchesFVG, toCandle, scanHistoryForFVG } from "@/lib/fvg";
import { closedCandles } from "@/lib/engulfing";
import { tfSeconds } from "@/lib/market";
import { currentUser } from "@/lib/session";
import { readStore } from "@/lib/store";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TF = "4h";
const CANDLE_COUNT = 120;

// Store alerted FVG keys in memory (per server instance).
const alertedKeys = new Set();

// FVG pairs definition
const FVG_PAIRS = [
  { name: "EUR/USD", display: "EUR/USD", tvSymbol: "FX:EURUSD" },
  { name: "USD/JPY", display: "USD/JPY", tvSymbol: "FX:USDJPY" },
  { name: "USD/CAD", display: "USD/CAD", tvSymbol: "FX:USDCAD" },
  { name: "XAU/USD", display: "XAU/USD", tvSymbol: "TVC:GOLD" },
  { name: "GBP/USD", display: "GBP/USD", tvSymbol: "FX:GBPUSD" },
];

// Shared scan logic for both GET and POST.
// When dryRun is true, alerts are detected but not persisted to alertedKeys.
async function runFvgScan({ dryRun = false } = {}) {
  const { results, errors } = await fetchAllPairs(TF, CANDLE_COUNT);

  const scans = [];
  const newAlerts = [];

  for (const pair of FVG_PAIRS) {
    const name = pair.name;
    const raw = results[name];

    if (!raw || !raw.length) {
      scans.push({
        pair: name,
        status: "error",
        error: errors[name] || "No data returned",
      });
      continue;
    }

    // Filter to only closed candles
    const rows = closedCandles(raw, tfSeconds(TF), Date.now());

    if (rows.length < 3) {
      scans.push({ pair: name, status: "waiting", candles: rows.length });
      continue;
    }

    const lastCandle = toCandle(rows[rows.length - 1]);
    const secondLast = toCandle(rows[rows.length - 2]);

    // Detect fresh FVG from latest 3 candles
    const freshFVG = detectFVG(rows);

    // Scan full history for all FVGs
    const allFVGs = scanHistoryForFVG(rows);

    // Find FRESH touches: current candle touches FVG BUT previous candle did NOT
    // This ensures we only alert when price NEWLY enters the zone (live touch)
    const touchedFVGs = allFVGs.filter((fvg) => {
      // Don't count the formation candle itself as a touch
      if (fvg.formedAt >= lastCandle.ts) return false;
      // Current candle must touch the FVG
      if (!candleTouchesFVG(lastCandle, fvg)) return false;
      // Previous candle must NOT touch the FVG (ensures it's a fresh entry)
      if (secondLast && candleTouchesFVG(secondLast, fvg)) return false;
      return true;
    });

    // Generate alerts for touched FVGs not yet alerted
    const pairAlerts = [];
    for (const fvg of touchedFVGs) {
      const key = `${name}|${fvg.type}|${fvg.fvgLow.toFixed(5)}|${fvg.formedAt}`;
      // Skip if already alerted in a previous scan (production mode)
      if (!dryRun && alertedKeys.has(key)) continue;
      // Persist to alertedKeys so we don't re-alert (only in production mode)
      if (!dryRun) alertedKeys.add(key);
      pairAlerts.push({
        pair: name,
        type: fvg.type,
        fvgLow: fvg.fvgLow,
        fvgHigh: fvg.fvgHigh,
        formedAt: fvg.formedAt,
        touchedAt: lastCandle.ts,
        touchPrice: lastCandle.close,
        id: key,
      });
    }

    if (pairAlerts.length) {
      newAlerts.push(...pairAlerts);
    }

    // Include candle data and FVG zones for the chart
    const candleData = rows.slice(-60).map((r) => ({
      ts: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5],
    }));

    scans.push({
      pair: name,
      status: "ok",
      currentPrice: lastCandle.close,
      currentCandle: lastCandle,
      prevCandle: secondLast,
      candleData,
      freshFVG,
      scannedAt: Date.now(),
      activeFVGs: allFVGs.filter(
        (f) => f.formedAt > Date.now() - 7 * 24 * 60 * 60 * 1000
      ),
      touchedNow: touchedFVGs.length > 0,
      touchedFVGs,
      alerts: pairAlerts,
      candles: rows.length,
      tvSymbol: pair.tvSymbol,
    });
  }

  // Limit alerted keys memory
  if (alertedKeys.size > 5000) {
    const arr = Array.from(alertedKeys).slice(-3000);
    alertedKeys.clear();
    arr.forEach((k) => alertedKeys.add(k));
  }

  return {
    scannedAt: Date.now(),
    scans,
    newAlerts,
    totalAlerts: newAlerts.length,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

// Send Telegram alert for FVG touch
async function sendFvgTelegramAlert(alert, user, store) {
  const tg = store.settings?.telegram || {};
  const botToken = tg.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = tg.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return false;

  const msg = `🔔 FVG TOUCH ALERT
--------------------------------
Pair: ${alert.pair}
Type: ${alert.type.toUpperCase()}
Zone: ${alert.fvgLow.toFixed(5)} → ${alert.fvgHigh.toFixed(5)}
Touched at: ${alert.touchPrice.toFixed(5)}
Time: ${new Date(alert.touchedAt).toLocaleString()}

TradingView: https://www.tradingview.com/chart/?symbol=${FVG_PAIRS.find(p => p.name === alert.pair)?.tvSymbol || ""}`;

  await sendTelegramMessage(msg, { botToken, chatId });
  return true;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const store = await readStore(user);
    const fvgEnabled = !!(store.settings?.fvgAlerts?.enabled);

    const result = await runFvgScan();

    // Send Telegram alerts if user has FVG alerts enabled
    const tgResults = [];
    if (fvgEnabled && result.newAlerts?.length > 0) {
      for (const alert of result.newAlerts) {
        try {
          await sendFvgTelegramAlert(alert, user, store);
          tgResults.push({ pair: alert.pair, sent: true });
        } catch (e) {
          tgResults.push({ pair: alert.pair, sent: false, error: String(e.message || e) });
        }
      }
    }

    return NextResponse.json({ ...result, fvgEnabled, telegram: tgResults });
  } catch (e) {
    return NextResponse.json(
      { error: String(e.message || e) },
      { status: 500 }
    );
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
      /* no body */
    }

    const store = await readStore(user);
    const result = await runFvgScan({ dryRun });

    const tgResults = [];
    if (!dryRun && store.settings?.fvgAlerts?.enabled && result.newAlerts?.length > 0) {
      for (const alert of result.newAlerts) {
        try {
          await sendFvgTelegramAlert(alert, user, store);
          tgResults.push({ pair: alert.pair, sent: true });
        } catch (e) {
          tgResults.push({ pair: alert.pair, sent: false, error: String(e.message || e) });
        }
      }
    }

    return NextResponse.json({ ...result, fvgEnabled: !!store.settings?.fvgAlerts?.enabled, telegram: tgResults });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
