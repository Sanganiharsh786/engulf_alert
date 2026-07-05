import { TrendingUp, TrendingDown, Diamond } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
