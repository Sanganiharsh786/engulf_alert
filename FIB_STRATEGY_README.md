# Fibonacci 0.70–0.786 Retracement Strategy

A simple, rule-based mean-reversion-into-trend strategy: find a clean impulse,
wait for price to retrace **deep** into the 0.700–0.786 Fibonacci zone, require a
**price-action confirmation**, then trade with a structural stop and a
configurable target. It ships with a full backtester, per-direction stats, and an
RR comparison table so you can judge whether the setup has a real edge instead of
assuming 1:2 is best.

> **This is a research tool, not a promise of profit.** The backtester exists to
> tell you objectively whether the rules have an edge on your data.

## Where the code lives

The suggested `strategy/*.ts` layout from the brief is mapped onto this repo's
flat JavaScript `lib/` convention:

| Spec module            | This repo                                             |
| ---------------------- | ---------------------------------------------------- |
| `config.ts`            | `DEFAULT_CONFIG` / `fibConfig()` in `lib/fibStrategy.js` |
| `swingDetection.ts`    | `isPivotHigh` / `isPivotLow` in `lib/fibStrategy.js` |
| `fibonacci.ts`         | `fibZoneLong` / `fibZoneShort` / `fibExtension*`     |
| `confirmation.ts`      | `confirmLong` / `confirmShort` + candle checks       |
| `impulseDetection.ts`  | `maybeCreate()` in `lib/fibBacktest.js`              |
| `tradeSetup.ts`        | setup state machine in `backtestPair()`             |
| `riskManagement.ts`    | `finaliseTrade` / `sizeTrades` / `computeStats`      |
| `tradeManager.ts`      | `resolve()` (walk-forward TP/SL)                    |
| `backtester.ts`        | `backtestPair` / `runFibBacktest`                   |
| `statistics.ts`        | `computeStats` / `rrComparison`                     |

- **API**: `app/api/backtest-fib/route.js`
- **UI**: `app/backtest-fib/page.js` (config panel, stats dashboard, LONG/SHORT
  split, RR comparison, trade history, per-trade chart) — reachable from the
  dashboard via the **Fib 0.7–0.786** button.

## Strategy rules

### LONG
1. **Impulse** — a confirmed swing **Low → High** (up move) large enough to pass
   the impulse filter.
2. **Fib zone** — measured Low(0.0) → High(1.0); the entry zone is between
   `0.700` (higher price) and `0.786` (lower price).
3. **Retrace** — price must trade back **into** that zone.
4. **Confirmation** — a bullish price-action signal inside the zone (default:
   bullish engulfing).
5. **Entry** — confirmation candle close (or, optionally, the break of the
   confirmation candle high).

### SHORT
The exact mirror: impulse High → Low, retrace **up** into the zone, bearish
confirmation, entry on close (or break of the confirmation candle low).

## Entry rules

- `entryMode = "close"` — enter at the confirmation candle's close.
- `entryMode = "break"` — after a confirmation candle, enter only if a later
  candle breaks its high (long) / low (short).
- **One trade per setup.** Each Fibonacci setup runs a lifecycle and fires at
  most once:
  `IDENTIFIED → FIB_ZONE_CREATED → PRICE_ENTERED_ZONE → WAITING_CONFIRMATION →
  TRADE_TRIGGERED → TP/SL → COMPLETED`, or `INVALIDATED` / expired.

## Exit rules

**Stop loss**
- `stopLossMode = "SWING"` — beyond the origin swing (below the swing low for
  longs, above the swing high for shorts), padded by `slBufferPercent`.
- `stopLossMode = "ZONE"` — beyond the fib zone edge instead.

**Take profit — multi-target system (default, `useMultiTarget: true`)**

Three targets can run simultaneously with partial exits:
- **TP1 — fixed RR**: `entry ± tp1RR × risk` (default 1:2).
- **TP2 — next liquidity**: the nearest confirmed pivot high above entry (long)
  / pivot low below entry (short) within `tp2LiquidityLookback` bars. If no
  valid level exists, **no fake target is invented** — TP2 is skipped and its
  allocation redistributed to the other targets.
- **TP3 — fib reference**: `tp3FibRatio` of the impulse (default `0` = swing
  origin / full-retrace target; set `0.7` for the literal 0.700 line — note that
  line *is* the entry zone, so it is rarely a useful target).

`targetMode` selects which targets are live (`ALL` | `RR` | `LIQUIDITY` | `FIB`
| `RR_LIQ` | `RR_FIB` | `LIQ_FIB`). Allocation defaults to **40/30/30**
(`tp1Percent/tp2Percent/tp3Percent`) and is normalised to 100% across the
targets that survive validation per trade. Resolution walks forward bar-by-bar:
the stop is checked **before** targets each bar (tie = worst case), targets fill
nearest-first, and the trade's R is the allocation-weighted blend.

**Break-even (`useBreakEven`)** — once TP1 fills, the stop moves to entry
(± `breakEvenBufferPercent`); trades stopped there are booked `breakeven`.

**Take profit — legacy single target (`useMultiTarget: false`)**
- `tpMode = "RR"` — `entry ± rrRatio × risk`.
- `tpMode = "SWING"` — the opposite origin swing (the impulse extreme).
- `tpMode = "FIB_EXT"` — a Fibonacci extension (`1.0`, `1.272`, `1.618`).

**Invalidation** — before a trade triggers, the setup is cancelled if price
breaks the origin swing (below the swing low for a long, above the swing high for
a short), or if it never triggers within `zoneExpiryBars`. A triggered setup is
also rejected if its stop is wider than `maxRiskPercent` of the entry price
(0 = off).

**Portfolio limits (applied chronologically across all pairs)**
- `maxActiveTrades` (default 1) — a new setup is skipped while that many trades
  are still running.
- `useMaxTradesPerDay` / `maxTradesPerDay` (default 3).
- `useMaxDailyLoss` / `maxDailyLossPercent` (default 3%) — measured in R × risk%.
- `useMaxConsecutiveLosses` / `maxConsecutiveLosses` (default 3) — resets on a
  win or a new day.

The API response reports `candidates` (all setups that confirmed) and `skipped`
(how many each limit rejected).

**Session filter (`sessionFilter`, UTC)** — `ALL` | `LONDON` (08–17) |
`NEWYORK` (13–22) | `LONDON_NY` | `CUSTOM` (`customSessionStart/End`, may wrap
past midnight). Confirmation outside the session does not trigger a trade.

## Fibonacci calculation

For a long with swing low `L` and swing high `H` (range `= H − L`):

```
fib(x)      = H − x·range          # retracement, x in [0,1]
zone top    = fib(0.700)           # higher price
zone bottom = fib(0.786)           # lower price
extension E = L + E·range          # 1.0 = H, 1.272, 1.618 ...
```

Shorts invert: `fib(x) = L + x·range`, extension `= H − E·range`.

## Swing detection (no repaint)

A pivot high at index `k` requires `pivotLeft` lower highs before it and
`pivotRight` lower highs after it (lows are the mirror). Because a pivot needs
`pivotRight` candles to its right, it is only **confirmed** at candle
`k + pivotRight` — the backtester does not "see" or act on it before then, so
confirmed swings never move historically.

## Confirmation engine

`bullish/bearishStructureBreak` (**the spec's mandatory confirmation**: candle
closes in the trade direction AND closes beyond the previous candle's
high/low), `bullish/bearishEngulfing`, `bullish/bearishRejection` (long dominant
wick, close in the far half), `bullish/bearishPinBar` (small body, one dominant
wick), `breakOfHigh` / `breakOfLow`. Combine with `_OR_`
(e.g. `ENGULFING_OR_STRUCTURE`) or use `ANY`. Set
`confirmationMode: "STRUCTURE"` for the strict spec behaviour;
`stopLossMode: "CANDLE"` places the stop beyond the confirmation candle itself
(the spec's §7 default).

## Risk calculation & position sizing

- Risk per trade = `riskPercent` of equity (default **1%**). No martingale —
  size never scales up after a loss.
- The equity curve compounds: each trade risks `riskPercent` of *current*
  equity; PnL in R is `reward/risk` on a win and `−1` on a loss.
- Displayed lot size = `riskAmount / (slPips × pipValuePerLot)` using the pair's
  `pipSize` / `contractSize` (FundingPips/MT5 convention), off **initial**
  capital for a stable per-row figure.

## Backtesting methodology

- Uses only **closed** candles (the forming candle is dropped — no repaint).
- Swing confirmation respects `pivotRight` (no lookahead).
- Confirmation reads only the current and previous candle.
- TP/SL resolution walks strictly forward from the entry candle; if a bar
  touches **both** stop and target, it is counted as a **loss** (worst case).
- **RR comparison** re-prices every triggered trade at `1:1.5 … 1:5` using the
  *same* entries and stops, then re-resolves — an apples-to-apples test of which
  RR would have performed best.

## Statistics reported

Total / winning / losing / open trades, win rate, profit factor, net profit
($ and %), net R, average R, expectancy, average win/loss (R), largest win/loss,
max drawdown ($ and %), max consecutive wins/losses, **TP1/TP2/TP3/SL hit
rates**, and a separate **LONG vs SHORT** breakdown.

### Month-wise breakdown (`stats.monthly`)

Every backtest also returns a per-calendar-month table, rendered as **Monthly
Performance** on the page. One row per month with: trades closed (plus any still
open), W/L/break-even counts, win rate, net R, net profit, **return %**, profit
factor, max drawdown, TP1/TP2/TP3/SL hit rates, and the equity the month closed
at. A totals row reconciles against the headline stats.

Two things worth knowing when reading it:

- **Months are bucketed on the IST clock** (UTC+5:30), the same clock as the
  `time` column in the trades table — so a trade at 20:00 UTC on 29 Feb lands in
  **March**.
- **Equity compounds across months.** Each month's `returnPct` is measured
  against the equity that month *opened* with, not against the initial capital,
  so the monthly percentages do not sum to the total return. `maxDrawdown` is
  measured *within* the month (the peak resets at each month boundary), so
  summing monthly drawdowns will not give the overall figure either.
- Win rate here counts **decided** trades only (break-evens excluded from the
  denominator).

Alongside the table: `monthsProfitable`, `monthsLosing`, `avgMonthlyReturnPct`,
`bestMonth`, and `worstMonth`.

To get a meaningful month-wise view, run with enough history — e.g. `days: 365`
on the `4h` or `1d` timeframe, or use an explicit `from`/`to` range.

## Configuration

All defaults live in `DEFAULT_CONFIG` (`lib/fibStrategy.js`) and every value is
overridable from the UI config panel or the API body:

```js
{
  fibUpper: 0.700, fibLower: 0.786,
  pivotLeft: 5, pivotRight: 5,
  minimumImpulsePercent: 1, minimumImpulseATR: 0,
  confirmationMode: "ENGULFING",          // + STRUCTURE | REJECTION | PINBAR | BREAK | ANY | *_OR_*
  entryMode: "close",                      // close | break
  stopLossMode: "SWING",                   // SWING | ZONE | CANDLE (confirmation candle)
  slBufferPercent: 0.1,
  tpMode: "RR",                            // legacy single-target: RR | SWING | FIB_EXT
  rrRatio: 2, fibExtension: 1.618,
  // multi-target system (default ON)
  useMultiTarget: true, targetMode: "ALL", // RR | LIQUIDITY | FIB | RR_LIQ | RR_FIB | LIQ_FIB | ALL
  tp1RR: 2, tp2LiquidityLookback: 60, tp3FibRatio: 0,
  tp1Percent: 40, tp2Percent: 30, tp3Percent: 30,
  useBreakEven: false, breakEvenBufferPercent: 0,
  maxRiskPercent: 0,                       // 0 = off
  // portfolio limits
  maxActiveTrades: 1,
  useMaxTradesPerDay: false, maxTradesPerDay: 3,
  useMaxDailyLoss: false, maxDailyLossPercent: 3,
  useMaxConsecutiveLosses: false, maxConsecutiveLosses: 3,
  // session (UTC)
  sessionFilter: "ALL",                    // LONDON | NEWYORK | LONDON_NY | CUSTOM
  customSessionStart: "00:00", customSessionEnd: "24:00",
  useTrendFilter: false, emaFast: 50, emaSlow: 200,
  useATRFilter: false, atrPeriod: 14, atrMin: 0, atrMax: 0,
  useMarketStructureFilter: false,
  allowLong: true, allowShort: true,
  riskPercent: 1, initialCapital: 10000, zoneExpiryBars: 150,
}
```

## Known limitations

- **Bar-level fills**, not tick-level: intrabar order of stop vs target is
  unknown, so ties are booked as losses (conservative). Slippage, spread, and
  commissions are **not** modelled.
- Entries/exits assume you can transact at the candle close (or exact break
  level) — real fills may differ.
- Runs on every pair in your store using the Binance data mirror; instruments
  without a feed are skipped and reported under `errors`.
- Optional filters (trend/ATR/market-structure) are intentionally simple; the
  market-structure check only inspects the two most recent confirmed pivots.
- No walk-forward optimisation or out-of-sample split is automated — vary the
  date range yourself and confirm any filter helps *out of sample* before
  trusting it (§25).

## How to use

1. Dashboard → **Fib 0.7–0.786**.
2. Pick a timeframe, history length, and confirmation/TP mode; hit **Run
   Backtest**.
3. Read the stats and the **RR comparison** table; click any trade for its
   TradingView / SVG chart with entry, stop, and target.
4. Only enable filters if they improve results *out of sample*. Start simple.
