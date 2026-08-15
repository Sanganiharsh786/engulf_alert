// Single source of truth for trading sessions.
//
// Every session window in this app is expressed in IST (UTC+5:30) minutes-of-day,
// because every timestamp the UI shows (the `time` column, the month buckets) is
// on the IST clock. Defining sessions on any other clock makes the strategy-level
// session filter disagree with the session labels in the trades table, which is
// exactly the bug this module exists to prevent.
//
// Windows are non-overlapping and cover the full 24h, so every trade maps to
// exactly one session. New York wraps past midnight.

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function hm(min) {
  const h = Math.floor((((min % 1440) + 1440) % 1440) / 60);
  const m = (((min % 60) + 60) % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const SESSIONS = [
  { key: "sydney", label: "Sydney", short: "SYD", start: 150, end: 330 }, // 02:30–05:30 IST
  { key: "tokyo", label: "Tokyo", short: "TYO", start: 330, end: 750 }, // 05:30–12:30 IST
  { key: "london", label: "London", short: "LDN", start: 750, end: 1050 }, // 12:30–17:30 IST
  { key: "newyork", label: "New York", short: "NY", start: 1050, end: 150 }, // 17:30–02:30 IST (+1)
].map((s) => ({ ...s, window: `${hm(s.start)}–${hm(s.end)}` }));

// Minutes-of-day on the IST clock for an epoch-ms timestamp.
export function istMinutesOfDay(tsMs) {
  const d = new Date(tsMs + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function inWindow(min, start, end) {
  return start < end ? min >= start && min < end : min >= start || min < end;
}

// Classify an IST time STRING ("YYYY-MM-DD HH:MM" / "…THH:MM…") into a session key.
export function sessionOf(time) {
  if (!time) return "newyork";
  const [h, m] = time.slice(11, 16).split(":").map(Number);
  const min = h * 60 + m;
  for (const s of SESSIONS) if (inWindow(min, s.start, s.end)) return s.key;
  return "newyork";
}

// Classify an epoch-ms TIMESTAMP into a session key.
export function sessionKeyOfTs(tsMs) {
  const min = istMinutesOfDay(tsMs);
  for (const s of SESSIONS) if (inWindow(min, s.start, s.end)) return s.key;
  return "newyork";
}

// Preset session combinations ("overlaps"): the union of two adjacent sessions.
export const SESSION_COMBOS = [
  { key: "syd_tyo", label: "Sydney + Tokyo", short: "SYD+TYO", keys: ["sydney", "tokyo"] },
  { key: "tyo_ldn", label: "Tokyo + London", short: "TYO+LDN", keys: ["tokyo", "london"] },
  { key: "ldn_ny", label: "London + New York", short: "LDN+NY", keys: ["london", "newyork"] },
];

// `sessionFilter` values accepted by the strategy config. These map onto the
// SESSIONS keys above so a filter always means the same thing as the label
// shown in the trades table.
export const SESSION_FILTERS = {
  ALL: null, // no filtering
  SYDNEY: ["sydney"],
  TOKYO: ["tokyo"],
  LONDON: ["london"],
  NEWYORK: ["newyork"],
  SYDNEY_TOKYO: ["sydney", "tokyo"],
  TOKYO_LONDON: ["tokyo", "london"],
  LONDON_NY: ["london", "newyork"],
};

function hhmmToMinutes(s) {
  const m = String(s || "").match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Is `tsMs` inside the configured session? CUSTOM ranges are also IST and may
// wrap past midnight.
export function inSession(tsMs, cfg = {}) {
  const mode = String(cfg.sessionFilter || "ALL").toUpperCase();
  if (mode === "ALL") return true;

  if (mode === "CUSTOM") {
    const start = hhmmToMinutes(cfg.customSessionStart);
    const end = hhmmToMinutes(cfg.customSessionEnd);
    if (start == null || end == null || start === end) return true;
    return inWindow(istMinutesOfDay(tsMs), start, end);
  }

  const keys = SESSION_FILTERS[mode];
  if (!keys) return true; // unknown value = no filtering
  return keys.includes(sessionKeyOfTs(tsMs));
}
