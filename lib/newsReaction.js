// Post-news-candle reaction analysis.
//
// The question this answers: the 1m candle at the news release (NFP / CPI /
// FOMC) pushes in one direction — say hard down. Once that 1m candle CLOSES,
// what happens next? Does price reverse straight away, or does it fall further
// in the same direction?
//
// The verdict is taken at higher-timeframe CLOSES (15m and 1h), because that is
// how a trader actually reads it: the news prints on the 1m, then you wait for
// the 15m and the 1h candle to close and see which side won.
//
// Everything here is pure: it takes 1m OHLCV rows ([ts, o, h, l, c, v]) and
// returns numbers. No network, no dates — so it runs on the server for the
// backtest and in the browser for the charts.

export const TF_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};

const M1 = TF_MS["1m"];

// A move smaller than this fraction of the news candle's range counts as neither
// continuation nor reversal — it is noise sitting on the news close.
const FLAT_R = 0.01;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

/** Start timestamp of the HTF bucket that contains `ts`. */
export function bucketStart(ts, sizeMs) {
  return Math.floor(ts / sizeMs) * sizeMs;
}

/**
 * Roll the 1m rows that fall inside [start, start + sizeMs) into one candle.
 * `complete` means the bucket's final minute is present, i.e. the close price
 * really is the HTF close and not a candle still forming.
 */
export function aggregateBucket(rows, start, sizeMs) {
  const end = start + sizeMs;
  let o = null, h = -Infinity, l = Infinity, c = null, v = 0, bars = 0, lastTs = null;
  for (const r of rows) {
    if (r[0] < start) continue;
    if (r[0] >= end) break;
    if (o === null) o = r[1];
    if (r[2] > h) h = r[2];
    if (r[3] < l) l = r[3];
    c = r[4];
    v += r[5] || 0;
    lastTs = r[0];
    bars++;
  }
  if (o === null) return null;
  return {
    ts: start,
    closeTs: end,
    o, h, l, c, v,
    bars,
    expectedBars: Math.round(sizeMs / M1),
    complete: lastTs + M1 >= end,
  };
}

/** Roll a whole 1m series into an HTF series (for the 15m / 1h chart views). */
export function aggregate1m(rows, sizeMs) {
  if (!rows || rows.length === 0) return [];
  const out = [];
  let cur = null;
  for (const r of rows) {
    const start = bucketStart(r[0], sizeMs);
    if (!cur || cur.start !== start) {
      if (cur) out.push(cur.row);
      cur = { start, row: [start, r[1], r[2], r[3], r[4], r[5] || 0] };
      continue;
    }
    if (r[2] > cur.row[2]) cur.row[2] = r[2];
    if (r[3] < cur.row[3]) cur.row[3] = r[3];
    cur.row[4] = r[4];
    cur.row[5] += r[5] || 0;
  }
  if (cur) out.push(cur.row);
  return out;
}

/**
 * One horizon verdict: compare the HTF close against the news candle's close.
 *
 * `dir` is +1 when the news candle closed up, -1 when it closed down, so a
 * POSITIVE move always means "kept going the same way" (continuation) and a
 * NEGATIVE one means "flipped" (reversal), whichever way the news candle went.
 */
function horizonStats(rows, news, tf) {
  const sizeMs = TF_MS[tf];
  const start = bucketStart(news.ts, sizeMs);
  const bucket = aggregateBucket(rows, start, sizeMs);
  if (!bucket) return { tf, error: "no candles in bucket" };

  const dir = news.dir;
  const p0 = news.c;
  const range = news.range;

  // 1m bars strictly after the news candle, up to the HTF close.
  const post = [];
  for (const r of rows) {
    if (r[0] <= news.ts) continue;
    if (r[0] >= bucket.closeTs) break;
    post.push(r);
  }

  const closeDiff = dir * (bucket.c - p0);
  const closeVsNewsPct = p0 ? (closeDiff / p0) * 100 : 0;
  const closeVsNewsR = range > 0 ? closeDiff / range : 0;

  // Favourable = further in the news candle's direction. Adverse = back against it.
  let favExt = p0, advExt = p0;
  for (const r of post) {
    const hi = r[2], lo = r[3];
    if (dir > 0) {
      if (hi > favExt) favExt = hi;
      if (lo < advExt) advExt = lo;
    } else {
      if (lo < favExt) favExt = lo;
      if (hi > advExt) advExt = hi;
    }
  }
  const mfe = dir * (favExt - p0);           // >= 0
  const mae = dir * (p0 - advExt);           // >= 0 (magnitude of the pullback)

  // Which level gave way first: the news candle's extreme (continuation break)
  // or its open (the body fully retraced — an instant reversal).
  const contLevel = dir > 0 ? news.h : news.l;
  const revLevel = news.o;
  let firstTouch = "none";
  let touchTs = null;
  for (const r of post) {
    const hitCont = dir > 0 ? r[2] > contLevel : r[3] < contLevel;
    const hitRev = dir > 0 ? r[3] < revLevel : r[2] > revLevel;
    if (!hitCont && !hitRev) continue;
    // both inside the same minute — the 1m bar can't say which came first
    firstTouch = hitCont && hitRev ? "both" : hitCont ? "continuation" : "reversal";
    touchTs = r[0];
    break;
  }

  const verdict =
    closeVsNewsR > FLAT_R ? "continuation" : closeVsNewsR < -FLAT_R ? "reversal" : "flat";

  return {
    tf,
    candle: {
      ts: bucket.ts, closeTs: bucket.closeTs,
      o: bucket.o, h: bucket.h, l: bucket.l, c: bucket.c,
    },
    complete: bucket.complete,
    bars: bucket.bars,
    minutesAfterNews: Math.round((bucket.closeTs - news.closeTs) / M1),
    verdict,
    closeVsNewsPct: r4(closeVsNewsPct),
    closeVsNewsR: r2(closeVsNewsR),
    // the HTF candle's own body colour, which is what you see on the chart
    candleDir: bucket.c >= bucket.o ? "bullish" : "bearish",
    candleAgrees: (bucket.c >= bucket.o ? 1 : -1) === dir,
    mfePct: r4(p0 ? (mfe / p0) * 100 : 0),
    maePct: r4(p0 ? (mae / p0) * 100 : 0),
    mfeR: r2(range > 0 ? mfe / range : 0),
    maeR: r2(range > 0 ? mae / range : 0),
    favExt: r4(favExt),
    advExt: r4(advExt),
    contLevel: r4(contLevel),
    revLevel: r4(revLevel),
    firstTouch,
    firstTouchTs: touchTs,
  };
}

/**
 * Analyse one news release on one symbol.
 *
 * @param {object} args
 * @param {number[][]} args.rows      1m OHLCV rows, ascending, covering the event
 * @param {number} args.eventTs       release timestamp (ms)
 * @param {string[]} args.horizons    HTF keys to judge on, e.g. ["15m","1h"]
 * @param {number} args.pathMinutes   how many minutes of drift path to return
 * @param {number} args.dojiBodyPct   body/range % under which the news candle is a doji
 */
export function analyzeNewsReaction({
  rows,
  eventTs,
  horizons = ["15m", "1h"],
  pathMinutes = 60,
  dojiBodyPct = 8,
} = {}) {
  if (!rows || rows.length === 0) return { error: "no candle data" };

  const idx = rows.findIndex((r) => r[0] <= eventTs && r[0] + M1 > eventTs);
  if (idx < 0) return { error: "no 1m candle at the event time" };

  const [nts, no, nh, nl, nc, nv] = rows[idx];
  const range = nh - nl;
  const body = Math.abs(nc - no);
  const bodyPct = range > 0 ? (body / range) * 100 : 0;
  const rawDir = nc > no ? 1 : nc < no ? -1 : 0;
  const isDoji = rawDir === 0 || bodyPct < dojiBodyPct;

  const news = {
    ts: nts,
    closeTs: nts + M1,
    o: no, h: nh, l: nl, c: nc, v: nv,
    dir: rawDir,
    direction: rawDir > 0 ? "bullish" : rawDir < 0 ? "bearish" : "flat",
    classification: isDoji ? "doji" : rawDir > 0 ? "bullish" : "bearish",
    isDoji,
    range: r4(range),
    rangePct: r4(no ? (range / no) * 100 : 0),
    bodyPct: r1(bodyPct),
    changePct: r4(no ? ((nc - no) / no) * 100 : 0),
  };
  // keep the unrounded range for the R maths below
  const newsExact = { ...news, range };

  if (rawDir === 0) {
    return { news, horizons: {}, path: [], error: "news candle closed flat" };
  }

  const out = {};
  for (const tf of horizons) {
    if (!TF_MS[tf]) continue;
    out[tf] = horizonStats(rows, newsExact, tf);
  }

  // Minute-by-minute drift after the news close, in multiples of the news
  // candle's range. Positive = still going the news candle's way.
  const path = [];
  for (let m = 1; m <= pathMinutes; m++) {
    const bar = rows[idx + m];
    if (!bar) break;
    const diff = rawDir * (bar[4] - nc);
    path.push({
      m,
      r: r2(range > 0 ? diff / range : 0),
      pct: r4(nc ? (diff / nc) * 100 : 0),
    });
  }

  return { news, horizons: out, path };
}

/* ------------------------------ aggregation ------------------------------ */

function emptyAgg(tf) {
  return {
    tf, n: 0,
    continuation: 0, reversal: 0, flat: 0,
    firstCont: 0, firstRev: 0, firstBoth: 0, firstNone: 0,
    _contMove: 0, _revMove: 0, _move: 0, _mfe: 0, _mae: 0, _movePct: 0,
  };
}

function pushAgg(agg, h) {
  if (!h || h.error) return;
  agg.n++;
  agg[h.verdict]++;
  agg._move += h.closeVsNewsR;
  agg._movePct += h.closeVsNewsPct;
  agg._mfe += h.mfeR;
  agg._mae += h.maeR;
  if (h.verdict === "continuation") agg._contMove += h.closeVsNewsR;
  if (h.verdict === "reversal") agg._revMove += Math.abs(h.closeVsNewsR);
  if (h.firstTouch === "continuation") agg.firstCont++;
  else if (h.firstTouch === "reversal") agg.firstRev++;
  else if (h.firstTouch === "both") agg.firstBoth++;
  else agg.firstNone++;
}

function sealAgg(agg) {
  const { _contMove, _revMove, _move, _mfe, _mae, _movePct, ...rest } = agg;
  const n = agg.n || 1;
  return {
    ...rest,
    contPct: agg.n ? r1((agg.continuation / agg.n) * 100) : 0,
    revPct: agg.n ? r1((agg.reversal / agg.n) * 100) : 0,
    flatPct: agg.n ? r1((agg.flat / agg.n) * 100) : 0,
    avgMoveR: r2(_move / n),
    avgMovePct: r4(_movePct / n),
    avgContMoveR: agg.continuation ? r2(_contMove / agg.continuation) : 0,
    avgRevMoveR: agg.reversal ? r2(_revMove / agg.reversal) : 0,
    avgMfeR: r2(_mfe / n),
    avgMaeR: r2(_mae / n),
    firstContPct: agg.n ? r1((agg.firstCont / agg.n) * 100) : 0,
    firstRevPct: agg.n ? r1((agg.firstRev / agg.n) * 100) : 0,
  };
}

function aggregateGroup(records, horizons) {
  const aggs = {};
  for (const tf of horizons) aggs[tf] = emptyAgg(tf);
  for (const rec of records) {
    for (const tf of horizons) pushAgg(aggs[tf], rec.horizons?.[tf]);
  }
  const sealed = {};
  for (const tf of horizons) sealed[tf] = sealAgg(aggs[tf]);
  return sealed;
}

/**
 * Roll per-event records up into the continuation-vs-reversal scoreboard.
 *
 * Doji news candles are reported but kept out of every rate, because
 * "same direction" is meaningless when the news candle had no direction.
 *
 * @param {{symbol:string,type:string,news:object,horizons:object}[]} records
 */
export function summarizeReactions(records, horizons = ["15m", "1h"]) {
  const bySymbol = new Map();
  for (const rec of records) {
    if (!rec || rec.error) continue;
    if (!bySymbol.has(rec.symbol)) bySymbol.set(rec.symbol, []);
    bySymbol.get(rec.symbol).push(rec);
  }

  const out = [];
  for (const [symbol, all] of bySymbol) {
    const used = all.filter((r) => r.news && !r.news.isDoji);
    const byDir = {};
    for (const d of ["bearish", "bullish"]) {
      const list = used.filter((r) => r.news.direction === d);
      byDir[d] = { n: list.length, horizons: aggregateGroup(list, horizons) };
    }
    const types = [...new Set(used.map((r) => r.type))].sort();
    const byType = {};
    for (const t of types) {
      const list = used.filter((r) => r.type === t);
      byType[t] = { n: list.length, horizons: aggregateGroup(list, horizons) };
    }
    out.push({
      symbol,
      total: all.length,
      doji: all.length - used.length,
      used: used.length,
      horizons: aggregateGroup(used, horizons),
      byDir,
      byType,
    });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Average drift path per symbol, split by what the 15m close ended up doing.
 * Feeds the "average post-news drift" line chart.
 */
export function averagePaths(records, { pathMinutes = 60, splitTf = "15m" } = {}) {
  const bySymbol = {};
  for (const rec of records) {
    if (!rec || rec.error || !rec.news || rec.news.isDoji || !rec.path?.length) continue;
    const s = (bySymbol[rec.symbol] = bySymbol[rec.symbol] || {
      all: [], continuation: [], reversal: [],
    });
    s.all.push(rec.path);
    const v = rec.horizons?.[splitTf]?.verdict;
    if (v === "continuation") s.continuation.push(rec.path);
    else if (v === "reversal") s.reversal.push(rec.path);
  }

  const out = {};
  for (const [symbol, groups] of Object.entries(bySymbol)) {
    const series = [];
    for (let m = 1; m <= pathMinutes; m++) {
      const point = { m };
      for (const key of ["all", "continuation", "reversal"]) {
        let sum = 0, count = 0;
        for (const p of groups[key]) {
          const hit = p[m - 1];
          if (hit && hit.m === m) { sum += hit.r; count++; }
        }
        point[key] = count ? r2(sum / count) : null;
      }
      series.push(point);
    }
    out[symbol] = {
      series,
      counts: {
        all: groups.all.length,
        continuation: groups.continuation.length,
        reversal: groups.reversal.length,
      },
    };
  }
  return out;
}
