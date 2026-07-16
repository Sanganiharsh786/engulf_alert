// Candle Range Theory (CRT) detection.
// A bullish CRT fires when the current candle closes ABOVE the previous candle's high.
// A bearish CRT fires when the current candle closes BELOW the previous candle's low.
// Pure logic — no external imports so it runs everywhere.

export function detectCRT(prev, curr) {
  // bullish CRT: close breaks above previous candle's high
  if (curr.close > prev.high) {
    return "bullish";
  }
  // bearish CRT: close breaks below previous candle's low
  if (curr.close < prev.low) {
    return "bearish";
  }
  return null;
}

// Re-export zone-touch helpers for consistency with the engulfing codebase
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
