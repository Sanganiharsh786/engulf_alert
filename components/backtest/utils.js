export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Forex trading sessions, expressed in IST (UTC+5:30) minutes-of-day.
// Windows are non-overlapping and cover the full 24h so every trade maps to
// exactly one session. New York wraps past midnight.
function hm(min) {
  const h = Math.floor((((min % 1440) + 1440) % 1440) / 60);
  const m = (((min % 60) + 60) % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const SESSIONS = [
  { key: "sydney", label: "Sydney", short: "SYD", start: 150, end: 330 }, // 02:30–05:30
  { key: "tokyo", label: "Tokyo", short: "TYO", start: 330, end: 750 }, // 05:30–12:30
  { key: "london", label: "London", short: "LDN", start: 750, end: 1050 }, // 12:30–17:30
  { key: "newyork", label: "New York", short: "NY", start: 1050, end: 150 }, // 17:30–02:30 (+1)
].map((s) => ({ ...s, window: `${hm(s.start)}–${hm(s.end)}` }));

// classify a trade's IST time string ("YYYY-MM-DDTHH:MM…") into a session key
export function sessionOf(time) {
  if (!time) return "newyork";
  const [h, m] = time.slice(11, 16).split(":").map(Number);
  const min = h * 60 + m;
  for (const s of SESSIONS) {
    if (s.start < s.end) {
      if (min >= s.start && min < s.end) return s.key;
    } else if (min >= s.start || min < s.end) {
      return s.key;
    }
  }
  return "newyork";
}

// win rate / TP–SL hits / net R per trading session
export function summarizeBySession(trades) {
  const map = {};
  for (const s of SESSIONS) {
    map[s.key] = { ...s, signals: 0, closed: 0, wins: 0, losses: 0, open: 0, netR: 0 };
  }
  for (const t of trades) {
    const s = map[sessionOf(t.time)];
    if (!s) continue;
    s.signals++;
    if (t.outcome === "open") s.open++;
    else {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return SESSIONS.map((sd) => {
    const s = map[sd.key];
    return {
      ...s,
      netR: Math.round(s.netR * 100) / 100,
      winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    };
  });
}

export function summarize(trades) {
  const byPair = {};
  for (const t of trades) {
    const s = (byPair[t.pair] = byPair[t.pair] || {
      pair: t.pair, signals: 0, closed: 0, wins: 0, losses: 0, open: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome === "open") s.open++;
    else {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byPair).map((s) => ({
    ...s,
    netR: Math.round(s.netR * 100) / 100,
    winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
  }));
}

// win rate per IST calendar month ("YYYY-MM" from the trade's IST time)
export function summarizeByMonth(trades) {
  const byMonth = {};
  for (const t of trades) {
    const key = t.time.slice(0, 7); // "YYYY-MM" in IST
    const s = (byMonth[key] = byMonth[key] || {
      key, signals: 0, closed: 0, wins: 0, losses: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome !== "open") {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byMonth)
    .sort((a, b) => (a.key < b.key ? 1 : -1)) // newest first
    .map((s) => ({
      ...s,
      label: monthLabel(s.key),
      netR: Math.round(s.netR * 100) / 100,
      winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    }));
}

// win rate per IST calendar day ("YYYY-MM-DD" from the trade's IST time)
export function summarizeByDay(trades) {
  const byDay = {};
  for (const t of trades) {
    const key = t.time.slice(0, 10); // "YYYY-MM-DD" in IST
    const s = (byDay[key] = byDay[key] || {
      key, date: key, signals: 0, closed: 0, wins: 0, losses: 0, netR: 0,
    });
    s.signals++;
    if (t.outcome !== "open") {
      s.closed++;
      if (t.outcome === "win") s.wins++;
      else if (t.outcome === "loss") s.losses++;
      s.netR += t.r;
    }
  }
  return Object.values(byDay)
    .sort((a, b) => (a.key < b.key ? -1 : 1)) // oldest first for calendar display
    .map((s) => ({
      ...s,
      netR: Math.round(s.netR * 100) / 100,
      winRate: s.closed ? Math.round((s.wins / s.closed) * 1000) / 10 : 0,
    }));
}

// get today's date in IST format
export function getTodayIST() {
  const now = new Date();
  const istTime = new Date(now.getTime() + IST_OFFSET_MS);
  return istTime.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
