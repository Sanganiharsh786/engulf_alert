// Liquidity Sweep strategy — pure detection logic (no external imports so it
// runs in API routes, the worker, the browser, and plain node tests).
//
// Idea (from the user's gold-chart example):
//   1. An engulfing candle forms AT a watched level ("my level").
//   2. Stop loss goes just beyond the nearest SWING PIVOT — for a long, below
//      the swing low; for a short, above the swing high. (Not the tiny
//      engulfing wick — a real structural swing.)
//   3. Take profit is the NEXT LIQUIDITY: the nearest opposite swing on the
//      other side — for a long, the closest prior swing HIGH above entry; for a
//      short, the closest prior swing LOW below entry.
//
// Everything here is walk-forward safe: a swing is only "confirmed" once it has
// `strength` candles on BOTH sides, and we never look past the signal candle.

export const DEFAULTS = {
  swingStrength: 2, // candles required on each side of a pivot to confirm it
  lookback: 30, // how far back (candles) to search for the swing / liquidity
};

// Read strategy tuning from settings, falling back to DEFAULTS.
export function sweepConfig(settings) {
  const c = (settings && settings.liquiditySweep) || {};
  return {
    swingStrength: Math.max(1, Number(c.swingStrength) || DEFAULTS.swingStrength),
    lookback: Math.max(2, Number(c.lookback) || DEFAULTS.lookback),
  };
}

// Is rows[k] a confirmed swing LOW? Its low must be <= the low of `strength`
// candles on each side (strictly lower than at least the immediate neighbours
// to avoid flat plateaus counting as pivots).
export function isSwingLow(rows, k, strength) {
  const lowK = rows[k][3];
  for (let s = 1; s <= strength; s++) {
    const l = rows[k - s];
    const r = rows[k + s];
    if (!l || !r) return false;
    if (lowK > l[3] || lowK > r[3]) return false;
    // require a strict break on the immediate neighbours so equal lows in a
    // range don't all register as pivots
    if (s === 1 && (lowK >= l[3] || lowK >= r[3])) return false;
  }
  return true;
}

export function isSwingHigh(rows, k, strength) {
  const highK = rows[k][2];
  for (let s = 1; s <= strength; s++) {
    const l = rows[k - s];
    const r = rows[k + s];
    if (!l || !r) return false;
    if (highK < l[2] || highK < r[2]) return false;
    if (s === 1 && (highK <= l[2] || highK <= r[2])) return false;
  }
  return true;
}

// Nearest confirmed swing LOW at or before the signal candle `i`, searching
// back `lookback` candles. Confirmed = has `strength` candles after it that all
// closed no later than `i` (so no lookahead). Returns { index, price } or null.
export function findSwingLowBefore(rows, i, strength, lookback) {
  const from = Math.max(strength, i - lookback);
  for (let k = i - strength; k >= from; k--) {
    if (k + strength > i) continue; // not yet confirmed by candle i
    if (isSwingLow(rows, k, strength)) return { index: k, price: rows[k][3] };
  }
  return null;
}

export function findSwingHighBefore(rows, i, strength, lookback) {
  const from = Math.max(strength, i - lookback);
  for (let k = i - strength; k >= from; k--) {
    if (k + strength > i) continue;
    if (isSwingHigh(rows, k, strength)) return { index: k, price: rows[k][2] };
  }
  return null;
}

// Next liquidity ABOVE `entry` for a long: the closest prior swing HIGH whose
// price sits above entry (the nearest resting liquidity price will run to).
// Returns { index, price } or null when there is no swing high overhead.
export function findLiquidityAbove(rows, i, entry, strength, lookback) {
  const from = Math.max(strength, i - lookback);
  let best = null;
  for (let k = i - strength; k >= from; k--) {
    if (k + strength > i) continue;
    if (!isSwingHigh(rows, k, strength)) continue;
    const price = rows[k][2];
    if (price <= entry) continue;
    // nearest-in-price above entry = the first liquidity price reaches
    if (!best || price < best.price) best = { index: k, price };
  }
  return best;
}

// Next liquidity BELOW `entry` for a short: closest prior swing LOW under entry.
export function findLiquidityBelow(rows, i, entry, strength, lookback) {
  const from = Math.max(strength, i - lookback);
  let best = null;
  for (let k = i - strength; k >= from; k--) {
    if (k + strength > i) continue;
    if (!isSwingLow(rows, k, strength)) continue;
    const price = rows[k][3];
    if (price >= entry) continue;
    if (!best || price > best.price) best = { index: k, price };
  }
  return best;
}

// Build the full trade plan for a confirmed engulfing at `i`.
// Returns { entry, stop, tp, risk, reward, rr, stopSwing, targetSwing } or null
// if a valid swing stop or liquidity target can't be found.
export function buildSweepPlan(rows, i, direction, cfg) {
  const { swingStrength: strength, lookback } = cfg;
  const entry = rows[i][4]; // close of the engulfing candle

  if (direction === "bullish") {
    const stopSwing = findSwingLowBefore(rows, i, strength, lookback);
    if (!stopSwing) return null;
    const stop = stopSwing.price;
    if (stop >= entry) return null; // stop must sit below entry
    const targetSwing = findLiquidityAbove(rows, i, entry, strength, lookback);
    if (!targetSwing) return null;
    const tp = targetSwing.price;
    const risk = entry - stop;
    const reward = tp - entry;
    if (risk <= 0 || reward <= 0) return null;
    return { entry, stop, tp, risk, reward, rr: reward / risk, stopSwing, targetSwing };
  }

  if (direction === "bearish") {
    const stopSwing = findSwingHighBefore(rows, i, strength, lookback);
    if (!stopSwing) return null;
    const stop = stopSwing.price;
    if (stop <= entry) return null; // stop must sit above entry
    const targetSwing = findLiquidityBelow(rows, i, entry, strength, lookback);
    if (!targetSwing) return null;
    const tp = targetSwing.price;
    const risk = stop - entry;
    const reward = entry - tp;
    if (risk <= 0 || reward <= 0) return null;
    return { entry, stop, tp, risk, reward, rr: reward / risk, stopSwing, targetSwing };
  }

  return null;
}
