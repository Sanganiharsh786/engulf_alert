import ccxt from "ccxt";
import {
  detectEngulfing,
  candleTouchesZone,
  closedCandles,
  toCandle,
  gapToZone,
} from "./engulfing.js";
import { buildChartSVG } from "./chart.js";
import { sendAlertEmail } from "./mailer.js";

const exchanges = {};
function getExchange(id) {
  if (!exchanges[id]) exchanges[id] = new ccxt[id]({ enableRateLimit: true });
  return exchanges[id];
}

export function tradingViewLink(pair) {
  const sym = pair.tradingview || `${pair.exchange.toUpperCase()}:${pair.name}`;
  return `https://www.tradingview.com/chart/?symbol=${sym}`;
}

function alertText(pair, direction, low, high, prev, curr) {
  const t = new Date(curr.ts).toISOString().replace("T", " ").slice(0, 16);
  return (
    `${direction.toUpperCase()} ENGULFING detected\n` +
    `--------------------------------------\n` +
    `Pair      : ${pair.name} (${pair.symbol} @ ${pair.exchange})\n` +
    `Level     : ${low} - ${high}\n` +
    `Candle UTC: ${t}\n\n` +
    `Signal candle  O:${curr.open} H:${curr.high} L:${curr.low} C:${curr.close}\n` +
    `Prev candle    O:${prev.open} H:${prev.high} L:${prev.low} C:${prev.close}\n\n` +
    `Chart with the level + engulfing candle is attached.\n` +
    `TradingView: ${tradingViewLink(pair)}\n`
  );
}

export async function scanPair(pair, settings, store, { dryRun = false } = {}) {
  const ex = getExchange(pair.exchange);
  const tf = pair.timeframe || settings.timeframe || "15m";
  const raw = await ex.fetchOHLCV(pair.symbol, tf, undefined, 60);
  const rows = closedCandles(raw, ex.parseTimeframe(tf), ex.milliseconds());

  if (rows.length < 2) {
    return { pair: pair.name, tf, status: "waiting", touched: [], alerts: [] };
  }

  const prev = toCandle(rows[rows.length - 2]);
  const curr = toCandle(rows[rows.length - 1]);
  const direction = detectEngulfing(prev, curr);
  const mode = settings.touchMode || "range";

  const result = {
    pair: pair.name,
    tf,
    status: "ok",
    last: curr,
    direction,
    levels: pair.levels.map((lvl) => {
      const low = Math.min(lvl.low, lvl.high);
      const high = Math.max(lvl.low, lvl.high);
      return {
        id: lvl.id,
        touched: !!direction && candleTouchesZone(curr, low, high, mode),
        gap: gapToZone(curr, low, high),
      };
    }),
    touched: [],
    alerts: [],
  };

  if (!direction) return result;

  for (const lvl of pair.levels) {
    const low = Math.min(lvl.low, lvl.high);
    const high = Math.max(lvl.low, lvl.high);
    if (!candleTouchesZone(curr, low, high, mode)) continue;
    result.touched.push(lvl.id);

    const key = `${pair.name}|${tf}|${lvl.id}|${direction}|${curr.ts}`;
    if (store.alertedKeys.includes(key)) continue;
    store.alertedKeys.push(key);

    const alert = {
      pair: pair.name,
      direction,
      low,
      high,
      ts: curr.ts,
      link: tradingViewLink(pair),
    };
    result.alerts.push(alert);

    const senderConfigured =
      process.env.GMAIL_SENDER || (settings.email && settings.email.sender);
    if (!dryRun && senderConfigured) {
      const svg = buildChartSVG({ pair, tf, rows, signalTs: curr.ts, direction });
      try {
        await sendAlertEmail(settings.email, {
          subject: `[${pair.name}] ${direction.toUpperCase()} engulfing at ${low}-${high}`,
          text: alertText(pair, direction, low, high, prev, curr),
          svg,
          filename: `${pair.name}_${direction}.svg`,
        });
        alert.emailed = true;
      } catch (e) {
        alert.emailed = false;
        alert.emailError = String(e.message || e);
        // allow a retry next scan
        store.alertedKeys = store.alertedKeys.filter((k) => k !== key);
      }
    }
  }
  return result;
}

export async function runScan(store, opts = {}) {
  const results = [];
  for (const pair of store.pairs) {
    try {
      results.push(await scanPair(pair, store.settings, store, opts));
    } catch (e) {
      results.push({ pair: pair.name, status: "error", error: String(e.message || e) });
    }
  }
  if (store.alertedKeys.length > 3000) {
    store.alertedKeys = store.alertedKeys.slice(-2000);
  }
  return { scannedAt: Date.now(), results };
}
