"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/components/backtest/utils";

function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

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
  return calendar;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- Win-rate calendar for the trades breakdown ---------- */

export function TradesCalendar({ monthKey, days, selectedDay, onDayClick }) {
  const [year, month] = monthKey.split("-").map(Number);
  const calendar = buildCalendarGrid(year, month);

  const dayMap = {};
  days.forEach((day) => {
    const dayNum = parseInt(day.date.split("-")[2]);
    dayMap[dayNum] = day;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-center text-sm">
          {MONTHS[month - 1]} {year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-2 grid grid-cols-7 gap-1">
          {DAY_NAMES.map((name) => (
            <div key={name} className="py-1 text-center text-[10px] font-medium text-muted-foreground sm:text-xs">
              {name}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {calendar.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-1">
              {week.map((day, dayIndex) => {
                if (day === null) return <div key={dayIndex} className="h-12 sm:h-14" />;

                const dayData = dayMap[day];
                const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isSelected = selectedDay === dayKey;
                const hasData = dayData && dayData.signals > 0;

                return (
                  <button
                    key={day}
                    onClick={() => hasData && onDayClick(dayKey)}
                    disabled={!hasData}
                    aria-pressed={isSelected}
                    className={cn(
                      "relative h-12 rounded-md text-xs transition sm:h-14",
                      !hasData
                        ? "cursor-not-allowed text-muted-foreground/40"
                        : isSelected
                        ? "border border-primary bg-primary/20 font-bold text-primary"
                        : "border border-border/50 bg-popover hover:border-primary/40 hover:bg-popover/70"
                    )}
                  >
                    <div className="absolute left-1 top-1 text-[9px] sm:text-[10px]">{day}</div>
                    {hasData && (
                      <div className="mt-2">
                        <div
                          className={cn(
                            "text-xs font-bold sm:text-sm",
                            dayData.winRate >= 50 ? "text-bull" : "text-bear"
                          )}
                        >
                          {dayData.winRate}%
                        </div>
                        <div className="text-[8px] text-muted-foreground sm:text-[9px]">{dayData.signals} sig</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded border border-bull/40 bg-bull/20" />
            <span>{"≥50% win rate"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-3 rounded border border-bear/40 bg-bear/20" />
            <span>{"<50% win rate"}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- News events calendar ---------- */

export function NewsCalendar({ monthKey, dayMap, onDayClick }) {
  const [year, month] = monthKey.split("-").map(Number);
  const calendar = buildCalendarGrid(year, month);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-center text-sm">
          {MONTHS[month - 1]} {year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-2 grid grid-cols-7 gap-1">
          {DAY_NAMES.map((n) => (
            <div key={n} className="py-1 text-center text-[10px] font-medium text-muted-foreground sm:text-xs">
              {n}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {calendar.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((day, di) => {
                if (day === null) return <div key={di} className="h-12 sm:h-16" />;

                const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const evts = dayMap[dayKey];
                const hasNews = evts && evts.length > 0;
                const types = hasNews ? [...new Set(evts.map((e) => e.type))] : [];
                const hasUpcoming = hasNews && evts.some((e) => e.isUpcoming);

                return (
                  <button
                    key={day}
                    onClick={() => hasNews && onDayClick(dayKey)}
                    disabled={!hasNews}
                    title={
                      hasNews
                        ? evts.map((e) => `${e.type} · ${e.label}${e.isUpcoming ? " (upcoming)" : ""}`).join("\n")
                        : ""
                    }
                    className={cn(
                      "relative flex h-12 flex-col items-center justify-center rounded-md text-xs transition sm:h-16",
                      !hasNews
                        ? "cursor-default text-muted-foreground/30"
                        : hasUpcoming
                        ? "cursor-pointer border border-bull/40 bg-bull/10 shadow-[0_0_12px_rgba(38,166,154,0.2)] hover:border-bull"
                        : "cursor-pointer border border-border/50 bg-popover hover:border-primary/40 hover:bg-popover/70"
                    )}
                  >
                    <div className="absolute left-1.5 top-1 text-[9px] font-medium sm:text-[10px]">{day}</div>
                    {hasNews && (
                      <div className="mt-2 flex items-center gap-1">
                        {types.map((t) => (
                          <span
                            key={t}
                            className={cn(
                              "size-2 rounded-full",
                              t === "NFP" ? "bg-bear" : t === "CPI" ? "bg-gold" : "bg-primary",
                              hasUpcoming && "animate-pulse"
                            )}
                          />
                        ))}
                      </div>
                    )}
                    {hasNews && (
                      <div className="mt-0.5 hidden text-[9px] text-muted-foreground sm:block">
                        {evts.length} event{evts.length > 1 ? "s" : ""}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-bear" />
            <span>NFP</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-gold" />
            <span>CPI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-primary" />
            <span>FOMC</span>
          </div>
          <div className="text-[10px] text-bull/70">Highlighted = upcoming</div>
          <div className="text-[10px] text-muted-foreground/60">Click a news day to view chart</div>
        </div>
      </CardContent>
    </Card>
  );
}
