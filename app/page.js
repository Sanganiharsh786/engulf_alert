"use client";

import { useEffect, useRef, useState } from "react";
import { buildChartSVG } from "@/lib/chart";

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
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: store.settings, pairs: store.pairs }),
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function scanNow() {
    if (dirty) await save();
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" }).then((r) => r.json());
      const byName = {};
      (res.results || []).forEach((r) => (byName[r.pair] = r));
      setResults(byName);
      setLastScan(res.scannedAt);
      const newAlerts = (res.results || []).flatMap((r) => r.alerts || []);
      if (newAlerts.length) {
        setSignals((prev) => [...newAlerts.map((a) => ({ ...a, at: res.scannedAt })), ...prev].slice(0, 50));
      }
    } finally {
      setScanning(false);
    }
  }

  async function loadPast() {
    if (dirty) await save();
    setPastLoading(true);
    try {
      const res = await fetch("/api/history", { method: "POST" }).then((r) => r.json());
      const sigs = (res.signals || []).filter((s) => s.ts);
      if (sigs.length) {
        setSignals((prev) => {
          const seen = new Set(prev.map((p) => `${p.pair}|${p.ts}|${p.direction}`));
          const fresh = sigs.filter((s) => !seen.has(`${s.pair}|${s.ts}|${s.direction}`));
          return [...fresh, ...prev].slice(0, 100);
        });
      }
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
      setPreflight(res.checks || []);
    } finally {
      setPfRunning(false);
    }
  }

  if (!store) {
    return <div className="p-10 text-muted">Loading…</div>;
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 mt-5">
        {/* main: pairs */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
              Pairs &amp; levels
            </h2>
            <button
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
              className="text-xs px-3 py-1.5 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition"
            >
              + Add pair
            </button>
          </div>

          {store.pairs.length === 0 && (
            <div className="rounded-lg border border-border bg-panel p-8 text-center text-muted text-sm">
              No pairs yet. Add one to start watching for engulfing signals.
            </div>
          )}

          {store.pairs.map((pair) => (
            <PairCard
              key={pair.id}
              pair={pair}
              result={results[pair.name]}
              mutate={mutate}
            />
          ))}
        </div>

        {/* sidebar */}
        <div className="space-y-5">
          <Settings settings={store.settings} mutate={mutate} />
          <SignalLog signals={signals} />
        </div>
      </div>
    </div>
  );
}

/* ---------- top bar ---------- */
function TopBar({ auto, setAuto, dirty, saving, scanning, lastScan, onSave, onScan, onPreflight, pfRunning, onPast, pastLoading, user, onLogout }) {
  return (
    <header className="flex flex-wrap items-center gap-3 justify-between border-b border-border pb-4">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${auto ? "bg-bull animate-pulse" : "bg-muted/40"}`} />
        <div>
          <h1 className="text-lg font-bold tracking-tight">Engulfing Alerts</h1>
          <p className="text-xs text-muted">
            {lastScan ? `Last scan ${new Date(lastScan).toLocaleTimeString()}` : "Not scanned yet"}
            {scanning && " · scanning…"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {user && (
          <span className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-panel text-muted">
            <span className="h-5 w-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-bold uppercase">
              {user.slice(0, 1)}
            </span>
            {user}
          </span>
        )}
        <button
          onClick={onPreflight}
          disabled={pfRunning}
          className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-panel/70 transition disabled:opacity-50"
        >
          {pfRunning ? "Checking…" : "Run check"}
        </button>
        <a
          href="/backtest"
          className="text-xs px-3 py-2 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition"
          title="Backtest results & Excel export"
        >
          Backtest
        </a>
        <button
          onClick={onPast}
          disabled={pastLoading}
          className="text-xs px-3 py-2 rounded-md border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition disabled:opacity-50"
          title="Find past engulfing signals at your levels and email any new ones"
        >
          {pastLoading ? "Searching…" : "Past signals"}
        </button>
        <label className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-panel cursor-pointer select-none">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-accent" />
          Auto-scan
        </label>
        <button
          onClick={onScan}
          disabled={scanning}
          className="text-xs px-3 py-2 rounded-md bg-accent text-white font-medium hover:brightness-110 transition disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Scan now"}
        </button>
        {dirty && (
          <button
            onClick={onSave}
            disabled={saving}
            className="text-xs px-3 py-2 rounded-md bg-bull text-white font-medium hover:brightness-110 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
        {user && (
          <button
            onClick={onLogout}
            className="text-xs px-3 py-2 rounded-md border border-border bg-panel hover:bg-bear/15 hover:text-bear hover:border-bear/40 transition"
            title="Sign out"
          >
            Logout
          </button>
        )}
      </div>
    </header>
  );
}

/* ---------- preflight panel ---------- */
function Preflight({ checks, onClose }) {
  return (
    <div className="mt-5 rounded-lg border border-border bg-panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Startup check</span>
        <button onClick={onClose} className="text-muted hover:text-ink text-sm">✕</button>
      </div>
      <div className="divide-y divide-border">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <span
              className={`mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                c.pass ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
              }`}
            >
              {c.pass ? "PASS" : "FAIL"}
            </span>
            <div className="min-w-0">
              <div className="text-sm">{`Test ${i + 1}  ${c.name}`}</div>
              {c.detail && (
                <div className="text-xs text-muted font-mono whitespace-pre-wrap break-words mt-0.5">
                  {c.detail}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- pair card ---------- */
function PairCard({ pair, result, mutate }) {
  const [showChart, setShowChart] = useState(false);
  const [svg, setSvg] = useState("");
  const [loadingChart, setLoadingChart] = useState(false);

  const dir = result?.direction;
  const lvlResult = (id) => result?.levels?.find((l) => l.id === id);

  async function toggleChart() {
    if (showChart) return setShowChart(false);
    setShowChart(true);
    setLoadingChart(true);
    try {
      const data = await fetch(`/api/candles?pairId=${pair.id}`).then((r) => r.json());
      if (data.rows) {
        setSvg(buildChartSVG({ pair, tf: data.tf, rows: data.rows, signalTs: result?.last?.ts, direction: dir }));
      } else {
        setSvg("");
      }
    } finally {
      setLoadingChart(false);
    }
  }

  const set = (field, value) =>
    mutate((s) => {
      const p = s.pairs.find((x) => x.id === pair.id);
      p[field] = value;
    });

  return (
    <div className="rounded-lg border border-border bg-panel overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <input
          value={pair.name}
          onChange={(e) => set("name", e.target.value)}
          className="bg-transparent font-semibold text-base w-36 outline-none focus:text-accent"
        />
        {dir && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${dir === "bullish" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
            {dir.toUpperCase()} ENGULF
          </span>
        )}
        {result?.last && (
          <span className="text-xs text-muted font-mono tnum">last {fmt(result.last.close)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <a href={tvLink(pair)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            TradingView ↗
          </a>
          <button onClick={toggleChart} className="text-xs px-2 py-1 rounded border border-border hover:bg-panel/60">
            {showChart ? "Hide chart" : "Chart"}
          </button>
          <button
            onClick={() => mutate((s) => (s.pairs = s.pairs.filter((x) => x.id !== pair.id)))}
            className="text-xs text-bear/80 hover:text-bear px-1"
            title="Delete pair"
          >
            Delete
          </button>
        </div>
      </div>

      {/* pair fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pt-3 text-xs">
        <Field label="Exchange" value={pair.exchange} onChange={(v) => set("exchange", v)} />
        <Field label="ccxt symbol" value={pair.symbol} onChange={(v) => set("symbol", v)} mono />
        <Field label="TradingView" value={pair.tradingview || ""} onChange={(v) => set("tradingview", v)} mono placeholder="auto" />
        <Field label="Timeframe" value={pair.timeframe || ""} onChange={(v) => set("timeframe", v || null)} placeholder="default" />
      </div>
      {/* trade params (forex lot sizing) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pt-3 pb-3 border-b border-border text-xs">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted">Market</span>
          <select
            value={pair.market || "custom"}
            onChange={(e) => {
              const m = e.target.value;
              mutate((s) => {
                const p = s.pairs.find((x) => x.id === pair.id);
                p.market = m;
                if (MARKET_PRESETS[m]) {
                  p.contractSize = MARKET_PRESETS[m].contractSize;
                  p.pipSize = MARKET_PRESETS[m].pipSize;
                }
              });
            }}
            className="mt-1 w-full bg-panel2 border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent/60"
          >
            <option value="crypto">Crypto</option>
            <option value="gold">Gold (XAU)</option>
            <option value="forex">Forex</option>
            <option value="forexJPY">Forex (JPY)</option>
            <option value="custom">Custom</option>
          </select>
        </label>
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

      {/* chart */}
      {showChart && (
        <div className="px-4 py-3 border-b border-border bg-panel2">
          {loadingChart ? (
            <div className="text-xs text-muted py-8 text-center">Loading candles…</div>
          ) : svg ? (
            <div className="w-full overflow-hidden rounded-md" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="text-xs text-bear py-8 text-center">Could not load candles — check the symbol/exchange.</div>
          )}
        </div>
      )}

      {/* levels */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Levels</span>
          <button
            onClick={() => mutate((s) => s.pairs.find((x) => x.id === pair.id).levels.push({ id: uid(), low: 0, high: 0 }))}
            className="text-xs px-2.5 py-1 rounded-md bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition"
          >
            + Add level
          </button>
        </div>

        {pair.levels.length === 0 ? (
          <div className="text-xs text-muted py-3">No levels yet. Add a zone to watch.</div>
        ) : (
          <div className="space-y-1.5">
            {pair.levels.map((lvl) => (
              <LevelRow
                key={lvl.id}
                lvl={lvl}
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
    </div>
  );
}

function Field({ label, value, onChange, mono, placeholder }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full bg-panel2 border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent/60 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

/* ---------- level row ---------- */
function LevelRow({ lvl, state, onChange, onDelete }) {
  const touched = state?.touched;
  const gap = state?.gap;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        touched ? "border-gold/60 bg-gold/10" : "border-border bg-panel2"
      }`}
    >
      <span className="h-2 w-2 rounded-full bg-gold/70 shrink-0" />
      <NumberInput value={lvl.low} onChange={(v) => onChange("low", v)} />
      <span className="text-muted text-xs">→</span>
      <NumberInput value={lvl.high} onChange={(v) => onChange("high", v)} />
      <div className="ml-auto flex items-center gap-2">
        {state && (
          <span className={`text-[10px] font-mono ${touched ? "text-gold" : "text-muted"}`}>
            {touched ? "TOUCHED" : gap === 0 ? "inside" : `gap ${fmt(gap)}`}
          </span>
        )}
        <button onClick={onDelete} className="text-bear/70 hover:text-bear text-xs px-1" title="Delete level">
          ✕
        </button>
      </div>
    </div>
  );
}

function NumberInput({ value, onChange }) {
  return (
    <input
      type="number"
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
      className="w-24 bg-bg/60 border border-border rounded px-2 py-1 font-mono tnum text-sm outline-none focus:border-accent/60"
    />
  );
}

function RiskField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <input
        type="number"
        step="any"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
        className="mt-1 w-full bg-panel2 border border-border rounded-md px-2 py-1.5 font-mono outline-none focus:border-accent/60"
      />
    </label>
  );
}

/* ---------- settings ---------- */
function Settings({ settings, mutate }) {
  const setS = (field, value) => mutate((s) => (s.settings[field] = value));
  const setEmail = (field, value) => mutate((s) => (s.settings.email[field] = value));
  const setRisk = (field, value) =>
    mutate((s) => {
      if (!s.settings.risk) s.settings.risk = {};
      s.settings.risk[field] = value;
    });
  const email = settings.email || {};
  const risk = settings.risk || {};
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-email", { method: "POST" }).then((r) => r.json());
      setTestResult(res.ok ? { ok: true, msg: `Sent to ${res.sentTo.join(", ")}` } : { ok: false, msg: res.error });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e.message || e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-4 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Settings</h2>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Select
          label="Timeframe"
          value={settings.timeframe || "15m"}
          onChange={(v) => setS("timeframe", v)}
          options={["1m", "5m", "15m", "30m", "1h", "4h", "1d"]}
        />
        <Select
          label="Touch mode"
          value={settings.touchMode || "range"}
          onChange={(v) => setS("touchMode", v)}
          options={["range", "body", "close"]}
        />
        <label className="block col-span-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">Auto-scan interval (sec)</span>
          <input
            type="number"
            value={settings.pollIntervalSeconds || 60}
            onChange={(e) => setS("pollIntervalSeconds", parseInt(e.target.value || "60", 10))}
            className="mt-1 w-full bg-panel2 border border-border rounded-md px-2 py-1.5 font-mono outline-none focus:border-accent/60"
          />
        </label>
      </div>

      <div className="pt-2 border-t border-border space-y-3 text-xs">
        <h3 className="text-[10px] uppercase tracking-wide text-muted">Email alerts</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP server" value={email.smtpServer || ""} onChange={(v) => setEmail("smtpServer", v)} mono />
          <Field label="Port" value={email.smtpPort || ""} onChange={(v) => setEmail("smtpPort", parseInt(v || "587", 10))} mono />
        </div>
        <Field label="Sender" value={email.sender || ""} onChange={(v) => setEmail("sender", v)} mono />
        <Field
          label="App password"
          value={email.password || ""}
          onChange={(v) => setEmail("password", v)}
          mono
        />
        <Field
          label="Recipients (comma separated)"
          value={(email.recipients || []).join(", ")}
          onChange={(v) => setEmail("recipients", v.split(",").map((x) => x.trim()).filter(Boolean))}
          mono
        />

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={sendTest}
            disabled={testing}
            className="text-xs px-3 py-1.5 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send test email"}
          </button>
          {testResult && (
            <span className={`text-[11px] ${testResult.ok ? "text-bull" : "text-bear"}`}>
              {testResult.ok ? "✓ " : "✕ "}
              {testResult.msg}
            </span>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-border space-y-3 text-xs">
        <label className="flex items-center justify-between cursor-pointer select-none">
          <h3 className="text-[10px] uppercase tracking-wide text-muted">Risk &amp; position sizing</h3>
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={!!risk.enabled}
              onChange={(e) => setRisk("enabled", e.target.checked)}
              className="accent-accent"
            />
            include in alerts
          </span>
        </label>

        {risk.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <RiskField label="Account size" value={risk.accountSize} onChange={(v) => setRisk("accountSize", v)} placeholder="1000" />
              <RiskField label="Risk % per trade" value={risk.riskPercent} onChange={(v) => setRisk("riskPercent", v)} placeholder="1" />
            </div>
            <p className="text-[10px] text-muted leading-relaxed">
              Lot size is calculated so hitting the stop loses your risk %. SL sits just past the engulfing candle; TP uses a 1:2 reward:risk.
              <span className="text-accent"> Leverage is set per pair</span> (in each pair card).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-panel2 border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent/60"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- signal log ---------- */
function SignalLog({ signals }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Signals</h2>
      {signals.length === 0 ? (
        <p className="text-xs text-muted">No signals yet. They appear here when an engulfing candle hits a level.</p>
      ) : (
        <div className="space-y-2">
          {signals.map((sig, i) => (
            <a
              key={i}
              href={sig.link}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-border bg-panel2 px-3 py-2 hover:border-accent/40 transition"
            >
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sig.direction === "bullish" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
                  {sig.direction.toUpperCase()}
                </span>
                <span className="text-sm font-medium">{sig.pair}</span>
                <span className="ml-auto text-[10px] text-muted">{new Date(sig.at).toLocaleTimeString()}</span>
              </div>
              <div className="text-xs text-muted font-mono tnum mt-1">
                {fmt(sig.low)} → {fmt(sig.high)}
                {sig.emailed === false && <span className="text-bear ml-2">email failed</span>}
              </div>
              {sig.position && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono tnum border-t border-border pt-2">
                  <span className="text-muted">Entry <span className="text-ink">{fmt(sig.position.entry)}</span></span>
                  <span className="text-muted">Lots <span className="text-accent">{sig.position.lots}</span></span>
                  <span className="text-muted">SL <span className="text-bear">{fmt(sig.position.stop)}</span> <span className="text-muted">({sig.position.slPips}p)</span></span>
                  <span className="text-muted">TP <span className="text-bull">{fmt(sig.position.tp)}</span> <span className="text-muted">({sig.position.tpPips}p)</span></span>
                  <span className="text-muted">Margin <span className="text-ink">{fmt(sig.position.margin)}</span></span>
                  <span className="text-muted">Risk <span className="text-ink">{fmt(sig.position.riskAmount)}</span> → <span className="text-bull">{fmt(sig.position.rewardAmount)}</span></span>
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
