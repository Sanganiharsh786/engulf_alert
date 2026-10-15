// Run: node lib/newsReaction.test.mjs
// Covers the post-news-candle continuation / reversal analysis.
import {
  TF_MS, bucketStart, aggregateBucket, aggregate1m,
  analyzeNewsReaction, summarizeReactions, averagePaths,
} from "./newsReaction.js";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? "PASS" : "FAIL") + " - " + n); };

const M1 = 60_000;
// NFP release: 2025-01-10 08:30 ET = 13:30 UTC
const EVENT = Date.UTC(2025, 0, 10, 13, 30);

/**
 * Build a 1m series around the event.
 * `closes` are the closes of the minutes AFTER the news candle; the news candle
 * itself is given explicitly so its body / range are exact.
 */
function series({ pre = 30, news, closes, startPrice = 100 }) {
  const rows = [];
  for (let i = pre; i > 0; i--) {
    const ts = EVENT - i * M1;
    rows.push([ts, startPrice, startPrice + 0.1, startPrice - 0.1, startPrice, 10]);
  }
  rows.push([EVENT, news.o, news.h, news.l, news.c, 100]);
  let prev = news.c;
  closes.forEach((c, i) => {
    const ts = EVENT + (i + 1) * M1;
    rows.push([ts, prev, Math.max(prev, c), Math.min(prev, c), c, 10]);
    prev = c;
  });
  return rows;
}

// --- bucket helpers ---------------------------------------------------------
ok("bucketStart 15m snaps down", bucketStart(Date.UTC(2025, 0, 10, 13, 37), TF_MS["15m"]) === Date.UTC(2025, 0, 10, 13, 30));
ok("bucketStart 1h snaps down", bucketStart(EVENT, TF_MS["1h"]) === Date.UTC(2025, 0, 10, 13, 0));

const rowsFlat = series({ news: { o: 100, h: 100.2, l: 99.8, c: 100 }, closes: Array(90).fill(100) });
const b15 = aggregateBucket(rowsFlat, EVENT, TF_MS["15m"]);
ok("15m bucket has 15 bars", b15.bars === 15 && b15.expectedBars === 15);
ok("15m bucket complete", b15.complete === true);
ok("15m bucket close = last 1m close", b15.c === 100);
// 30 pre-news bars + the news bar + 5 more = a 15m bucket only 6 minutes in
const partial = aggregateBucket(rowsFlat.slice(0, 30 + 6), EVENT, TF_MS["15m"]);
ok("partial bucket flagged incomplete", partial.bars === 6 && partial.complete === false);
ok("aggregate1m rolls series", aggregate1m(rowsFlat, TF_MS["15m"]).length >= 7);

// --- bearish news candle that keeps falling (continuation) ------------------
// news: 100 -> 98 (range 2.5, body 2), then drifts to 96 and stays below
const contRows = series({
  news: { o: 100, h: 100.5, l: 97.8, c: 98 },
  closes: [...Array(14).fill(0).map((_, i) => 98 - (i + 1) * 0.1), ...Array(76).fill(96)],
});
const cont = analyzeNewsReaction({ rows: contRows, eventTs: EVENT });
ok("news candle detected", cont.news.ts === EVENT && cont.news.direction === "bearish");
ok("news not a doji", cont.news.isDoji === false && cont.news.bodyPct > 70);
ok("15m verdict continuation", cont.horizons["15m"].verdict === "continuation");
ok("1h verdict continuation", cont.horizons["1h"].verdict === "continuation");
ok("15m close is 14 min after news close", cont.horizons["15m"].minutesAfterNews === 14);
ok("1h close is 29 min after news close", cont.horizons["1h"].minutesAfterNews === 29);
ok("continuation move positive in R", cont.horizons["15m"].closeVsNewsR > 0);
ok("broke the news low first", cont.horizons["15m"].firstTouch === "continuation");
ok("no adverse excursion", cont.horizons["15m"].maeR === 0);
ok("mfe positive", cont.horizons["15m"].mfeR > 0);
ok("15m candle agrees with news", cont.horizons["15m"].candleDir === "bearish" && cont.horizons["15m"].candleAgrees === true);
ok("path drifts favourable", cont.path.length === 60 && cont.path[13].r > 0);

// --- bearish news candle that reverses instantly ----------------------------
// news: 100 -> 98, then rips back up through the open to 101
const revRows = series({
  news: { o: 100, h: 100.5, l: 97.8, c: 98 },
  closes: [...Array(14).fill(0).map((_, i) => 98 + (i + 1) * 0.25), ...Array(76).fill(101.5)],
});
const rev = analyzeNewsReaction({ rows: revRows, eventTs: EVENT });
ok("15m verdict reversal", rev.horizons["15m"].verdict === "reversal");
ok("1h verdict reversal", rev.horizons["1h"].verdict === "reversal");
ok("reversal move negative in R", rev.horizons["15m"].closeVsNewsR < 0);
ok("retraced the body first", rev.horizons["15m"].firstTouch === "reversal");
ok("adverse excursion recorded", rev.horizons["15m"].maeR > 0);
ok("15m candle disagrees with news", rev.horizons["15m"].candleAgrees === false);
ok("path drifts adverse", rev.path[13].r < 0);

// --- the 15m reverses but the 1h still closes beyond ------------------------
// pops back above the open inside the 15m, then collapses again before 14:00
const mixedRows = series({
  news: { o: 100, h: 100.5, l: 97.8, c: 98 },
  closes: [...Array(14).fill(100.4), ...Array(76).fill(96.5)],
});
const mixed = analyzeNewsReaction({ rows: mixedRows, eventTs: EVENT });
ok("mixed: 15m reversal", mixed.horizons["15m"].verdict === "reversal");
ok("mixed: 1h continuation", mixed.horizons["1h"].verdict === "continuation");

// --- doji news candle -------------------------------------------------------
const dojiRows = series({
  news: { o: 100, h: 101, l: 99, c: 100.02 },
  closes: Array(90).fill(100),
});
const doji = analyzeNewsReaction({ rows: dojiRows, eventTs: EVENT });
ok("doji classified", doji.news.classification === "doji" && doji.news.isDoji === true);

// --- bullish news candle mirrors -------------------------------------------
const bullRows = series({
  news: { o: 100, h: 102.2, l: 99.8, c: 102 },
  closes: Array(90).fill(103),
});
const bull = analyzeNewsReaction({ rows: bullRows, eventTs: EVENT });
ok("bullish continuation", bull.news.direction === "bullish" && bull.horizons["15m"].verdict === "continuation");
ok("bullish cont level is the news high", bull.horizons["15m"].contLevel === 102.2);
ok("bullish rev level is the news open", bull.horizons["15m"].revLevel === 100);

// --- missing data -----------------------------------------------------------
ok("no rows -> error", Boolean(analyzeNewsReaction({ rows: [], eventTs: EVENT }).error));
ok("event outside rows -> error", Boolean(analyzeNewsReaction({ rows: contRows, eventTs: EVENT + 86_400_000 }).error));

// --- aggregation ------------------------------------------------------------
const recs = [
  { symbol: "BTCUSDT.P", type: "NFP", ...cont },
  { symbol: "BTCUSDT.P", type: "CPI", ...rev },
  { symbol: "BTCUSDT.P", type: "CPI", ...mixed },
  { symbol: "BTCUSDT.P", type: "FOMC", ...doji },
  { symbol: "PAXGUSDT.P", type: "NFP", ...bull },
];
const stats = summarizeReactions(recs);
const btc = stats.find((s) => s.symbol === "BTCUSDT.P");
ok("two symbols summarised", stats.length === 2);
ok("doji excluded from rates", btc.total === 4 && btc.doji === 1 && btc.used === 3);
ok("15m: 1 continuation / 2 reversals", btc.horizons["15m"].continuation === 1 && btc.horizons["15m"].reversal === 2);
ok("15m reversal rate 66.7%", btc.horizons["15m"].revPct === 66.7);
ok("1h: 2 continuations / 1 reversal", btc.horizons["1h"].continuation === 2 && btc.horizons["1h"].reversal === 1);
ok("bearish-news split holds all 3", btc.byDir.bearish.n === 3 && btc.byDir.bullish.n === 0);
ok("per-type split: CPI n=2", btc.byType.CPI.n === 2);
ok("first-touch counted", btc.horizons["15m"].firstCont + btc.horizons["15m"].firstRev + btc.horizons["15m"].firstBoth + btc.horizons["15m"].firstNone === 3);

const paths = averagePaths(recs, { pathMinutes: 60 });
ok("paths per symbol", Object.keys(paths).length === 2);
ok("path has 60 minutes", paths["BTCUSDT.P"].series.length === 60);
ok("path split counts", paths["BTCUSDT.P"].counts.all === 3 && paths["BTCUSDT.P"].counts.reversal === 2);
ok("path averages are numbers", typeof paths["BTCUSDT.P"].series[9].all === "number");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
