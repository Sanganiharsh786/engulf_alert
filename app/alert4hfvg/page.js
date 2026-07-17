"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { FVGChart } from "@/components/fvg-chart";
import { useToast } from "../toast";

const fmt = (n) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

const fmtTime = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const uid = () => Math.random().toString(36).slice(2, 9);

/* ─── Color scheme per pair ─── */
const PAIR_STYLES = {
  "EUR/USD": { bg: "from-blue-600/15 to-blue-900/5", border: "border-blue-500/25", accent: "text-blue-400", label: "EUR/USD" },
  "USD/JPY": { bg: "from-red-600/15 to-red-900/5", border: "border-red-500/25", accent: "text-red-400", label: "USD/JPY" },
  "USD/CAD": { bg: "from-orange-600/15 to-orange-900/5", border: "border-orange-500/25", accent: "text-orange-400", label: "USD/CAD" },
  "XAU/USD": { bg: "from-amber-600/15 to-amber-900/5", border: "border-amber-500/25", accent: "text-amber-400", label: "XAU/USD" },
  "GBP/USD": { bg: "from-violet-600/15 to-violet-900/5", border: "border-violet-500/25", accent: "text-violet-400", label: "GBP/USD" },
};

function pairStyle(pair) { return PAIR_STYLES[pair] || PAIR_STYLES["EUR/USD"]; }

/* ─── Alert Banner ─── */
function AlertBanner({ alert, onDismiss }) {
  const isBull = alert.type === "bullish";
  return (
    <div
      className={cn(
        "animate-in slide-in-from-top-2 flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm transition-all duration-300",
        isBull
          ? "border-bull/60 bg-bull/12 text-bull"
          : "border-bear/60 bg-bear/12 text-bear"
      )}
    >
      <Zap className="mt-0.5 size-5 shrink-0 animate-pulse" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{alert.pair}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              isBull ? "border-bull/40 text-bull" : "border-bear/40 text-bear"
            )}
          >
            {alert.type.toUpperCase()} FVG TOUCH
          </Badge>
          {alert.telegramSent && (
            <Badge className="text-[9px] px-1 py-0 bg-blue-500/20 text-blue-400 border-0">
              Telegram ✓
            </Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-xs opacity-80">
          Zone {fmt(alert.fvgLow)} → {fmt(alert.fvgHigh)}
          <span className="opacity-60"> · touched {fmt(alert.touchPrice)}</span>
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 opacity-40 transition hover:opacity-100 hover:bg-background/20"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

/* ─── FVG Zone Row ─── */
function FvgZoneRow({ fvg, index }) {
  const [expanded, setExpanded] = useState(false);
  const isBull = fvg.type === "bullish";
  return (
    <div
      className={cn(
        "rounded-lg border text-xs transition-all cursor-pointer",
        isBull ? "border-bull/15 bg-bull/3" : "border-bear/15 bg-bear/3",
        fvg.touchedAt && "border-gold/30 bg-gold/3"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {isBull ? (
          <TrendingUp className="size-3.5 shrink-0 text-bull" />
        ) : (
          <TrendingDown className="size-3.5 shrink-0 text-bear" />
        )}
        <span className="font-mono font-medium text-[11px]">
          {fmt(fvg.fvgLow)} → {fmt(fvg.fvgHigh)}
        </span>
        <span className={cn(
          "ml-auto text-[10px] font-medium",
          fvg.touchedAt ? "text-gold" : "text-muted-foreground/60"
        )}>
          {fvg.touchedAt ? "✓ Touched" : "Untouched"}
        </span>
        {expanded ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
      </div>
    </div>
  );
}

/* ─── Pair Card ─── */
function PairCard({ pair, scan, candleData }) {
  const s = pairStyle(pair);
  const [expandedChart, setExpandedChart] = useState(false);
  const freshFVG = scan?.freshFVG;
  const activeFVGs = scan?.activeFVGs || [];
  const price = scan?.currentPrice;
  const candle = scan?.currentCandle;
  const prevCandle = scan?.prevCandle;
  const candleDir = candle && prevCandle
    ? candle.close > prevCandle.close ? "up" : candle.close < prevCandle.close ? "down" : "flat"
    : null;

  return (
    <Card className={cn("overflow-hidden border transition hover:border-foreground/20", s.border)}>
      {/* Header */}
      <div className={cn("bg-gradient-to-r px-4 py-3", s.bg)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/40 text-sm font-black">
              {pair.split("/")[0][0]}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold tracking-tight truncate">{pair}</h3>
              <p className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>4H · Twelve Data</span>
                {scan?.status === "ok" && price && (
                  <span className={cn("font-mono font-semibold", s.accent)}>
                    {fmt(price)}
                  </span>
                )}
                {candleDir === "up" && <TrendingUp className="size-3 text-bull" />}
                {candleDir === "down" && <TrendingDown className="size-3 text-bear" />}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {freshFVG && (
              <Badge className={cn(
                "animate-pulse text-[9px] px-1.5 py-0 font-bold border",
                freshFVG.type === "bullish" ? "border-bull/60 bg-bull/15 text-bull" : "border-bear/60 bg-bear/15 text-bear"
              )}>
                NEW {freshFVG.type.toUpperCase()} FVG
              </Badge>
            )}
            {scan?.touchedNow && (
              <Badge className="animate-pulse text-[9px] px-1.5 py-0 font-bold border border-gold/60 bg-gold/15 text-gold">
                TOUCHED
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* FVG Chart — lightweight-charts candlestick chart with FVG zone price lines */}
      <div className="border-b border-border/50">
        <div className="px-3 pt-3">
          <FVGChart
            key={`fg-${scan?.scannedAt || 0}`}
            pair={pair}
            candleData={candleData || []}
            fvgZones={activeFVGs}
            height={expandedChart ? 320 : 180}
          />
        </div>
        <div className="flex items-center justify-between px-3 pb-2 pt-1.5">
          <button
            onClick={() => setExpandedChart(!expandedChart)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition"
          >
            {expandedChart ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expandedChart ? "Collapse" : "Expand chart"}
          </button>
          {scan?.tvSymbol && (
            <a
              href={`https://www.tradingview.com/chart/?symbol=${scan.tvSymbol}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition"
            >
              <ExternalLink className="size-3" />
              Open in TV
            </a>
          )}
        </div>
      </div>

      {/* Body */}
      <CardContent className="p-4">
        {/* Candle details */}
        {candle && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { label: "Open", val: candle.open, color: "" },
              { label: "High", val: candle.high, color: "text-bull" },
              { label: "Low", val: candle.low, color: "text-bear" },
              { label: "Close", val: candle.close, color: "" },
              { label: "Volume", val: candle.volume, color: "" },
              { label: "Time", val: candle.ts ? new Date(candle.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "", color: "" },
            ].map(({ label, val, color }, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
                <span className={cn("font-mono text-[11px] font-medium", color)}>{fmt(val)}</span>
              </div>
            ))}
          </div>
        )}

        {/* FVG Zones */}
        {activeFVGs.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              FVG Zones ({activeFVGs.length})
            </p>
            {activeFVGs.slice(0, 5).map((fvg, i) => (
              <FvgZoneRow key={i} fvg={fvg} index={i} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60 italic">No FVG zones detected yet</p>
        )}

        {/* Links */}
        {!scan?.tvSymbol && scan?.status === "error" && (
          <span className="text-[10px] text-bear/80">{scan.error}</span>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Main Page ─── */
export default function Alert4HFVG() {
  const [scans, setScans] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState(null);
  const [fvgEnabled, setFvgEnabled] = useState(false);
  const timer = useRef(null);
  const lastScanRef = useRef(0);
  const toast = useToast();

  const scanNow = useCallback(async () => {
    // Cooldown: don't scan more than once per 30s
    if (Date.now() - lastScanRef.current < 30000) return;
    lastScanRef.current = Date.now();

    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan-fvg").then((r) => {
        if (r.status === 401) { window.location.href = "/login"; return null; }
        return r.json();
      });
      if (!res) return;
      if (res.error) throw new Error(res.error);

      setScans(res.scans);
      if (res.fvgEnabled !== undefined) setFvgEnabled(res.fvgEnabled);

      if (res.newAlerts?.length > 0) {
        const withTg = res.newAlerts.map(a => ({
          ...a,
          id: uid(),
          at: Date.now(),
          telegramSent: res.telegram?.some(t => t.pair === a.pair && t.sent) || false,
        }));
        setAlerts((prev) => [...withTg, ...prev].slice(0, 50));
        toast(
          `${res.newAlerts.length} FVG touch${res.newAlerts.length > 1 ? "es" : ""} detected${res.fvgEnabled ? " · Telegram sent" : ""}`,
          "success"
        );
      }

      setLastScan(res.scannedAt);
    } catch (e) {
      setError(String(e.message || e));
      toast(`FVG scan failed · ${e.message || e}`, "error");
    } finally {
      setScanning(false);
    }
  }, [toast]);

  // Auto-scan every 15 minutes
  useEffect(() => {
    if (!auto) { clearInterval(timer.current); return; }
    scanNow();
    timer.current = setInterval(scanNow, 900000); // 15 min
    return () => clearInterval(timer.current);
  }, [auto, scanNow]);

  const dismissAlert = (id) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  const scanMap = useMemo(() => {
    if (!scans) return {};
    const m = {};
    for (const s of scans) m[s.pair] = s;
    return m;
  }, [scans]);

  return (
    <div className="mx-auto max-w-[1280px] px-3 py-4 sm:px-4 sm:py-6">
      {/* ─── Header ─── */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className={cn("size-2.5 shrink-0 rounded-full", auto ? "animate-pulse bg-bull" : "bg-muted-foreground/40")} />
          <div>
            <h1 className="text-lg font-bold tracking-tight">4H FVG Alerts</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {lastScan
                ? `Last scan ${new Date(lastScan).toLocaleTimeString()}${scanning ? " · scanning…" : ""}`
                : "Not scanned yet"}
              {fvgEnabled && <Badge className="text-[9px] px-1.5 bg-bull/15 text-bull border-0">Telegram alerts on</Badge>}
              {!fvgEnabled && lastScan && <span className="text-[10px] text-muted-foreground/60">Toggle FVG alerts in Dashboard settings</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
            <Link href="/"><ArrowLeft className="size-3.5 mr-1" /> Dashboard</Link>
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
            <Link href="/totalalerts"><Bell className="size-3.5 mr-1" /> Alerts</Link>
          </Button>
          <label className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs">
            <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-scan" className="scale-75" />
            Auto
          </label>
          <Button size="sm" className="h-8 text-xs" onClick={scanNow} disabled={scanning}>
            <RefreshCw className={cn("size-3.5 mr-1", scanning && "animate-spin")} />
            {scanning ? "Scan…" : "Scan"}
          </Button>
        </div>
      </header>

      {/* ─── Error ─── */}
      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-bear/30 bg-bear/8 px-4 py-3 text-sm text-bear">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── Live Alerts ─── */}
      {alerts.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live Alerts ({alerts.length})
            </h2>
            <button onClick={() => setAlerts([])} className="text-[10px] text-muted-foreground underline hover:text-foreground">
              Clear all
            </button>
          </div>
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto scrollbar-thin">
            {alerts.map((alert) => (
              <AlertBanner key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Pair Cards ─── */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {["EUR/USD", "USD/JPY", "USD/CAD", "XAU/USD", "GBP/USD"].map((pair) => {
          const scan = scanMap[pair];
          const candleData = scan?.candleData || null;
          return <PairCard key={pair} pair={pair} scan={scan} candleData={candleData} />;
        })}

        {/* ─── Status Summary ─── */}
        <Card className="border-border/50 sm:col-span-2 xl:col-span-3">
          <CardHeader className="border-b border-border py-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3.5" /> Scan Status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {["EUR/USD", "USD/JPY", "USD/CAD", "XAU/USD", "GBP/USD"].map((pair) => {
                const s = scanMap[pair];
                const fresh = s?.freshFVG;
                const touched = s?.touchedNow;
                const active = s?.activeFVGs?.length || 0;
                return (
                  <div key={pair} className={cn(
                    "rounded-lg border p-3 text-center transition",
                    fresh ? "border-bull/30 bg-bull/8" : touched ? "border-gold/30 bg-gold/8" : "border-border bg-popover"
                  )}>
                    <div className="text-sm font-bold">{pair}</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5">
                      {fresh && <Badge className="text-[9px] px-1 py-0 bg-bull/20 text-bull border-0">NEW FVG</Badge>}
                      {touched && !fresh && <Badge className="text-[9px] px-1 py-0 bg-gold/20 text-gold border-0">TOUCHED</Badge>}
                      {!fresh && !touched && s?.status === "ok" && <CheckCircle2 className="size-3.5 text-muted-foreground/40" />}
                      {s?.status === "error" && <AlertTriangle className="size-3.5 text-bear" />}
                      {!s && <span className="text-[10px] text-muted-foreground/40">—</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {active} FVG{active !== 1 ? "s" : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator className="my-3" />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {lastScan ? `Last: ${new Date(lastScan).toLocaleString()}` : "Not scanned yet"}
                {fvgEnabled && <span className="ml-2 text-bull">· Telegram alerts active</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", auto ? "bg-bull animate-pulse" : "bg-muted-foreground/40")} />
                {auto ? "Auto-scan every 15m" : "Auto-scan off"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── FVG Legend ─── */}
      <details className="mt-4 group">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition list-none flex items-center gap-2">
          <ChevronDown className="size-3 transition group-open:rotate-180" />
          How FVG Detection Works
        </summary>
        <div className="mt-3 text-xs text-muted-foreground space-y-1.5 leading-relaxed">
          <p><strong className="text-foreground">Fair Value Gap (FVG):</strong> A 3-candle pattern where price moves aggressively, leaving a gap between candle 1 and candle 3.</p>
          <p><strong className="text-bull">Bullish FVG:</strong> Candle 3's low is above Candle 1's high → support zone where buyers may step in.</p>
          <p><strong className="text-bear">Bearish FVG:</strong> Candle 3's high is below Candle 1's low → resistance zone where sellers may step in.</p>
          <p><strong>FVG Touch Alert:</strong> Fires when price returns into the gap zone — signalling a potential reversal/continuation entry.</p>
          <p className="text-gold">💡 Real-time data from Twelve Data. Enable Telegram alerts from Dashboard → Settings → FVG Alerts.</p>
        </div>
      </details>
    </div>
  );
}
