"use client";

import { useMemo, useState } from "react";
import { Newspaper, Search, MousePointerClick } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/backtest/spinner";
import { NewsCalendar } from "@/components/backtest/calendars";
import { NewsChartDialog } from "@/components/backtest/news-chart-dialog";
import { NewsCandleBadge, NewsTypeBadge } from "@/components/backtest/news-badge";
import { IST_OFFSET_MS, MONTHS } from "@/components/backtest/utils";
import { useToast } from "@/app/toast";
import { cn } from "@/lib/utils";

const NEWS_YEARS = [2022, 2023, 2024, 2025, 2026];

function NewsStats({ events }) {
  const stats = {};
  for (const ev of events) {
    for (const a of ev.analysis) {
      if (a.error) continue;
      if (!stats[a.symbol]) stats[a.symbol] = { bullish: 0, bearish: 0, doji: 0, total: 0 };
      stats[a.symbol][a.classification]++;
      stats[a.symbol].total++;
    }
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Object.entries(stats).map(([sym, s]) => (
        <Card key={sym}>
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <span className="text-sm font-semibold">{sym}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-bull" />
                <span className="font-bold text-bull">{s.bullish}</span>
                <span className="text-muted-foreground">bull</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-bear" />
                <span className="font-bold text-bear">{s.bearish}</span>
                <span className="text-muted-foreground">bear</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-gold" />
                <span className="font-bold text-gold">{s.doji}</span>
                <span className="text-muted-foreground">doji</span>
              </span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="text-bull">{s.total > 0 ? Math.round((s.bullish / s.total) * 100) : 0}%</span> bull
              rate
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function NewsSection() {
  const [newsEvents, setNewsEvents] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");
  const [newsTypes, setNewsTypes] = useState(["NFP", "FOMC", "CPI"]);
  const [newsYearFrom, setNewsYearFrom] = useState("2023");
  const [newsYearTo, setNewsYearTo] = useState("2025");
  const [selectedNewsEvent, setSelectedNewsEvent] = useState(null);
  const [newsMonthSel, setNewsMonthSel] = useState(null);
  const toast = useToast();

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
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
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

  const newsMonths = useMemo(() => {
    if (!newsEvents) return [];
    const s = new Set();
    for (const ev of newsEvents) {
      const d = new Date(ev.ts);
      const ist = new Date(d.getTime() + IST_OFFSET_MS);
      s.add(ist.toISOString().slice(0, 7));
    }
    return [...s].sort();
  }, [newsEvents]);

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

  return (
    <section aria-labelledby="news-analysis-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="news-analysis-heading" className="flex items-center gap-2 text-base font-bold tracking-tight">
          <Newspaper className="size-4 text-primary" aria-hidden="true" />
          News Candle Analysis
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          1m candle reaction at NFP, FOMC &amp; CPI releases · gold &amp; BTC · times in IST
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Events</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={newsTypes}
              onValueChange={(v) => setNewsTypes(v)}
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
            <Label htmlFor="news-year-from" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              From
            </Label>
            <Select value={newsYearFrom} onValueChange={setNewsYearFrom}>
              <SelectTrigger id="news-year-from" className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {NEWS_YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="news-year-to" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              To
            </Label>
            <Select value={newsYearTo} onValueChange={setNewsYearTo}>
              <SelectTrigger id="news-year-to" className="w-full sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {NEWS_YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={fetchNewsCandles} disabled={newsLoading || newsTypes.length === 0}>
            {newsLoading ? <Spinner className="size-4 text-primary-foreground" /> : <Search />}
            {newsLoading ? "Fetching…" : "Analyze"}
          </Button>
        </CardContent>
      </Card>

      {newsError && (
        <Alert variant="destructive">
          <AlertDescription>{newsError}</AlertDescription>
        </Alert>
      )}

      {newsEvents && (
        <>
          <NewsStats events={newsEvents} />

          {newsMonths.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Calendar</span>
              {newsMonths.map((m) => {
                const [y, mo] = m.split("-");
                const label = `${MONTHS[Number(mo) - 1]} ${y}`;
                return (
                  <Button
                    key={m}
                    size="sm"
                    variant={newsMonthSel === m ? "default" : "outline"}
                    onClick={() => setNewsMonthSel(newsMonthSel === m ? null : m)}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          )}

          {newsMonthSel && (
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
          )}

          {/* Events table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">News Events ({newsEvents.length})</CardTitle>
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <MousePointerClick className="size-3.5" aria-hidden="true" />
                Tap any event to view its chart
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-xs">Date (IST)</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Time (IST)</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Event</TableHead>
                      {newsEvents[0]?.analysis?.map((a) => (
                        <TableHead key={a.symbol} className="whitespace-nowrap text-center text-xs">
                          {a.symbol}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-mono text-xs tnum">
                    {newsEvents.map((ev, i) => {
                      const d = new Date(ev.ts);
                      const istDate = new Date(d.getTime() + IST_OFFSET_MS);
                      const dateStr = istDate.toISOString().slice(0, 10);
                      const timeStr = istDate.toISOString().slice(11, 16);
                      return (
                        <TableRow
                          key={i}
                          className={cn(
                            "cursor-pointer",
                            selectedNewsEvent === ev && "bg-primary/5",
                            ev.isUpcoming && "bg-bull/5"
                          )}
                          onClick={() => setSelectedNewsEvent(ev)}
                        >
                          <TableCell className="whitespace-nowrap">
                            {dateStr}
                            {ev.isUpcoming && (
                              <Badge variant="outline" className="ml-2 animate-pulse border-bull/40 bg-bull/10 text-[9px] text-bull">
                                UPCOMING
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{timeStr}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <NewsTypeBadge type={ev.type} />
                            <span className="ml-1.5 text-muted-foreground">{ev.label}</span>
                          </TableCell>
                          {ev.analysis.map((a, j) => (
                            <TableCell key={j} className="whitespace-nowrap text-center">
                              {a.error ? (
                                <span className="text-[10px] text-bear" title={a.error}>
                                  error
                                </span>
                              ) : (
                                <NewsCandleBadge analysis={a} />
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <NewsChartDialog event={selectedNewsEvent} onClose={() => setSelectedNewsEvent(null)} />
    </section>
  );
}
