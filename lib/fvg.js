// Fair Value Gap (FVG) detection logic.
// Pure math — no external imports so it runs everywhere.
//
// Standard 3-candle FVG:
//   Bullish: candle[i-2].high < candle[i].low  → gap zone = [c1.high, c3.low]
//   Bearish: candle[i-2].low  > candle[i].high → gap zone = [c3.high, c1.low]
//
// An FVG "touch" occurs when price re-enters the gap zone.

export function toCandle(row) {
  const [ts, open, high, low, close, volume] = row;
  return { ts, open, high, low, close, volume };
}

// Detect a fresh FVG formed by the last 3 candles (rows).
// Returns null or { type, fvgLow, fvgHigh, formedAt, midpoint }.
export function detectFVG(rows) {
  if (rows.length < 3) return null;

  const c1 = toCandle(rows[rows.length - 3]);
  const c2 = toCandle(rows[rows.length - 2]);
  const c3 = toCandle(rows[rows.length - 1]);

  // Bullish FVG: c3's low is above c1's high
  if (c3.low > c1.high) {
    const gapLow = c1.high;
    const gapHigh = c3.low;
    return {
      type: "bullish",
      fvgLow: gapLow,
      fvgHigh: gapHigh,
      midpoint: (gapLow + gapHigh) / 2,
      formedAt: c3.ts,
      impulseOpen: c2.open,
      impulseClose: c2.close,
      impulseHigh: c2.high,
      impulseLow: c2.low,
      c1,
      c2,
      c3,
    };
  }

  // Bearish FVG: c3's high is below c1's low
  if (c3.high < c1.low) {
    const gapLow = c3.high;
    const gapHigh = c1.low;
    return {
      type: "bearish",
      fvgLow: gapLow,
      fvgHigh: gapHigh,
      midpoint: (gapLow + gapHigh) / 2,
      formedAt: c3.ts,
      impulseOpen: c2.open,
      impulseClose: c2.close,
      impulseHigh: c2.high,
      impulseLow: c2.low,
      c1,
      c2,
      c3,
    };
  }

  return null;
}

// Check if a candle touches/enters an FVG zone.
export function candleTouchesFVG(candle, fvg) {
  if (!fvg) return false;
  return candle.low <= fvg.fvgHigh && candle.high >= fvg.fvgLow;
}

// Scan ALL 3-candle windows for FVG formations.
// Returns an array of { type, fvgLow, fvgHigh, formedAt, touched }.
export function scanHistoryForFVG(rows) {
  const fvgs = [];
  for (let i = 2; i < rows.length; i++) {
    const c1 = toCandle(rows[i - 2]);
    const c2 = toCandle(rows[i - 1]);
    const c3 = toCandle(rows[i]);
    let fvg = null;

    if (c3.low > c1.high) {
      fvg = {
        type: "bullish",
        fvgLow: c1.high,
        fvgHigh: c3.low,
        midpoint: (c1.high + c3.low) / 2,
        formedAt: c3.ts,
        candle1: { ts: c1.ts, high: c1.high, low: c1.low },
        candle3: { ts: c3.ts, high: c3.high, low: c3.low },
      };
    } else if (c3.high < c1.low) {
      fvg = {
        type: "bearish",
        fvgLow: c3.high,
        fvgHigh: c1.low,
        midpoint: (c3.high + c1.low) / 2,
        formedAt: c3.ts,
        candle1: { ts: c1.ts, high: c1.high, low: c1.low },
        candle3: { ts: c3.ts, high: c3.high, low: c3.low },
      };
    }

    if (fvg) {
      // Check if price already touched this FVG after formation
      let touched = false;
      for (let j = i + 1; j < rows.length; j++) {
        const test = toCandle(rows[j]);
        if (candleTouchesFVG(test, fvg)) {
          touched = true;
          fvg.touchedAt = test.ts;
          fvg.touchPrice = test.close;
          break;
        }
      }
      fvgs.push(fvg);
    }
  }
  return fvgs;
}

// Format FVG for display
export function formatFVG(fvg) {
  if (!fvg) return "";
  const dir = fvg.type === "bullish" ? "BULLISH" : "BEARISH";
  return `${dir} FVG · ${fvg.fvgLow.toFixed(5)} – ${fvg.fvgHigh.toFixed(5)}`;
}
