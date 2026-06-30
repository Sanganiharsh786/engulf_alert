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
        </>
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

/* ---------- TradingView Chart Component ---------- */

// Map app timeframe format to TradingView's interval format
const TF_MAP = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240",
  "1d": "D", "1w": "W", "1M": "M",
};

// Preload the TradingView script once at module level so it's ready instantly
let tvScriptLoaded = false;
let tvScriptPromise = null;
function loadTvScript() {
  if (tvScriptLoaded) return Promise.resolve();
  if (typeof window !== "undefined" && window.TradingView && window.TradingView.widget) {
    tvScriptLoaded = true;
    return Promise.resolve();
  }
  if (tvScriptPromise) return tvScriptPromise;
  tvScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "tv-chart-script";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => { tvScriptLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}
// Start loading immediately
if (typeof window !== "undefined") loadTvScript().catch(() => {});

function TradingViewChart({ symbol, interval, tradeTs, entry, stop, tp, direction, theme = "dark", levelLow, levelHigh }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const [tvReady, setTvReady] = useState(false);
  const [tvError, setTvError] = useState("");
  const containerIdRef = useRef(`tv-chart-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    const containerId = containerIdRef.current;
    if (containerRef.current) {
      containerRef.current.id = containerId;
    }

    let mounted = true;
    let retryCount = 0;
    const MAX_RETRIES = 5;

    const doSetupChart = (chart, tsSec, fromSec, toSec) => {
      // 1. Set visible range — retry if data not loaded yet
      const trySetRange = () => {
        try {
          chart.setVisibleRange({ from: fromSec, to: toSec });
          return true;
        } catch (e) {
          return false;
        }
      };

      if (!trySetRange() && retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(trySetRange, 400 * retryCount);
      }

      // 2. Draw Entry / Stop / TP lines
      const addTradeLine = (price, color, label) => {
        if (price == null || isNaN(Number(price))) return;
        try {
          chart.createShape(
            { time: tsSec, price: Number(price) },
            {
              shape: "horizontal_line",
              lock: true,
              disableSave: true,
              text: label,
              overrides: {
                linecolor: color,
                linestyle: 2,
                linewidth: 2,
              },
            }
          );
        } catch (e) {
          // silent
        }
      };

      addTradeLine(entry, "#ffffff", "ENTRY");
      addTradeLine(stop,  "#ef5350", "STOP LOSS");
      addTradeLine(tp,    "#26a69a", "TAKE PROFIT");

      // 3. Level zone boundaries as default Horizontal Line studies
      if (levelLow != null && levelHigh != null && !isNaN(levelLow) && !isNaN(levelHigh)) {
        try {
          const lo = Math.min(Number(levelLow), Number(levelHigh));
          const hi = Math.max(Number(levelLow), Number(levelHigh));
          chart.createStudy("Horizontal Line", false, false, [lo]);
          chart.createStudy("Horizontal Line", false, false, [hi]);
        } catch (e) { /* silent */ }
      }

      // 4. Direction arrow + \"ENGULF\" label at the signal candle
      try {
        const isBull = direction === "bullish";
        chart.createShape(
          { time: tsSec },
          {
            shape: isBull ? "arrow_up" : "arrow_down",
            lock: true,
            disableSave: true,
            text: isBull ? " BULL ENGULF" : " BEAR ENGULF",
            overrides: {
              color: isBull ? "#26a69a" : "#ef5350",
              textcolor: "#ffffff",
              fontSize: 12,
            },
          }
        );
      } catch (e) { /* silent */ }

      // 5. Place a vertical line marker at the signal time for extra visibility
      try {
        chart.createShape(
          { time: tsSec },
          {
            shape: "vertical_line",
            lock: true,
            disableSave: true,
            text: " SIGNAL",
            overrides: {
              linecolor: "#3b82f6",
              linestyle: 2,
              linewidth: 1,
            },
          }
        );
      } catch (e) { /* silent */ }
    };

    const initWidget = async () => {
      if (!mounted || !containerRef.current) return;

      // Ensure TV script is loaded
      try {
        await loadTvScript();
      } catch (e) {
        if (mounted) setTvError("Failed to load TradingView");
        return;
      }

      if (!mounted || !containerRef.current) return;

      const tvInterval = TF_MAP[interval] || "15";

      try {
        widgetRef.current = new window.TradingView.widget({
          container_id: containerId,
          width: "100%",
          height: "100%",
          symbol: symbol,
          interval: tvInterval,
          timezone: "Asia/Kolkata",
          theme: theme,
          style: "1",
          locale: "en",
          toolbar_bg: "#131722",
          hide_top_toolbar: false,
          hide_legend: true,
          allow_symbol_change: false,
          save_image: false,
          enable_publishing: false,
          hideideasbutton: true,
          withdateranges: true,
          studies: [],
          loading_screen: { backgroundColor: "#0e1422" },
          overrides: {
            "paneProperties.background": "#0e1422",
            "paneProperties.vertGridProperties.color": "#1e2840",
            "paneProperties.horzGridProperties.color": "#1e2840",
            "paneProperties.crossHairProperties.color": "#3b82f6",
            "paneProperties.topMargin": 15,
            "paneProperties.bottomMargin": 10,
          },
          disabled_features: [
            "header_symbol_search", "header_compare",
            "header_undo_redo", "popup_menu", "go_to_date",
          ],
          enabled_features: [
            "hide_left_toolbar_by_default",
          ],
        });

        if (widgetRef.current) {
          if (mounted) setTvReady(true);

          widgetRef.current.onChartReady(() => {
            if (!mounted || !widgetRef.current) return;
            const chart = widgetRef.current.chart();
            if (!chart) return;

            // Calculate time window
            const tfSecondsMap = { "1": 60, "3": 180, "5": 300, "15": 900, "30": 1800, "60": 3600, "120": 7200, "240": 14400, "D": 86400, "W": 604800 };
            const sec = tfSecondsMap[tvInterval] || 900;
            const msPerBar = sec * 1000;
            const barsBefore = tvInterval === "D" ? 20 : tvInterval === "W" ? 12 : tvInterval >= "60" ? 30 : 25;
            const barsAfter  = tvInterval === "D" ? 15 : tvInterval === "W" ? 8  : tvInterval >= "60" ? 25 : 25;

            const tsSec = Math.floor(tradeTs / 1000);
            const fromSec = (tradeTs - barsBefore * msPerBar) / 1000;
            const toSec   = (tradeTs + barsAfter  * msPerBar) / 1000;

            doSetupChart(chart, tsSec, fromSec, toSec);
          });
        }
      } catch (e) {
        if (mounted) {
          setTvError(String(e.message || e));
        }
      }
    };

    initWidget();

    return () => {
      mounted = false;
      if (widgetRef.current && typeof widgetRef.current.remove === "function") {
        try { widgetRef.current.remove(); } catch (e) { /* silent */ }
        widgetRef.current = null;
      }
    };
  }, [symbol, interval, tradeTs, entry, stop, tp, direction, levelLow, levelHigh, theme]);

  if (tvError) {
    return (
      <div className="flex items-center justify-center h-96 text-bear text-center">
        <div>
          <div className="text-lg mb-2">⚠️ TradingView Error</div>
          <div className="text-sm">{tvError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[500px]">
      {!tvReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0e1422] rounded-lg z-10">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3"></div>
            <div className="text-sm text-muted">Loading TradingView chart...</div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full min-h-[500px] rounded-lg overflow-hidden"
      />
    </div>
  );
}

/* ---------- HoverChart Modal ---------- */

function HoverChart({ trade, onClose }) {
  const [viewMode, setViewMode] = useState("tradingview"); // "tradingview" | "svg"
  const [chartSVG, setChartSVG] = useState("");
  const [svgLoading, setSvgLoading] = useState(false);
  const [svgError, setSvgError] = useState("");

  // Derive the TradingView symbol from the trade data
  const tvSymbol = trade.tvSymbol ||
    (trade.tradingview ? trade.tradingview : (trade.exchange ? `${trade.exchange.toUpperCase()}:${trade.pair}` : ""));

  const tvInterval = trade.tf || "15m";

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

  // Fetch SVG chart on demand (second tab)
  const fetchSvg = async () => {
    if (chartSVG || svgLoading) return;
    setSvgLoading(true);
    setSvgError("");
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
      if (data.error) {
        setSvgError(data.error);
      } else {
        setChartSVG(data.svg);
      }
    } catch (e) {
      setSvgError(String(e.message || e));
    } finally {
      setSvgLoading(false);
    }
  };

  // Pre-fetch SVG when switching to SVG tab
  const switchToSvg = () => {
    setViewMode("svg");
    fetchSvg();
  };

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
              onClick={switchToSvg}
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
            {viewMode === "tradingview" && (
              tvSymbol ? (
                <div className="w-full h-full min-h-[450px] rounded-lg overflow-hidden border border-border">
                  <TradingViewChart
                    symbol={tvSymbol}
                    interval={tvInterval}
                    tradeTs={trade.ts}
                    entry={trade.entry}
                    stop={trade.stop}
                    tp={trade.tp}
                    direction={trade.direction}
                    levelLow={levelLow}
                    levelHigh={levelHigh}
                    theme="dark"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-96 text-muted text-sm">
                  No TradingView symbol configured for this pair.
                  Set a "tradingview" symbol in the pair settings.
                </div>
              )
            )}

            {viewMode === "svg" && (
              svgLoading ? (
                <div className="flex items-center justify-center h-96 text-muted">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3"></div>
                    <div>Loading SVG chart data...</div>
                  </div>
                </div>
              ) : svgError ? (
                <div className="flex items-center justify-center h-96 text-bear text-center">
                  <div>
                    <div className="text-lg mb-2">⚠️ Chart Error</div>
                    <div className="text-sm">{svgError}</div>
                  </div>
                </div>
              ) : chartSVG ? (
                <div className="w-full h-[450px] bg-[#0e1422] rounded-lg overflow-hidden">
                  <div
                    className="w-full h-full"
                    dangerouslySetInnerHTML={{ __html: chartSVG }}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-96 text-muted text-sm">
                  Click to load SVG chart
                </div>
              )
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
