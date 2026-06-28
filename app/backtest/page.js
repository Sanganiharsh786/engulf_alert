"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast";

const fmt = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// "YYYY-MM-DD" (IST day) -> epoch ms at start/end of that IST day
function istDayStart(dateStr) {
  if (!dateStr) return null;
  return Date.parse(dateStr + "T00:00:00Z") - IST_OFFSET_MS;
}
function istDayEnd(dateStr) {
  if (!dateStr) return null;
  return Date.parse(dateStr + "T23:59:59Z") - IST_OFFSET_MS;
}

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

export default function Backtest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pairSel, setPairSel] = useState([]); // empty = all
  const toast = useToast();

  async function run({ notify = true } = {}) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/backtest", { method: "POST" });
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
        if (notify) toast(`Backtest complete · ${json.trades.length} trades`, "success");
      }
    } catch (e) {
      setError(String(e.message || e));
      toast(`Backtest failed · ${e.message || e}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run({ notify: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPairs = useMemo(
    () => (data ? [...new Set(data.trades.map((t) => t.pair))] : []),
    [data]
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const f = istDayStart(from);
    const tt = istDayEnd(to);
    return data.trades.filter((t) => {
      if (f && t.ts < f) return false;
      if (tt && t.ts > tt) return false;
      if (pairSel.length && !pairSel.includes(t.pair)) return false;
      return true;
    });
  }, [data, from, to, pairSel]);

  const summaries = useMemo(() => summarize(filtered), [filtered]);

  const togglePair = (p) =>
    setPairSel((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const exportUrl = useMemo(() => {
    const q = new URLSearchParams();
    const f = istDayStart(from);
    const tt = istDayEnd(to);
    if (f) q.set("from", f);
    if (tt) q.set("to", tt);
    if (pairSel.length) q.set("pairs", pairSel.join(","));
    const s = q.toString();
    return "/api/backtest/export" + (s ? `?${s}` : "");
  }, [from, to, pairSel]);

  const reset = () => {
    setFrom("");
    setTo("");
    setPairSel([]);
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <header className="flex flex-wrap items-center gap-3 justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Backtest results</h1>
          <p className="text-xs text-muted">
            Engulfing-at-level setups over the last ~1000 candles · times in IST (UTC+5:30)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-panel/70 transition">
            ← Dashboard
          </a>
          <button
            onClick={run}
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

      {/* filters */}
      {data && (
        <div className="mt-5 rounded-lg border border-border bg-panel p-4 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-muted">From (IST)</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-muted">To (IST)</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block bg-panel2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent/60"
            />
          </label>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted">Pairs</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {allPairs.map((p) => {
                const on = pairSel.length === 0 || pairSel.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePair(p)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border transition ${
                      pairSel.includes(p)
                        ? "border-accent bg-accent/15 text-accent font-medium"
                        : "border-border bg-panel2 text-muted hover:border-accent/40"
                    }`}
                    title={pairSel.length === 0 ? "all pairs shown" : ""}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={reset}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-panel2 text-muted hover:text-ink transition"
          >
            Reset
          </button>
          <span className="text-[11px] text-muted ml-auto">
            {filtered.length} of {data.trades.length} trades
          </span>
        </div>
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
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
              Trades ({filtered.length})
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
                    <tr key={i} className="border-b border-border/50 hover:bg-panel2">
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
