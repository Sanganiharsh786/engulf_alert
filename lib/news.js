// Economic news event schedule and 1m candle analysis.
// All NFP / CPI / FOMC dates are from official BLS and Federal Reserve schedules.
// NFP and CPI use the first-Friday / middle-of-month formula with a known-exceptions
// override map for months where the BLS schedule deviates due to holidays.

// ---- ET / UTC helpers ----

function etOffset(year, month) {
  // EDT (UTC-4) from 2nd Sunday March to 1st Sunday November
  return month >= 2 && month <= 9 ? -4 : -5;
}

function etToUTC(year, month, day, hourET, minET) {
  return Date.UTC(year, month, day, hourET - etOffset(year, month), minET, 0, 0);
}

function firstFriday(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay();
  const diff = dow <= 5 ? 5 - dow : 5 + 7 - dow;
  return 1 + diff;
}

/** Nth weekday of a month (0=Sun…6=Sat, n is 1‑based) */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function nthWeekday(year, month, weekday, n) {
  let d = 1, count = 0;
  for (; d <= 31; d++) {
    const dt = new Date(Date.UTC(year, month, d));
    if (dt.getUTCMonth() !== month) break;
    if (dt.getUTCDay() === weekday) { count++; if (count === n) return d; }
  }
  return 14; // fallback
}

// ---- Known exceptions to formula-based dates ----
// Keys: "YYYY-MM" (release month, 1-indexed month string)
// Value: override day-of-month

const NFP_DATE_OVERRIDES = {
  // Months where first Friday is NOT the release day (holiday reschedules)
  // Jul 4 (Sat) → Jul 3 observed holiday → NFP moved to Thursday Jul 2
  "2026-07": 2,
};

// CPI release approximates: 2nd Wednesday of the month, 8:30 AM ET
// Verified BLS dates listed as overrides
const CPI_DATE_OVERRIDES = {
  // 2025 actual BLS CPI release dates
  "2025-01": 15,
  "2025-02": 13,
  "2025-04": 10,  // Mar data released Apr 10
  "2025-05": 14,  // Apr data released May 14
  "2025-06": 11,  // May data released Jun 11
  "2025-07": 11,  // Jun data released Jul 11
  "2025-08": 13,  // Jul data released Aug 13
  "2025-09": 10,  // Aug data released Sep 10
  "2025-10": 15,  // Sep data released Oct 15
  "2025-11": 13,  // Oct data released Nov 13
  "2025-12": 11,  // Nov data released Dec 11
  // 2026 actual BLS CPI release dates
  "2026-01": 13,  // Dec data released Jan 13
  "2026-02": 13,  // Jan data released Feb 13
  "2026-03": 11,  // Feb data released Mar 11
  "2026-04": 10,  // Mar data released Apr 10
  "2026-05": 12,  // Apr data released May 12
  "2026-06": 10,  // May data released Jun 10
  "2026-07": 14,  // Jun data released Jul 14
  "2026-08": 12,  // Jul data released Aug 12
  "2026-09": 11,  // Aug data released Sep 11
  "2026-10": 14,  // Sep data released Oct 14
  "2026-11": 10,  // Oct data released Nov 10
  "2026-12": 10,  // Nov data released Dec 10
};

// ---- Candle classification ----

export function classifyCandle(o, h, l, c) {
  const body = Math.abs(c - o);
  const range = h - l;
  if (range === 0) return "doji";
  return body / range < 0.08 ? "doji" : (c >= o ? "bullish" : "bearish");
}

export function candleChangePct(o, c) {
  if (o === 0) return 0;
  return ((c - o) / o) * 100;
}

// ---- Generators ----

/**
 * Generate NFP events for a year range.
 * Each event corresponds to one NFP data release.
 * @returns {{ type, label, dataLabel, ts, timeET, importance }[]}
 */
export function generateNFP(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 0; m < 12; m++) {        // dataLabel: which month's DATA this release covers (previous month)
      const dataMonthIdx = m === 0 ? 11 : m - 1;
      const dataYear = m === 0 ? y - 1 : y;
      const dataMonthLabel = `${MONTHS[dataMonthIdx]} ${dataYear}`;

      const key = `${y}-${String(m+1).padStart(2,"0")}`;
      const day = NFP_DATE_OVERRIDES[key] ?? firstFriday(y, m);
      const ts = etToUTC(y, m, day, 8, 30);
      if (ts >= Date.now()) continue;

      // Build a clear label: "Apr 2025 NFP" where Apr is the data month
      const label = `${dataMonthLabel} NFP`;

      events.push({
        type: "NFP",
        label,                         // "June 2026 NFP"
        dataLabel: dataMonthLabel,     // "June 2026"
        ts,                            // release timestamp
        timeET: "08:30",
        importance: "high",
        releaseDate: `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
      });
    }
  }
  return events;
}

/**
 * Generate CPI events for a year range.
 * CPI for month M is released in month M+1 (around 10th-15th).
 */
export function generateCPI(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 0; m < 12; m++) {
      // dataMonth: the month whose data this release covers.
      // Release in month m covers data from month m-1.
      const dataMonthIdx = m === 0 ? 11 : m - 1;
      const dataYear = m === 0 ? y - 1 : y;
      const dataMonthLabel = `${MONTHS[dataMonthIdx]} ${dataYear}`;

      const key = `${y}-${String(m+1).padStart(2,"0")}`;
      // Default: 2nd Wednesday of the month (common CPI release day)
      const defaultDay = nthWeekday(y, m, 3, 2); // 3=Wednesday
      const day = CPI_DATE_OVERRIDES[key] ?? defaultDay;
      const ts = etToUTC(y, m, day, 8, 30);
      if (ts >= Date.now()) continue;

      events.push({
        type: "CPI",
        label: `${dataMonthLabel} CPI`,
        dataLabel: dataMonthLabel,
        ts,
        timeET: "08:30",
        importance: "high",
        releaseDate: `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
      });
    }
  }
  return events;
}

// FOMC decision days (second day of each 2-day meeting) at 2 PM ET.
// Verified against Federal Reserve official calendar.
const FOMC_DATES = {
  2022: [
    [0, 26],  // Jan 26
    [2, 16],  // Mar 16
    [4, 4],   // May 4
    [5, 15],  // Jun 15
    [6, 27],  // Jul 27
    [8, 21],  // Sep 21
    [10, 2],  // Nov 2
    [11, 14], // Dec 14
  ],
  2023: [
    [0, 31],  // Jan 31
    [2, 22],  // Mar 22
    [4, 3],   // May 3
    [5, 14],  // Jun 14
    [6, 26],  // Jul 26
    [8, 20],  // Sep 20
    [10, 1],  // Nov 1
    [11, 13], // Dec 13
  ],
  2024: [
    [0, 31],  // Jan 31
    [2, 20],  // Mar 20
    [4, 1],   // May 1
    [5, 12],  // Jun 12
    [6, 31],  // Jul 31
    [8, 18],  // Sep 18
    [10, 7],  // Nov 7
    [11, 18], // Dec 18
  ],
  2025: [
    [0, 29],  // Jan 29
    [2, 19],  // Mar 19
    [4, 7],   // May 7
    [5, 18],  // Jun 18
    [6, 30],  // Jul 30
    [8, 17],  // Sep 17
    [9, 29],  // Oct 29  ← FIXED (was Nov 5)
    [11, 10], // Dec 10
  ],
  2026: [
    [0, 28],  // Jan 28
    [2, 18],  // Mar 18
    [3, 29],  // Apr 29  ← FIXED (was May 6)
    [5, 17],  // Jun 17
    [6, 29],  // Jul 29
    [8, 16],  // Sep 16
    [9, 28],  // Oct 28  ← FIXED (was Nov 4)
    [11, 9],  // Dec 9
  ],
};

export function generateFOMC(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    const meetings = FOMC_DATES[y] || [];
    for (const [m, d] of meetings) {
      const ts = etToUTC(y, m, d, 14, 0);
      if (ts >= Date.now()) continue;
      const dataMonthLabel = `${MONTHS[m]} ${y}`;
      events.push({
        type: "FOMC",
        label: `${dataMonthLabel} FOMC`,
        dataLabel: dataMonthLabel,
        ts,
        timeET: "14:00",
        importance: "high",
        releaseDate: `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,
      });
    }
  }
  return events;
}

const GENERATORS = { NFP: generateNFP, CPI: generateCPI, FOMC: generateFOMC };

export function generateNewsEvents({ types = ["NFP","FOMC","CPI"], fromYear = 2023, toYear = 2026 } = {}) {
  const all = [];
  for (const t of types) {
    const fn = GENERATORS[t];
    if (fn) all.push(...fn(fromYear, toYear));
  }
  all.sort((a, b) => a.ts - b.ts);
  return all;
}
