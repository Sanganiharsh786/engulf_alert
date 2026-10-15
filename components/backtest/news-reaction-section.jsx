"use client";

import { useMemo, useState } from "react";
import { Activity, Search, MousePointerClick, ArrowRight, Undo2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Pagination, usePagination } from "@/components/backtest/pagination";
import { Spinner } from "@/components/backtest/spinner";
import { NewsReactionDialog } from "@/components/backtest/news-reaction-dialog";
import { NewsCandleBadge, NewsTypeBadge, VerdictBadge } from "@/components/backtest/news-badge";
import { IST_OFFSET_MS } from "@/components/backtest/utils";
import { cn } from "@/lib/utils";

const YEARS = [2022, 2023, 2024, 2025, 2026];
const HORIZONS = ["15m", "1h"];

const BULL = "#26a69a";
const BEAR = "#ef5350";
const GOLD = "#f1c40f";
const MUTED = "#94a3b8";

const chartTooltip = {
  contentStyle: {
    background: "#0e1422",
    border: "1px solid #1e2840",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#e8edff" },
};

/* --------------------------- headline stat cards --------------------------- */

function SplitBar({ contPct, revPct, flatPct }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="bg-bull" style={{ width: `${contPct}%` }} />
      <div className="bg-bear" style={{ width: `${revPct}%` }} />
      <div className="bg-muted-foreground/40" style={{ width: `${flatPct}%` }} />
    </div>
  );
}

function HorizonSummary({ tf, agg, caption }) {
  const leaning = agg.revPct > agg.contPct ? "reversal" : agg.contPct > agg.revPct ? "continuation" : "split";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">
            {tf} close
            <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              {caption}
            </span>
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {agg.n} events
          </span>
        </div>

        <div className="mt-3 flex items-end gap-4">
          <div>
            <div className="flex items-center gap-1 text-2xl font-bold text-bull">
              <ArrowRight className="size-5" aria-hidden="true" />
              {agg.contPct}%
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              same direction ({agg.continuation})
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-2xl font-bold text-bear">
              <Undo2 className="size-5" aria-hidden="true" />
              {agg.revPct}%
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              reversed ({agg.reversal})
            </div>
          </div>
        </div>

        <div className="mt-3">
          <SplitBar contPct={agg.contPct} revPct={agg.revPct} flatPct={agg.flatPct} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <Stat label="avg move" value={`${agg.avgMoveR > 0 ? "+" : ""}${agg.avgMoveR}R`} cls={agg.avgMoveR >= 0 ? "text-bull" : "text-bear"} />
          <Stat label="avg run" value={`${agg.avgMfeR}R`} cls="text-bull" />
          <Stat label="avg pullback" value={`${agg.avgMaeR}R`} cls="text-bear" />
          <Stat label="broke extreme first" value={`${agg.firstContPct}%`} />
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Leans <span className={leaning === "reversal" ? "text-bear" : leaning === "continuation" ? "text-bull" : ""}>{leaning}</span>
          {agg.flat ? ` · ${agg.flat} closed flat` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, cls = "" }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("font-mono font-bold", cls)}>{value}</div>
    </div>
  );
}

/* ------------------------------- the charts ------------------------------- */

function DirectionSplitChart({ stat }) {
  const data = useMemo(() => {
    const rows = [];
    for (const dir of ["bearish", "bullish"]) {
      for (const tf of HORIZONS) {
        const agg = stat.byDir[dir]?.horizons?.[tf];
        if (!agg || !agg.n) continue;
        rows.push({
          name: `${dir === "bearish" ? "down" : "up"} news · ${tf}`,
          continuation: agg.contPct,
          reversal: agg.revPct,
          flat: agg.flatPct,
          n: agg.n,
        });
      }
    }
    return rows;
  }, [stat]);

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Continuation vs reversal, by news-candle direction</CardTitle>
        <CardDescription className="text-xs">
          % of releases where the HTF close finished beyond / behind the 1m news candle close
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] p-2 sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid stroke="#1e2840" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} interval={0} />
            <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10, fill: MUTED }} />
            <Tooltip
              {...chartTooltip}
              formatter={(v, k) => [`${v}%`, k]}
              labelFormatter={(l) => {
                const row = data.find((d) => d.name === l);
                return `${l} · ${row?.n ?? 0} events`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="continuation" name="same direction" fill={BULL} radius={[3, 3, 0, 0]} />
            <Bar dataKey="reversal" name="reversed" fill={BEAR} radius={[3, 3, 0, 0]} />
            <Bar dataKey="flat" name="flat" fill={MUTED} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function DriftChart({ path }) {
  if (!path?.series?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Average drift after the news candle closes</CardTitle>
        <CardDescription className="text-xs">
          Minute by minute, in news-candle ranges (R). Above 0 = still going the news candle&apos;s way.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] p-2 sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={path.series} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid stroke="#1e2840" vertical={false} />
            <XAxis
              dataKey="m"
              tick={{ fontSize: 10, fill: MUTED }}
              tickFormatter={(m) => `${m}m`}
              interval={9}
            />
            <YAxis unit="R" tick={{ fontSize: 10, fill: MUTED }} />
            <Tooltip {...chartTooltip} labelFormatter={(m) => `${m} min after news close`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke={GOLD} strokeDasharray="4 4" />
            <ReferenceLine x={14} stroke="#3b82f6" strokeDasharray="2 4" label={{ value: "15m close", fill: MUTED, fontSize: 10, position: "insideTopRight" }} />
            <Line
              type="monotone" dataKey="all" name={`all (${path.counts.all})`}
              stroke={GOLD} strokeWidth={2} dot={false} connectNulls
            />
            <Line
              type="monotone" dataKey="continuation" name={`15m continued (${path.counts.continuation})`}
              stroke={BULL} strokeWidth={1.5} dot={false} connectNulls
            />
            <Line
              type="monotone" dataKey="reversal" name={`15m reversed (${path.counts.reversal})`}
              stroke={BEAR} strokeWidth={1.5} dot={false} connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TypeTable({ stat }) {
  const types = Object.keys(stat.byType || {});
  if (types.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">By event type</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Event</TableHead>
              <TableHead className="text-xs">n</TableHead>
              {HORIZONS.map((tf) => (
                <TableHead key={tf} className="text-center text-xs">
                  {tf} same / reversed
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono text-xs tnum">
            {types.map((t) => (
              <TableRow key={t}>
                <TableCell>
                  <NewsTypeBadge type={t} />
                </TableCell>
                <TableCell>{stat.byType[t].n}</TableCell>
                {HORIZONS.map((tf) => {
                  const a = stat.byType[t].horizons[tf];
                  return (
                    <TableCell key={tf} className="text-center">
                      <span className="text-bull">{a.contPct}%</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-bear">{a.revPct}%</span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ main section ------------------------------ */

export function NewsReactionSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [types, setTypes] = useState(["NFP", "FOMC", "CPI"]);
  const [yearFrom, setYearFrom] = useState("2024");
  const [yearTo, setYearTo] = useState("2026");
  const [symbol, setSymbol] = useState(null);
  const [dirFilter, setDirFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  async function run() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch("/api/news-reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsTypes: types,
          fromYear: Number(yearFrom),
          toYear: Number(yearTo),
          limit: 60,
        }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setData(json);
        setSymbol(json.symbols?.[0] ?? null);
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  const activeSymbol = symbol && data?.symbols?.includes(symbol) ? symbol : data?.symbols?.[0];
  const stat = data?.stats?.find((s) => s.symbol === activeSymbol);

  const rows = useMemo(() => {
    if (!data || !activeSymbol) return [];
    return data.events
      .map((ev) => {
        const s = ev.symbols.find((x) => x.symbol === activeSymbol);
        return s && !s.error ? { ev, s } : null;
      })
      .filter(Boolean)
      .filter(({ s }) => {
        if (dirFilter === "all") return true;
        if (dirFilter === "doji") return s.news.isDoji;
        return !s.news.isDoji && s.news.direction === dirFilter;
      });
  }, [data, activeSymbol, dirFilter]);

  const pager = usePagination(rows, 25);

  return (
    <section aria-labelledby="news-reaction-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="news-reaction-heading" className="flex items-center gap-2 text-base font-bold tracking-tight">
          <Activity className="size-4 text-primary" aria-hidden="true" />
          After the News Candle — Continuation vs Reversal
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The 1m candle prints on the release. Once it closes, how often does price keep going the same
          way, and how often does it flip? Judged at the 15m and 1h candle closes · times in IST
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Events</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={types}
              onValueChange={setTypes}
              className="justify-start"
            >
              {["NFP", "FOMC", "CPI"].map((t) => (
                <ToggleGroupItem key={t} value={t} aria-label={`Toggle ${t}`}>
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reaction-year-from" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              From
            </Label>
            <Select value={yearFrom} onValueChange={setYearFrom}>
              <SelectTrigger id="reaction-year-from" className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reaction-year-to" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              To
            </Label>
            <Select value={yearTo} onValueChange={setYearTo}>
              <SelectTrigger id="reaction-year-to" className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={run} disabled={loading || types.length === 0}>
            {loading ? <Spinner className="size-4 text-primary-foreground" /> : <Search />}
            {loading ? "Backtesting…" : "Backtest reaction"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && stat && (
        <>
          {data.symbols.length > 1 && (
            <Tabs value={activeSymbol} onValueChange={setSymbol}>
              <TabsList>
                {data.symbols.map((s) => (
                  <TabsTrigger key={s} value={s}>{s}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {HORIZONS.map((tf) => (
              <HorizonSummary
                key={tf}
                tf={tf}
                agg={stat.horizons[tf]}
                caption={tf === "15m" ? "instant reaction" : "held into the hour"}
              />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {stat.used} of {stat.total} releases had a directional 1m news candle
            {stat.doji > 0 && ` · ${stat.doji} were doji and are excluded from the rates`}
            {" · "}after a <span className="text-bear">down</span> news candle:{" "}
            <span className="text-bear">{stat.byDir.bearish.horizons["15m"].revPct}%</span> reversed by
            the 15m close, <span className="text-bull">{stat.byDir.bearish.horizons["15m"].contPct}%</span>{" "}
            fell further
          </p>
          <p className="text-[11px] text-muted-foreground">
            Both verdicts compare the HTF close with the 1m news candle&apos;s close, so + always means
            &ldquo;kept going&rdquo;. R = one news-candle range. NFP and CPI print at 08:30 ET, so their
            hourly candle closes 29 minutes later; FOMC prints on the hour, so its hourly close is 59
            minutes out — each row&apos;s exact wait is on its chart.
          </p>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <DirectionSplitChart stat={stat} />
            <DriftChart path={data.paths?.[activeSymbol]} />
          </div>

          <TypeTable stat={stat} />

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-sm">Every release ({rows.length})</CardTitle>
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  <MousePointerClick className="size-3.5" aria-hidden="true" />
                  Tap a row for the chart with the levels drawn on
                </CardDescription>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={dirFilter}
                onValueChange={(v) => v && setDirFilter(v)}
              >
                <ToggleGroupItem value="all" aria-label="All news candles">All</ToggleGroupItem>
                <ToggleGroupItem value="bearish" aria-label="Down news candles">Down</ToggleGroupItem>
                <ToggleGroupItem value="bullish" aria-label="Up news candles">Up</ToggleGroupItem>
                <ToggleGroupItem value="doji" aria-label="Doji news candles">Doji</ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-xs">Date (IST)</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Time</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Event</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">1m news candle</TableHead>
                      <TableHead className="whitespace-nowrap text-center text-xs">15m close</TableHead>
                      <TableHead className="whitespace-nowrap text-center text-xs">1h close</TableHead>
                      <TableHead className="whitespace-nowrap text-center text-xs">Hit first</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-mono text-xs tnum">
                    {pager.pageItems.map(({ ev, s }) => {
                      const ist = new Date(ev.ts + IST_OFFSET_MS);
                      const h15 = s.horizons?.["15m"];
                      return (
                        <TableRow
                          key={`${ev.ts}-${s.symbol}`}
                          className="cursor-pointer"
                          onClick={() => setSelected(ev)}
                        >
                          <TableCell className="whitespace-nowrap">{ist.toISOString().slice(0, 10)}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {ist.toISOString().slice(11, 16)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <NewsTypeBadge type={ev.type} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <NewsCandleBadge analysis={s.news} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            <VerdictBadge horizon={h15} tf="15m" compact />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            <VerdictBadge horizon={s.horizons?.["1h"]} tf="1h" compact />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center text-[10px] text-muted-foreground">
                            {h15?.firstTouch === "continuation"
                              ? s.news.dir < 0 ? "news low" : "news high"
                              : h15?.firstTouch === "reversal"
                              ? "news open"
                              : h15?.firstTouch === "both"
                              ? "both"
                              : "neither"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination pagination={pager} label="releases" />
            </CardContent>
          </Card>
        </>
      )}

      {selected && <NewsReactionDialog event={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
