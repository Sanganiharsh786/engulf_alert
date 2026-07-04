"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../toast";

const fmt = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function summarize(trades) {
  const byPair = {};
  for (const t of trades) {
    const s = (byPair[t.pair] = byPair[t.pair] || {
      pair: t.pair, signals: 0, closed: 0, wins: 0, losses: 0, open: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome === "open") s.open++;
    else {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byPair).map((s) => ({
    ...s,
    netR: Math.round(s.netR * 100) / 100,
    winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
  }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// win rate per IST calendar month ("YYYY-MM" from the trade's IST time)
function summarizeByMonth(trades) {
  const byMonth = {};
  for (const t of trades) {
    const key = t.time.slice(0, 7); // "YYYY-MM" in IST
    const s = (byMonth[key] = byMonth[key] || {
      key, signals: 0, closed: 0, wins: 0, losses: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome !== "open") {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byMonth)
    .sort((a, b) => (a.key < b.key ? 1 : -1)) // newest first
    .map((s) => ({
      ...s,
      label: monthLabel(s.key),
      netR: Math.round(s.netR * 100) / 100,
      winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    }));
}

// win rate per IST calendar day ("YYYY-MM-DD" from the trade's IST time)
function summarizeByDay(trades) {
  const byDay = {};
  for (const t of trades) {
    const key = t.time.slice(0, 10); // "YYYY-MM-DD" in IST
    const s = (byDay[key] = byDay[key] || {
      key, date: key, signals: 0, closed: 0, wins: 0, losses: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome !== "open") {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byDay)
    .sort((a, b) => (a.key < b.key ? -1 : 1)) // oldest first for calendar display
    .map((s) => ({
      ...s,
      netR: Math.round(s.netR * 100) / 100,
      winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    }));
}

// get today's date in IST format
function getTodayIST() {
  const now = new Date();
  const istTime = new Date(now.getTime() + IST_OFFSET_MS);
  return istTime.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export default function Backtest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pairSel, setPairSel] = useState([]); // empty = all
  const [monthSel, setMonthSel] = useState(null); // "YYYY-MM" or null = all months
  const [daySel, setDaySel] = useState(null); // "YYYY-MM-DD" or null = all days
  const [period, setPeriod] = useState("recent"); // "recent" | "today" | "2023" | "2024" | ...
  const [exclFrom, setExclFrom] = useState(""); // "HH:MM" IST — start of excluded window
  const [exclTo, setExclTo] = useState(""); // "HH:MM" IST — end of excluded window
  const [showCalendar, setShowCalendar] = useState(false); // toggle calendar view
  const [hoveredTrade, setHoveredTrade] = useState(null); // for chart preview

  // News candle analysis state
  const [newsEvents, setNewsEvents] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");
  const [newsTypes, setNewsTypes] = useState(["NFP", "FOMC", "CPI"]);
  const [newsYearFrom, setNewsYearFrom] = useState("2023");
  const [newsYearTo, setNewsYearTo] = useState("2025");
  const [selectedNewsEvent, setSelectedNewsEvent] = useState(null);
  const [newsMonthSel, setNewsMonthSel] = useState(null); // "YYYY-MM" or null — for calendar view
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

  const LOOKBACK_DAYS = 180; // ~6 months of history for the monthly breakdown
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
        body = { days: 180 }; // approximately 6 months
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
          let periodLabel = sel === "recent" ? "last 6 months" :
                           sel === "today" ? "today" :
                           sel === "last6months" ? "last 6 months" : sel;
          toast(
            `Backtest complete · ${json.trades.length} trades · ${periodLabel}`,
            "success"
          );
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

  // trades narrowed by pair + excluded time-of-day window — feeds the monthly
  // breakdown (so removed trades drop out of the win rates too)
  const pairFiltered = useMemo(() => {
    if (!data) return [];
    let rows = pairSel.length
      ? data.trades.filter((t) => pairSel.includes(t.pair))
      : data.trades;
    if (exclActive) rows = rows.filter((t) => !inExcl(t));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pairSel, exclActive, exclFrom, exclTo]);

  const months = useMemo(() => summarizeByMonth(pairFiltered), [pairFiltered]);

  // daily breakdown for calendar view (only when a month is selected)
  const days = useMemo(() => {
    if (!monthSel) return [];
    const monthTrades = pairFiltered.filter((t) => t.time.slice(0, 7) === monthSel);
    return summarizeByDay(monthTrades);
  }, [pairFiltered, monthSel]);

  // trades for the table/cards — pair + selected month + selected day
  const filtered = useMemo(() => {
    let result = pairFiltered;
    if (monthSel) {
      result = result.filter((t) => t.time.slice(0, 7) === monthSel);
    }
    if (daySel) {
      result = result.filter((t) => t.time.slice(0, 10) === daySel);
    }
    return result;
  }, [pairFiltered, monthSel, daySel]);

  const summaries = useMemo(() => summarize(filtered), [filtered]);

  const togglePair = (p) =>
    setPairSel((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

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
    return "/api/backtest/export?" + q.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSel, monthSel, daySel, period, exclActive, exclFrom, exclTo]);

  const reset = () => {
    setPairSel([]);
    setMonthSel(null);
    setDaySel(null);
    setShowCalendar(false);
  };

  /* ---------- News Candle Analysis ---------- */

  async function fetchNewsCandles() {
    setNewsLoading(true);
    setNewsError("");
    setNewsEvents(null);
    try {
      const res = await fetch("/api/news-candles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsTypes,
          fromYear: Number(newsYearFrom),
          toYear: Number(newsYearTo),
          limit: 60,
        }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const json = await res.json();
      if (json.error) {
        setNewsError(json.error);
        toast(`News analysis failed · ${json.error}`, "error");
      } else {
        setNewsEvents(json.events);
        toast(`Found ${json.returned} news events`, "success");
      }
    } catch (e) {
      setNewsError(String(e.message || e));
      toast(`News analysis failed · ${e.message || e}`, "error");
    } finally {
      setNewsLoading(false);
    }
  }

  /* ---------- News events grouped by month / day for calendar ---------- */

  const newsMonths = useMemo(() => {
    if (!newsEvents) return [];
    const s = new Set();
    for (const ev of newsEvents) {
      const d = new Date(ev.ts);
      const ist = new Date(d.getTime() + IST_OFFSET_MS);
      s.add(ist.toISOString().slice(0, 7)); // "YYYY-MM"
    }
    return [...s].sort();
  }, [newsEvents]);

  /** Map day→events[] for the selected month */
  const newsDayMap = useMemo(() => {
    if (!newsEvents || !newsMonthSel) return {};
    const map = {};
    for (const ev of newsEvents) {
      const d = new Date(ev.ts);
      const ist = new Date(d.getTime() + IST_OFFSET_MS);
      const day = ist.toISOString().slice(0, 10);
      if (day.startsWith(newsMonthSel)) {
        if (!map[day]) map[day] = [];
        map[day].push(ev);
      }
    }
    return map;
  }, [newsEvents, newsMonthSel]);

  // toggle a news type in the filter
  function toggleNewsType(t) {
    setNewsTypes((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <header className="flex flex-wrap items-center gap-3 justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Backtest results</h1>
          <p className="text-xs text-muted">
            Engulfing-at-level setups · history fetched per timeframe · times in IST (UTC+5:30)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-panel/70 transition">
            ← Dashboard
          </a>
          <button
            onClick={() => run()}
            disabled={loading}
            className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-panel/70 transition disabled:opacity-50"
          >
            {loading ? "Running…" : "Re-run"}
          </button>
          <a
            href={exportUrl}
            onClick={() => toast("Preparing Excel export…", "info")}
            className="text-xs px-3 py-2 rounded-md bg-bull text-white font-medium hover:brightness-110 transition"
          >
            ⬇ Export Excel
          </a>
        </div>
      </header>

      {error && (
        <div className="mt-5 text-sm text-bear bg-bear/10 border border-bear/30 rounded-md px-4 py-3">
          {error}
        </div>
      )}

      {/* period / year selector */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Period</span>
        <button
          onClick={() => pickPeriod("today")}
          disabled={loading}
          className={`text-xs px-3 py-1.5 rounded-md border transition disabled:opacity-50 ${
            period === "today"
              ? "border-accent bg-accent/15 text-accent font-medium"
              : "border-border bg-panel2 text-muted hover:border-accent/40"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => pickPeriod("last6months")}
          disabled={loading}
          className={`text-xs px-3 py-1.5 rounded-md border transition disabled:opacity-50 ${
            period === "last6months"
              ? "border-accent bg-accent/15 text-accent font-medium"
              : "border-border bg-panel2 text-muted hover:border-accent/40"
          }`}
        >
          Last 6 months
        </button>
        <button
          onClick={() => pickPeriod("recent")}
          disabled={loading}
          className={`text-xs px-3 py-1.5 rounded-md border transition disabled:opacity-50 ${
            period === "recent"
              ? "border-accent bg-accent/15 text-accent font-medium"
              : "border-border bg-panel2 text-muted hover:border-accent/40"
          }`}
        >
          Recent
        </button>
        {YEARS.map((y) => (
          <button
            key={y}
            onClick={() => pickPeriod(y)}
            disabled={loading}
            className={`text-xs px-3 py-1.5 rounded-md border transition disabled:opacity-50 ${
              period === y
                ? "border-accent bg-accent/15 text-accent font-medium"
                : "border-border bg-panel2 text-muted hover:border-accent/40"
            }`}
          >
            {y}
          </button>
        ))}
        {loading && <span className="text-[11px] text-muted">fetching history…</span>}
      </div>

      {/* pair filter */}
      {data && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Pairs</span>
          {allPairs.map((p) => (
            <button
              key={p}
              onClick={() => togglePair(p)}
              className={`text-xs px-2.5 py-1.5 rounded-md border transition ${
                pairSel.includes(p)
                  ? "border-accent bg-accent/15 text-accent font-medium"
                  : "border-border bg-panel2 text-muted hover:border-accent/40"
              }`}
              title={pairSel.length === 0 ? "all pairs included" : ""}
            >
              {p}
            </button>
          ))}
          {(pairSel.length > 0 || monthSel || daySel) && (
            <button
              onClick={reset}
              className="text-xs px-3 py-1.5 rounded-md border border-border bg-panel2 text-muted hover:text-ink transition"
            >
              Reset
            </button>
          )}
          <span className="text-[11px] text-muted ml-auto">
            {filtered.length} of {data.trades.length} trades
            {daySel && ` · ${daySel}`}
            {monthSel && !daySel && ` · ${monthLabel(monthSel)}`}
          </span>
        </div>
      )}

      {/* exclude time-of-day window */}
      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Exclude time (IST)</span>
          <input
            type="time"
            value={exclFrom}
            onChange={(e) => setExclFrom(e.target.value)}
            className="bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
          />
          <span className="text-muted text-xs">to</span>
          <input
            type="time"
            value={exclTo}
            onChange={(e) => setExclTo(e.target.value)}
            className="bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
          />
          {exclActive ? (
            <>
              <span className="text-[11px] text-bear">
                removing trades {exclFrom}–{exclTo}
              </span>
              <button
                onClick={() => { setExclFrom(""); setExclTo(""); }}
                className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-panel2 text-muted hover:text-ink transition"
              >
                Clear
              </button>
            </>
          ) : (
            <span className="text-[11px] text-muted">
              set both times to drop trades opened in that window (e.g. 00:00–06:00)
            </span>
          )}
        </div>
      )}

      {/* monthly win rate breakdown */}
      {data && months.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wide text-muted">
              Win rate by month{monthSel ? " · click again to clear" : " · click a month to filter"}
            </div>
            {monthSel && (
              <button
                onClick={() => setShowCalendar(!showCalendar)}
                className="text-xs px-3 py-1.5 rounded-md border border-border bg-panel2 text-muted hover:text-ink transition"
              >
                {showCalendar ? "Hide" : "Show"} Calendar
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
                      setShowCalendar(false);
                    }
                  }}
                  className={`text-left rounded-lg border p-3 transition ${
                    active
                      ? "border-accent bg-accent/10"
                      : "border-border bg-panel hover:border-accent/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted">{m.signals} sig</span>
                  </div>
                  <div className="mt-1 flex items-end gap-2">
                    <span className={`text-2xl font-bold ${m.winRate >= 50 ? "text-bull" : "text-bear"}`}>
                      {m.winRate}%
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono">
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
          <div className="text-[10px] uppercase tracking-wide text-muted mb-3">
            Daily breakdown for {monthLabel(monthSel)} · click a day to filter
          </div>
          <Calendar
            monthKey={monthSel}
            days={days}
            selectedDay={daySel}
            onDayClick={(day) => setDaySel(daySel === day ? null : day)}
          />
        </div>
      )}

      {/* Chart Modal */}
      {hoveredTrade && (
        <HoverChart
          trade={hoveredTrade}
          onClose={() => setHoveredTrade(null)}
        />
      )}

      {loading && !data && (
        <div className="mt-10 text-center text-muted text-sm">Running backtest…</div>
      )}

      {data && (
        <>
          {/* per-pair summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
            {summaries.length === 0 && (
              <div className="col-span-full text-center text-muted text-sm py-6">
                No trades match the current filters.
              </div>
            )}
            {summaries.map((s, i) => (
              <div key={i} className="rounded-lg border border-border bg-panel p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{s.pair}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted">{s.signals} signals</span>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <span className={`text-3xl font-bold ${s.winRate >= 50 ? "text-bull" : "text-bear"}`}>
                    {s.winRate}%
                  </span>
                  <span className="text-xs text-muted mb-1">win rate</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <Stat label="Wins" value={s.wins} cls="text-bull" />
                  <Stat label="Losses" value={s.losses} cls="text-bear" />
                  <Stat label="Net R" value={s.netR} cls={s.netR >= 0 ? "text-bull" : "text-bear"} />
                </div>
                <div className="mt-2 text-[10px] text-muted text-center">
                  {s.closed} closed · {s.open} still open
                </div>
              </div>
            ))}
          </div>

          {/* trades table */}
          <div className="mt-6 rounded-lg border border-border bg-panel overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted flex items-center justify-between">
              <span>Trades ({filtered.length})</span>
              <span className="text-accent text-[10px] normal-case">💡 Click any row to view chart</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    {["Date/Time IST", "Day", "Pair", "Dir", "Level", "Entry", "Stop", "TP", "SL pips", "Lots", "Outcome", "Bars", "R"].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono tnum">
                  {filtered.map((t, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-panel2 cursor-pointer transition-colors"
                      onClick={() => setHoveredTrade(t)}
                      title="Click to view chart"
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap">{t.time}</td>
                      <td className="px-3 py-1.5">{t.day}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{t.pair}</td>
                      <td className={`px-3 py-1.5 ${t.direction === "bullish" ? "text-bull" : "text-bear"}`}>{t.direction === "bullish" ? "BULL" : "BEAR"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{t.level}</td>
                      <td className="px-3 py-1.5">{fmt(t.entry)}</td>
                      <td className="px-3 py-1.5 text-bear">{fmt(t.stop)}</td>
                      <td className="px-3 py-1.5 text-bull">{fmt(t.tp)}</td>
                      <td className="px-3 py-1.5">{t.slPips}</td>
                      <td className="px-3 py-1.5 text-accent">{t.lots ?? ""}</td>
                      <td className={`px-3 py-1.5 font-bold ${t.outcome === "win" ? "text-bull" : t.outcome === "loss" ? "text-bear" : "text-muted"}`}>
                        {t.outcome.toUpperCase()}
                      </td>
                      <td className="px-3 py-1.5">{t.barsHeld}</td>
                      <td className={`px-3 py-1.5 ${t.r > 0 ? "text-bull" : t.r < 0 ? "text-bear" : "text-muted"}`}>{t.r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- News Candle Analysis ---- */}
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="text-base font-bold tracking-tight mb-1">📰 News Candle Analysis</h2>
            <p className="text-xs text-muted mb-5">
              1m candle reaction at NFP, FOMC &amp; CPI releases · gold &amp; BTC · times in IST
            </p>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Events</span>
              {["NFP","FOMC","CPI"].map((t) => (
                <button
                  key={t}
                  onClick={() => toggleNewsType(t)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition ${
                    newsTypes.includes(t)
                      ? "border-accent bg-accent/15 text-accent font-medium"
                      : "border-border bg-panel2 text-muted hover:border-accent/40"
                  }`}
                >
                  {t}
                </button>
              ))}
              <span className="text-[10px] uppercase tracking-wide text-muted ml-2 mr-1">From</span>
              <select
                value={newsYearFrom}
                onChange={(e) => setNewsYearFrom(e.target.value)}
                className="bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
              >
                {[2022,2023,2024,2025,2026].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-muted text-xs">to</span>
              <select
                value={newsYearTo}
                onChange={(e) => setNewsYearTo(e.target.value)}
                className="bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
              >
                {[2022,2023,2024,2025,2026].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                onClick={fetchNewsCandles}
                disabled={newsLoading || newsTypes.length === 0}
                className="text-xs px-4 py-1.5 rounded-md bg-accent text-white font-medium hover:brightness-110 transition disabled:opacity-50"
              >
                {newsLoading ? "Fetching…" : "🔍 Analyze"}
              </button>
              {newsLoading && <span className="text-[11px] text-muted">fetching 1m candles…</span>}
            </div>

            {newsError && (
              <div className="text-sm text-bear bg-bear/10 border border-bear/30 rounded-md px-4 py-3 mb-4">
                {newsError}
              </div>
            )}

            {newsEvents && (
              <>
                {/* Stats summary */}
                <NewsStats events={newsEvents} />

                {/* Month selector for news calendar */}
                {newsMonths.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="text-[10px] uppercase tracking-wide text-muted mr-1">Calendar</span>
                    {newsMonths.map((m) => {
                      const [y, mo] = m.split("-");
                      const label = `${MONTHS[Number(mo)-1]} ${y}`;
                      return (
                        <button
                          key={m}
                          onClick={() => setNewsMonthSel(newsMonthSel === m ? null : m)}
                          className={`text-xs px-3 py-1.5 rounded-md border transition ${
                            newsMonthSel === m
                              ? "border-accent bg-accent/15 text-accent font-medium"
                              : "border-border bg-panel2 text-muted hover:border-accent/40"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* News calendar for selected month */}
                {newsMonthSel && (
                  <div className="mb-4">
                    <NewsCalendar
                      monthKey={newsMonthSel}
                      dayMap={newsDayMap}
                      onDayClick={(dayKey) => {
                        const events = newsDayMap[dayKey];
                        if (events && events.length > 0) {
                          setSelectedNewsEvent(events[0]);
                        }
                      }}
                    />
                  </div>
                )}

                {/* Events table */}
                <div className="mt-4 rounded-lg border border-border bg-panel overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted flex items-center justify-between">
                    <span>News Events ({newsEvents.length})</span>
                    <span className="text-accent text-[10px] normal-case">💡 Click any row to view chart</span>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted sticky top-0 bg-panel z-10">
                        <tr className="border-b border-border">
                          <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Date (IST)</th>
                          <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Time (IST)</th>
                          <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Event</th>
                          {newsEvents[0]?.analysis?.map((a) => (
                            <th key={a.symbol} className="text-center font-medium px-3 py-2 whitespace-nowrap">{a.symbol}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="font-mono tnum">
                        {newsEvents.map((ev, i) => {
                          const d = new Date(ev.ts);
                          const istDate = new Date(d.getTime() + IST_OFFSET_MS);
                          const dateStr = istDate.toISOString().slice(0, 10);
                          const timeStr = istDate.toISOString().slice(11, 16);
                          return (
                            <tr
                              key={i}
                              className={`border-b border-border/50 hover:bg-panel2 cursor-pointer transition-colors ${
                                selectedNewsEvent === ev ? "bg-accent/5" : ""
                              }`}
                              onClick={() => setSelectedNewsEvent(selectedNewsEvent === ev ? null : ev)}
                            >
                              <td className="px-3 py-1.5 whitespace-nowrap">{dateStr}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-muted">{timeStr}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                  ev.type === "NFP" ? "bg-red-500/20 text-red-400" :
                                  ev.type === "CPI" ? "bg-yellow-500/20 text-yellow-400" :
                                  "bg-blue-500/20 text-blue-400"
                                }`}>
                                  {ev.type}
                                </span>
                                <span className="text-muted ml-1.5">{ev.label}</span>
                              </td>
                              {ev.analysis.map((a, j) => (
                                <td key={j} className="px-3 py-1.5 text-center whitespace-nowrap">
                                  {a.error ? (
                                    <span className="text-bear text-[10px]" title={a.error}>⚠️</span>
                                  ) : (
                                    <NewsCandleBadge analysis={a} />
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* News Event Chart Modal */}
      {selectedNewsEvent && (
        <NewsChart
          event={selectedNewsEvent}
          onClose={() => setSelectedNewsEvent(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div className="rounded-md bg-panel2 border border-border py-1.5">
      <div className={`font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

/* ---------- News Candle Analysis Components ---------- */

function NewsStats({ events }) {
  // Per-symbol statistics
  const stats = {};
  for (const ev of events) {
    for (const a of ev.analysis) {
      if (a.error) continue;
      if (!stats[a.symbol]) stats[a.symbol] = { bullish:0, bearish:0, doji:0, total:0 };
      stats[a.symbol][a.classification]++;
      stats[a.symbol].total++;
    }
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      {Object.entries(stats).map(([sym, s]) => (
        <div key={sym} className="rounded-lg border border-border bg-panel2 p-3 flex items-center gap-4">
          <span className="font-semibold text-sm">{sym}</span>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-bull"></span>
              <span className="text-bull font-bold">{s.bullish}</span>
              <span className="text-muted">bull</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-bear"></span>
              <span className="text-bear font-bold">{s.bearish}</span>
              <span className="text-muted">bear</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
              <span className="text-yellow-400 font-bold">{s.doji}</span>
              <span className="text-muted">doji</span>
            </span>
          </div>
          <div className="text-xs text-muted ml-auto">
            <span className="text-bull">{s.total > 0 ? Math.round(s.bullish/s.total*100) : 0}%</span>
            {" "}bull rate
          </div>
        </div>
      ))}
    </div>
  );
}

function NewsCandleBadge({ analysis }) {
  const { classification, changePct, bodyPct } = analysis;
  const isBull = classification === "bullish";
  const isBear = classification === "bearish";
  const isDoji = classification === "doji";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
        isBull ? "bg-bull/15 text-bull" :
        isBear ? "bg-bear/15 text-bear" :
        "bg-yellow-500/15 text-yellow-400"
      }`}
      title={`Change: ${changePct > 0 ? "+" : ""}${changePct}% · Body: ${bodyPct}% of range`}
    >
      <span>{isBull ? "▲" : isBear ? "▼" : "◆"}</span>
      {classification.toUpperCase()}
      {changePct !== 0 && (
        <span className={`opacity-70 ${isBull ? "text-bull" : isBear ? "text-bear" : "text-yellow-400"}`}>
          {changePct > 0 ? "+" : ""}{changePct}%
        </span>
      )}
    </span>
  );
}

/* ---------- News Calendar Component ---------- */

function NewsCalendar({ monthKey, dayMap, onDayClick }) {
  const [year, month] = monthKey.split("-").map(Number);

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sun

  // Build calendar grid
  const calendar = [];
  let week = [];
  for (let i = 0; i < startDayOfWeek; i++) week.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);
    if (week.length === 7 || day === daysInMonth) {
      while (week.length < 7) week.push(null);
      calendar.push(week);
      week = [];
    }
  }

  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="bg-panel border border-border rounded-lg p-4">
      <div className="text-center text-sm font-semibold mb-4">
        {MONTHS[month - 1]} {year}
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map((n) => (
          <div key={n} className="text-center text-xs font-medium text-muted py-1">{n}</div>
        ))}
      </div>

      <div className="space-y-1">
        {calendar.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              if (day === null) return <div key={di} className="h-16"></div>;

              const dayKey = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const evts = dayMap[dayKey];
              const hasNews = evts && evts.length > 0;

              // Collect unique news types for this day
              const types = hasNews ? [...new Set(evts.map((e) => e.type))] : [];

              return (
                <button
                  key={day}
                  onClick={() => hasNews && onDayClick(dayKey)}
                  disabled={!hasNews}
                  title={hasNews ? evts.map((e) => `${e.type} · ${e.label}`).join("\n") : ""}
                  className={`h-16 rounded-md text-xs transition relative flex flex-col items-center justify-center ${
                    !hasNews
                      ? "text-muted/30 cursor-default"
                      : "bg-panel2 hover:bg-panel2/70 border border-border/50 hover:border-accent/40 cursor-pointer"
                  }`}
                >
                  <div className="absolute top-1 left-1.5 text-[10px] font-medium">{day}</div>
                  {hasNews && (
                    <div className="mt-2 flex items-center gap-1">
                      {types.map((t) => (
                        <span
                          key={t}
                          className={`w-2 h-2 rounded-full ${
                            t === "NFP" ? "bg-red-400" :
                            t === "CPI" ? "bg-yellow-400" :
                            "bg-blue-400"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  {hasNews && (
                    <div className="text-[9px] text-muted mt-0.5">
                      {evts.length} event{evts.length > 1 ? "s" : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex justify-center gap-4 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
          <span>NFP</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span>
          <span>CPI</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
          <span>FOMC</span>
        </div>
        <div className="text-muted/50 text-[10px]">· Click a news day to view chart</div>
      </div>
    </div>
  );
}

/* ---------- News Event Chart Modal ---------- */

function NewsChart({ event, onClose }) {
  const [selectedSymbol, setSelectedSymbol] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const firstAnalysis = event.analysis?.find((a) => !a.error);
  const activeSymbol = selectedSymbol || firstAnalysis?.symbol;
  const activeAnalysis = event.analysis?.find((a) => a.symbol === activeSymbol && !a.error);

  const d = new Date(event.ts);
  const istDate = new Date(d.getTime() + IST_OFFSET_MS);
  const dateStr = istDate.toISOString().slice(0, 10);
  const timeStr = istDate.toISOString().slice(11, 16);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-panel border-2 border-accent/60 rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border bg-panel2/50 shrink-0">
            <div>
              <h3 className="text-lg font-bold">📰 {event.label}</h3>
              <p className="text-sm text-muted mt-1">
                {dateStr} at {timeStr} IST · {event.timeET} ET ·{" "}
                <span className={`font-bold ${
                  event.type === "NFP" ? "text-red-400" :
                  event.type === "CPI" ? "text-yellow-400" : "text-blue-400"
                }`}>{event.type}</span>
              </p>
            </div>
            <button onClick={onClose} className="text-muted hover:text-ink transition text-xl leading-none px-2 py-1 hover:bg-border/30 rounded">×</button>
          </div>

          {/* Symbol tabs */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0">
            {event.analysis.filter((a) => !a.error).map((a) => (
              <button
                key={a.symbol}
                onClick={() => setSelectedSymbol(a.symbol)}
                className={`text-xs px-3 py-1.5 rounded-t-md border border-b-0 transition ${
                  activeSymbol === a.symbol
                    ? "bg-panel border-accent/40 text-accent font-medium"
                    : "bg-panel2/50 border-border text-muted hover:text-ink"
                }`}
              >
                {a.symbol}
              </button>
            ))}
            <div className="flex-1 border-b border-border"></div>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-4">
            {activeAnalysis && activeAnalysis.chartRows && activeAnalysis.chartRows.length > 0 ? (
              <SimpleNewsChart rows={activeAnalysis.chartRows} eventTs={event.ts} analysis={activeAnalysis} />
            ) : activeAnalysis?.error ? (
              <div className="flex items-center justify-center h-80 text-bear text-sm">{activeAnalysis.error}</div>
            ) : (
              <div className="flex items-center justify-center h-80 text-muted text-sm">No candle data available</div>
            )}
          </div>

          {/* Candle details footer */}
          {activeAnalysis && !activeAnalysis.error && (
            <div className="border-t border-border bg-panel2/30 shrink-0 p-3">
              <div className="grid grid-cols-4 gap-4 text-center text-xs">
                <div>
                  <div className="text-muted mb-1">OPEN</div>
                  <div className="font-bold">{activeAnalysis.candle.o.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-muted mb-1">HIGH</div>
                  <div className="font-bold text-bull">{activeAnalysis.candle.h.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-muted mb-1">LOW</div>
                  <div className="font-bold text-bear">{activeAnalysis.candle.l.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-muted mb-1">CLOSE</div>
                  <div className="font-bold">{activeAnalysis.candle.c.toFixed(4)}</div>
                </div>
              </div>
              <div className="flex justify-center gap-4 mt-2 text-xs">
                <span className="text-muted">Classification: <NewsCandleBadge analysis={activeAnalysis} /></span>
                <span className="text-muted">Change: <span className={activeAnalysis.changePct >= 0 ? "text-bull" : "text-bear"}>
                  {activeAnalysis.changePct > 0 ? "+" : ""}{activeAnalysis.changePct}%
                </span></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Simplified lightweight-charts for news events ---------- */

function SimpleNewsChart({ rows, eventTs, analysis }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!containerRef.current || !rows || rows.length === 0) return;
    let chart = null;
    let cancelled = false;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: "#0e1422" },
            textColor: "#e8edff",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: { vertLines: { color: "#1e2840" }, horzLines: { color: "#1e2840" } },
          rightPriceScale: { borderColor: "#1e2840", scaleMargins: { top: 0.1, bottom: 0.25 } },
          timeScale: { borderColor: "#1e2840", timeVisible: true, secondsVisible: false },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        chartRef.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#26a69a", downColor: "#ef5350",
          borderUpColor: "#26a69a", borderDownColor: "#ef5350",
          wickUpColor: "#26a69a", wickDownColor: "#ef5350",
        });

        const seriesData = rows.map((r) => ({
          time: Math.floor(r[0] / 1000),
          open: r[1], high: r[2], low: r[3], close: r[4],
        }));
        candleSeries.setData(seriesData);

        // Volume histogram
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a44",
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        volumeSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            value: r[5],
            color: r[4] >= r[1] ? "#26a69a44" : "#ef535044",
          }))
        );

        // Marker at the event candle
        candleSeries.setMarkers([
          {
            time: Math.floor(eventTs / 1000),
            position: "aboveBar",
            color: "#f1c40f",
            shape: "circle",
            text: `📰 ${analysis?.classification?.toUpperCase() || "NEWS"}`,
            size: 2,
          },
        ]);

        chart.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e));
      }
    })();

    const onResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* silent */ }
        chartRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, eventTs]);

  if (err) return <div className="flex items-center justify-center h-80 text-bear text-sm">{err}</div>;

  return (
    <div
      ref={containerRef}
      className="w-full h-[400px] min-h-[400px] rounded-lg overflow-hidden bg-[#0e1422]"
    />
  );
}

function Calendar({ monthKey, days, selectedDay, onDayClick }) {
  const [year, month] = monthKey.split("-").map(Number);

  // Get first day of the month and how many days in the month
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

  // Create a map of day number to day data for quick lookup
  const dayMap = {};
  days.forEach(day => {
    const dayNum = parseInt(day.date.split('-')[2]);
    dayMap[dayNum] = day;
  });

  // Generate calendar grid
  const calendar = [];
  let week = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startDayOfWeek; i++) {
    week.push(null);
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);

    // If we've filled a week (7 days) or it's the last day, add the week to calendar
    if (week.length === 7 || day === daysInMonth) {
      // Fill remaining cells if it's the last week and not complete
      while (week.length < 7) {
        week.push(null);
      }
      calendar.push(week);
      week = [];
    }
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="bg-panel border border-border rounded-lg p-4">
      {/* Month/Year header */}
      <div className="text-center text-sm font-semibold mb-4">
        {MONTHS[month - 1]} {year}
      </div>

      {/* Day names header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map((name) => (
          <div key={name} className="text-center text-xs font-medium text-muted py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-1">
        {calendar.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-1">
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={dayIndex} className="h-12"></div>;
              }

              const dayData = dayMap[day];
              const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = selectedDay === dayKey;
              const hasData = dayData && dayData.signals > 0;

              return (
                <button
                  key={day}
                  onClick={() => hasData && onDayClick(dayKey)}
                  disabled={!hasData}
                  className={`h-12 rounded-md text-xs transition relative ${
                    !hasData
                      ? "text-muted/40 cursor-not-allowed"
                      : isSelected
                      ? "bg-accent/20 border border-accent text-accent font-bold"
                      : "bg-panel2 hover:bg-panel2/70 border border-border/50 hover:border-accent/40"
                  }`}
                >
                  <div className="absolute top-1 left-1 text-[10px]">{day}</div>
                  {hasData && (
                    <div className="mt-2">
                      <div className={`text-sm font-bold ${
                        dayData.winRate >= 50 ? "text-bull" : "text-bear"
                      }`}>
                        {dayData.winRate}%
                      </div>
                      <div className="text-[9px] text-muted">
                        {dayData.signals} sig
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex justify-center gap-4 text-xs text-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-bull/20 border border-bull/40"></div>
          <span>≥50% win rate</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-bear/20 border border-bear/40"></div>
          <span>&lt;50% win rate</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- TradingView-style Chart (lightweight-charts) ---------- */
// Uses TradingView's free open-source lightweight-charts library so we can
// overlay Entry / Stop / Take-Profit zones, the level band, and a marker
// on the engulfing candle — same details the SVG chart already shows.

// Custom drawing primitive: filled rectangle between two (time, price) corners.
// Used to render the SL (red) and TP (green) zones starting at the signal candle.
function positionsBox(p1, p2, ratio) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  return {
    position: Math.round(min * ratio),
    length: Math.max(1, Math.round((max - min) * ratio)),
  };
}

function makeZonePrimitive(startTime, endTime, priceA, priceB, fillColor, borderColor) {
  return {
    _chart: null,
    _series: null,
    _p1: { x: null, y: null },
    _p2: { x: null, y: null },
    attached({ chart, series }) {
      this._chart = chart;
      this._series = series;
    },
    detached() {},
    updateAllViews() {
      if (!this._chart || !this._series) return;
      const ts = this._chart.timeScale();
      this._p1 = {
        x: ts.timeToCoordinate(startTime),
        y: this._series.priceToCoordinate(priceA),
      };
      this._p2 = {
        x: ts.timeToCoordinate(endTime),
        y: this._series.priceToCoordinate(priceB),
      };
    },
    paneViews() {
      const p1 = this._p1;
      const p2 = this._p2;
      return [
        {
          renderer: () => ({
            draw(target) {
              target.useBitmapCoordinateSpace((scope) => {
                if (
                  p1.x == null || p1.y == null ||
                  p2.x == null || p2.y == null
                ) return;
                const hbox = positionsBox(p1.x, p2.x, scope.horizontalPixelRatio);
                const vbox = positionsBox(p1.y, p2.y, scope.verticalPixelRatio);
                const ctx = scope.context;
                ctx.fillStyle = fillColor;
                ctx.fillRect(hbox.position, vbox.position, hbox.length, vbox.length);
                if (borderColor) {
                  ctx.strokeStyle = borderColor;
                  ctx.lineWidth = Math.max(1, scope.verticalPixelRatio);
                  ctx.strokeRect(hbox.position, vbox.position, hbox.length, vbox.length);
                }
              });
            },
          }),
        },
      ];
    },
  };
}

function TradingViewChart({ trade, rows, signalTs }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  // Pre-parse the level "low-high" string into numbers.
  let levelLow = null, levelHigh = null;
  if (trade.level && typeof trade.level === "string" && trade.level.includes("-")) {
    const [a, b] = trade.level.split("-").map(parseFloat);
    if (!isNaN(a) && !isNaN(b)) {
      levelLow = Math.min(a, b);
      levelHigh = Math.max(a, b);
    }
  }

  useEffect(() => {
    if (!containerRef.current || !rows || rows.length === 0) return;

    let chart = null;
    let cancelled = false;

    (async () => {
      try {
        const lwc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        chart = lwc.createChart(containerRef.current, {
          layout: {
            background: { type: lwc.ColorType.Solid, color: "#0e1422" },
            textColor: "#e8edff",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          grid: {
            vertLines: { color: "#1e2840" },
            horzLines: { color: "#1e2840" },
          },
          crosshair: { mode: lwc.CrosshairMode.Normal },
          rightPriceScale: {
            borderColor: "#1e2840",
            scaleMargins: { top: 0.1, bottom: 0.25 },
          },
          timeScale: {
            borderColor: "#1e2840",
            timeVisible: true,
            secondsVisible: false,
          },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        chartRef.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor: "#26a69a",
          downColor: "#ef5350",
          borderUpColor: "#26a69a",
          borderDownColor: "#ef5350",
          wickUpColor: "#26a69a",
          wickDownColor: "#ef5350",
        });

        candleSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            open: r[1],
            high: r[2],
            low: r[3],
            close: r[4],
          }))
        );

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: "#26a69a44",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
        volumeSeries.setData(
          rows.map((r) => ({
            time: Math.floor(r[0] / 1000),
            value: r[5],
            color: r[4] >= r[1] ? "#26a69a44" : "#ef535044",
          }))
        );

        const dashed = lwc.LineStyle.Dashed;
        const dotted = lwc.LineStyle.Dotted;

        if (trade.entry != null) {
          candleSeries.createPriceLine({
            price: Number(trade.entry),
            color: "#ffffff",
            lineWidth: 1,
            lineStyle: dashed,
            axisLabelVisible: true,
            title: "ENTRY",
          });
        }
        if (trade.stop != null) {
          candleSeries.createPriceLine({
            price: Number(trade.stop),
            color: "#ef5350",
            lineWidth: 2,
            lineStyle: lwc.LineStyle.Solid,
            axisLabelVisible: true,
            title: "SL",
          });
        }
        if (trade.tp != null) {
          candleSeries.createPriceLine({
            price: Number(trade.tp),
            color: "#26a69a",
            lineWidth: 2,
            lineStyle: lwc.LineStyle.Solid,
            axisLabelVisible: true,
            title: "TP",
          });
        }

        // SL / TP filled risk-reward zones (start at signal candle, extend to last bar)
        const sigSec = Math.floor(Number(signalTs ?? trade.ts) / 1000);
        const lastSec = Math.floor(rows[rows.length - 1][0] / 1000);
        if (sigSec && lastSec > sigSec && trade.entry != null) {
          if (trade.tp != null) {
            candleSeries.attachPrimitive(
              makeZonePrimitive(
                sigSec,
                lastSec,
                Number(trade.entry),
                Number(trade.tp),
                "rgba(38, 166, 154, 0.22)", // green fill
                "rgba(38, 166, 154, 0.55)"  // green border
              )
            );
          }
          if (trade.stop != null) {
            candleSeries.attachPrimitive(
              makeZonePrimitive(
                sigSec,
                lastSec,
                Number(trade.entry),
                Number(trade.stop),
                "rgba(239, 83, 80, 0.22)",  // red fill
                "rgba(239, 83, 80, 0.55)"   // red border
              )
            );
          }
        }
        if (levelLow != null && levelHigh != null) {
          candleSeries.createPriceLine({
            price: levelHigh,
            color: "#f1c40f",
            lineWidth: 1,
            lineStyle: dotted,
            axisLabelVisible: true,
            title: "LVL HI",
          });
          candleSeries.createPriceLine({
            price: levelLow,
            color: "#f1c40f",
            lineWidth: 1,
            lineStyle: dotted,
            axisLabelVisible: true,
            title: "LVL LO",
          });
        }

        // Marker on the engulfing signal candle.
        const sigTs = Number(signalTs ?? trade.ts);
        if (sigTs) {
          const bullish = trade.direction === "bullish";
          candleSeries.setMarkers([
            {
              time: Math.floor(sigTs / 1000),
              position: bullish ? "belowBar" : "aboveBar",
              color: "#3b82f6",
              shape: bullish ? "arrowUp" : "arrowDown",
              text: `${(trade.direction || "").toUpperCase()} ENGULFING`,
              size: 2,
            },
          ]);
        }

        chart.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();

    const onResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (e) { /* silent */ }
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, signalTs, trade.entry, trade.stop, trade.tp, trade.direction, trade.ts]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-bear text-center">
        <div>
          <div className="text-lg mb-2">⚠️ Chart Error</div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[500px] rounded-lg overflow-hidden bg-[#0e1422]"
    />
  );
}

/* ---------- HoverChart Modal ---------- */

function HoverChart({ trade, onClose }) {
  const [viewMode, setViewMode] = useState("tradingview"); // "tradingview" | "svg"
  const [chartData, setChartData] = useState(null); // { svg, rows, signalTs, tf }
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState("");

  // Derive the TradingView symbol from the trade data
  const tvSymbol = trade.tvSymbol ||
    (trade.tradingview ? trade.tradingview : (trade.exchange ? `${trade.exchange.toUpperCase()}:${trade.pair}` : ""));

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Parse level string like "62842.5-63104.4" into low/high values
  let levelLow, levelHigh;
  if (trade.level && typeof trade.level === 'string' && trade.level.includes('-')) {
    const parts = trade.level.split('-');
    levelLow = parseFloat(parts[0]);
    levelHigh = parseFloat(parts[1]);
  }

  // Fetch chart data (rows + svg) once when the modal opens — both tabs share it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChartLoading(true);
      setChartError("");
      try {
        const response = await fetch("/api/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairName: trade.pair,
            timestamp: trade.ts,
            entry: trade.entry,
            stop: trade.stop,
            tp: trade.tp,
            direction: trade.direction,
            levelLow,
            levelHigh,
          }),
        });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        if (data.error) setChartError(data.error);
        else setChartData(data);
      } catch (e) {
        if (!cancelled) setChartError(String(e.message || e));
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.ts, trade.pair]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-panel border-2 border-accent/60 rounded-lg shadow-2xl w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border bg-panel2/50 shrink-0">
            <div>
              <h3 className="text-lg font-bold">
                {trade.pair} · {trade.direction?.toUpperCase()} ENGULFING PATTERN
              </h3>
              <p className="text-sm text-muted mt-1">
                {trade.time} · Level: {trade.level} · Outcome:{" "}
                <span className={`font-bold ${
                  trade.outcome === "win" ? "text-bull" :
                  trade.outcome === "loss" ? "text-bear" : "text-muted"
                }`}>
                  {trade.outcome.toUpperCase()}
                </span>
                {tvSymbol && (
                  <span className="ml-3 text-accent text-xs">
                    · TV: <span className="font-mono">{tvSymbol}</span>
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted hover:text-ink transition text-xl leading-none px-2 py-1 hover:bg-border/30 rounded"
            >
              ×
            </button>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0">
            <button
              onClick={() => setViewMode("tradingview")}
              className={`text-xs px-3 py-1.5 rounded-t-md border border-b-0 transition ${
                viewMode === "tradingview"
                  ? "bg-panel border-accent/40 text-accent font-medium"
                  : "bg-panel2/50 border-border text-muted hover:text-ink"
              }`}
            >
              📈 TradingView Chart
            </button>
            <button
              onClick={() => setViewMode("svg")}
              className={`text-xs px-3 py-1.5 rounded-t-md border border-b-0 transition ${
                viewMode === "svg"
                  ? "bg-panel border-accent/40 text-accent font-medium"
                  : "bg-panel2/50 border-border text-muted hover:text-ink"
              }`}
            >
              📊 SVG Chart
            </button>
            <div className="flex-1 border-b border-border"></div>
          </div>

          {/* Chart Content */}
          <div className="flex-1 min-h-0 p-4">
            {chartLoading ? (
              <div className="flex items-center justify-center h-96 text-muted">
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3"></div>
                  <div>Loading chart data...</div>
                </div>
              </div>
            ) : chartError ? (
              <div className="flex items-center justify-center h-96 text-bear text-center">
                <div>
                  <div className="text-lg mb-2">⚠️ Chart Error</div>
                  <div className="text-sm">{chartError}</div>
                </div>
              </div>
            ) : !chartData ? null : viewMode === "tradingview" ? (
              <div className="w-full h-full min-h-[450px] rounded-lg overflow-hidden border border-border">
                <TradingViewChart
                  trade={trade}
                  rows={chartData.rows}
                  signalTs={chartData.signalTs}
                />
              </div>
            ) : (
              <div className="w-full h-[450px] bg-[#0e1422] rounded-lg overflow-hidden">
                <div
                  className="w-full h-full"
                  dangerouslySetInnerHTML={{ __html: chartData.svg }}
                />
              </div>
            )}
          </div>

          {/* Trade Details Footer */}
          <div className="border-t border-border bg-panel2/30 shrink-0">
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">ENTRY PRICE</div>
                  <div className="text-lg font-bold text-accent">{fmt(trade.entry)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">STOP LOSS</div>
                  <div className="text-lg font-bold text-bear">{fmt(trade.stop)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">TAKE PROFIT</div>
                  <div className="text-lg font-bold text-bull">{fmt(trade.tp)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">RISK/REWARD</div>
                  <div className="text-lg font-bold">{trade.r > 0 ? `+${trade.r}R` : `${trade.r}R`}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted mb-1">BARS HELD</div>
                  <div className="text-lg font-bold">{trade.barsHeld || "—"}</div>
                </div>
              </div>

              {/* Open on TradingView link */}
              {tvSymbol && (
                <div className="mt-3 pt-3 border-t border-border/50 flex justify-center">
                  <a
                    href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-4 py-2 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition inline-flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    Open full chart on TradingView
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
