"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { LiveChart } from "@/components/live-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useToast } from "./toast";

/* ---------- small helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

function tvLink(pair) {
  const sym = pair.tradingview || `${pair.exchange.toUpperCase()}:${pair.name}`;
  return `https://www.tradingview.com/chart/?symbol=${sym}`;
}

// FundedNext / MT5 standard contract & pip specs per market type
const MARKET_PRESETS = {
  crypto: { contractSize: 1, pipSize: 1 },
  gold: { contractSize: 100, pipSize: 0.1 },
  forex: { contractSize: 100000, pipSize: 0.0001 },
  forexJPY: { contractSize: 100000, pipSize: 0.01 },
};

/* ---------- root ---------- */
export default function Dashboard() {
  const [store, setStore] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [results, setResults] = useState({}); // pairName -> result
  const [signals, setSignals] = useState([]);
  const [auto, setAuto] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [pfRunning, setPfRunning] = useState(false);
  const [user, setUser] = useState(null);
  const [pastLoading, setPastLoading] = useState(false);
  const timer = useRef(null);
  const toast = useToast();

  /* load config */
  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return r.json();
      })
      .then((s) => {
        if (!s) return;
        setStore(s);
        setUser(s.user || null);
      })
      .catch(() => setStore({ settings: {}, pairs: [] }));
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  /* auto-scan loop */
  useEffect(() => {
    if (!auto || !store) return;
    const ms = (store.settings.pollIntervalSeconds || 60) * 1000;
    timer.current = setInterval(() => scanNow(), ms);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, store?.settings?.pollIntervalSeconds]);

  const mutate = (fn) => {
    setStore((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  async function save() {
    if (!store) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: store.settings, pairs: store.pairs }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setDirty(false);
      toast("Settings saved", "success");
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function scanNow() {
    if (dirty) await save();
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const byName = {};
      (res.results || []).forEach((r) => (byName[r.pair] = r));
      setResults(byName);
      setLastScan(res.scannedAt);
      const newAlerts = (res.results || []).flatMap((r) => r.alerts || []);
      if (newAlerts.length) {
        setSignals((prev) => [...newAlerts.map((a) => ({ ...a, at: res.scannedAt })), ...prev].slice(0, 50));
        toast(`Scan complete · ${newAlerts.length} new signal${newAlerts.length > 1 ? "s" : ""}`, "success");
      } else {
        toast("Scan complete · no new signals", "info");
      }
    } catch (e) {
      toast(`Scan failed · ${e.message || e}`, "error");
    } finally {
      setScanning(false);
    }
  }

  async function loadPast() {
    if (dirty) await save();
    setPastLoading(true);
    try {
      const res = await fetch("/api/history", { method: "POST" }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const sigs = (res.signals || []).filter((s) => s.ts);
      const seen = new Set(signals.map((p) => `${p.pair}|${p.ts}|${p.direction}`));
      const fresh = sigs.filter((s) => !seen.has(`${s.pair}|${s.ts}|${s.direction}`));
      const freshCount = fresh.length;
      if (fresh.length) {
        setSignals((prev) => [...fresh, ...prev].slice(0, 100));
      }
      toast(
        freshCount
          ? `Found ${freshCount} new past signal${freshCount > 1 ? "s" : ""}`
          : "No new past signals found",
        freshCount ? "success" : "info"
      );
    } catch (e) {
      toast(`Past signals failed · ${e.message || e}`, "error");
    } finally {
      setPastLoading(false);
    }
  }

  async function runPreflight() {
    if (dirty) await save();
    setPfRunning(true);
    setPreflight(null);
    try {
      const res = await fetch("/api/preflight", { method: "POST" }).then((r) => r.json());
      const checks = res.checks || [];
      setPreflight(checks);
      const failed = checks.filter((c) => !c.pass).length;
      if (failed) toast(`Check finished · ${failed} of ${checks.length} failed`, "error");
      else toast(`All ${checks.length} checks passed`, "success");
    } catch (e) {
      toast(`Check failed · ${e.message || e}`, "error");
    } finally {
      setPfRunning(false);
    }
  }

  if (!store) {
    return <div className="p-10 text-muted-foreground">Loading…</div>;
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <TopBar
        auto={auto}
        setAuto={setAuto}
        dirty={dirty}
        saving={saving}
        scanning={scanning}
        lastScan={lastScan}
        onSave={save}
        onScan={scanNow}
        onPreflight={runPreflight}
        pfRunning={pfRunning}
        onPast={loadPast}
        pastLoading={pastLoading}
        user={user}
        onLogout={logout}
      />

      {preflight && <Preflight checks={preflight} onClose={() => setPreflight(null)} />}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        {/* main: pairs */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Pairs &amp; levels
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                mutate((s) =>
                  s.pairs.push({
                    id: uid(),
                    name: "NEWUSDT.P",
                    exchange: "binance",
                    symbol: "NEW/USDT:USDT",
                    tradingview: "",
                    timeframe: null,
                    market: "crypto",
                    leverage: 25,
                    contractSize: 1,
                    pipSize: 1,
                    levels: [],
                  })
                )
              }
            >
              <Plus />
              Add pair
            </Button>
          </div>

          {store.pairs.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No pairs yet. Add one to start watching for engulfing signals.
              </CardContent>
            </Card>
          )}

          {store.pairs.map((pair) => (
            <PairCard key={pair.id} pair={pair} result={results[pair.name]} mutate={mutate} />
          ))}
        </div>

        {/* sidebar */}
        <div className="flex flex-col gap-5">
          <SettingsPanel settings={store.settings} mutate={mutate} dna={store.dna} />
          <SignalLog signals={signals} />
        </div>
      </div>
    </main>
  );
}

/* ---------- top bar ---------- */
function TopBar({ auto, setAuto, dirty, saving, scanning, lastScan, onSave, onScan, onPreflight, pfRunning, user, onLogout }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex items-center gap-3">
        <span className={cn("size-2.5 rounded-full", auto ? "animate-pulse bg-bull" : "bg-muted-foreground/40")} />
        <div>
          <h1 className="text-lg font-bold tracking-tight">Engulfing Alerts</h1>
          <p className="text-xs text-muted-foreground">
            {lastScan ? `Last scan ${new Date(lastScan).toLocaleTimeString()}` : "Not scanned yet"}
            {scanning && " · scanning…"}
          </p>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
        {user && (
          <span className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold uppercase text-primary">
              {user.slice(0, 1)}
            </span>
            {user}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={onPreflight} disabled={pfRunning}>
          <ListChecks />
          {pfRunning ? "Checking…" : "Run check"}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/backtest" title="Engulfing backtest results & Excel export">
            <BarChart3 />
            Backtest
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/crt" title="CRT (Candle Range Theory) backtest results">
            <BarChart3 />
            CRT Backtest
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/totalalerts" title="All alerts — tick which trades you placed">
            <Bell />
            Total Alerts
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="/alert4hfvg" title="4H Fair Value Gap alerts — real-time forex">
            <Zap />
            4H FVG
          </a>
        </Button>

        <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-card px-3 text-xs">
          <Switch checked={auto} onCheckedChange={setAuto} aria-label="Toggle auto-scan" />
          Auto-scan
        </label>
        <Button size="sm" onClick={onScan} disabled={scanning}>
          <RefreshCw className={cn(scanning && "animate-spin")} />
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
        {dirty && (
          <Button size="sm" onClick={onSave} disabled={saving} className="bg-bull text-white hover:bg-bull/90">
            <Save />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        )}
        {user && (
          <Button variant="outline" size="sm" onClick={onLogout} title="Sign out">
            <LogOut />
            Logout
          </Button>
        )}
      </div>
    </header>
  );
}

/* ---------- preflight panel ---------- */
function Preflight({ checks, onClose }) {
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border px-4 py-2.5">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Startup check
        </CardTitle>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close startup check">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <Badge
              variant="outline"
              className={cn(
                "mt-0.5 gap-1",
                c.pass ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear"
              )}
            >
              {c.pass ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
              {c.pass ? "PASS" : "FAIL"}
            </Badge>
            <div className="min-w-0">
              <div className="text-sm">{`Test ${i + 1}  ${c.name}`}</div>
              {c.detail && (
                <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {c.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ---------- pair card ---------- */
function PairCard({ pair, result, mutate }) {
  const [showChart, setShowChart] = useState(false);

  const dir = result?.direction;
  const lvlResult = (id) => result?.levels?.find((l) => l.id === id);

  const toggleChart = () => setShowChart((v) => !v);

  const set = (field, value) =>
    mutate((s) => {
      const p = s.pairs.find((x) => x.id === pair.id);
      p[field] = value;
    });

  return (
    <Card className="overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <input
          value={pair.name}
          onChange={(e) => set("name", e.target.value)}
          className="w-36 bg-transparent text-base font-semibold outline-none focus:text-primary"
          aria-label="Pair name"
        />
        {dir && (
          <Badge
            variant="outline"
            className={cn(
              dir === "bullish" ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear"
            )}
          >
            {dir.toUpperCase()} ENGULF
          </Badge>
        )}
        {result?.alerts?.some((a) => a.dna && !a.dna.pending) && (
          <Badge variant="outline" className="border-gold/40 bg-gold/10 font-mono text-gold" title="Signal DNA match vs historical winners">
            {(() => {
              const d = result.alerts.find((a) => a.dna && !a.dna.pending).dna;
              return `DNA ${Math.round(d.sim)}% · ${d.record}`;
            })()}
          </Badge>
        )}
        {result?.last && (
          <span className="font-mono text-xs text-muted-foreground tnum">last {fmt(result.last.close)}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <a href={tvLink(pair)} target="_blank" rel="noreferrer">
              <ExternalLink />
              <span className="hidden sm:inline">TradingView</span>
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleChart}>
            <BarChart3 />
            <span className="hidden sm:inline">{showChart ? "Hide chart" : "Live chart"}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-bear/80 hover:bg-bear/10 hover:text-bear"
            onClick={() => mutate((s) => (s.pairs = s.pairs.filter((x) => x.id !== pair.id)))}
            title="Delete pair"
          >
            <Trash2 />
            <span className="sr-only">Delete pair</span>
          </Button>
        </div>
      </div>

      {/* pair fields */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Exchange" value={pair.exchange} onChange={(v) => set("exchange", v)} />
        <Field label="ccxt symbol" value={pair.symbol} onChange={(v) => set("symbol", v)} mono />
        <Field label="TradingView" value={pair.tradingview || ""} onChange={(v) => set("tradingview", v)} mono placeholder="auto" />
        <Field label="Timeframe" value={pair.timeframe || ""} onChange={(v) => set("timeframe", v || null)} placeholder="default" />
      </div>
      {/* trade params (forex lot sizing) */}
      <div className="grid grid-cols-1 gap-3 border-b border-border px-4 pb-3 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Market</Label>
          <Select
            value={pair.market || "custom"}
            onValueChange={(m) => {
              mutate((s) => {
                const p = s.pairs.find((x) => x.id === pair.id);
                p.market = m;
                if (MARKET_PRESETS[m]) {
                  p.contractSize = MARKET_PRESETS[m].contractSize;
                  p.pipSize = MARKET_PRESETS[m].pipSize;
                }
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="crypto">Crypto</SelectItem>
                <SelectItem value="gold">Gold (XAU)</SelectItem>
                <SelectItem value="forex">Forex</SelectItem>
                <SelectItem value="forexJPY">Forex (JPY)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Field
          label="Leverage (x)"
          value={pair.leverage ?? ""}
          onChange={(v) => set("leverage", v === "" ? "" : parseFloat(v))}
          placeholder="25"
        />
        <Field
          label="Contract size"
          value={pair.contractSize ?? ""}
          onChange={(v) => set("contractSize", v === "" ? "" : parseFloat(v))}
          placeholder="gold 100 · crypto 1"
        />
        <Field
          label="Pip size"
          value={pair.pipSize ?? ""}
          onChange={(v) => set("pipSize", v === "" ? "" : parseFloat(v))}
          placeholder="gold 0.1 · crypto 1"
        />
      </div>

      {/* DNA-suppressed signals */}
      {result?.dnaSkipped?.length > 0 && (
        <div className="border-b border-border bg-popover px-4 py-2">
          {result.dnaSkipped.map((s, i) => (
            <p key={i} className="font-mono text-[10px] text-muted-foreground">
              {`${s.direction} signal suppressed by DNA filter (${s.matches ? `${s.sim}% similar, ${s.matches} match${s.matches === 1 ? "" : "es"} went ${s.record}` : "no similar historical winners"})`}
            </p>
          ))}
        </div>
      )}

      {/* live chart */}
      {showChart && (
        <div className="border-b border-border bg-popover px-4 py-3">
          <LiveChart pair={pair} signalTs={result?.last?.ts} direction={dir} />
        </div>
      )}

      {/* levels */}
      <div className="px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Levels</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Offset
              <input
                type="number"
                step="any"
                value={pair.levelOffset ?? ""}
                placeholder="0"
                onChange={(e) => set("levelOffset", e.target.value === "" ? "" : parseFloat(e.target.value))}
                className="w-20 rounded border border-border bg-popover px-2 py-1 font-mono text-xs outline-none focus:border-primary/60 tnum"
                title="Shift every level by this price (e.g. -5.79 to align your broker's gold with Binance)"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              className="border-gold/30 bg-gold/10 text-gold hover:bg-gold/20 hover:text-gold"
              onClick={() => mutate((s) => s.pairs.find((x) => x.id === pair.id).levels.push({ id: uid(), low: 0, high: 0 }))}
            >
              <Plus />
              Add level
            </Button>
          </div>
        </div>
        {pair.levelOffset ? (
          <div className="mb-2 font-mono text-[10px] text-muted-foreground">
            Watching levels shifted by {pair.levelOffset > 0 ? "+" : ""}
            {pair.levelOffset} (broker → feed)
          </div>
        ) : null}

        {pair.levels.length === 0 ? (
          <div className="py-3 text-xs text-muted-foreground">No levels yet. Add a zone to watch.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pair.levels.map((lvl) => (
              <LevelRow
                key={lvl.id}
                lvl={lvl}
                offset={pair.levelOffset}
                state={lvlResult(lvl.id)}
                onChange={(field, value) =>
                  mutate((s) => {
                    const p = s.pairs.find((x) => x.id === pair.id);
                    const l = p.levels.find((x) => x.id === lvl.id);
                    l[field] = value;
                  })
                }
                onDelete={() =>
                  mutate((s) => {
                    const p = s.pairs.find((x) => x.id === pair.id);
                    p.levels = p.levels.filter((x) => x.id !== lvl.id);
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, mono, placeholder }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 text-xs", mono && "font-mono")}
      />
    </div>
  );
}

/* ---------- level row ---------- */
function LevelRow({ lvl, state, onChange, onDelete, offset }) {
  const touched = state?.touched;
  const gap = state?.gap;
  const off = Number(offset) || 0;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        touched ? "border-gold/60 bg-gold/10" : "border-border bg-popover"
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-gold/70" />
      <NumberInput value={lvl.low} onChange={(v) => onChange("low", v)} label="Level low" />
      <span className="text-xs text-muted-foreground">→</span>
      <NumberInput value={lvl.high} onChange={(v) => onChange("high", v)} label="Level high" />
      {off !== 0 && (
        <span className="whitespace-nowrap font-mono text-[10px] text-gold/80" title="Effective watched zone after offset">
          ⇒ {fmt(Math.min(lvl.low, lvl.high) + off)}–{fmt(Math.max(lvl.low, lvl.high) + off)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {state && (
          <span className={cn("font-mono text-[10px]", touched ? "text-gold" : "text-muted-foreground")}>
            {touched ? "TOUCHED" : gap === 0 ? "inside" : `gap ${fmt(gap)}`}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-bear/70 hover:bg-bear/10 hover:text-bear"
          onClick={onDelete}
          title="Delete level"
        >
          <X />
          <span className="sr-only">Delete level</span>
        </Button>
      </div>
    </div>
  );
}

function NumberInput({ value, onChange, label }) {
  return (
    <input
      type="number"
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
      className="w-24 rounded border border-border bg-background/60 px-2 py-1 font-mono text-sm outline-none focus:border-primary/60 tnum"
      aria-label={label}
    />
  );
}

function RiskField({ label, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step="any"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}

/* ---------- settings ---------- */
function SettingsPanel({ settings, mutate, dna }) {
  const setS = (field, value) => mutate((s) => (s.settings[field] = value));
  const setDna = (field, value) =>
    mutate((s) => {
      if (!s.settings.dna) s.settings.dna = {};
      s.settings.dna[field] = value;
    });
  const dnaCfg = { enabled: false, minSimilarity: 85, minWinRate: 60, minMatches: 5, ...(settings.dna || {}) };
  const setEmail = (field, value) => mutate((s) => (s.settings.email[field] = value));
  const setTelegram = (field, value) => mutate((s) => {
    if (!s.settings.telegram) s.settings.telegram = {};
    s.settings.telegram[field] = value;
  });
  const setRisk = (field, value) =>
    mutate((s) => {
      if (!s.settings.risk) s.settings.risk = {};
      s.settings.risk[field] = value;
    });
  const setFvg = (field, value) =>
    mutate((s) => {
      if (!s.settings.fvgAlerts) s.settings.fvgAlerts = {};
      s.settings.fvgAlerts[field] = value;
    });
  const email = settings.email || {};
  const telegram = settings.telegram || {};
  const risk = settings.risk || {};
  const [testing, setTesting] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const toast = useToast();

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/test-email", { method: "POST" }).then((r) => r.json());
      if (res.ok) toast(`Test email sent to ${res.sentTo.join(", ")}`, "success");
      else toast(`Test email failed · ${res.error}`, "error");
    } catch (e) {
      toast(`Test email failed · ${e.message || e}`, "error");
    } finally {
      setTesting(false);
    }
  }

  async function sendTelegramTest() {
    setTelegramTesting(true);
    try {
      const res = await fetch("/api/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "🚀 Test message from Engulfing Alerts Dashboard\n\nTelegram integration is working correctly!"
        })
      }).then((r) => r.json());
      if (res.success) toast("Test message sent to Telegram successfully", "success");
      else toast(`Telegram test failed · ${res.error}`, "error");
    } catch (e) {
      toast(`Telegram test failed · ${e.message || e}`, "error");
    } finally {
      setTelegramTesting(false);
    }
  }

  async function sendTelegramChartTest() {
    setTelegramTesting(true);
    try {
      const res = await fetch("/api/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testChart: true
        })
      }).then((r) => r.json());
      if (res.success) toast("Test chart image sent to Telegram successfully", "success");
      else toast(`Telegram chart test failed · ${res.error}`, "error");
    } catch (e) {
      toast(`Telegram chart test failed · ${e.message || e}`, "error");
    } finally {
      setTelegramTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Timeframe</Label>
            <Select value={settings.timeframe || "15m"} onValueChange={(v) => setS("timeframe", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Auto-scan interval (sec)
            </Label>
            <Input
              type="number"
              value={settings.pollIntervalSeconds || 60}
              onChange={(e) => setS("pollIntervalSeconds", parseInt(e.target.value || "60", 10))}
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>

        <MultiSelectModes
          label="Touch mode (select one or more)"
          values={settings.touchModes || [settings.touchMode || "range"]}
          onChange={(v) => setS("touchModes", v)}
          options={[
            { value: "range", label: "Range", hint: "wick touches the zone" },
            { value: "body", label: "Body", hint: "candle body touches the zone" },
            { value: "close", label: "Close", hint: "candle closes inside the zone" },
          ]}
        />

        <Separator />

        <div className="flex flex-col gap-3 text-xs">
          <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground">Signal DNA filter</h3>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={!!dnaCfg.enabled}
              onCheckedChange={(v) => setDna("enabled", !!v)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">Only alert on DNA-matched winners</span>
              <span className="leading-relaxed text-muted-foreground">
                Fingerprints each engulfing candle&apos;s shape (body ratio, wicks, ATR context) and only
                alerts when it matches historically winning patterns. Non-matching signals are suppressed.
              </span>
            </span>
          </label>
          {dnaCfg.enabled && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <RiskField
                  label="Min similarity %"
                  value={dnaCfg.minSimilarity}
                  onChange={(v) => setDna("minSimilarity", v)}
                  placeholder="85"
                />
                <RiskField
                  label="Min win rate %"
                  value={dnaCfg.minWinRate}
                  onChange={(v) => setDna("minWinRate", v)}
                  placeholder="60"
                />
                <RiskField
                  label="Min matches"
                  value={dnaCfg.minMatches}
                  onChange={(v) => setDna("minMatches", v)}
                  placeholder="5"
                />
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                {dna && dna.builtAt
                  ? `Library: ${dna.count} historical trades · built ${new Date(dna.builtAt).toLocaleString()} · refreshes every 24h`
                  : "Library builds automatically on the next scan (~6 months of history per pair). Alerts fire normally until it's ready."}
              </p>
            </>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-3 text-xs">
          <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground">Email alerts</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="SMTP server" value={email.smtpServer || ""} onChange={(v) => setEmail("smtpServer", v)} mono />
            <Field label="Port" value={email.smtpPort || ""} onChange={(v) => setEmail("smtpPort", parseInt(v || "587", 10))} mono />
          </div>
          <Field label="Sender" value={email.sender || ""} onChange={(v) => setEmail("sender", v)} mono />
          <Field label="App password" value={email.password || ""} onChange={(v) => setEmail("password", v)} mono />
          <Field
            label="Recipients (comma separated)"
            value={(email.recipients || []).join(", ")}
            onChange={(v) => setEmail("recipients", v.split(",").map((x) => x.trim()).filter(Boolean))}
            mono
          />
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={sendTest} disabled={testing}>
              {testing ? "Sending…" : "Send test email"}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 text-xs">
          <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground">Telegram alerts</h3>
          <Field
            label="Bot Token"
            value={telegram.botToken || ""}
            onChange={(v) => setTelegram("botToken", v)}
            mono
            placeholder="Get from @BotFather on Telegram"
          />
          <Field
            label="Chat ID"
            value={telegram.chatId || ""}
            onChange={(v) => setTelegram("chatId", v)}
            mono
            placeholder="Your chat ID or group chat ID"
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={sendTelegramTest} disabled={telegramTesting}>
              {telegramTesting ? "Sending…" : "Send test message"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-bull/30 bg-bull/10 text-bull hover:bg-bull/20 hover:text-bull"
              onClick={sendTelegramChartTest}
              disabled={telegramTesting}
            >
              {telegramTesting ? "Sending…" : "Test chart image"}
            </Button>
          </div>

          <Alert>
            <AlertDescription className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <p className="font-semibold text-foreground">Setup Instructions:</p>
              <p>1. Create a bot by messaging @BotFather on Telegram</p>
              <p>2. Copy the bot token and paste above</p>
              <p>3. Start a chat with your bot or add it to a group</p>
              <p>4. Get your Chat ID from @userinfobot</p>
              <p>5. Test the connection using the button above</p>
            </AlertDescription>
          </Alert>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 text-xs">
          <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground">4H FVG Alerts</h3>
          <label className="flex cursor-pointer items-start gap-2">
            <Switch
              checked={!!(settings.fvgAlerts || {}).enabled}
              onCheckedChange={(v) => setFvg("enabled", !!v)}
              aria-label="Enable FVG alerts"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-foreground">Send Telegram alerts for 4H FVG touches</span>
              <span className="leading-relaxed text-muted-foreground">
                When enabled, you&apos;ll receive Telegram messages when price touches a Fair Value Gap zone on the 4H timeframe.
                Works with EUR/USD, USD/JPY, USD/CAD, XAU/USD, GBP/USD via Twelve Data.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/alert4hfvg" title="Open 4H FVG dashboard">
                <Zap className="size-3.5" />
                Open FVG Dashboard
              </a>
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Risk &amp; position sizing
            </h3>
            <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-muted-foreground">
              <Switch
                checked={!!risk.enabled}
                onCheckedChange={(v) => setRisk("enabled", v)}
                aria-label="Include risk sizing in alerts"
              />
              include in alerts
            </label>
          </div>

          {risk.enabled && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RiskField label="Account size" value={risk.accountSize} onChange={(v) => setRisk("accountSize", v)} placeholder="1000" />
                <RiskField label="Risk % per trade" value={risk.riskPercent} onChange={(v) => setRisk("riskPercent", v)} placeholder="1" />
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Lot size is calculated so hitting the stop loses your risk %. SL sits just past the engulfing candle; TP uses a 1:2 reward:risk.
                <span className="text-primary"> Leverage is set per pair</span> (in each pair card).
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// multi-select checkbox group — an engulfing counts if it matches ANY checked mode
function MultiSelectModes({ label, values, onChange, options }) {
  const selected = Array.isArray(values) && values.length ? values : ["range"];
  const toggle = (v) => {
    const set = new Set(selected);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    if (set.size === 0) set.add(v); // keep at least one selected
    // preserve option order
    onChange(options.map((o) => o.value).filter((x) => set.has(x)));
  };
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={o.value}
              title={o.hint}
              className={cn(
                "flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition",
                on
                  ? "border-primary bg-primary/15 font-medium text-primary"
                  : "border-border bg-popover text-muted-foreground hover:border-primary/40"
              )}
            >
              <Checkbox
                checked={on}
                onCheckedChange={() => toggle(o.value)}
                className="size-3.5"
                aria-label={o.label}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Alerts when a candle matches {selected.length > 1 ? "any of: " : ""}
        <span className="text-foreground">{selected.join(", ")}</span>
      </p>
    </div>
  );
}

/* ---------- signal log ---------- */
function SignalLog({ signals }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Signals
        </CardTitle>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No signals yet. They appear here when an engulfing candle hits a level.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {signals.map((sig, i) => (
              <a
                key={i}
                href={sig.link}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-border bg-popover px-3 py-2 transition hover:border-primary/40"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      sig.direction === "bullish"
                        ? "border-bull/40 bg-bull/10 text-bull"
                        : "border-bear/40 bg-bear/10 text-bear"
                    )}
                  >
                    {sig.direction.toUpperCase()}
                  </Badge>
                  <span className="text-sm font-medium">{sig.pair}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(sig.at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground tnum">
                  {fmt(sig.low)} → {fmt(sig.high)}
                  {sig.emailed === false && <span className="ml-2 text-bear">email failed</span>}
                </div>
                {sig.position && (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 font-mono text-[11px] tnum">
                    <span className="text-muted-foreground">
                      Entry <span className="text-foreground">{fmt(sig.position.entry)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Lots <span className="text-primary">{sig.position.lots}</span>
                    </span>
                    <span className="text-muted-foreground">
                      SL <span className="text-bear">{fmt(sig.position.stop)}</span>{" "}
                      <span className="text-muted-foreground">({sig.position.slPips}p)</span>
                    </span>
                    <span className="text-muted-foreground">
                      TP <span className="text-bull">{fmt(sig.position.tp)}</span>{" "}
                      <span className="text-muted-foreground">({sig.position.tpPips}p)</span>
                    </span>
                    <span className="text-muted-foreground">
                      Margin <span className="text-foreground">{fmt(sig.position.margin)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Risk <span className="text-foreground">{fmt(sig.position.riskAmount)}</span> →{" "}
                      <span className="text-bull">{fmt(sig.position.rewardAmount)}</span>
                    </span>
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
