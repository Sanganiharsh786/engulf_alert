// Economic news event schedule and 1m candle analysis.
// Generates historical NFP, FOMC, and CPI event timestamps and
// classifies the 1‑minute candle at release time as bullish/bearish/doji.

// ---- Helpers ----

// Approximate ET offset from UTC (simplified — ignores DST transition edge)
function etOffset(year, month) {
  // EDT (UTC-4) from 2nd Sunday March to 1st Sunday November
  // EST (UTC-5) otherwise
  return month >= 2 && month <= 9 ? -4 : -5;
}

function etToUTC(year, month, day, hourET, minET) {
  const offset = etOffset(year, month);
  return Date.UTC(year, month, day, hourET - offset, minET, 0, 0);
}

function firstFriday(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay(); // 0=Sun … 5=Fri, 6=Sat
  const diff = dow <= 5 ? 5 - dow : 5 + 7 - dow;
  return 1 + diff;
}

/** Classify a closed candle */
export function classifyCandle(o, h, l, c) {
  const body = Math.abs(c - o);
  const range = h - l;
  if (range === 0) return "doji";
  const bodyRatio = body / range;
  if (bodyRatio < 0.08) return "doji";
  return c >= o ? "bullish" : "bearish";
}

export function candleChangePct(o, c) {
  if (o === 0) return 0;
  return ((c - o) / o) * 100;
}

// ---- News generators ----

/** All NFP dates: first Friday of every month, 8:30 AM ET */
export function generateNFP(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 0; m < 12; m++) {
      const day = firstFriday(y, m);
      const ts = etToUTC(y, m, day, 8, 30);
      if (ts >= Date.now()) continue;
      events.push({ type:"NFP",  label:"Non‑Farm Payrolls",     ts, importance:"high", timeET:"08:30" });
    }
  }
  return events;
}

/** CPI dates: approximated as the 13th of each month, 8:30 AM ET */
export function generateCPI(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 0; m < 12; m++) {
      const day = 13;
      const ts = etToUTC(y, m, day, 8, 30);
      if (ts >= Date.now()) continue;
      events.push({ type:"CPI",  label:"Consumer Price Index", ts, importance:"high", timeET:"08:30" });
    }
  }
  return events;
}

// Known FOMC meeting decision day timestamps (2 PM ET).
// Decision published on the second day of each 2‑day meeting.
const FOMC_SCHEDULE = {
  2022:[
    { m:0,  d:26 }, { m:2,  d:16 }, { m:4,  d:4  }, { m:5,  d:15 },
    { m:6,  d:27 }, { m:8,  d:21 }, { m:9,  d:2 },  { m:11, d:14 },
  ],
  2023:[
    { m:0,  d:31 }, { m:2,  d:22 }, { m:4,  d:3  }, { m:5,  d:14 },
    { m:6,  d:26 }, { m:8,  d:20 }, { m:10, d:1  }, { m:11, d:13 },
  ],
  2024:[
    { m:0,  d:31 }, { m:2,  d:20 }, { m:4,  d:1  }, { m:5,  d:12 },
    { m:6,  d:31 }, { m:8,  d:18 }, { m:10, d:7  }, { m:11, d:18 },
  ],
  2025:[
    { m:0,  d:29 }, { m:2,  d:19 }, { m:4,  d:7  }, { m:5,  d:18 },
    { m:6,  d:30 }, { m:8,  d:17 }, { m:10, d:5  }, { m:11, d:10 },
  ],
  2026:[
    { m:0,  d:28 }, { m:2,  d:18 }, { m:4,  d:6  }, { m:5,  d:17 },
    { m:6,  d:29 }, { m:8,  d:16 }, { m:10, d:4  }, { m:11, d:9  },
  ],
};

export function generateFOMC(fromYear, toYear) {
  const events = [];
  for (let y = fromYear; y <= toYear; y++) {
    const meetings = FOMC_SCHEDULE[y] || [];
    for (const { m, d } of meetings) {
      const ts = etToUTC(y, m, d, 14, 0);
      if (ts >= Date.now()) continue;
      events.push({ type:"FOMC", label:"FOMC Rate Decision", ts, importance:"high", timeET:"14:00" });
    }
  }
  return events;
}

const GENERATORS = { NFP: generateNFP, CPI: generateCPI, FOMC: generateFOMC };

/**
 * Generate events for the requested news types over the given year range.
 * Results are sorted chronologically (oldest first).
 */
export function generateNewsEvents({ types = ["NFP","FOMC","CPI"], fromYear = 2023, toYear = 2026 } = {}) {
  const all = [];
  for (const t of types) {
    const fn = GENERATORS[t];
    if (fn) all.push(...fn(fromYear, toYear));
  }
  all.sort((a, b) => a.ts - b.ts);
  return all;
}
