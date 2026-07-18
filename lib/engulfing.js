// Pure detection logic. No external imports so it runs anywhere
// (Next API routes, the worker, the browser, plain node tests).

export function detectEngulfing(prev, curr) {
  const prevBear = prev.close < prev.open;
  const prevBull = prev.close > prev.open;
  const currBull = curr.close > curr.open;
  const currBear = curr.close < curr.open;

  // bullish engulfing: a down candle, then an up candle whose body fully
  // covers the previous body
  if (prevBear && currBull && curr.open <= prev.close && curr.close >= prev.open) {
    return "bullish";
  }
  // bearish engulfing: an up candle, then a down candle whose body fully
  // covers the previous body
  if (prevBull && currBear && curr.open >= prev.close && curr.close <= prev.open) {
    return "bearish";
  }
  return null;
}

export function candleTouchesZone(curr, low, high, mode = "range") {
  if (mode === "range") return curr.low <= high && curr.high >= low;
  if (mode === "body") {
    const bl = Math.min(curr.open, curr.close);
    const bh = Math.max(curr.open, curr.close);
    return bl <= high && bh >= low;
  }
  if (mode === "close") return curr.close >= low && curr.close <= high;
  return false;
}

// true if the candle touches the zone under ANY of the selected modes
export function candleTouchesAnyMode(curr, low, high, modes) {
  const list = Array.isArray(modes) && modes.length ? modes : ["range"];
  return list.some((m) => candleTouchesZone(curr, low, high, m));
}

// drop the still-forming candle so we only judge CLOSED candles (no repaint)
export function closedCandles(rows, tfSeconds, nowMs) {
  const tfMs = tfSeconds * 1000;
  return rows.filter((r) => r[0] + tfMs <= nowMs);
}

export function toCandle(row) {
  const [ts, open, high, low, close, volume] = row;
  return { ts, open, high, low, close, volume };
}

export function gapToZone(curr, low, high) {
  if (curr.high < low) return +(low - curr.high).toFixed(4);
  if (curr.low > high) return +(curr.low - high).toFixed(4);
  return 0;
}

// Zone Origin rule: an engulfing is only a valid "zone origin" signal when the
// candle opens exactly on a 4H boundary (IST). 4H blocks start at 00:00, 04:00,
// 08:00, 12:00, 16:00, 20:00 IST — the starting point of a 4H S/R zone.
// `tsMs` is the candle OPEN time in epoch ms.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function is4HStartingCandle(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return d.getUTCMinutes() === 0 && d.getUTCHours() % 4 === 0;
}
