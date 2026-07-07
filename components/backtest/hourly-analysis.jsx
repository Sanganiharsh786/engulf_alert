"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hourly Performance Analysis Component
 * Shows which hours (IST) have the best TP hit rates and returns
 * Helps traders identify optimal trading hours instead of trading all day
 */
export function HourlyAnalysis({ trades, selectedHours = [], onHourToggle }) {
  // Helper functions - defined at component level
  const formatHour = (h) => {
    return `${String(h).padStart(2, "0")}:00`;
  };

  const getHourLabel = (h) => {
    return `${formatHour(h)}–${formatHour(h + 1)}`;
  };

  const hourlyStats = useMemo(() => {
    // Group trades by hour of day (0-23 in IST)
    const byHour = {};
    
    for (let h = 0; h < 24; h++) {
      byHour[h] = {
        hour: h,
        signals: 0,
        closed: 0,
        wins: 0,
        losses: 0,
        open: 0,
        netR: 0,
        avgR: 0,
      };
    }

    for (const t of trades) {
      const hour = parseInt(t.time.slice(11, 13), 10); // Extract hour from "YYYY-MM-DDTHH:MM"
      const s = byHour[hour];
      
      s.signals++;
      if (t.outcome === "open") {
        s.open++;
      } else {
        s.closed++;
        if (t.outcome === "win") s.wins++;
        else if (t.outcome === "loss") s.losses++;
        s.netR += t.r;
      }
    }

    // Calculate win rates and average R
    const stats = Object.values(byHour).map((s) => ({
      ...s,
      netR: Math.round(s.netR * 100) / 100,
      avgR: s.closed > 0 ? Math.round((s.netR / s.closed) * 100) / 100 : 0,
      winRate: s.closed > 0 ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    }));

    // Sort by performance (win rate * signals to prioritize active + profitable hours)
    return stats.sort((a, b) => {
      const scoreA = a.closed > 0 ? (a.winRate * a.signals) / 100 : 0;
      const scoreB = b.closed > 0 ? (b.winRate * b.signals) / 100 : 0;
      return scoreB - scoreA;
    });
  }, [trades]);

  // Find best performing hours (win rate > 50% and at least 3 closed trades)
  const bestHours = useMemo(() => {
    return hourlyStats
      .filter((s) => s.closed >= 3 && s.winRate >= 50)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 8); // Top 8 hours
  }, [hourlyStats]);

  // Time range summary for best hours
  const timeRanges = useMemo(() => {
    if (bestHours.length === 0) return [];
    
    const sorted = [...bestHours].sort((a, b) => a.hour - b.hour);
    const ranges = [];
    let start = sorted[0].hour;
    let end = sorted[0].hour;

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].hour === end + 1) {
        end = sorted[i].hour;
      } else {
        ranges.push({ start, end });
        start = sorted[i].hour;
        end = sorted[i].hour;
      }
    }
    ranges.push({ start, end });

    return ranges.map(r => ({
      ...r,
      label: r.start === r.end 
        ? `${formatHour(r.start)}`
        : `${formatHour(r.start)}–${formatHour(r.end + 1)}`,
    }));
  }, [bestHours]);

  // Performance level classification
  const getPerformanceLevel = (winRate, signals) => {
    if (signals < 3) return "insufficient";
    if (winRate >= 60) return "excellent";
    if (winRate >= 50) return "good";
    if (winRate >= 40) return "moderate";
    return "poor";
  };

  const levelColors = {
    excellent: "border-green-500/50 bg-green-500/10",
    good: "border-blue-500/50 bg-blue-500/10",
    moderate: "border-yellow-500/50 bg-yellow-500/10",
    poor: "border-red-500/50 bg-red-500/10",
    insufficient: "border-border bg-muted/30",
  };

  const applyBestHours = () => {
    if (!onHourToggle) return;
    const hours = bestHours.map(h => h.hour);
    hours.forEach(h => onHourToggle(h, true));
  };

  const exportHourlySummary = () => {
    const csv = [
      ["Hour (IST)", "Signals", "Closed", "Wins", "Losses", "Win Rate %", "Net R", "Avg R"].join(","),
      ...hourlyStats.map(s => 
        [
          getHourLabel(s.hour),
          s.signals,
          s.closed,
          s.wins,
          s.losses,
          s.winRate,
          s.netR,
          s.avgR
        ].join(",")
      )
    ].join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hourly-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Summary Card - Best Trading Hours */}
      {bestHours.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-1">🎯 Optimal Trading Hours (IST)</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Focus on these hours for best performance (50%+ win rate, min. 3 trades)
                </p>
                <div className="flex flex-wrap gap-2">
                  {timeRanges.map((range, i) => (
                    <div
                      key={i}
                      className="rounded-md bg-primary/20 px-3 py-1.5 font-mono text-sm font-semibold text-primary"
                    >
                      {range.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-right">
                  <div className="text-2xl font-bold text-bull">{bestHours.length}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Best Hours
                  </div>
                </div>
                {onHourToggle && (
                  <Button size="sm" onClick={applyBestHours} className="whitespace-nowrap">
                    <Clock className="mr-1" />
                    Filter These
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hourly Performance Grid */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Performance by hour (IST) · {onHourToggle ? "click hours to filter" : "showing all 24 hours"}
            {selectedHours.length > 0 && ` · ${selectedHours.length} hours selected`}
          </span>
          <div className="flex gap-2">
            {selectedHours.length > 0 && onHourToggle && (
              <Button variant="ghost" size="sm" onClick={() => selectedHours.forEach(h => onHourToggle(h, false))}>
                <X />
                Clear Hours
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportHourlySummary}>
              <Download />
              Export CSV
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {hourlyStats
            .sort((a, b) => a.hour - b.hour)
            .map((stat) => {
              const level = getPerformanceLevel(stat.winRate, stat.closed);
              const hasData = stat.closed > 0;
              const isSelected = selectedHours.includes(stat.hour);

              return (
                <Card
                  key={stat.hour}
                  className={cn(
                    "transition-all cursor-pointer",
                    hasData ? levelColors[level] : levelColors.insufficient,
                    isSelected && "ring-2 ring-primary ring-offset-2 scale-105",
                    onHourToggle && "hover:scale-105"
                  )}
                  onClick={() => onHourToggle && hasData && onHourToggle(stat.hour)}
                >
                  <CardContent className="p-3">
                    {/* Hour label */}
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn(
                        "font-mono text-xs font-semibold",
                        isSelected && "text-primary"
                      )}>
                        {getHourLabel(stat.hour)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {stat.signals} sig
                      </span>
                    </div>

                    {/* Win rate - main metric */}
                    {hasData ? (
                      <>
                        <div className="mb-1">
                          <span
                            className={cn(
                              "text-xl font-bold",
                              stat.winRate >= 50 ? "text-bull" : "text-bear"
                            )}
                          >
                            {stat.winRate}%
                          </span>
                        </div>

                        {/* Stats */}
                        <div className="space-y-0.5 text-[10px]">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">W/L</span>
                            <span className="font-mono">
                              <span className="text-bull">{stat.wins}</span>
                              /
                              <span className="text-bear">{stat.losses}</span>
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Net R</span>
                            <span
                              className={cn(
                                "font-mono font-semibold",
                                stat.netR >= 0 ? "text-bull" : "text-bear"
                              )}
                            >
                              {stat.netR > 0 ? "+" : ""}
                              {stat.netR}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg R</span>
                            <span
                              className={cn(
                                "font-mono",
                                stat.avgR >= 0 ? "text-bull" : "text-bear"
                              )}
                            >
                              {stat.avgR > 0 ? "+" : ""}
                              {stat.avgR}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-2">
                        <span className="text-xs text-muted-foreground">No data</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </div>
      </div>

      {/* Performance Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground">Performance levels:</span>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border-2 border-green-500/50 bg-green-500/10" />
          <span>Excellent (60%+)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border-2 border-blue-500/50 bg-blue-500/10" />
          <span>Good (50-60%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border-2 border-yellow-500/50 bg-yellow-500/10" />
          <span>Moderate (40-50%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border-2 border-red-500/50 bg-red-500/10" />
          <span>Poor (&lt;40%)</span>
        </div>
      </div>
    </div>
  );
}
