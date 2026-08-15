// Sessions live in lib/sessions.js so the strategy-level session FILTER and the
// session LABELS in the trades table can never drift apart.
//
// Imported (not just re-exported) because the helpers below use them directly —
// a bare `export ... from` would re-export the names without binding them in
// this module's scope.
import {
  IST_OFFSET_MS,
  SESSIONS,
  SESSION_COMBOS,
  sessionOf,
  sessionKeyOfTs,
} from "@/lib/sessions";

// re-exported so existing imports from this module keep working
export { IST_OFFSET_MS, SESSIONS, SESSION_COMBOS, sessionOf, sessionKeyOfTs };

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt = (n) =>
  n === null || n === undefined || n === ""
    ? ""
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Merge per-session summaries into one aggregate stat for a set of session keys.
export function mergeSessionStats(sessions, keys) {
  const acc = { signals: 0, closed: 0, wins: 0, losses: 0, open: 0, netR: 0 };
  for (const s of sessions) {
    if (!keys.includes(s.key)) continue;
    acc.signals += s.signals;
    acc.closed += s.closed;
    acc.wins += s.wins;
    acc.losses += s.losses;
    acc.open += s.open;
    acc.netR += s.netR;
  }
  return {
    ...acc,
    netR: Math.round(acc.netR * 100) / 100,
    winRate: acc.closed ? Math.round((acc.wins / acc.closed) * 1000) / 10 : 0,
  };
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
