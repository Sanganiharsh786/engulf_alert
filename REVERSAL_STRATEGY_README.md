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
| "price is moving downward" | close `legLookback` bars ago is above the current low by ≥ `minLegPercent` % and/or ≥ `minLegATR` × ATR | `legMode`, `legLookback`, `minLegPercent`, `minLegATR` |
| "at the bottom" | the candle's low is within `bottomTolerancePercent` % of the lowest low in the lookback window | `bottomTolerancePercent` |
| "price moves down again" | a later candle prints a low strictly below the first reversal candle's low (or close) | `dipReference`, `maxBarsBetweenReversals`, `maxDipPercent` |
| "a temporary pullback" | see §3.3 — bounded by candle count and by retracement of the run | `maxPullbackCandles`, `maxPullbackRetracePercent` |
| "continuation resumes" | see §3.4 — four selectable objective definitions | `resumeMode`, `minResumePercent`, `minResumeATR` |

SHORT is the exact mirror: every `low`→`high`, `min`→`max`, bullish→bearish.

---

## 1. Candle colour

* bullish: `close > open`
* bearish: `close < open`
* `close === open` (doji): `dojiPolicy` = `NEUTRAL` (default — neither, it
  cannot open a pattern and it cannot trigger an exit), `BULL`, or `BEAR`.

Optionally a candle only "counts" as a reversal candle if it has a real body:
`minBodyATR` (× ATR) and `minBodyPercentOfRange` (body / high-low). Both default
to `0` = off.

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
  └─ entryMode satisfied                               (step 6)
POSITION_OPEN            ← phase CONTINUATION
  ├─ an opposite candle prints → TEMPORARY_PULLBACK     (step 8, never an exit)
  ├─ resume condition met     → CONTINUATION_RESUMED    (step 9, arms the exit)
  └─ first opposite candle while armed → EXIT_ON_FIRST_OPPOSITE_CANDLE
CLOSED
```

A setup resets to `SEEKING_REVERSAL` on timeout (`maxBarsBetweenReversals`,
`confirmationExpiryBars`), on a too-deep dip (`maxDipPercent`), or when price
breaks the pattern low before entry.

### 2.1 No look-ahead, no repainting

* The machine is a single forward pass. On bar `i` it reads only bars `≤ i`.
* A swing pivot at index `p` is only visible from bar `p + pivotRight`
  onwards (`SWING_HIGH_BREAK` entry mode uses this). Pivots never repaint.
* Entry on `SECOND_CANDLE_CLOSE` fills at the close of the bar that triggered
  it — a price known at that bar's close, never a later bar.
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

### 3.1 Entry (`entryMode`)

| Mode | Fill |
|---|---|
| `SECOND_CANDLE_CLOSE` (default) | close of the second reversal candle |
| `SECOND_CANDLE_HIGH_BREAK` | stop order at the second reversal candle's high / low; fills on the first later bar whose high/low reaches it |
| `SWING_HIGH_BREAK` | stop order at the most recent *confirmed* swing high / low above entry; same fill rule |

Break modes expire after `confirmationExpiryBars` and are cancelled if price
first takes out the pattern low (long) / high (short).

### 3.2 Stop loss

* Long: `patternLow × (1 − slBufferPercent/100) − atrStopMultiple × ATR`
* Short: `patternHigh × (1 + slBufferPercent/100) + atrStopMultiple × ATR`

`patternLow` = the lowest low from the first reversal candle through the second
("the confirmed reversal swing low"). `atrStopMultiple` defaults to `0`.

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
| `BULL_CLOSE_ABOVE_PULLBACK_HIGH` | a bullish bar closes above the highest high of the pullback |
| `BULL_CLOSE_ABOVE_PRIOR_HIGH` | a bullish bar closes above the previous bar's high |
| `N_BULL_CANDLES` | `resumeBullCandles` consecutive bullish bars, each closing above the previous close |

Additionally the bar must have travelled `minResumePercent` % and/or
`minResumeATR` × ATR up from the pullback low (both default `0` = off).

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

## 5. Timeframes

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
plus `equityCurve`, `drawdownCurve`, and breakdowns by direction and by
exit reason.

> Any number shown in the UI comes from an actual run over the candles you
> loaded. The UI labels a run `SAMPLE` only when it used the built-in synthetic
> fixture; live/CSV runs are labelled with the data source and bar count.
