# Candle-Reversal / First-Opposite-Candle Strategy

Double reversal-candle entry, exit on the **first opposite-colour candle after
continuation resumes**. Multi-timeframe backtester.

* Engine core: [lib/reversalStrategy.js](lib/reversalStrategy.js) — pure, dependency-free state machine
* Backtest / metrics / CSV: [lib/reversalBacktest.js](lib/reversalBacktest.js)
* Tests: `node lib/reversalStrategy.test.mjs`
* API: `POST /api/backtest-reversal`
* UI: `/backtest-reversal`

---

## 0. NOTE ON THE SCREENSHOT

**No chart screenshot arrived with the request** (the message referenced an
attachment but none was delivered to this session). Everything below is derived
from the written description in §1–§2 of the request, not from an image. The
interpretation is spelled out explicitly so you can correct it; every
subjective decision is a config key, not a hardcoded constant.

### How the described chart is interpreted (LONG)

```
            ┌─ 5. strong up move ──────────── 9. first RED after resume = EXIT
            │                            ▲   ▼
  1. down   │                         ███ │  ▒▒▒
     leg    │                      ███    │
   ▒▒▒      │                  ▒▒▒  ← 8. temporary pullback (1–2 red candles,
      ▒▒▒   │               ███         NOT an exit)
         ███ ← 2. first GREEN candle at the bottom
            ▒▒▒ ← 3. price dips again (new low)
              ███ ← 4. second GREEN candle near the bottom  → 6. ENTRY
              ───── stop below the lowest low of the pattern
```

The five things that had to be made objective, because a picture cannot define
them:

| Picture says | Engine rule | Config key |
|---|---|---|
| "price is moving downward" | close `legLookback` bars ago is above the current low by ≥ `minLegPercent` % | `legLookback`, `minLegPercent` |
| "at the bottom" (R1) | the candle's low is the lowest in the lookback window, within `bottomTolerancePercent` % | `bottomTolerancePercent` |
| "near the bottom" (R2) | the candle's low is inside the bottom `bottomZonePercentOfLeg` % **of the leg's own range**, measured up from the pattern low. A flat % of price cannot mean the same thing on a 0.5% range and a 5% range, and it made the engine reject real double bottoms whose second low sits a little above the first | `bottomZonePercentOfLeg` |
| "price moves down again" | a later candle prints a low strictly below the first reversal candle's low (or close) | `dipReference`, `maxBarsBetweenReversals`, `maxDipPercent` |
| "a temporary pullback" | see §3.3 — bounded by candle count and by retracement of the run | `maxPullbackCandles`, `maxPullbackRetracePercent` |
| "continuation resumes" | see §3.4 — four selectable objective definitions | `resumeMode`, `minResumePercent` |

SHORT is the exact mirror: every `low`→`high`, `min`→`max`, bullish→bearish.

---

## 1. Candle colour

* bullish: `close > open`
* bearish: `close < open`
* `close === open` (doji): `dojiPolicy` = `NEUTRAL` (default — neither, it
  cannot open a pattern and it cannot trigger an exit), `BULL`, or `BEAR`.

Optionally a candle only "counts" as a reversal candle if it has a real body:
`minBodyPercentOfRange` (body / high-low), default `0` = off.

---

## 2. State machine

States are explicit and exported as `STATES`:

```
SEEKING_REVERSAL
  └─ qualifying down-leg + candle at the bottom + bullish candle
FIRST_REVERSAL_CANDLE
  └─ a later candle dips below the first candle's low  (step 3)
WAITING_FOR_SECOND_REVERSAL_CANDLE
  └─ a bullish candle near the running pattern low     (step 4)
WAITING_FOR_DIRECTIONAL_CONFIRMATION
  └─ entry at that candle's close                      (step 6)
POSITION_OPEN            ← phase CONTINUATION
  ├─ an opposite candle prints → TEMPORARY_PULLBACK     (step 8, never an exit)
  ├─ resume condition met     → CONTINUATION_RESUMED    (step 9, arms the exit)
  └─ first opposite candle while armed → EXIT_ON_FIRST_OPPOSITE_CANDLE
CLOSED
```

A setup resets to `SEEKING_REVERSAL` on timeout (`maxBarsBetweenReversals`) or
on a too-deep dip (`maxDipPercent`).

### 2.1 No look-ahead, no repainting

* The machine is a single forward pass. On bar `i` it reads only bars `≤ i`.
* Entry fills at the close of the second reversal candle — a price known at
  that bar's close, never a later bar.
* An exit decision is made on bar `i`'s close and filled at `close[i]`
  (`exitFill: "CLOSE"`) or `open[i+1]` (`exitFill: "NEXT_OPEN"`).
* "Continuation resumed" is decided when the resume bar closes. It is never
  back-dated onto an earlier bar.
* Only fully-closed candles are fed to the engine; the forming candle is dropped.
* `tests` include an explicit prefix-invariance check: running the engine on
  `rows.slice(0, k)` produces exactly the same trades as running it on the full
  series, for every `k` — which is what "no look-ahead" means operationally.

---

## 3. Rules in detail

### 3.1 Entry

Always the **close of the second reversal candle**. There is no entry-mode or
swing-pivot setting: the signal bar has closed, so the price is known and the
fill needs no further confirmation step.

### 3.2 Stop loss

* Long: `patternLow × (1 − slBufferPercent/100)`
* Short: `patternHigh × (1 + slBufferPercent/100)`

`patternLow` = the lowest low from the first reversal candle through the second
("the confirmed reversal swing low").

Always-active emergency protections, independent of the candle logic:

* `emergencyStopPercent` — hard % stop from entry (`0` = off).
* `maxHoldBars` — force-close at that bar's close (`0` = off).

Intrabar ordering is conservative: on every bar the stop is checked **before**
the candle-colour logic, so a bar that both stops out and would have signalled
an exit books the stop.

### 3.3 Temporary pullback vs. structure break

Entering a pullback: any opposite-colour candle while in `CONTINUATION`.

It stays a *temporary* pullback — and will not close the trade — until either
of these bounds is exceeded:

* `maxPullbackCandles` (default `3`) opposite-colour candles inside the pullback;
* the pullback retraces more than `maxPullbackRetracePercent` (default `61.8`)
  of the move from entry to the pre-pullback swing extreme.

When a bound is exceeded the move is treated as a structure break, not a
pullback. `exitOnFailedContinuation` (default `true`) closes the trade there;
set it `false` to hold until the stop.

Same-colour candles inside a pullback do not end it — that is deliberate, it is
what lets "one or two red candles with a small green between them" stay a
single pullback.

### 3.4 Continuation resumed (`resumeMode`)

| Mode | Condition (long) |
|---|---|
| `NEW_HIGH` (default) | a bar's high exceeds the pre-pullback swing high |
| `CLOSE_ABOVE_PULLBACK_EXTREME` | a bullish bar closes above the highest high the pullback reached before this bar |
| `CLOSE_ABOVE_PRIOR_BAR` | a bullish bar closes above the previous bar's high |

Additionally the bar must have travelled `minResumePercent` % up from the
pullback low (default `0` = off).

The pre-pullback swing extreme only updates while the phase is `CONTINUATION`,
so it is a fixed reference for the whole pullback.

### 3.5 Exit

* `armAfterCycles` (default `1`) — how many pullback→resume cycles must complete
  before the first-opposite-candle exit is armed. `1` is the requested
  behaviour: a red candle during the *first* leg up is a pullback, not an exit.
  Set `0` to exit on the first opposite candle after entry.
* Once armed, the first opposite-colour candle closes the trade. The resume bar
  itself can never be the exit bar (the exit requires a bar strictly after the
  bar that armed it).
* `exitFill`: `CLOSE` (default) or `NEXT_OPEN`.

Exit reasons recorded per trade: `firstOpposite`, `stop`, `emergencyStop`,
`failedContinuation`, `maxHold`, `endOfData`.

---

### 3.1a Entry quality

Measured on real data, the single largest loss source is trades that stop out
before the pattern develops at all. Two filters test whether the second
reversal candle actually showed strength, using only that candle and R1:

* `minClosePositionPercent` (default `55`) — R2 must close in the top 55% of
  its own high-low range (mirrored for shorts). A bullish candle that closes
  near its low is not a reversal.
* `requireSecondStronger` (default off) — R2 must close beyond R1's close.
* `maxRiskPercent` (default `0` = off) — skip a setup whose stop would sit
  further than X% from entry.

## 4. Execution model

Applied by [lib/reversalBacktest.js](lib/reversalBacktest.js) on top of the raw
engine prices, so the signal logic stays price-pure:

```
long  entry fill = px × (1 + spreadPercent/200 + slippagePercent/100)
long  exit  fill = px × (1 − spreadPercent/200 − slippagePercent/100)
short mirrored
fee per side = |fill| × qty × feePercentPerSide/100
```

Defaults: `feePercentPerSide 0.04`, `spreadPercent 0.02`, `slippagePercent 0.01`.
Stop fills take the slippage too, so a stop-out loses slightly more than 1R —
which is the realistic case.

Sizing (`sizingMode`): `RISK_PERCENT` (default, `riskPercent` of *current*
equity per trade), `FIXED_RISK` (`fixedRiskAmount` cash), `FIXED_QTY`
(`fixedQty`), `FIXED_NOTIONAL` (`fixedNotional`).

---

## 4b. Session filter

`sessionFilter` uses the app-wide IST windows from [lib/sessions.js](lib/sessions.js),
so a filter always means the same thing as the session label in the trades
table: Sydney 02:30–05:30 · Tokyo 05:30–12:30 · London 12:30–17:30 ·
New York 17:30–02:30. Values: `ALL`, the four single sessions, the three
adjacent combos (`LONDON_NY` etc.), or `CUSTOM` with `customSessionStart` /
`customSessionEnd` in IST `HH:MM`. A trade is bucketed and filtered by its
**entry** time.

## 5. Instruments and timeframes

Any instrument configured on the dashboard can be backtested — including gold
(`PAXGUSDT.P`). Select several and the run produces one result per
**instrument × timeframe**, each with its own equity curve and sizing, so one
market's drawdown never distorts another's numbers.

### Timeframes

`1m 5m 10m 15m 1h 4h 1d`. Each is backtested independently and compared
side by side. `10m` is not an exchange interval, so it is built by aggregating
`5m` candles (2:1); aggregation is also used for CSV input at any timeframe.

Higher-timeframe trend confirmation (`htfTimeframe`, `htfMode`:
`NONE | CANDLE_COLOR | EMA`) is computed by aggregating the same base series
into HTF buckets and, for bar `i`, using only the last HTF bucket that **closed
at or before** `rows[i].ts`. A partially-formed HTF bar is never read, so the
filter adds no look-ahead.

---

## 6. CSV input

Headers are matched case-insensitively and flexibly:
`time|timestamp|date|datetime`, `open|o`, `high|h`, `low|l`, `close|c`,
`volume|vol|v`. Timestamps may be ms epoch, s epoch, or an ISO date string.

Validation reports (and the run refuses on `errors`):

* unparseable / missing timestamps, out-of-order rows
* duplicate timestamps
* missing candles (gaps that are exact multiples of the timeframe)
* OHLC violations: `high < low`, `high < max(open,close)`, `low > min(open,close)`,
  non-positive or non-finite prices

---

## 7. What the metrics mean

Computed only from closed trades, after fees, in `computeStats`:

`totalTrades · wins · losses · winRate · netProfit · netProfitPct ·
grossProfit · grossLoss · totalFees · profitFactor · expectancy (R) ·
expectancyMoney · avgWin · avgLoss · maxDrawdown · maxDrawdownPct ·
avgBarsHeld · avgHoldMinutes · maxConsecWins · maxConsecLosses`,
plus `equityCurve` and `drawdownCurve`.

### Breakdowns

`byMonth · byWeek · byDayOfWeek · bySession · byDirection · byExitReason ·
byPair` — all produced by the one `breakdown()` helper, so each reports the
same columns (`trades, wins, losses, winRate, netProfit, grossProfit,
grossLoss, fees, profitFactor, expectancy, avgBarsHeld, maxDrawdown`) and each
is covered by the same tests. `maxDrawdown` inside a bucket is measured on that
bucket's own run of trades, so the "Tue" row shows the worst run you would have
had trading Tuesdays only.

Buckets are on the IST clock: months `Jan 2024`, weeks keyed by their Monday,
weekdays Mon-first, sessions as in §4b. A trade falls in the bucket of its
**entry**.

## 8. Measured performance — read this before trusting it

Defaults were chosen by a **train/test sweep**, not by picking the best
in-sample numbers: BTC / ETH / PAXG × 15m / 1h / 4h, 180 days, chronologically
split two-thirds train and one-third held out. Configurations were ranked by
the *worse* of the two halves.

What the tuning actually bought (full 180 days, after fees, 9 pair×timeframe
runs):

| | old defaults | current defaults |
|---|---|---|
| trades | 2552 | 270 |
| win rate | 24.6% | **38.5%** |
| expectancy | −0.38 R | **−0.05 R** |
| avg net | −48.5% | −1.4% |
| avg max drawdown | 50.1% | **5.4%** |

**The strategy is approximately breakeven-to-slightly-negative after realistic
costs, and no parameter set tested was profitable on both halves — 0 of 252.**
Every configuration that looked strong in-sample (+0.5 to +0.76 R, 55–59% win
rate) collapsed on the held-out half (−0.21 to −0.35 R). That is curve-fitting,
and it is reported here rather than hidden.

The component that works is the exit. Broken out by exit reason:

| exit | trades | win rate | avg R |
|---|---|---|---|
| `firstOpposite` | 54 | **94.4%** | **+1.33** |
| `failedContinuation` | 99 | 53.5% | +0.35 |
| `stop` | 111 | 0% | −1.12 |

So the first-opposite-candle rule is excellent when the trade gets going; the
drag is the ~42% of setups that stop out before it ever does. Improving this
further means a better entry filter, not a better exit.

> Any number shown in the UI comes from an actual run over the candles you
> loaded. The UI labels a run `SAMPLE` only when it used the built-in synthetic
> fixture; live/CSV runs are labelled with the data source and bar count.
