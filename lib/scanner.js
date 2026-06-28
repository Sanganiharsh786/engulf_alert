import {
  detectEngulfing,
  candleTouchesAnyMode,
  closedCandles,
  toCandle,
  gapToZone,
} from "./engulfing.js";
import { fetchOHLCV, tfSeconds } from "./market.js";
import { buildChartSVG } from "./chart.js";
import { sendAlertEmail } from "./mailer.js";
import { computePosition, positionText } from "./position.js";

// selected touch modes (array), with backward-compat for the old single value
function touchModes(settings) {
  if (Array.isArray(settings.touchModes) && settings.touchModes.length) return settings.touchModes;
  return [settings.touchMode || "range"];
}

// Persist a generated alert into store.alerts so it shows on /totalalerts.
// Deduped by the signal key; preserves the user's "placed" tick on re-records.
// Newest alerts are kept; the log is capped so it can't grow unbounded.
function recordAlert(store, id, sig) {
  if (!Array.isArray(store.alerts)) store.alerts = [];
  if (store.alerts.some((a) => a.id === id)) return;
  store.alerts.push({
    id,
    pair: sig.pair,
    direction: sig.direction,
    low: sig.low,
    high: sig.high,
    ts: sig.ts,
    at: Date.now(),
    link: sig.link,
    position: sig.position || null,
    placed: false,
  });
  if (store.alerts.length > 2000) {
    store.alerts = store.alerts.slice(-1500);
  }
}

export function tradingViewLink(pair) {
  const sym = pair.tradingview || `${pair.exchange.toUpperCase()}:${pair.name}`;
  return `https://www.tradingview.com/chart/?symbol=${sym}`;
}

// A level's watched zone, shifted by the pair's price offset (used to align a
// broker's price with the Binance feed, e.g. gold). Returns [low, high].
export function levelZone(lvl, offset = 0) {
  const off = Number(offset) || 0;
  return [Math.min(lvl.low, lvl.high) + off, Math.max(lvl.low, lvl.high) + off];
}

// pair with its levels shifted by the offset — for drawing charts that match
// the watched zones.
function offsetPair(pair) {
  const off = Number(pair.levelOffset) || 0;
  if (!off) return pair;
  return {
    ...pair,
    levels: pair.levels.map((l) => ({ ...l, low: l.low + off, high: l.high + off })),
  };
}

// Stop just past the engulfing candle (below low for bullish, above high for
// bearish), entry at its close.
function tradeLevels(direction, curr) {
  const entry = curr.close;
  const stop = direction === "bullish" ? curr.low : curr.high;
  return { entry, stop };
}

function alertText(pair, direction, low, high, prev, curr, pos) {
  const t = new Date(curr.ts).toISOString().replace("T", " ").slice(0, 16);
  return (
    `${direction.toUpperCase()} ENGULFING detected\n` +
    `--------------------------------------\n` +
    `Pair      : ${pair.name} (${pair.symbol} @ ${pair.exchange})\n` +
    `Level     : ${low} - ${high}\n` +
    `Candle UTC: ${t}\n\n` +
    `Signal candle  O:${curr.open} H:${curr.high} L:${curr.low} C:${curr.close}\n` +
    `Prev candle    O:${prev.open} H:${prev.high} L:${prev.low} C:${prev.close}\n` +
    positionText(pos) +
    `\n\nChart with the level + engulfing candle is attached.\n` +
    `TradingView: ${tradingViewLink(pair)}\n`
  );
}

export async function scanPair(pair, settings, store, { dryRun = false } = {}) {
  const tf = pair.timeframe || settings.timeframe || "15m";
  const raw = await fetchOHLCV(pair, tf, 60);
  const rows = closedCandles(raw, tfSeconds(tf), Date.now());

  if (rows.length < 2) {
    return { pair: pair.name, tf, status: "waiting", touched: [], alerts: [] };
  }

  const prev = toCandle(rows[rows.length - 2]);
  const curr = toCandle(rows[rows.length - 1]);
  const direction = detectEngulfing(prev, curr);
  const modes = touchModes(settings);
  const offset = pair.levelOffset;

  const result = {
    pair: pair.name,
    tf,
    status: "ok",
    last: curr,
    direction,
    levels: pair.levels.map((lvl) => {
      const [low, high] = levelZone(lvl, offset);
      return {
        id: lvl.id,
        touched: !!direction && candleTouchesAnyMode(curr, low, high, modes),
        gap: gapToZone(curr, low, high),
      };
    }),
    touched: [],
    alerts: [],
  };

  if (!direction) return result;

  for (const lvl of pair.levels) {
    const [low, high] = levelZone(lvl, offset);
    if (!candleTouchesAnyMode(curr, low, high, modes)) continue;
    result.touched.push(lvl.id);

    const key = `${pair.name}|${tf}|${lvl.id}|${direction}|${curr.ts}`;
    if (store.alertedKeys.includes(key)) continue;
    store.alertedKeys.push(key);

    const { entry, stop } = tradeLevels(direction, curr);
    const position = computePosition({
      direction,
      entry,
      stop,
      settings,
      leverage: pair.leverage,
      contractSize: pair.contractSize,
      pipSize: pair.pipSize,
    });

    const alert = {
      pair: pair.name,
      direction,
      low,
      high,
      ts: curr.ts,
      link: tradingViewLink(pair),
      position,
    };
    result.alerts.push(alert);
    recordAlert(store, key, alert);

    const senderConfigured =
      process.env.GMAIL_SENDER || (settings.email && settings.email.sender);
    if (!dryRun && senderConfigured) {
      const svg = buildChartSVG({ pair: offsetPair(pair), tf, rows, signalTs: curr.ts, direction });
      try {
        await sendAlertEmail(settings.email, {
          subject: `[${pair.name}] ${direction.toUpperCase()} engulfing at ${low}-${high}`,
          text: alertText(pair, direction, low, high, prev, curr, position),
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

// Look back through recent history and find EVERY past engulfing-at-level
// signal (not just the latest candle), each with its trade plan. Optionally
// emails the ones not already sent. Used by the "Past signals" button.
export async function scanPairHistory(pair, settings, store, { bars = 150, send = false } = {}) {
  const tf = pair.timeframe || settings.timeframe || "15m";
  const raw = await fetchOHLCV(pair, tf, bars);
  const rows = closedCandles(raw, tfSeconds(tf), Date.now());
  const modes = touchModes(settings);
  const offset = pair.levelOffset;
  const senderConfigured =
    process.env.GMAIL_SENDER || (settings.email && settings.email.sender);
  const signals = [];

  for (let i = 1; i < rows.length; i++) {
    const prev = toCandle(rows[i - 1]);
    const curr = toCandle(rows[i]);
    const direction = detectEngulfing(prev, curr);
    if (!direction) continue;

    for (const lvl of pair.levels) {
      const [low, high] = levelZone(lvl, offset);
      if (!candleTouchesAnyMode(curr, low, high, modes)) continue;

      const { entry, stop } = tradeLevels(direction, curr);
      const position = computePosition({
        direction, entry, stop, settings,
        leverage: pair.leverage,
        contractSize: pair.contractSize,
        pipSize: pair.pipSize,
      });

      const key = `${pair.name}|${tf}|${lvl.id}|${direction}|${curr.ts}`;
      const sig = {
        pair: pair.name,
        direction,
        low,
        high,
        ts: curr.ts,
        at: curr.ts,
        link: tradingViewLink(pair),
        position,
      };

      if (send && senderConfigured && !store.alertedKeys.includes(key)) {
        const win = rows.slice(Math.max(0, i - 45), i + 1);
        const svg = buildChartSVG({ pair: offsetPair(pair), tf, rows: win, signalTs: curr.ts, direction });
        try {
          await sendAlertEmail(settings.email, {
            subject: `[${pair.name}] past ${direction.toUpperCase()} engulfing at ${low}-${high}`,
            text: alertText(pair, direction, low, high, prev, curr, position),
            svg,
            filename: `${pair.name}_${direction}.svg`,
          });
          store.alertedKeys.push(key);
          recordAlert(store, key, sig);
          sig.emailed = true;
        } catch (e) {
          sig.emailed = false;
          sig.emailError = String(e.message || e);
        }
      }
      signals.push(sig);
    }
  }
  // newest first
  signals.sort((a, b) => b.ts - a.ts);
  return { pair: pair.name, tf, signals };
}

export async function runHistory(store, opts = {}) {
  const signals = [];
  for (const pair of store.pairs) {
    try {
      const out = await scanPairHistory(pair, store.settings, store, opts);
      signals.push(...out.signals);
    } catch (e) {
      // skip a failing pair but keep going
      signals.push({ pair: pair.name, error: String(e.message || e) });
    }
  }
  if (store.alertedKeys.length > 3000) {
    store.alertedKeys = store.alertedKeys.slice(-2000);
  }
  signals.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { scannedAt: Date.now(), signals };
}
