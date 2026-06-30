// Builds a candlestick chart as an SVG string. Pure / dependency-free so it
// works both server-side (email attachment) and in the browser (live preview).

function fmtTime(ts, tfSec) {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = String(d.getUTCMonth() + 1).padStart(2, "0");

  // Show date for 4h+ and 1d+ timeframes, otherwise show time
  if (tfSec >= 14400) {
    return `${dd}/${mon}`;
  }
  return `${hh}:${mm}`;
}

function shouldShowLabel(i, total, tfSec) {
  // Determine label spacing based on timeframe and total candles
  const targetLabels = Math.min(total, 8);
  const step = Math.max(1, Math.floor(total / targetLabels));
  return i % step === 0 || i === total - 1;
}

export function buildChartSVG({ pair, tf, rows, signalTs = null, direction = null, entry = null, stop = null, tp = null, levelLow = null, levelHigh = null }) {
  // Chart dimensions
  const W = 1200, H = 650;
  const padL = 80, padR = 130, padT = 50, padB = 80; // More bottom space for time labels
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const volH = 50; // Height of the volume bars section
  const candleH = plotH - volH - 10; // Height for candles, with gap before volume

  if (!rows || rows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0e1422"/></svg>`;
  }

  const lows = rows.map((r) => r[3]);
  const highs = rows.map((r) => r[2]);
  const vols = rows.map((r) => r[5]);
  let ymin = Math.min(...lows);
  let ymax = Math.max(...highs);

  // Include SL/TP levels in the chart range if provided
  if (stop !== null) {
    ymin = Math.min(ymin, stop);
    ymax = Math.max(ymax, stop);
  }
  if (tp !== null) {
    ymin = Math.min(ymin, tp);
    ymax = Math.max(ymax, tp);
  }
  if (entry !== null) {
    ymin = Math.min(ymin, entry);
    ymax = Math.max(ymax, entry);
  }
  // Include level zone bounds
  if (levelLow !== null) {
    ymin = Math.min(ymin, levelLow);
    ymax = Math.max(ymax, levelLow);
  }
  if (levelHigh !== null) {
    ymin = Math.min(ymin, levelHigh);
    ymax = Math.max(ymax, levelHigh);
  }

  const pad = (ymax - ymin) * 0.15 || 1;
  ymin -= pad;
  ymax += pad;

  // If no valid price range, use default
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }

  const x = (i) =>
    padL + (rows.length <= 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const yPrice = (v) => padT + (1 - (v - ymin) / (ymax - ymin)) * candleH;
  const yVol = (v, maxVol) => {
    const volTop = padT + candleH + 15;
    const volPlotH = volH - 5;
    if (maxVol <= 0) return volTop + volPlotH;
    return volTop + (1 - v / maxVol) * volPlotH;
  };
  const cw = Math.max(3, Math.min(30, (plotW / rows.length) * 0.7));

  // Colors
  const C = {
    bg: "#0e1422", grid: "#1e2840", gridSub: "#162034",
    ink: "#e8edff", muted: "#8b97b8", mutedDim: "#3e4a6e",
    bull: "#26a69a", bear: "#ef5350", bullVol: "#26a69a44", bearVol: "#ef535044",
    gold: "#f1c40f", blue: "#3b82f6", blueDim: "#3b82f622",
    entry: "#ffffff", stopLoss: "#ef5350", takeProfit: "#26a69a",
    volLine: "#1e284088",
  };

  // Determine the signal's time range for display
  const firstTs = rows[0][0];
  const lastTs = rows[rows.length - 1][0];
  const tfSec = (() => {
    if (rows.length < 2) return 900;
    return Math.round((rows[1][0] - rows[0][0]) / 1000);
  })();

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif">`;

  // Background
  s += `<defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#0a0f1a"/>
    </linearGradient>
    <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#26a69a"/>
      <stop offset="100%" stop-color="#1a7a72"/>
    </linearGradient>
    <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ef5350"/>
      <stop offset="100%" stop-color="#c62828"/>
    </linearGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#bgGrad)"/>`;

  // Horizontal grid lines for candle area
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + ((ymax - ymin) * i) / ticks;
    const yy = yPrice(v);
    s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${C.gridSub}" stroke-width="1"/>`;
    s += `<text x="${padL - 10}" y="${yy + 4}" fill="${C.muted}" font-size="12" text-anchor="end" font-family="ui-monospace,monospace" opacity="0.9">${v.toFixed(4)}</text>`;
  }

  // Draw the volume separator line
  const volTopY = padT + candleH + 10;
  s += `<line x1="${padL}" y1="${volTopY}" x2="${W - padR}" y2="${volTopY}" stroke="${C.volLine}" stroke-width="1" stroke-dasharray="4,2"/>`;

  // Draw the specific level zone (gold) if provided
  if (levelLow !== null && levelHigh !== null) {
    const lo = Math.min(levelLow, levelHigh);
    const hi = Math.max(levelLow, levelHigh);
    const top = Math.max(padT, yPrice(hi));
    const bot = Math.min(padT + candleH, yPrice(lo));
    if (bot > top + 2) {
      s += `<rect x="${padL}" y="${top}" width="${plotW}" height="${bot - top}" fill="${C.gold}" opacity="0.12"/>`;
      s += `<line x1="${padL}" y1="${top}" x2="${W - padR}" y2="${top}" stroke="${C.gold}" opacity="0.6" stroke-width="1.5" stroke-dasharray="4,3"/>`;
      s += `<line x1="${padL}" y1="${bot}" x2="${W - padR}" y2="${bot}" stroke="${C.gold}" opacity="0.6" stroke-width="1.5" stroke-dasharray="4,3"/>`;
      // Level label
      const midY = (top + bot) / 2;
      s += `<rect x="${padL + 4}" y="${midY - 10}" width="32" height="20" fill="${C.bg}" opacity="0.85" rx="3"/>`;
      s += `<text x="${padL + 20}" y="${midY + 4}" fill="${C.gold}" font-size="10" font-weight="700" text-anchor="middle" opacity="0.8">LEVEL</text>`;
    }
  } else {
    // Fallback: draw all pair levels
    for (const lvl of pair.levels || []) {
      const lo = Math.min(lvl.low, lvl.high);
      const hi = Math.max(lvl.low, lvl.high);
      const top = Math.max(padT, yPrice(hi));
      const bot = Math.min(padT + candleH, yPrice(lo));
      if (bot > top + 2) {
        s += `<rect x="${padL}" y="${top}" width="${plotW}" height="${bot - top}" fill="${C.gold}" opacity="0.08"/>`;
        s += `<line x1="${padL}" y1="${top}" x2="${W - padR}" y2="${top}" stroke="${C.gold}" opacity="0.4" stroke-width="1" stroke-dasharray="3,3"/>`;
        s += `<line x1="${padL}" y1="${bot}" x2="${W - padR}" y2="${bot}" stroke="${C.gold}" opacity="0.4" stroke-width="1" stroke-dasharray="3,3"/>`;
      }
    }
  }

  // Entry, Stop Loss, and Take Profit lines
  function drawLine(v, color, label, labelPrefix) {
    const yy = yPrice(v);
    s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${color}" stroke-width="2.5" stroke-dasharray="7,4" opacity="0.9"/>`;
    const txt = `${labelPrefix} ${v.toFixed(4)}`;
    const tw = txt.length * 7;
    s += `<rect x="${W - padR - tw - 12}" y="${yy - 12}" width="${tw + 16}" height="24" fill="${C.bg}" stroke="${color}" stroke-width="1" rx="4"/>`;
    s += `<text x="${W - padR - 6}" y="${yy + 5}" fill="${color}" font-size="12" font-weight="700" text-anchor="end" font-family="ui-monospace,monospace">${txt}</text>`;
  }
  if (entry !== null) drawLine(entry, C.entry, "ENTRY", "Entry");
  if (stop !== null) drawLine(stop, C.stopLoss, "STOP LOSS", "SL");
  if (tp !== null) drawLine(tp, C.takeProfit, "TAKE PROFIT", "TP");

  // Volume bars
  const maxVol = Math.max(...vols, 1);
  const volBaseY = yVol(0, maxVol);
  rows.forEach((r, i) => {
    const [ts, o, h, l, c, v] = r;
    const up = c >= o;
    const col = up ? C.bullVol : C.bearVol;
    const cx = x(i);
    const barW = Math.max(1, cw * 0.8);
    const volY2 = yVol(v, maxVol);
    const barH = volBaseY - volY2;
    if (barH > 0.5) {
      s += `<rect x="${cx - barW / 2}" y="${volY2}" width="${barW}" height="${barH}" fill="${col}" rx="0.5"/>`;
    }
  });

  // Candles
  let sigX = null, sigYH = null, sigYL = null;
  rows.forEach((r, i) => {
    const [ts, o, h, l, c] = r;
    const up = c >= o;
    const col = up ? C.bull : C.bear;
    const cx = x(i);

    // Wick
    const wickH = yPrice(h) - yPrice(l);
    if (wickH > 0.5) {
      s += `<line x1="${cx}" y1="${yPrice(h)}" x2="${cx}" y2="${yPrice(l)}" stroke="${col}" stroke-width="1.5" opacity="0.8"/>`;
    }

    // Body
    const yo = yPrice(o), yc = yPrice(c);
    const bodyTop = Math.min(yo, yc);
    const bodyHgt = Math.max(1.5, Math.abs(yc - yo));
    s += `<rect x="${cx - cw / 2}" y="${bodyTop}" width="${cw}" height="${bodyHgt}" fill="${up ? 'url(#bullGrad)' : 'url(#bearGrad)'}" stroke="${col}" stroke-width="0.5" rx="0.5"/>`;

    if (signalTs != null && ts === signalTs) {
      sigX = cx;
      sigYH = yPrice(h);
      sigYL = yPrice(l);
    }
  });

  // Highlight engulfing candle
  if (sigX != null) {
    const boxPad = cw > 8 ? 8 : 4;
    s += `<rect x="${sigX - cw / 2 - boxPad}" y="${sigYH - boxPad - 4}" width="${cw + boxPad * 2}" height="${sigYL - sigYH + boxPad * 2 + 4}" fill="${C.blueDim}" stroke="${C.blue}" stroke-width="3" rx="5"/>`;

    const label = `${direction ? direction.toUpperCase() : ""} ENGULFING SIGNAL`;
    const labelW = 180;
    const labelH = 26;
    let labelY = Math.max(padT + 10, sigYH - 40);
    if (labelY + labelH > padT + candleH) labelY = Math.min(sigYH + 10, padT + candleH - 35);
    s += `<rect x="${sigX - labelW / 2}" y="${labelY}" width="${labelW}" height="${labelH}" fill="${C.blue}" rx="13"/>`;
    s += `<text x="${sigX}" y="${labelY + 17}" fill="#ffffff" font-size="13" font-weight="800" text-anchor="middle" letter-spacing="1">${label}</text>`;
  }

  // Time labels on x-axis
  rows.forEach((r, i) => {
    if (!shouldShowLabel(i, rows.length, tfSec)) return;
    const cx = x(i);
    const label = fmtTime(r[0], tfSec);
    s += `<text x="${cx}" y="${padT + candleH + volH + 30}" fill="${C.mutedDim}" font-size="11" text-anchor="middle" font-family="ui-monospace,monospace" opacity="0.9">${label}</text>`;
    // Tick mark
    s += `<line x1="${cx}" y1="${padT + candleH + 15}" x2="${cx}" y2="${padT + candleH + 20}" stroke="${C.mutedDim}" stroke-width="1" opacity="0.5"/>`;
  });

  // Vertical grid lines matching time labels
  rows.forEach((r, i) => {
    if (!shouldShowLabel(i, rows.length, tfSec)) return;
    if (i === 0 || i === rows.length - 1) return; // skip edges for cleaner look
    const cx = x(i);
    s += `<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${padT + candleH}" stroke="${C.gridSub}" stroke-width="0.5" stroke-dasharray="2,4" opacity="0.5"/>`;
  });

  // Title line
  s += `<text x="${padL}" y="28" fill="${C.ink}" font-size="18" font-weight="700" letter-spacing="0.5">${pair.name}  ·  ${tf}</text>`;

  // Date range subtitle
  const fmtRange = (ts) => {
    const d = new Date(ts);
    return d.toUTCString().slice(5, 16);
  };
  s += `<text x="${padL}" y="42" fill="${C.muted}" font-size="11" opacity="0.7">${fmtRange(firstTs)} — ${fmtRange(lastTs)}</text>`;

  // Volume label
  s += `<text x="${padL - 4}" y="${padT + candleH + volH - 5}" fill="${C.mutedDim}" font-size="10" text-anchor="end" font-family="ui-monospace,monospace" opacity="0.7">VOL</text>`;

  s += `</svg>`;
  return s;
}
