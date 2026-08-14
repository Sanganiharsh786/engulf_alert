# Fib 0.70–0.786 Pullback Strategy — Pine Script v6

`fib_pullback_strategy.pine` is a standalone TradingView **`strategy()`** (not an
indicator) that trades the exact sequence:

```
IMPULSE → PULLBACK → 0.70–0.786 ZONE → REJECTION → CONFIRMATION CANDLE
        → STRUCTURE BREAK → ENTRY → SL → TP1 (RR) / TP2 (Liquidity) / TP3 (Fib)
```

It never treats "touch Fib = entry": price must reach the zone **and** produce a
confirmation candle that breaks the previous candle's structure before any order
is placed. Logic is fully symmetric for LONG and SHORT.

> Research tool, not financial advice. Use the backtester to decide whether the
> rules have a real edge on *your* market and timeframe.

---

## 1. How to add it to TradingView

1. Open TradingView → **Pine Editor** (bottom panel).
2. Paste the entire contents of `fib_pullback_strategy.pine`.
3. Click **Add to chart**. The strategy plots on the price chart (`overlay=true`).
4. Open the **Strategy Tester** tab for the performance report.
5. Click the gear ⚙️ next to the strategy name to open the grouped **Settings**.

---

## 2. Strategy logic (LONG; SHORT is the mirror)

1. **Impulse** — a confirmed swing **Low → High** (an up-move) whose size passes
   the impulse filter (`Minimum Impulse %` and/or `ATR multiple`).
2. **Fib zone** — measured from the swing Low (0.0) to the swing High (1.0). The
   entry band is between the **0.700** price (`High − 0.700·range`) and the
   **0.786** price (`High − 0.786·range`).
3. **Pullback** — price must trade back **down** into that band (`low ≤ 0.700 line`).
4. **Confirmation** — a bullish candle that **closes above the previous candle's
   high** (structure break). Configurable via *Confirmation Type*.
5. **Entry** — at the confirmation candle's **close** (default) or the **next
   candle's open**.
6. **Stop** — below the confirmation candle low (default) or below the origin
   swing, minus an optional buffer.
7. **Targets** — TP1 (RR), TP2 (liquidity), TP3 (Fib), taken partially.

SHORT inverts everything: impulse High → Low, pullback **up** into the zone,
bearish confirmation that closes below the previous low, stop above the
confirmation high.

**Invalidation** — a pending setup is canceled if price breaks the origin swing
(close below the swing low for a long / above the swing high for a short) or if
no entry occurs within *Zone Expiry* bars.

---

## 3. Every input (grouped exactly as in the Settings panel)

**Strategy** — `Enable Long`, `Enable Short`.

**Fibonacci** — `Fib Zone Start` (0.700), `Fib Zone End` (0.786); `Draw all Fib
levels` plus per-level toggles for 0.236 / 0.382 / 0.500 / 0.618.

**Swing** — `Pivot Left Bars`, `Pivot Right Bars` (swing sensitivity);
`Minimum Impulse Size %`, `Minimum Impulse ATR mult` (0 = off), `ATR Length`.

**Confirmation** — `Confirmation Type`:
- *Close + Break* (default): bullish/bearish body **and** breaks prior candle.
- *Close Only*: directional body that closes back inside the zone.
- *Break Only*: closes beyond the prior candle high/low regardless of body.

**Entry** — `Entry Mode`: *Confirmation Close* or *Next Candle Open*.

**Risk** — `Account Size`, `Risk Per Trade %` (position size is derived, never
hardcoded), `Stop Loss Basis` (*Confirmation Candle* / *Swing*), `SL Buffer %`,
`Max Risk %` (invalidate a setup whose stop is wider than this; 0 = off).

**Targets** — `Target Mode` (RR Only / Liquidity Only / Fib 0.700 Only / the
pairs / **All Targets**); `TP1 Risk:Reward`; `TP2 Liquidity Lookback`;
`TP3 Fib Ratio`; `TP1/TP2/TP3 Allocation %` (auto-normalized to 100% across the
targets that are actually active).

**Trade Management** — `Move SL to Break Even after TP1` + `Break Even Buffer %`;
`Zone Expiry`.

**Daily Limits** — `Max Trades Per Day`, `Max Daily Loss %`, `Max Consecutive
Losses` (each independently toggleable, all **off** by default).

**Session** — All / London / New York / London + New York / Custom, with a
timezone selector.

**Filters (optional, all off)** — EMA trend filter, volume-above-average filter.

**Alerts & Visuals** — enable alerts; draw zone / swings / labels; show the stats
table and the RR-comparison table.

---

## 4. Fibonacci calculation

For a long with swing low `L`, swing high `H`, `range = H − L`:

```
fib(x)     = H − x · range        # retracement price for ratio x
zone top    = H − 0.700 · range   # the 0.700 line (upper edge)
zone bottom = H − 0.786 · range   # the 0.786 line (lower edge)
```

Shorts use the same formula anchored on the swing high of the down-impulse; the
band is identical, only the trade direction differs.

---

## 5. Confirmation candle

Default (*Close + Break*):

- **Long:** `close > open` **and** `close > high[1]` while the setup has already
  tagged the zone (`low ≤ 0.700 line` on this or an earlier bar).
- **Short:** `close < open` **and** `close < low[1]` after price tagged the zone.

This is the "structure break + close confirmation" step — it is what separates a
real trade from a naked Fib touch.

---

## 6. Liquidity detection (TP2)

The script keeps a rolling store of the last confirmed pivot highs and lows.
At entry it searches, within `TP2 Liquidity Lookback` bars, for the **nearest**:

- pivot **high above** the entry (long), or
- pivot **low below** the entry (short).

That closest level becomes TP2. **If no valid level exists, TP2 is skipped** — no
fake target is invented, and its allocation is redistributed to the other TPs.

---

## 7. TP1 / TP2 / TP3

| Target | Basis | Price |
| ------ | ----- | ----- |
| **TP1** | Fixed Risk:Reward | `entry ± RR · risk` (default 1:2) |
| **TP2** | Next liquidity | nearest opposing pivot in trade direction |
| **TP3** | Fib reference | `TP3 Fib Ratio` of the swing (default 0.0 = swing origin) |

`Target Mode` selects which of the three are live; `TP1/2/3 Allocation %` sets the
partial-exit split (default 40 / 30 / 30) and is renormalized to 100% across only
the active, *valid* targets. A target is only used if it lies strictly beyond the
entry in the trade direction (invalid levels are dropped); at least one target
(TP1) is always guaranteed so every trade can exit.

> **Note on "TP3 = Fib 0.700":** geometrically the 0.700 line *is* the entry zone,
> so it is not a meaningful profit target. The script exposes `TP3 Fib Ratio` and
> defaults it to **0.0 (the swing origin / full-retrace target)**, which is the
> sensible read of "next Fib reference." Set it to `0.7` if you want the literal
> 0.700 line.

---

## 8. Position, risk & break-even

- **Position size** = `(Account Size × Risk %) / stop distance` — passed to
  `strategy.entry(qty=…)`. Nothing is hardcoded; it adapts to each stop.
- **Partial exits** use three `strategy.exit` orders sharing the current stop.
- **Break-even**: once TP1 is hit, the stop is moved to entry (± buffer).
- **Single position** (`pyramiding = 0`, `Max Active Trades = 1` by design).

---

## 9. Backtesting methodology & no-repaint guarantees

- **Swings** use `ta.pivothigh/low`, which only confirm `Pivot Right Bars` later —
  the strategy never acts on an unconfirmed pivot, so historical swings never move.
- **Confirmation** reads only the current and previous **closed** bars.
- **Entries** fill on bar close (`process_orders_on_close = true`); *Next Candle
  Open* defers the order by one bar.
- **No look-ahead:** nothing uses a future bar to decide a past entry.

**Known limitations (be honest with your results):**
- Fills are **bar-level**, not tick-level; the intrabar order of stop vs target is
  unknown. The stats counters resolve ties as **losses** (worst case). The
  TradingView engine itself uses its own tie handling, so engine PnL and the
  custom hit-rate counters can differ slightly.
- With `process_orders_on_close`, exit orders are first placed the bar **after**
  entry, so a gap immediately after entry is not stop-protected in the sim.
- Slippage, spread and commission are 0 by default — set them in the strategy
  properties for realism.

---

## 10. Statistics & RR comparison

Two on-chart tables (last bar only):

- **Stats table** — trades taken, win rate, net profit, profit factor, avg
  win/loss, max drawdown, and **TP1 / TP2 / TP3 / SL hit rates**. The full report
  (Sharpe, drawdown curve, trade list) is in TradingView's **Strategy Tester**.
- **RR comparison table** — an independent *shadow* simulation re-prices every
  real entry/stop at **1:1, 1:1.5, 1:2, 1:2.5, 1:3, 1:4, 1:5** and walks each
  forward (tie = loss), reporting trades, win rate and **expectancy in R** so you
  can see which RR actually fits this setup instead of assuming 1:2.

---

## 11. Alerts

- **Setup detected** — a valid impulse armed a 0.70–0.786 zone.
- **LONG / SHORT CONFIRMED** — includes `{{ticker}}` and entry price. Also exposed
  as `alertcondition`s so you can wire them in *Create Alert*.
- **TP1 / TP2 / TP3 reached** and **STOP LOSS HIT**.

---

## 12. Recommended starting settings

Keep it simple first; add filters only if they help **out of sample**.

| Input | Start with |
| ----- | ---------- |
| Pivot Left / Right | 5 / 5 |
| Minimum Impulse % | 1.0 (raise on lower timeframes) |
| Confirmation Type | Close + Break |
| Entry Mode | Confirmation Close |
| Stop Loss Basis | Confirmation Candle, buffer 0.05% |
| Target Mode | All Targets, TP1 RR = 2 |
| Allocation | 40 / 30 / 30 |
| Break Even | Off initially, then test On |
| Daily limits / session / trend / volume | Off initially |
| Risk Per Trade | 1% |

Timeframes: start on 1H–4H for crypto/indices, 15m–1H for FX. Backtest a
direction at a time (Enable Long / Short) to see which side carries the edge, then
vary RR using the comparison table before committing to a fixed target.
