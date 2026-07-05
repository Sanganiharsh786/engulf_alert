"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  LineChart,
  Mail,
  MessageSquare,
  ExternalLink,
  Inbox,
} from "lucide-react";
import { useToast } from "../toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

const fmt = (n) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DirBadge({ direction }) {
  const bull = direction === "bullish";
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent font-semibold",
        bull ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
      )}
    >
      {String(direction || "").toUpperCase()}
    </Badge>
  );
}

function DeliveryIcons({ alert: a }) {
  return (
    <div className="flex items-center gap-1.5">
      {a.emailed !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(a.emailed ? "text-bull" : "text-bear")}>
              <Mail className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {a.emailed ? "Email sent" : `Email failed: ${a.emailError || "Unknown error"}`}
          </TooltipContent>
        </Tooltip>
      )}
      {a.telegramSent !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(a.telegramSent ? "text-bull" : "text-bear")}>
              <MessageSquare className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {a.telegramSent
              ? "Telegram sent"
              : `Telegram failed: ${a.telegramError || "Unknown error"}`}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default function TotalAlerts() {
  const [alerts, setAlerts] = useState(null);
  const [filter, setFilter] = useState("all"); // all | today | placed | missed
  const [saving, setSaving] = useState(null);
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
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, placed: !placed } : a)));
      toast(`Could not save · ${e.message || e}`, "error");
    } finally {
      setSaving(null);
    }
  }

  const today = useMemo(() => dayKey(Date.now()), []);

  const counts = useMemo(() => {
    const a = alerts || [];
    return {
      all: a.length,
      today: a.filter((x) => dayKey(x.ts) === today).length,
      placed: a.filter((x) => x.placed).length,
      missed: a.filter((x) => !x.placed).length,
    };
  }, [alerts, today]);

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

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Total Alerts</h1>
          <p className="text-xs text-muted-foreground text-pretty">
            Tick the trades you actually placed. The end-of-day analysis updates below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft data-icon="inline-start" />
              Dashboard
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/backtest">
              <LineChart data-icon="inline-start" />
              Backtest
            </Link>
          </Button>
        </div>
      </header>

      {/* filters */}
      <div className="mt-5">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="flex w-full flex-wrap justify-start sm:w-auto">
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="today">Today ({counts.today})</TabsTrigger>
            <TabsTrigger value="placed">Placed ({counts.placed})</TabsTrigger>
            <TabsTrigger value="missed">Missed ({counts.missed})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* content */}
      {alerts === null ? (
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="py-4">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>No alerts {filter === "all" ? "yet" : "in this view"}</EmptyTitle>
                <EmptyDescription>
                  Alerts appear here automatically when an engulfing candle hits a level.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* desktop table */}
          <Card className="mt-4 hidden overflow-hidden py-0 md:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Placed</TableHead>
                    <TableHead>Date / time</TableHead>
                    <TableHead>Pair</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>SL</TableHead>
                    <TableHead>TP</TableHead>
                    <TableHead>Lots</TableHead>
                    <TableHead>Alerts</TableHead>
                    <TableHead className="text-right">TV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((a) => (
                    <TableRow key={a.id} className={cn(a.placed && "bg-bull/5")}>
                      <TableCell>
                        <Checkbox
                          checked={!!a.placed}
                          disabled={saving === a.id}
                          onCheckedChange={(v) => togglePlaced(a.id, !!v)}
                          aria-label="Mark trade as placed"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {fmtTime(a.ts)}
                      </TableCell>
                      <TableCell className="font-medium">{a.pair}</TableCell>
                      <TableCell>
                        <DirBadge direction={a.direction} />
                      </TableCell>
                      <TableCell className="tnum whitespace-nowrap font-mono text-muted-foreground">
                        {fmt(a.low)} → {fmt(a.high)}
                      </TableCell>
                      <TableCell className="tnum font-mono">{fmt(a.position?.entry)}</TableCell>
                      <TableCell className="tnum font-mono text-bear">{fmt(a.position?.stop)}</TableCell>
                      <TableCell className="tnum font-mono text-bull">{fmt(a.position?.tp)}</TableCell>
                      <TableCell className="tnum font-mono text-primary">{fmt(a.position?.lots)}</TableCell>
                      <TableCell>
                        <DeliveryIcons alert={a} />
                      </TableCell>
                      <TableCell className="text-right">
                        {a.link ? (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex text-primary hover:text-primary/80"
                            aria-label="Open in TradingView"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* mobile cards */}
          <div className="mt-4 flex flex-col gap-3 md:hidden">
            {visible.map((a) => (
              <Card key={a.id} className={cn(a.placed && "border-bull/40 bg-bull/5")}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-center gap-2.5">
                      <Checkbox
                        checked={!!a.placed}
                        disabled={saving === a.id}
                        onCheckedChange={(v) => togglePlaced(a.id, !!v)}
                        aria-label="Mark trade as placed"
                      />
                      <span className="text-sm font-semibold">{a.pair}</span>
                      <DirBadge direction={a.direction} />
                    </label>
                    <span className="text-right text-xs text-muted-foreground">{fmtTime(a.ts)}</span>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Entry</dt>
                      <dd className="tnum font-mono">{fmt(a.position?.entry)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Lots</dt>
                      <dd className="tnum font-mono text-primary">{fmt(a.position?.lots)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">SL</dt>
                      <dd className="tnum font-mono text-bear">{fmt(a.position?.stop)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">TP</dt>
                      <dd className="tnum font-mono text-bull">{fmt(a.position?.tp)}</dd>
                    </div>
                    <div className="col-span-2 flex justify-between gap-2">
                      <dt className="text-muted-foreground">Zone</dt>
                      <dd className="tnum font-mono">
                        {fmt(a.low)} → {fmt(a.high)}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-between border-t pt-2.5">
                    <DeliveryIcons alert={a} />
                    {a.link && (
                      <a
                        href={a.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                      >
                        TradingView <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* analysis */}
      {alerts && <Analysis stats={stats} />}
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
    <div className="mt-8 flex flex-col gap-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Analysis</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total alerts" value={stats.total} />
        <Stat label="Placed" value={stats.placed} tone="bull" />
        <Stat label="Missed" value={stats.missed} tone="bear" />
        <Stat label="Placement rate" value={`${stats.rate}%`} tone="primary" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Breakdown
          title="By pair"
          rows={stats.byPair.map((r) => ({ label: r.pair, total: r.total, placed: r.placed, rate: r.rate }))}
        />
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

      <Breakdown
        title="By day (last 14)"
        rows={stats.byDay.map((r) => ({ label: r.day, total: r.total, placed: r.placed, rate: r.rate }))}
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
      : tone === "primary"
      ? "text-primary"
      : "text-foreground";
  return (
    <Card>
      <CardContent>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("tnum mt-1 text-2xl font-bold", color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, rows }) {
  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">No data.</div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.label} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{r.label}</span>
                  <span className="tnum text-muted-foreground">
                    <span className="text-bull">{r.placed}</span> / {r.total} placed ·{" "}
                    <span className="text-primary">{r.rate}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-bull" style={{ width: `${r.rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
