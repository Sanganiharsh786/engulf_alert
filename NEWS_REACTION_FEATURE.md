# After the News Candle — Continuation vs Reversal

Answers one question with history instead of a hunch:

> The 1m candle at the news release pushes one way — say it drops hard. Once that
> candle **closes**, how often does price keep falling, and how often does it reverse
> straight away?

The verdict is taken at **higher-timeframe closes (15m and 1h)**, which is how it is
actually read on a chart: the news prints on the 1m, then you wait for the 15m and the
1h candle to close and see which side won.

Lives at the bottom of **/backtest**, under the existing *News Candle Analysis* section.

## How a release is scored

For each past NFP / CPI / FOMC release, per symbol (BTC and gold/PAXG by default):

1. **News candle** — the 1m candle whose minute covers the release timestamp
   (08:30 ET for NFP/CPI, 14:00 ET for FOMC). Its direction is the body direction;
   a body under 8% of the range is a **doji** and is kept out of every rate.
2. **Reference price** — the news candle's **close**. Every number below is measured
   from there and signed by the news candle's direction, so **positive always means
   "kept going the same way"**, whether the news candle was up or down.
3. **Horizon closes** — the 15m and the 1h candle that contain the news minute,
   rolled up from the 1m data:
   - `continuation` — the HTF close finished beyond the news close
   - `reversal` — it finished back behind it
   - `flat` — within 0.01 of a news-candle range
4. **Excursions** — between the news close and the HTF close:
   `mfeR` how far it ran the news candle's way, `maeR` how far it pulled back,
   both in multiples of the news candle's own range (**R**).
5. **Hit first** — walking the 1m bars, which level gave way first:
   the **news candle extreme** (continuation break) or the **news candle open**
   (body fully retraced — an instant reversal). `both` means one 1m bar took out
   both, so the minute data cannot order them.

Because NFP and CPI land at 08:30 ET, their hourly candle closes 29 minutes after the
news; FOMC lands on the hour, so its hourly close is 59 minutes out. Each row's exact
wait is shown on its chart (`+14m after news`, `+29m after news`, …).

## What you see

- **Two headline cards** — continuation % vs reversal % at the 15m and the 1h close,
  with average move, average run, average pullback and how often the news extreme
  broke first.
- **Bar chart** — the same split cut by news-candle direction (down news / up news),
  which is the cut that matters: a down news candle and an up one do not behave alike.
- **Drift chart** — average minute-by-minute drift after the news close, in R, with the
  releases that continued and the ones that reversed drawn separately.
- **By event type** — NFP vs CPI vs FOMC.
- **Every release** table — filterable to down / up / doji news candles. Click a row for
  the chart.

### The chart

Kept deliberately bare — candles plus **two dashed gold lines at the news candle's high
and low**, and one gold arrow marking the news candle itself. Nothing else is drawn on
the price: the verdicts, the run and the pullback are read off the cards under the chart,
where they stay legible.

The chart switches between **1m / 15m / 1h** candles; the HTF views are rolled up from
the same 1m rows.

## Code

| file | what it holds |
| --- | --- |
| `lib/newsReaction.js` | all the maths — pure, no network: bucket aggregation, per-release analysis, scoreboard, average paths |
| `lib/newsReaction.test.mjs` | `node lib/newsReaction.test.mjs` — 46 assertions over synthetic series |
| `app/api/news-reaction/route.js` | fetches a ±30/+95 min 1m window per release per symbol and returns events + stats + paths |
| `components/backtest/news-reaction-section.jsx` | the section: filters, cards, charts, table |
| `components/backtest/news-reaction-dialog.jsx` | the per-release dialog |
| `components/backtest/charts.jsx` | `NewsReactionChart` — the lightweight-charts view with the drawings |

Releases whose 1h candle has not closed yet are skipped, so a half-formed HTF candle can
never be scored.
