"use client";

import { Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Clickable session cards. Clicking a card toggles it in the session filter.
// wins = TP hits, losses = SL hits.
export function SessionBreakdown({ sessions, selected = [], onToggle }) {
  // best session = highest net R among sessions that have closed trades
  let bestKey = null;
  let bestR = -Infinity;
  for (const s of sessions) {
    if (s.closed > 0 && s.netR > bestR) {
      bestR = s.netR;
      bestKey = s.key;
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {sessions.map((s) => {
        const active = selected.includes(s.key);
        const isBest = s.key === bestKey && s.closed > 0;
        const empty = s.signals === 0;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={active}
            disabled={empty}
            className={cn(
              "flex flex-col rounded-lg border p-3 text-left transition",
              active
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/40",
              empty && "cursor-not-allowed opacity-50 hover:border-border"
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-sm font-semibold">{s.label}</span>
              {isBest ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-bull/40 bg-bull/10 px-1.5 py-0 text-[10px] text-bull"
                >
                  <Trophy className="size-3" aria-hidden="true" />
                  Best
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">{s.signals} sig</span>
              )}
            </div>
            <span className="mt-0.5 font-mono text-[10px] text-muted-foreground tnum">
              {s.window} IST
            </span>
            <div className="mt-2 flex items-end gap-1.5">
              <span
                className={cn(
                  "text-2xl font-bold",
                  s.closed === 0
                    ? "text-muted-foreground"
                    : s.winRate >= 50
                    ? "text-bull"
                    : "text-bear"
                )}
              >
                {s.winRate}%
              </span>
              <span className="mb-1 text-[10px] text-muted-foreground">win</span>
            </div>
            <div className="mt-1 font-mono text-[11px] tnum">
              <span className="text-bull">{s.wins} TP</span>{" · "}
              <span className="text-bear">{s.losses} SL</span>
            </div>
            <div className="mt-0.5 font-mono text-[11px] tnum">
              Net{" "}
              <span className={cn("font-semibold", s.netR >= 0 ? "text-bull" : "text-bear")}>
                {s.netR > 0 ? `+${s.netR}` : s.netR}R
              </span>
              {s.open > 0 && (
                <span className="text-muted-foreground"> · {s.open} open</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
