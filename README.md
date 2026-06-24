# Engulfing Alerts — Next.js Dashboard

A web dashboard to watch trading pairs for **engulfing candles at your price
levels** and get an **email alert** (with a chart image and TradingView link)
when one fires. Everything — pairs, levels, timeframe, email — is managed from
the UI and saved to a local file. No code editing needed to add a level or pair.

Tech: Next.js 14 (App Router), Tailwind CSS, ccxt (market data), nodemailer (email).

---

## 1. Requirements
- Node.js 18.18+ (20 LTS recommended). Check with `node -v`.

## 2. Install
From this folder:
```bash
npm install
```

## 3. Run the dashboard
```bash
npm run dev
```
Open http://localhost:3000

You'll see your PAXGUSDT.P pair with all 5 levels already loaded.

## 4. Set up email (one time)
In the dashboard sidebar → **Settings → Email alerts**:
- SMTP server: `smtp.gmail.com`, Port: `587`
- Sender: your Gmail address
- App password: a Gmail **App Password** (Google Account → Security → 2-Step
  Verification → App passwords — your normal password will not work)
- Recipients: where alerts go (your own email is fine)

Click **Save changes**, then **Run check** at the top. You'll get a Test 1…5
checklist (logic, config, live data, TradingView link, email login) so you can
confirm everything is wired up.

## 5. Watch for signals
- **Scan now** runs one scan immediately.
- **Auto-scan** keeps scanning on the interval set in Settings (default 60s)
  for as long as the tab is open.
- When an engulfing candle closes inside one of your levels, you get an email
  and it appears in the **Signals** panel.

## Managing levels & pairs (all live, no code)
- **Add level:** open a pair → "+ Add level" → type the two prices. Order
  doesn't matter; the system sorts low/high.
- **Edit level:** just change the numbers.
- **Delete level:** the ✕ on the row.
- **Add pair (e.g. BTCUSDT.P):** "+ Add pair", then set name, exchange,
  ccxt symbol (e.g. `BTC/USDT:USDT`), and add levels.
- Click **Save changes** to persist. Data lives in `data/store.json`.

Not sure of a symbol? ccxt uses unified names like `PAXG/USDT:USDT` (the
`:USDT` part means the USDT perpetual). If a pair's chart fails to load, the
symbol or exchange is wrong.

## Run 24/7 (alerts even with the browser closed)
The dashboard only scans while open. For always-on alerts, run the worker in a
separate terminal (or on a small VPS):
```bash
npm run worker
```
It uses the same `data/store.json` and email settings, scanning on your
interval and printing a line per scan.

## How a signal is decided
1. A candle **closes** (signals are confirmed, never repaint).
2. It's a real-body **engulfing** candle (bullish or bearish).
3. It **touches** one of your level zones (touch mode: `range` = any wick,
   `body`, or `close` = closed inside).
All three → email + signal.

## Notes / production
- `data/store.json` is the database. Back it up if you like. `alertedKeys`
  inside it prevents duplicate alerts.
- The email's chart is attached as an **SVG** (opens in any browser, crisp at
  any size). If you specifically want a PNG embedded in the email body, add
  `sharp` and convert the SVG — ask and it can be wired in.
- Deploying to Vercel: the serverless filesystem is read-only/ephemeral, so the
  JSON store won't persist there. For a hosted always-on setup, run it on a VPS
  (or swap `lib/store.js` for a small database). Locally and on a VPS it works
  as-is.

## Project map
```
app/
  page.js            the dashboard UI (client)
  layout.js, globals.css
  api/
    config/route.js  GET/PUT the whole config
    scan/route.js    run a scan (detect + email)
    candles/route.js candles for the chart preview
    preflight/route.js the Test 1..5 checklist
lib/
  engulfing.js  detection + zone logic (pure)
  chart.js      candlestick SVG builder (pure)
  scanner.js    fetch + detect + send alerts
  mailer.js     nodemailer email
  store.js      read/write data/store.json
worker.mjs      standalone 24/7 scanner
data/store.json your pairs, levels, settings
```
