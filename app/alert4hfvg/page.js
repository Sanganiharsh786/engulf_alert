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
  RefreshCw,
  Maximize2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FVGLiveChart } from "@/components/fvg-live-chart";
import { useToast } from "../toast";

const fmt = (n) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

const uid = () => Math.random().toString(36).slice(2, 9);

/* ─── Color scheme per pair ─── */
const PAIR_STYLES = {
  "XAU/USD": { bg: "from-amber-600/15 to-amber-900/5", border: "border-amber-500/25", accent: "text-amber-400" },
  "GBP/USD": { bg: "from-violet-600/15 to-violet-900/5", border: "border-violet-500/25", accent: "text-violet-400" },
};

function pairStyle(pair) { return PAIR_STYLES[pair] || PAIR_STYLES["XAU/USD"]; }

/* ─── Alert Banner ─── */
function AlertBanner({ alert, onDismiss }) {
  const isBull = alert.type === "bullish";
  return (
    <div
      className={cn(
        "animate-in slide-in-from-top-2 flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm transition-all duration-300",
        isBull ? "border-bull/60 bg-bull/12 text-bull" : "border-bear/60 bg-bear/12 text-bear"
      )}
    >
      <Zap className="mt-0.5 size-5 shrink-0 animate-pulse" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{alert.pair}</span>
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", isBull ? "border-bull/40 text-bull" : "border-bear/40 text-bear")}>
            {alert.type.toUpperCase()} FVG TOUCH
          </Badge>
          {alert.telegramSent && (
            <Badge className="text-[9px] px-1 py-0 bg-blue-500/20 text-blue-400 border-0">Telegram ✓</Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-xs opacity-80">
          Zone {fmt(alert.fvgLow)} → {fmt(alert.fvgHigh)}
          <span className="opacity-60"> · touched {fmt(alert.touchPrice)}</span>
        </p>
      </div>
      <button onClick={onDismiss} className="shrink-0 rounded-md p-1 opacity-40 transition hover:opacity-100 hover:bg-background/20">✕</button>
    </div>
  );
}

/* ─── Fullscreen Chart Dialog ─── */
function FullscreenChartDialog({ open, onClose, pair, tf }) {
  if (!pair) return null;

  const s = pairStyle(pair);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 !bg-background/95 backdrop-blur-xl">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12 sm:px-6 sm:py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <span className={cn("font-bold", s.accent)}>{pair}</span>
            <Badge variant="outline" className="text-muted-foreground">{tf} · Live</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="h-[50vh] min-h-[350px] sm:h-[65vh] sm:min-h-[500px]">
            <FVGLiveChart pair={pair} tf={tf} height="100%" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Pair Card (compact header + live chart) ─── */
function PairCard({ pair, scan, onChartClick, tf }) {
  const s = pairStyle(pair);
  const price = scan?.currentPrice;
  const [chartHeight] = useState(240);
  // Live FVG zones streamed from the chart on every poll.
  const [liveZones, setLiveZones] = useState([]);

  // Prefer live zones from the chart; fall back to the periodic scan payload.
  const scanZones = useMemo(() => {
    const active = (scan?.activeFVGs || []).map((f) => ({
      type: f.type === "bearish" ? "bearish" : "bullish",
      high: Math.max(Number(f.fvgHigh), Number(f.fvgLow)),
      low: Math.min(Number(f.fvgHigh), Number(f.fvgLow)),
      formedTime: f.formedAt ? Math.floor(f.formedAt / 1000) : null,
      fresh: false,
    }));
    if (scan?.freshFVG) {
      const fr = scan.freshFVG;
      const ft = fr.formedAt ? Math.floor(fr.formedAt / 1000) : null;
      const dup = active.find((z) => z.type === (fr.type === "bearish" ? "bearish" : "bullish") && z.formedTime === ft);
      if (dup) dup.fresh = true;
      else active.push({
        type: fr.type === "bearish" ? "bearish" : "bullish",
        high: Math.max(Number(fr.fvgHigh), Number(fr.fvgLow)),
        low: Math.min(Number(fr.fvgHigh), Number(fr.fvgLow)),
        formedTime: ft,
        fresh: true,
      });
    }
    return active;
  }, [scan]);

  const zones = liveZones.length ? liveZones : scanZones;
  const freshZone = zones.find((z) => z.fresh);

  return (
    <Card className={cn("overflow-hidden border transition-all duration-200", s.border, "hover:border-foreground/30")}>
      {/* ── Header ── */}
      <div className={cn("bg-gradient-to-r px-4 pt-4 pb-3", s.bg)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background/40 text-base font-black">
              {pair.split("/")[0][0]}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold tracking-tight">{pair}</h3>
                {price && (
                  <span className={cn("font-mono text-sm font-semibold", s.accent)}>
                    {Number(price).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 })}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span>{tf} · Twelve Data</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {freshZone && (
              <Badge className={cn("animate-pulse text-[10px] px-2 py-0.5 font-bold border", freshZone.type === "bullish" ? "border-bull/60 bg-bull/15 text-bull" : "border-bear/60 bg-bear/15 text-bear")}>
                NEW {freshZone.type.toUpperCase()} FVG
              </Badge>
            )}
            {scan?.touchedNow && (
              <Badge className="animate-pulse text-[10px] px-2 py-0.5 font-bold border border-gold/60 bg-gold/15 text-gold">TOUCHED</Badge>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onChartClick(pair); }}
              className="flex items-center gap-1 rounded-md border border-border/50 bg-background/40 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-background/60 transition"
              title="Open fullscreen chart"
            >
              <Maximize2 className="size-3" />                <span className="hidden sm:inline">Expand</span>
            </button>
          </div>
        </div>

        {/* ── FVG zone values ── */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {zones.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60">No active {tf} FVG zones</span>
          ) : (
            zones.map((z, i) => {
              const isBull = z.type === "bullish";
              return (
                <span
                  key={`${z.type}-${z.formedTime}-${i}`}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                    isBull ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear",
                    z.fresh && "font-semibold ring-1 ring-inset ring-current/40"
                  )}
                  title={`${z.type} FVG · ${z.fresh ? "fresh" : "active"}`}
                >
                  {isBull ? "▲" : "▼"} {fmt(z.high)} → {fmt(z.low)}
                  {z.fresh && <span className="opacity-70">· NEW</span>}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* ── Live Chart ── */}
      <div className="px-3 pb-2">
        <FVGLiveChart pair={pair} tf={tf} height={chartHeight} refreshMs={15_000} onFvgs={setLiveZones} />
      </div>


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
  const [chartPair, setChartPair] = useState(null);
  const [tf, setTf] = useState("4h");
  const TF_OPTIONS = [
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "30m", label: "30m" },
    { value: "1h", label: "1h" },
    { value: "4h", label: "4h" },
  ];
  const timer = useRef(null);
  const lastScanRef = useRef(0);
  const toast = useToast();

  const scanNow = useCallback(async () => {
    if (Date.now() - lastScanRef.current < 30000) return;
    lastScanRef.current = Date.now();
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`/api/scan-fvg?tf=${tf}`).then((r) => {
        if (r.status === 401) { window.location.href = "/login"; return null; }
        return r.json();
      });
      if (!res) return;
      if (res.error) throw new Error(res.error);
      setScans(res.scans);
      if (res.fvgEnabled !== undefined) setFvgEnabled(res.fvgEnabled);
      if (res.newAlerts?.length > 0) {
        setAlerts((prev) => [
          ...res.newAlerts.map(a => ({ ...a, id: uid(), at: Date.now(), telegramSent: res.telegram?.some(t => t.pair === a.pair && t.sent) || false })),
          ...prev,
        ].slice(0, 50));
        toast(`${res.newAlerts.length} FVG touch${res.newAlerts.length > 1 ? "es" : ""} detected${res.fvgEnabled ? " · Telegram sent" : ""}`, "success");
      }
      if (res.tf) setTf(res.tf);
      setLastScan(res.scannedAt);
    } catch (e) {
      setError(String(e.message || e));
      toast(`FVG scan failed · ${e.message || e}`, "error");
    } finally {
      setScanning(false);
    }
  }, [toast, tf]);

  useEffect(() => {
    if (!auto) { clearInterval(timer.current); return; }
    scanNow();
    const intervalMs = tf === "5m" ? 180000 : tf === "15m" ? 300000 : tf === "30m" ? 600000 : tf === "1h" ? 600000 : 900000;
    timer.current = setInterval(scanNow, intervalMs);
    return () => clearInterval(timer.current);
  }, [auto, scanNow, tf]);

  const dismissAlert = (id) => setAlerts((prev) => prev.filter((a) => a.id !== id));
  const scanMap = useMemo(() => {
    if (!scans) return {};
    const m = {};
    for (const s of scans) m[s.pair] = s;
    return m;
  }, [scans]);

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 sm:py-6">
      {/* ─── Header ─── */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <span className={cn("size-2.5 shrink-0 rounded-full", auto ? "animate-pulse bg-bull" : "bg-muted-foreground/40")} />
          <div>
            <h1 className="text-lg font-bold tracking-tight">FVG Alerts &amp; Live Charts</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {lastScan ? `Last full scan ${new Date(lastScan).toLocaleTimeString()}${scanning ? " · scanning…" : ""}` : "Not scanned yet"}
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
          {/* Timeframe selector */}
          <div className="flex rounded-md border border-border bg-card overflow-hidden">
            {TF_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTf(opt.value)}
                className={cn(
                  "px-2 py-1.5 text-[11px] font-medium transition",
                  tf === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs">
            <Switch checked={auto} onCheckedChange={setAuto} className="scale-75" /> Auto
          </label>
          <Button size="sm" className="h-8 text-xs" onClick={scanNow} disabled={scanning}>
            <RefreshCw className={cn("size-3.5 mr-1", scanning && "animate-spin")} />
            {scanning ? "Scan…" : "Scan"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-bear/30 bg-bear/8 px-4 py-3 text-sm text-bear">
          <AlertTriangle className="size-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live Alerts ({alerts.length})</h2>
            <button onClick={() => setAlerts([])} className="text-[10px] text-muted-foreground underline hover:text-foreground">Clear all</button>
          </div>
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto scrollbar-thin">
            {alerts.map((alert) => <AlertBanner key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />)}
          </div>
        </div>
      )}

      {/* ─── Fullscreen Chart Dialog ─── */}
      <FullscreenChartDialog
        open={!!chartPair}
        onClose={() => setChartPair(null)}
        pair={chartPair}
        tf={tf}
      />

      {/* ─── Pair Cards with Live Charts ─── */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {["XAU/USD", "GBP/USD"].map((pair) => (
          <PairCard key={pair} pair={pair} scan={scanMap[pair]} onChartClick={setChartPair} tf={tf} />
        ))}

        {/* ─── Status Summary ─── */}
        <Card className="border-border/50 lg:col-span-2">
          <CardHeader className="border-b border-border py-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3.5" /> Scan Status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-3">
              {["XAU/USD", "GBP/USD"].map((pair) => {
                const s = scanMap[pair];
                const fresh = s?.freshFVG;
                const touched = s?.touchedNow;
                const active = s?.activeFVGs?.length || 0;
                return (
                  <div key={pair} className={cn("rounded-lg border p-3 text-center transition", fresh ? "border-bull/30 bg-bull/8" : touched ? "border-gold/30 bg-gold/8" : "border-border bg-popover")}>
                    <div className="text-sm font-bold">{pair}</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5">
                      {fresh && <Badge className="text-[9px] px-1 py-0 bg-bull/20 text-bull border-0">NEW FVG</Badge>}
                      {touched && !fresh && <Badge className="text-[9px] px-1 py-0 bg-gold/20 text-gold border-0">TOUCHED</Badge>}
                      {!fresh && !touched && s?.status === "ok" && <CheckCircle2 className="size-3.5 text-muted-foreground/40" />}
                      {s?.status === "error" && <AlertTriangle className="size-3.5 text-bear" />}
                      {!s && <span className="text-[10px] text-muted-foreground/40">—</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{active} FVG{active !== 1 ? "s" : ""}</div>
                    {fresh && (
                      <div className={cn("mt-1 font-mono text-[10px]", fresh.type === "bullish" ? "text-bull" : "text-bear")}>
                        {fresh.type === "bullish" ? "▲" : "▼"} {fmt(Math.max(fresh.fvgHigh, fresh.fvgLow))} → {fmt(Math.min(fresh.fvgHigh, fresh.fvgLow))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Separator className="my-3" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {lastScan ? `Last scan: ${new Date(lastScan).toLocaleString()}` : "Not scanned yet"}
                {fvgEnabled && <span className="ml-2 text-bull">· Telegram alerts active</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", auto ? "bg-bull animate-pulse" : "bg-muted-foreground/40")} />
                {auto ? `Auto-scan every ${tf === "5m" ? "3m" : tf === "15m" ? "5m" : tf === "30m" ? "10m" : tf === "1h" ? "10m" : "15m"}` : "Auto-scan off"}
                <span className="text-muted-foreground/60 ml-2">· Live charts update every 15s</span>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition list-none flex items-center gap-2">
          <ChevronDown className="size-3 transition group-open:rotate-180" /> How FVG Detection Works
        </summary>
        <div className="mt-3 text-xs text-muted-foreground space-y-1.5 leading-relaxed">
          <p><strong className="text-foreground">Fair Value Gap (FVG):</strong> A 3-candle pattern where price moves aggressively, leaving a gap between candle 1 and candle 3.</p>
          <p><strong className="text-bull">Bullish FVG:</strong> Candle 3&apos;s low is above Candle 1&apos;s high → support zone.</p>
          <p><strong className="text-bear">Bearish FVG:</strong> Candle 3&apos;s high is below Candle 1&apos;s low → resistance zone.</p>
          <p><strong>FVG Touch Alert:</strong> Fires when price returns into the gap zone.</p>
          <p className="text-gold">💡 Live chart updates every 15s via cached Twelve Data. Full FVG scan runs every few minutes. Enable Telegram alerts from Dashboard → Settings → FVG Alerts.</p>
        </div>
      </details>
    </div>
  );
}
