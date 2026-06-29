"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast";

const fmt = (n) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function dayKey(ts) {
  // local-day bucket, e.g. "2026-06-28"
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TotalAlerts() {
  const [alerts, setAlerts] = useState(null);
  const [filter, setFilter] = useState("all"); // all | today | placed | missed
  const [saving, setSaving] = useState(null); // id currently saving
  const toast = useToast();

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.error) throw new Error(d.error);
        setAlerts(d.alerts || []);
      })
      .catch((e) => {
        toast(`Failed to load alerts · ${e.message || e}`, "error");
        setAlerts([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePlaced(id, placed) {
    // optimistic update
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, placed } : a)));
    setSaving(id);
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, placed }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
    } catch (e) {
      // revert on failure
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, placed: !placed } : a)));
      toast(`Could not save · ${e.message || e}`, "error");
    } finally {
      setSaving(null);
    }
  }

  const today = useMemo(() => dayKey(Date.now()), []);

  const visible = useMemo(() => {
    if (!alerts) return [];
    return alerts.filter((a) => {
      if (filter === "today") return dayKey(a.ts) === today;
      if (filter === "placed") return a.placed;
      if (filter === "missed") return !a.placed;
      return true;
    });
  }, [alerts, filter, today]);

  const stats = useMemo(() => buildStats(alerts || []), [alerts]);

  if (!alerts) return <div className="p-10 text-muted">Loading…</div>;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <header className="flex flex-wrap items-center gap-3 justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Total Alerts</h1>
          <p className="text-xs text-muted">
            Tick the trades you actually placed. The end-of-day analysis updates below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-panel/70 transition"
          >
            ← Dashboard
          </a>
          <a
            href="/backtest"
            className="text-xs px-3 py-2 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition"
          >
            Backtest
          </a>
        </div>
      </header>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        {[
          { k: "all", label: `All (${alerts.length})` },
          { k: "today", label: `Today (${alerts.filter((a) => dayKey(a.ts) === today).length})` },
          { k: "placed", label: `Placed (${alerts.filter((a) => a.placed).length})` },
          { k: "missed", label: `Missed (${alerts.filter((a) => !a.placed).length})` },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`text-xs px-3 py-1.5 rounded-md border transition ${
              filter === f.k
                ? "border-accent bg-accent/15 text-accent font-medium"
                : "border-border bg-panel text-muted hover:border-accent/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="mt-4 rounded-lg border border-border bg-panel overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No alerts {filter === "all" ? "yet" : "in this view"}. They appear here automatically when an
            engulfing candle hits a level.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wide border-b border-border">
                  <th className="px-3 py-2.5 font-semibold">Placed</th>
                  <th className="px-3 py-2.5 font-semibold">Date / time</th>
                  <th className="px-3 py-2.5 font-semibold">Pair</th>
                  <th className="px-3 py-2.5 font-semibold">Dir</th>
                  <th className="px-3 py-2.5 font-semibold">Zone</th>
                  <th className="px-3 py-2.5 font-semibold">Entry</th>
                  <th className="px-3 py-2.5 font-semibold">SL</th>
                  <th className="px-3 py-2.5 font-semibold">TP</th>
                  <th className="px-3 py-2.5 font-semibold">Lots</th>
                  <th className="px-3 py-2.5 font-semibold">Alerts</th>
                  <th className="px-3 py-2.5 font-semibold">TV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((a) => (
                  <tr key={a.id} className={a.placed ? "bg-bull/5" : ""}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={!!a.placed}
                        disabled={saving === a.id}
                        onChange={(e) => togglePlaced(a.id, e.target.checked)}
                        className="h-4 w-4 accent-bull cursor-pointer disabled:opacity-50"
                        title="Tick if you placed this trade"
                      />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                      {new Date(a.ts).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{a.pair}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          a.direction === "bullish" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                        }`}
                      >
                        {String(a.direction || "").toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono tnum whitespace-nowrap">
                      {fmt(a.low)} → {fmt(a.high)}
                    </td>
                    <td className="px-3 py-2.5 font-mono tnum">{fmt(a.position?.entry)}</td>
                    <td className="px-3 py-2.5 font-mono tnum text-bear">{fmt(a.position?.stop)}</td>
                    <td className="px-3 py-2.5 font-mono tnum text-bull">{fmt(a.position?.tp)}</td>
                    <td className="px-3 py-2.5 font-mono tnum text-accent">{fmt(a.position?.lots)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {a.emailed !== undefined && (
                          <span
                            className={`text-[10px] px-1 py-0.5 rounded ${
                              a.emailed ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                            }`}
                            title={a.emailed ? "Email sent" : `Email failed: ${a.emailError || "Unknown error"}`}
                          >
                            📧
                          </span>
                        )}
                        {a.telegramSent !== undefined && (
                          <span
                            className={`text-[10px] px-1 py-0.5 rounded ${
                              a.telegramSent ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                            }`}
                            title={a.telegramSent ? "Telegram sent" : `Telegram failed: ${a.telegramError || "Unknown error"}`}
                          >
                            📱
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {a.link ? (
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* analysis */}
      <Analysis stats={stats} />
    </div>
  );
}

function buildStats(alerts) {
  const total = alerts.length;
  const placed = alerts.filter((a) => a.placed).length;
  const missed = total - placed;

  const byPair = {};
  const byDir = { bullish: { total: 0, placed: 0 }, bearish: { total: 0, placed: 0 } };
  const byDay = {};

  for (const a of alerts) {
    const p = (byPair[a.pair] = byPair[a.pair] || { total: 0, placed: 0 });
    p.total++;
    if (a.placed) p.placed++;

    if (byDir[a.direction]) {
      byDir[a.direction].total++;
      if (a.placed) byDir[a.direction].placed++;
    }

    const dk = dayKey(a.ts);
    const d = (byDay[dk] = byDay[dk] || { total: 0, placed: 0 });
    d.total++;
    if (a.placed) d.placed++;
  }

  return {
    total,
    placed,
    missed,
    rate: pct(placed, total),
    byPair: Object.entries(byPair)
      .map(([pair, v]) => ({ pair, ...v, rate: pct(v.placed, v.total) }))
      .sort((x, y) => y.total - x.total),
    byDir,
    byDay: Object.entries(byDay)
      .map(([day, v]) => ({ day, ...v, rate: pct(v.placed, v.total) }))
      .sort((x, y) => (x.day < y.day ? 1 : -1))
      .slice(0, 14),
  };
}

function Analysis({ stats }) {
  if (!stats.total) return null;
  return (
    <div className="mt-6 space-y-5">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Analysis</h2>

      {/* headline cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total alerts" value={stats.total} />
        <Stat label="Placed" value={stats.placed} tone="bull" />
        <Stat label="Missed" value={stats.missed} tone="bear" />
        <Stat label="Placement rate" value={`${stats.rate}%`} tone="accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* by pair */}
        <Breakdown
          title="By pair"
          rows={stats.byPair.map((r) => ({
            label: r.pair,
            total: r.total,
            placed: r.placed,
            rate: r.rate,
          }))}
        />

        {/* by direction */}
        <Breakdown
          title="By direction"
          rows={[
            {
              label: "Bullish",
              total: stats.byDir.bullish.total,
              placed: stats.byDir.bullish.placed,
              rate: pct(stats.byDir.bullish.placed, stats.byDir.bullish.total),
            },
            {
              label: "Bearish",
              total: stats.byDir.bearish.total,
              placed: stats.byDir.bearish.placed,
              rate: pct(stats.byDir.bearish.placed, stats.byDir.bearish.total),
            },
          ].filter((r) => r.total)}
        />
      </div>

      {/* by day */}
      <Breakdown
        title="By day (last 14)"
        rows={stats.byDay.map((r) => ({
          label: r.day,
          total: r.total,
          placed: r.placed,
          rate: r.rate,
        }))}
      />
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
      ? "text-bear"
      : tone === "accent"
      ? "text-accent"
      : "text-ink";
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-2xl font-bold mt-1 tnum ${color}`}>{value}</div>
    </div>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-4 text-xs text-muted">No data.</div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.label} className="px-4 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{r.label}</span>
                <span className="text-muted tnum">
                  <span className="text-bull">{r.placed}</span> / {r.total} placed ·{" "}
                  <span className="text-accent">{r.rate}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-panel2 overflow-hidden">
                <div
                  className="h-full bg-bull rounded-full"
                  style={{ width: `${r.rate}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
