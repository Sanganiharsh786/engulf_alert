"use client";

import { useEffect, useState } from "react";

const fmt = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function Backtest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/backtest", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <header className="flex flex-wrap items-center gap-3 justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Backtest results</h1>
          <p className="text-xs text-muted">
            Engulfing-at-level setups replayed over the last ~1000 candles · TP/SL hit first decides win/loss
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
            href="/api/backtest/export"
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

      {loading && !data && (
        <div className="mt-10 text-center text-muted text-sm">Running backtest…</div>
      )}

      {data && (
        <>
          {/* per-pair summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
            {data.summaries.map((s, i) =>
              s.error ? (
                <div key={i} className="rounded-lg border border-bear/40 bg-panel p-4">
                  <div className="font-semibold">{s.pair}</div>
                  <div className="text-xs text-bear mt-1">{s.error}</div>
                </div>
              ) : (
                <div key={i} className="rounded-lg border border-border bg-panel p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{s.pair}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted">{s.market} · {s.tf}</span>
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
              )
            )}
          </div>

          {/* trades table */}
          <div className="mt-6 rounded-lg border border-border bg-panel overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
              Trades ({data.trades.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    {["Date/Time UTC", "Day", "Pair", "Dir", "Level", "Entry", "Stop", "TP", "SL pips", "Lots", "Outcome", "Bars", "R"].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono tnum">
                  {data.trades.map((t, i) => (
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
