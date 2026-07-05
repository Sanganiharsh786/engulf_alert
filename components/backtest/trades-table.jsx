"use client";

import { MousePointerClick } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SESSIONS, fmt, sessionOf } from "@/components/backtest/utils";

const SESSION_LABEL = Object.fromEntries(SESSIONS.map((s) => [s.key, s.short]));

function SessionTag({ time }) {
  return (
    <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
      {SESSION_LABEL[sessionOf(time)]}
    </Badge>
  );
}

function OutcomeBadge({ outcome }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        outcome === "win"
          ? "border-bull/40 bg-bull/10 text-bull"
          : outcome === "loss"
          ? "border-bear/40 bg-bear/10 text-bear"
          : "border-border text-muted-foreground"
      )}
    >
      {outcome.toUpperCase()}
    </Badge>
  );
}

function DirBadge({ direction }) {
  const bull = direction === "bullish";
  return (
    <Badge
      variant="outline"
      className={cn(bull ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear")}
    >
      {bull ? "BULL" : "BEAR"}
    </Badge>
  );
}

export function TradesTable({ trades, onTradeClick }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Trades ({trades.length})</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
              <MousePointerClick className="size-3.5" aria-hidden="true" />
              Tap any trade to view its chart
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {["Date/Time IST", "Day", "Session", "Pair", "Dir", "Level", "Entry", "Stop", "TP", "SL pips", "Lots", "Outcome", "Bars", "R"].map((h) => (
                  <TableHead key={h} className="whitespace-nowrap text-xs">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-xs tnum">
              {trades.map((t, i) => (
                <TableRow
                  key={i}
                  className="cursor-pointer"
                  onClick={() => onTradeClick(t)}
                  title="Click to view chart"
                >
                  <TableCell className="whitespace-nowrap">{t.time}</TableCell>
                  <TableCell>{t.day}</TableCell>
                  <TableCell>
                    <SessionTag time={t.time} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-semibold">{t.pair}</TableCell>
                  <TableCell>
                    <DirBadge direction={t.direction} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{t.level}</TableCell>
                  <TableCell>{fmt(t.entry)}</TableCell>
                  <TableCell className="text-bear">{fmt(t.stop)}</TableCell>
                  <TableCell className="text-bull">{fmt(t.tp)}</TableCell>
                  <TableCell>{t.slPips}</TableCell>
                  <TableCell className="text-primary">{t.lots ?? ""}</TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={t.outcome} />
                  </TableCell>
                  <TableCell>{t.barsHeld}</TableCell>
                  <TableCell
                    className={cn(
                      "font-bold",
                      t.r > 0 ? "text-bull" : t.r < 0 ? "text-bear" : "text-muted-foreground"
                    )}
                  >
                    {t.r}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="flex flex-col divide-y divide-border md:hidden">
          {trades.map((t, i) => (
            <button
              key={i}
              onClick={() => onTradeClick(t)}
              className="flex flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-popover"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.pair}</span>
                <DirBadge direction={t.direction} />
                <SessionTag time={t.time} />
                <OutcomeBadge outcome={t.outcome} />
                <span
                  className={cn(
                    "ml-auto font-mono text-sm font-bold tnum",
                    t.r > 0 ? "text-bull" : t.r < 0 ? "text-bear" : "text-muted-foreground"
                  )}
                >
                  {t.r > 0 ? `+${t.r}R` : `${t.r}R`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t.time} · {t.day} · Level {t.level}
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-xs tnum">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Entry</div>
                  <div>{fmt(t.entry)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Stop</div>
                  <div className="text-bear">{fmt(t.stop)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">TP</div>
                  <div className="text-bull">{fmt(t.tp)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {trades.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No trades match the current filters.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
