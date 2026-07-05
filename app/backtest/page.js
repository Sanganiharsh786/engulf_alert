"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/backtest/spinner";
import { TradesCalendar } from "@/components/backtest/calendars";
import { TradesTable } from "@/components/backtest/trades-table";
import { TradeChartDialog } from "@/components/backtest/trade-chart-dialog";
import { NewsSection } from "@/components/backtest/news-section";
import { SessionBreakdown } from "@/components/backtest/session-breakdown";
import {
  IST_OFFSET_MS,
  SESSIONS,
  getTodayIST,
  monthLabel,
  sessionOf,
  summarize,
  summarizeByDay,
  summarizeByMonth,
  summarizeBySession,
} from "@/components/backtest/utils";
import { useToast } from "../toast";
import { cn } from "@/lib/utils";

const LOOKBACK_DAYS = 180; // ~6 months of history for the monthly breakdown

export default function Backtest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pairSel, setPairSel] = useState([]); // empty = all
  const [monthSel, setMonthSel] = useState(null); // "YYYY-MM" or null = all months
  const [daySel, setDaySel] = useState(null); // "YYYY-MM-DD" or null = all days
  const [sessionSel, setSessionSel] = useState([]); // session keys, empty = all sessions
  const [period, setPeriod] = useState("recent"); // "recent" | "today" | "2023" | "2024" | ...
  const [exclFrom, setExclFrom] = useState(""); // "HH:MM" IST — start of excluded window
  const [exclTo, setExclTo] = useState(""); // "HH:MM" IST — end of excluded window
  const [dnaOn, setDnaOn] = useState(true); // Signal DNA filter (only shown when trades carry DNA data)
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const toast = useToast();

  const toMin = (hm) => {
    if (!hm) return null;
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };
  const exclActive = exclFrom !== "" && exclTo !== "" && exclFrom !== exclTo;
  const inExcl = (t) => {
    const f = toMin(exclFrom);
    const tt = toMin(exclTo);
    const [h, m] = t.time.slice(11, 16).split(":").map(Number);
    const min = h * 60 + m;
    return f < tt ? min >= f && min < tt : min >= f || min < tt;
  };

  const nowYear = new Date().getUTCFullYear();
  const YEARS = [];
  for (let y = nowYear; y >= 2023; y--) YEARS.push(String(y));

  // IST boundaries of a calendar year, as UTC ms
  function yearRange(year) {
    const y = Number(year);
    return {
      from: Date.UTC(y, 0, 1) - IST_OFFSET_MS,
      to: Date.UTC(y + 1, 0, 1) - IST_OFFSET_MS - 1,
    };
  }

  async function run(sel = period, { notify = true } = {}) {
    setLoading(true);
    setError("");
    setMonthSel(null);
    setDaySel(null);
    setSessionSel([]);
    setShowCalendar(false);
    try {
      let body;
      if (sel === "recent") {
        body = { days: LOOKBACK_DAYS };
      } else if (sel === "today") {
        const today = getTodayIST();
        const todayStart = new Date(today + "T00:00:00.000Z").getTime() - IST_OFFSET_MS;
        const todayEnd = new Date(today + "T23:59:59.999Z").getTime() - IST_OFFSET_MS;
        body = { from: todayStart, to: todayEnd };
      } else if (sel === "last6months") {
        body = { days: 180 };
      } else {
        body = yearRange(sel);
      }

      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        toast(`Backtest failed · ${json.error}`, "error");
      } else {
        setData(json);
        if (notify) {
          const periodLabel =
            sel === "recent" ? "last 6 months" :
            sel === "today" ? "today" :
            sel === "last6months" ? "last 6 months" : sel;
          toast(`Backtest complete · ${json.trades.length} trades · ${periodLabel}`, "success");
        }
      }
    } catch (e) {
      setError(String(e.message || e));
      toast(`Backtest failed · ${e.message || e}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function pickPeriod(sel) {
    if (!sel) return;
    setPeriod(sel);
    run(sel);
  }

  useEffect(() => {
    run("recent", { notify: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPairs = useMemo(
    () => (data ? [...new Set(data.trades.map((t) => t.pair))] : []),
    [data]
  );

  // trades carry DNA fields only when the Signal DNA setting is enabled
  const hasDna = useMemo(
    () => !!data && data.trades.some((t) => t.dnaPass !== undefined),
    [data]
  );
  const dnaActive = hasDna && dnaOn;

  // trades narrowed by pair + excluded time-of-day window + DNA filter
  const pairFiltered = useMemo(() => {
    if (!data) return [];
    let rows = pairSel.length
      ? data.trades.filter((t) => pairSel.includes(t.pair))
      : data.trades;
    if (exclActive) rows = rows.filter((t) => !inExcl(t));
    if (dnaActive) rows = rows.filter((t) => t.dnaPass);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pairSel, exclActive, exclFrom, exclTo, dnaActive]);

  const months = useMemo(() => summarizeByMonth(pairFiltered), [pairFiltered]);

  const days = useMemo(() => {
    if (!monthSel) return [];
    const monthTrades = pairFiltered.filter((t) => t.time.slice(0, 7) === monthSel);
    return summarizeByDay(monthTrades);
  }, [pairFiltered, monthSel]);

  // trades within the selected pair + excl + month + day scope, before the
  // session filter is applied (so the session breakdown always shows every
  // session for the current date scope)
  const dateScoped = useMemo(() => {
    let result = pairFiltered;
    if (monthSel) result = result.filter((t) => t.time.slice(0, 7) === monthSel);
    if (daySel) result = result.filter((t) => t.time.slice(0, 10) === daySel);
    return result;
  }, [pairFiltered, monthSel, daySel]);

  const sessions = useMemo(() => summarizeBySession(dateScoped), [dateScoped]);

  const filtered = useMemo(() => {
    if (!sessionSel.length) return dateScoped;
    return dateScoped.filter((t) => sessionSel.includes(sessionOf(t.time)));
  }, [dateScoped, sessionSel]);

  const toggleSession = (key) =>
    setSessionSel((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const summaries = useMemo(() => summarize(filtered), [filtered]);

  // overall totals across the current filter selection
  const totals = useMemo(() => {
    let wins = 0, losses = 0, open = 0, closed = 0, netR = 0;
    for (const t of filtered) {
      if (t.outcome === "open") open++;
      else {
        closed++;
        if (t.outcome === "win") wins++;
        else if (t.outcome === "loss") losses++;
        netR += t.r;
      }
    }
    return {
      trades: filtered.length,
      wins,
      losses,
      open,
      closed,
      netR: Math.round(netR * 100) / 100,
      winRate: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
    };
  }, [filtered]);

  const exportUrl = useMemo(() => {
    const q = new URLSearchParams();
    if (pairSel.length) q.set("pairs", pairSel.join(","));
    if (daySel) {
      const dayStart = new Date(daySel + "T00:00:00.000Z").getTime() - IST_OFFSET_MS;
      const dayEnd = new Date(daySel + "T23:59:59.999Z").getTime() - IST_OFFSET_MS;
      q.set("from", String(dayStart));
      q.set("to", String(dayEnd));
    } else if (monthSel) {
      const [y, m] = monthSel.split("-").map(Number);
      q.set("from", String(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS));
      q.set("to", String(Date.UTC(y, m, 1) - IST_OFFSET_MS - 1));
    } else if (period === "today") {
      const today = getTodayIST();
      const todayStart = new Date(today + "T00:00:00.000Z").getTime() - IST_OFFSET_MS;
      const todayEnd = new Date(today + "T23:59:59.999Z").getTime() - IST_OFFSET_MS;
      q.set("from", String(todayStart));
      q.set("to", String(todayEnd));
    } else if (period === "last6months") {
      q.set("days", "180");
    } else if (period !== "recent") {
      const r = yearRange(period);
      q.set("from", String(r.from));
      q.set("to", String(r.to));
    } else {
      q.set("days", String(LOOKBACK_DAYS));
    }
    if (exclActive) {
      q.set("exclFrom", String(toMin(exclFrom)));
      q.set("exclTo", String(toMin(exclTo)));
    }
    if (dnaActive) q.set("dna", "1");
    return "/api/backtest/export?" + q.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSel, monthSel, daySel, period, exclActive, exclFrom, exclTo, dnaActive]);

  const hasActiveFilters =
    pairSel.length > 0 || monthSel || daySel || exclActive || sessionSel.length > 0;

  const reset = () => {
    setPairSel([]);
    setMonthSel(null);
    setDaySel(null);
    setSessionSel([]);
    setShowCalendar(false);
    setExclFrom("");
    setExclTo("");
  };

  const sessionSelLabel = sessionSel
    .map((k) => SESSIONS.find((s) => s.key === k)?.label)
    .filter(Boolean)
    .join(", ");

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-balance">Backtest results</h1>
          <p className="text-xs text-muted-foreground">
            Engulfing-at-level setups · history fetched per timeframe · times in IST (UTC+5:30)
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="outline" size="sm" asChild>
            <a href="/">
              <ArrowLeft />
              Dashboard
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => run()} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            {loading ? "Running…" : "Re-run"}
          </Button>
          <Button size="sm" asChild>
            <a href={exportUrl} onClick={() => toast("Preparing Excel export…", "info")}>
              <Download />
              Export Excel
            </a>
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* filters */}
      <Card className="mt-5">
        <CardContent className="flex flex-col gap-4 p-4">
          {/* period */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Period</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={period}
              onValueChange={pickPeriod}
              disabled={loading}
              className="flex-wrap justify-start"
            >
              <ToggleGroupItem value="today">Today</ToggleGroupItem>
              <ToggleGroupItem value="last6months">Last 6 months</ToggleGroupItem>
              <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
              {YEARS.map((y) => (
                <ToggleGroupItem key={y} value={y}>
                  {y}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* pairs */}
          {data && allPairs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Pairs {pairSel.length === 0 && <span className="normal-case">(all included)</span>}
              </Label>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                value={pairSel}
                onValueChange={setPairSel}
                className="flex-wrap justify-start"
              >
                {allPairs.map((p) => (
                  <ToggleGroupItem key={p} value={p}>
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {/* exclude time-of-day window */}
          {data && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Exclude time window (IST)
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  value={exclFrom}
                  onChange={(e) => setExclFrom(e.target.value)}
                  className="h-9 w-32"
                  aria-label="Exclude from time"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={exclTo}
                  onChange={(e) => setExclTo(e.target.value)}
                  className="h-9 w-32"
                  aria-label="Exclude to time"
                />
                {exclActive ? (
                  <>
                    <span className="text-xs text-bear">
                      removing trades {exclFrom}–{exclTo}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setExclFrom("");
                        setExclTo("");
                      }}
                    >
                      <X />
                      Clear
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    set both times to drop trades opened in that window
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Signal DNA filter (only when trades carry DNA data) */}
          {data && hasDna && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Signal DNA
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={dnaOn ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDnaOn((v) => !v)}
                  aria-pressed={dnaOn}
                >
                  {dnaOn ? "DNA filter on" : "DNA filter off"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {dnaOn
                    ? "showing only trades whose fingerprint matched earlier winners (walk-forward)"
                    : "showing all trades — toggle to keep only DNA-matched winners"}
                </span>
              </div>
            </div>
          )}

          {/* active filter summary + reset */}
          {data && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Showing {filtered.length} of {data.trades.length} trades
                  {daySel && ` · ${daySel}`}
                  {monthSel && !daySel && ` · ${monthLabel(monthSel)}`}
                  {sessionSel.length > 0 && ` · ${sessionSelLabel} session`}
                  {dnaActive && " · DNA-matched only"}
                </span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw />
                    Reset all filters
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* loading state */}
      {loading && !data && (
        <div className="mt-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Running backtest…
          </div>
        </div>
      )}

      {data && (
        <>
          {/* overall totals strip */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <OverallStat label="Trades" value={totals.trades} />
            <OverallStat
              label="Win rate"
              value={`${totals.winRate}%`}
              cls={totals.winRate >= 50 ? "text-bull" : "text-bear"}
            />
            <OverallStat label="Wins" value={totals.wins} cls="text-bull" />
            <OverallStat label="Losses" value={totals.losses} cls="text-bear" />
            <OverallStat
              label="Net R"
              value={totals.netR > 0 ? `+${totals.netR}` : totals.netR}
              cls={totals.netR >= 0 ? "text-bull" : "text-bear"}
            />
            <OverallStat label="Still open" value={totals.open} cls="text-muted-foreground" />
          </div>

          {/* session performance breakdown */}
          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Performance by session (IST){" "}
                {sessionSel.length > 0
                  ? "· click again to clear"
                  : "· click a session to filter"}
              </span>
              {sessionSel.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSessionSel([])}>
                  <X />
                  Clear session
                </Button>
              )}
            </div>
            <SessionBreakdown
              sessions={sessions}
              selected={sessionSel}
              onToggle={toggleSession}
              onSelectCombo={setSessionSel}
            />
          </div>

          {/* monthly win rate breakdown */}
          {months.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Win rate by month{monthSel ? " · click again to clear" : " · click a month to filter"}
                </span>
                {monthSel && (
                  <Button variant="outline" size="sm" onClick={() => setShowCalendar(!showCalendar)}>
                    <CalendarDays />
                    {showCalendar ? "Hide" : "Show"} calendar
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {months.map((m) => {
                  const active = monthSel === m.key;
                  return (
                    <button
                      key={m.key}
                      onClick={() => {
                        if (active) {
                          setMonthSel(null);
                          setDaySel(null);
                          setShowCalendar(false);
                        } else {
                          setMonthSel(m.key);
                          setDaySel(null);
                        }
                      }}
                      aria-pressed={active}
                      className={cn(
                        "rounded-lg border p-3 text-left transition",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{m.label}</span>
                        <span className="text-[10px] text-muted-foreground">{m.signals} sig</span>
                      </div>
                      <div className="mt-1 flex items-end gap-2">
                        <span className={cn("text-2xl font-bold", m.winRate >= 50 ? "text-bull" : "text-bear")}>
                          {m.winRate}%
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] tnum">
                        <span className="text-bull">{m.wins}W</span>{" "}
                        <span className="text-bear">{m.losses}L</span>{" "}
                        <span className={m.netR >= 0 ? "text-bull" : "text-bear"}>· {m.netR}R</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* daily calendar view */}
          {monthSel && showCalendar && (
            <div className="mt-5">
              <div className="mb-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                Daily breakdown for {monthLabel(monthSel)} · click a day to filter
              </div>
              <TradesCalendar
                monthKey={monthSel}
                days={days}
                selectedDay={daySel}
                onDayClick={(day) => setDaySel(daySel === day ? null : day)}
              />
            </div>
          )}

          {/* per-pair summary cards */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{s.pair}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {s.signals} signals
                    </span>
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className={cn("text-3xl font-bold", s.winRate >= 50 ? "text-bull" : "text-bear")}>
                      {s.winRate}%
                    </span>
                    <span className="mb-1 text-xs text-muted-foreground">win rate</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <PairStat label="Wins" value={s.wins} cls="text-bull" />
                    <PairStat label="Losses" value={s.losses} cls="text-bear" />
                    <PairStat label="Net R" value={s.netR} cls={s.netR >= 0 ? "text-bull" : "text-bear"} />
                  </div>
                  <div className="mt-2 text-center text-[10px] text-muted-foreground">
                    {s.closed} closed · {s.open} still open
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* trades table */}
          <div className="mt-6">
            <TradesTable trades={filtered} onTradeClick={setSelectedTrade} />
          </div>

          {/* news candle analysis */}
          <Separator className="mt-10" />
          <div className="mt-8">
            <NewsSection />
          </div>
        </>
      )}

      {/* trade chart dialog — closes on outside click / Escape */}
      <TradeChartDialog trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
    </main>
  );
}

function OverallStat({ label, value, cls = "" }) {
  return (
    <Card>
      <CardContent className="p-3 text-center sm:p-4">
        <div className={cn("text-xl font-bold sm:text-2xl", cls)}>{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function PairStat({ label, value, cls }) {
  return (
    <div className="rounded-md border border-border bg-popover py-1.5">
      <div className={cn("font-bold", cls)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
