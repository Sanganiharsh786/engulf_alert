// Builds a candlestick chart as an SVG string. Pure / dependency-free so it
// works both server-side (email attachment) and in the browser (live preview).

export function buildChartSVG({ pair, tf, rows, signalTs = null, direction = null, entry = null, stop = null, tp = null }) {
  const W = 1000, H = 520, padL = 70, padR = 16, padT = 38, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  if (!rows || rows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0e1422"/></svg>`;
  }

  const lows = rows.map((r) => r[3]);
  const highs = rows.map((r) => r[2]);
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
  
  const pad = (ymax - ymin) * 0.12 || 1;
  ymin -= pad;
  ymax += pad;

  const x = (i) =>
    padL + (rows.length <= 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v) => padT + (1 - (v - ymin) / (ymax - ymin)) * plotH;
  const cw = Math.max(2, (plotW / rows.length) * 0.6);

  const C = {
    bg: "#0e1422", grid: "#1e2840", ink: "#e8edff", muted: "#8b97b8",
    bull: "#26a69a", bear: "#ef5350", gold: "#f1c40f", blue: "#3b82f6",
    entry: "#ffffff", stopLoss: "#ef5350", takeProfit: "#26a69a",
  };

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;

  // y grid + price labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + ((ymax - ymin) * i) / ticks;
    const yy = y(v);
    s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${C.grid}"/>`;
    s += `<text x="${padL - 8}" y="${yy + 4}" fill="${C.muted}" font-size="12" text-anchor="end" font-family="ui-monospace,monospace">${v.toFixed(2)}</text>`;
  }

  // your level zones (gold)
  for (const lvl of pair.levels || []) {
    const lo = Math.min(lvl.low, lvl.high);
    const hi = Math.max(lvl.low, lvl.high);
    const top = Math.max(padT, y(hi));
    const bot = Math.min(padT + plotH, y(lo));
    if (bot > top) {
      s += `<rect x="${padL}" y="${top}" width="${plotW}" height="${bot - top}" fill="${C.gold}" opacity="0.16"/>`;
      s += `<line x1="${padL}" y1="${top}" x2="${W - padR}" y2="${top}" stroke="${C.gold}" opacity="0.55"/>`;
      s += `<line x1="${padL}" y1="${bot}" x2="${W - padR}" y2="${bot}" stroke="${C.gold}" opacity="0.55"/>`;
    }
  }

  // Entry, Stop Loss, and Take Profit lines
  if (entry !== null) {
    const entryY = y(entry);
    s += `<line x1="${padL}" y1="${entryY}" x2="${W - padR}" y2="${entryY}" stroke="${C.entry}" stroke-width="2" stroke-dasharray="5,3"/>`;
    s += `<text x="${W - padR - 5}" y="${entryY - 8}" fill="${C.entry}" font-size="11" font-weight="600" text-anchor="end">ENTRY ${entry.toFixed(2)}</text>`;
  }
  
  if (stop !== null) {
    const stopY = y(stop);
    s += `<line x1="${padL}" y1="${stopY}" x2="${W - padR}" y2="${stopY}" stroke="${C.stopLoss}" stroke-width="2" stroke-dasharray="8,4"/>`;
    s += `<text x="${W - padR - 5}" y="${stopY - 8}" fill="${C.stopLoss}" font-size="11" font-weight="600" text-anchor="end">SL ${stop.toFixed(2)}</text>`;
  }
  
  if (tp !== null) {
    const tpY = y(tp);
    s += `<line x1="${padL}" y1="${tpY}" x2="${W - padR}" y2="${tpY}" stroke="${C.takeProfit}" stroke-width="2" stroke-dasharray="8,4"/>`;
    s += `<text x="${W - padR - 5}" y="${tpY - 8}" fill="${C.takeProfit}" font-size="11" font-weight="600" text-anchor="end">TP ${tp.toFixed(2)}</text>`;
  }

  // candles
  let sigX = null, sigYH = null, sigYL = null;
  rows.forEach((r, i) => {
    const [ts, o, h, l, c] = r;
    const up = c >= o;
    const col = up ? C.bull : C.bear;
    const cx = x(i);
    s += `<line x1="${cx}" y1="${y(h)}" x2="${cx}" y2="${y(l)}" stroke="${col}" stroke-width="1.4"/>`;
    const yo = y(o), yc = y(c);
    const top = Math.min(yo, yc);
    const hgt = Math.max(1, Math.abs(yc - yo));
    s += `<rect x="${cx - cw / 2}" y="${top}" width="${cw}" height="${hgt}" fill="${col}"/>`;
    if (signalTs != null && ts === signalTs) { sigX = cx; sigYH = y(h); sigYL = y(l); }
  });

  // highlight engulfing candle
  if (sigX != null) {
    s += `<rect x="${sigX - cw / 2 - 4}" y="${sigYH - 6}" width="${cw + 8}" height="${sigYL - sigYH + 12}" fill="none" stroke="${C.blue}" stroke-width="2.5" rx="3"/>`;
    const label = `${direction ? direction.toUpperCase() : ""} ENGULF`;
    s += `<text x="${sigX}" y="${Math.max(padT + 12, sigYH - 12)}" fill="${C.blue}" font-size="13" font-weight="700" text-anchor="middle">${label}</text>`;
  }

  s += `<text x="${padL}" y="22" fill="${C.ink}" font-size="15" font-weight="700">${pair.name}  ${tf}</text>`;
  s += `</svg>`;
  return s;
}
