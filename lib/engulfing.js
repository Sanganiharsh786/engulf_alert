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
