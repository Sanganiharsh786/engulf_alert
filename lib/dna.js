// Signal DNA fingerprinting. Pure math, no external imports so it runs
// anywhere (Next API routes, the worker, plain node tests).
//
// Every engulfing signal candle gets a scale-free "fingerprint" of its shape
// (body ratio, wick %, ATR context). New signals are compared against a
// library of historical trades with known outcomes; a signal "passes" when
// enough highly-similar past trades exist and they won often enough.

export function dnaDefaults() {
  return { enabled: false, minSimilarity: 85, minWinRate: 60, minMatches: 5 };
}

// merge saved settings with defaults (tolerates missing/partial config)
export function dnaConfig(settings) {
  return { ...dnaDefaults(), ...((settings && settings.dna) || {}) };
}

function cap(n, max) {
  return Math.min(max, Math.max(0, n));
}

// Average True Range of the `period` candles ending at row index `i`.
// rows are raw [ts, open, high, low, close, volume] arrays.
export function atr(rows, i, period = 14) {
  const start = Math.max(1, i - period + 1);
  let sum = 0;
  let n = 0;
  for (let j = start; j <= i; j++) {
    const high = rows[j][2];
    const low = rows[j][3];
    const prevClose = rows[j - 1][4];
    sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    n++;
  }
  if (!n) {
    // no history at all -> fall back to the candle's own range
    return Math.max(rows[i][2] - rows[i][3], 1e-9);
  }
  return Math.max(sum / n, 1e-9);
}

// Feature vector describing the SHAPE of the signal candle at index `i`
// relative to the previous candle and recent volatility. All features are
// scale-free so BTC, gold, and forex fingerprints are comparable.
export function computeFingerprint(rows, i) {
  if (i < 1 || i >= rows.length) return null;
  const [, po, ph, pl, pc] = rows[i - 1];
  const [, o, h, l, c] = rows[i];

  const body = Math.abs(c - o);
  const prevBody = Math.abs(pc - po);
  const range = Math.max(h - l, 1e-9);
  const prevRange = Math.max(ph - pl, 1e-9);
  const a = atr(rows, i);

  return [
    cap(body / Math.max(prevBody, 1e-9), 5) / 5, // 0 bodyRatio (engulf strength)
    cap(body / range, 1),                        // 1 bodyPct
    cap((h - Math.max(o, c)) / range, 1),        // 2 upperWickPct
    cap((Math.min(o, c) - l) / range, 1),        // 3 lowerWickPct
    cap(range / a, 4) / 4,                       // 4 rangeAtr (volatility context)
    cap(body / a, 4) / 4,                        // 5 bodyAtr
    cap((c - l) / range, 1),                     // 6 closePos
    cap(prevBody / prevRange, 1),                // 7 prevBodyPct
  ].map((x) => Math.round(x * 1000) / 1000);
}

// weights: engulfing strength + body/ATR shape matter most
const W = [2, 2, 1, 1, 1.5, 1.5, 1, 0.5];
const W_SUM = W.reduce((a, b) => a + b, 0);

// 0..100 similarity between two fingerprints (100 = identical shape)
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0;
  for (let k = 0; k < a.length; k++) d += W[k] * Math.abs(a[k] - b[k]);
  return Math.round((1 - d / W_SUM) * 1000) / 10;
}

// Compare a fingerprint against library entries of the same pair + direction.
// entries: [{ pair, direction, fp, outcome }]  (outcome: "win" | "loss")
export function matchFingerprint(fp, entries, { pair, direction, minSimilarity = 85, minWinRate = 60, minMatches = 5 } = {}) {
  let matches = 0;
  let wins = 0;
  let losses = 0;
  let simSum = 0;
  let best = 0;
  for (const e of entries || []) {
    if (e.pair !== pair || e.direction !== direction || !e.fp) continue;
    const s = similarity(fp, e.fp);
    if (s < minSimilarity) continue;
    matches++;
    simSum += s;
    if (s > best) best = s;
    if (e.outcome === "win") wins++;
    else if (e.outcome === "loss") losses++;
  }
  const winRate = matches ? Math.round((wins / matches) * 1000) / 10 : 0;
  return {
    matches,
    wins,
    losses,
    winRate,
    avgSimilarity: matches ? Math.round((simSum / matches) * 10) / 10 : 0,
    bestSimilarity: best,
    pass: matches >= minMatches && winRate >= minWinRate,
  };
}

// The human sentence used in alerts:
// "This candle is 91% similar to 14 past trades that went 11-3."
export function dnaText(match) {
  if (!match || !match.matches) return "DNA: no similar historical trades found.";
  return (
    `This candle is ${Math.round(match.avgSimilarity)}% similar to ${match.matches} past ` +
    `trade${match.matches === 1 ? "" : "s"} that went ${match.wins}-${match.losses}.`
  );
}
