import { TrendingUp, TrendingDown, Diamond, ArrowRight, Undo2, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * What price did after the news candle closed, judged at an HTF close:
 * continuation = kept going the news candle's way, reversal = flipped.
 */
export function VerdictBadge({ horizon, tf, compact = false }) {
  if (!horizon || horizon.error) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const { verdict, closeVsNewsPct, closeVsNewsR, mfeR, maeR } = horizon;
  const cont = verdict === "continuation";
  const rev = verdict === "reversal";
  const Icon = cont ? ArrowRight : rev ? Undo2 : Minus;
  return (
    <Badge
      variant="outline"
      className={
        cont
          ? "gap-1 border-bull/40 bg-bull/10 text-bull"
          : rev
          ? "gap-1 border-bear/40 bg-bear/10 text-bear"
          : "gap-1 border-muted bg-muted/40 text-muted-foreground"
      }
      title={`${tf || ""} close ${closeVsNewsPct > 0 ? "+" : ""}${closeVsNewsPct}% vs news close · ${closeVsNewsR}R · ran ${mfeR}R / pulled back ${maeR}R`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {compact ? (cont ? "CONT" : rev ? "REV" : "FLAT") : verdict.toUpperCase()}
      <span className="opacity-70">
        {closeVsNewsPct > 0 ? "+" : ""}
        {closeVsNewsPct}%
      </span>
    </Badge>
  );
}

export function NewsTypeBadge({ type }) {
  return (
    <Badge
      variant="outline"
      className={
        type === "NFP"
          ? "border-bear/40 bg-bear/10 text-bear"
          : type === "CPI"
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-primary/40 bg-primary/10 text-primary"
      }
    >
      {type}
    </Badge>
  );
}

export function NewsCandleBadge({ analysis }) {
  const { classification, changePct, bodyPct } = analysis;
  const isBull = classification === "bullish";
  const isBear = classification === "bearish";
  const Icon = isBull ? TrendingUp : isBear ? TrendingDown : Diamond;
  return (
    <Badge
      variant="outline"
      className={
        isBull
          ? "gap-1 border-bull/40 bg-bull/10 text-bull"
          : isBear
          ? "gap-1 border-bear/40 bg-bear/10 text-bear"
          : "gap-1 border-gold/40 bg-gold/10 text-gold"
      }
      title={`Change: ${changePct > 0 ? "+" : ""}${changePct}% · Body: ${bodyPct}% of range`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {classification.toUpperCase()}
      {changePct !== 0 && (
        <span className="opacity-70">
          {changePct > 0 ? "+" : ""}
          {changePct}%
        </span>
      )}
    </Badge>
  );
}
