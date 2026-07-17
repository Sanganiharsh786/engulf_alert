// Forex data provider using Twelve Data API.
// Real-time forex data for EUR/USD, USD/JPY, USD/CAD, XAU/USD, GBP/USD.
//
// Free tier: 800 requests/day, 8 requests/min.
// Batch requests (comma-separated symbols) count per symbol.
// 5 symbols per scan → ~160 scans/day → scan every ~10 minutes.
//
// Get your free API key: https://twelvedata.com (Sign Up → Dashboard → API Keys)
// Then set: TWELVEDATA_API_KEY=your_key_here

const BASE_URL = "https://api.twelvedata.com";

function getApiKey() {
  const key = process.env.TWELVEDATA_API_KEY || "";
  if (!key) {
    throw new Error(
      "TWELVEDATA_API_KEY not configured. Get a free key at https://twelvedata.com " +
      "(Sign Up → Dashboard → API Keys), then set it in your environment."
    );
  }
  return key;
}

// Twelve Data interval format
function tdInterval(tf) {
  const map = {
    "4h": "4h",
    "1h": "1h",
    "30m": "30min",
    "15m": "15min",
    "1d": "1day",
  };
  return map[tf] || "15min";
}

// Parse Twelve Data datetime string → timestamp ms
function parseTDDateTime(dt) {
  // Format: "2025-05-20 16:00:00"
  return new Date(dt.replace(" ", "T") + "Z").getTime();
}

// Fetch OHLCV candles from Twelve Data.
// Uses batch request for all 5 pairs in a single API call to save credits.
// Returns { pairName: [ts_ms, open, high, low, close, volume][] }
export async function fetchTwelveData(tf = "4h", count = 100) {
  const apiKey = getApiKey();
  const interval = tdInterval(tf);

  // All 5 pairs in a single batch request (URL-encode slashes for batch)
  const symbols = ["EUR/USD", "USD/JPY", "USD/CAD", "XAU/USD", "GBP/USD"]
    .map(s => encodeURIComponent(s)).join(",");

  const url = `${BASE_URL}/time_series?` +
    `symbol=${symbols}` +
    `&interval=${interval}` +
    `&outputsize=${count}` +
    `&apikey=${apiKey}`;

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Twelve Data ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.status === "error") {
    throw new Error(`Twelve Data error: ${data.message || JSON.stringify(data)}`);
  }

  // Parse response — each symbol key contains { values: [...], meta, status }
  const results = {};
  const errors = {};

  for (const symbol of ["EUR/USD", "USD/JPY", "USD/CAD", "XAU/USD", "GBP/USD"]) {
    const pairData = data[symbol];
    if (!pairData) {
      errors[symbol] = "No data in response";
      continue;
    }
    if (pairData.status === "error") {
      errors[symbol] = pairData.message || "API error";
      continue;
    }

    const values = pairData.values;
    if (!Array.isArray(values) || values.length === 0) {
      errors[symbol] = "No values returned";
      continue;
    }

    // Convert to [ts_ms, open, high, low, close, volume]
    const rows = values.map((v) => [
      parseTDDateTime(v.datetime),
      parseFloat(v.open),
      parseFloat(v.high),
      parseFloat(v.low),
      parseFloat(v.close),
      parseInt(v.volume) || 0,
    ]).sort((a, b) => a[0] - b[0]); // oldest first

    results[symbol] = rows;
  }

  return { results, errors };
}

// Test the Twelve Data connection.
export async function testDataConnection() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "TWELVEDATA_API_KEY not set. Get a free key at https://twelvedata.com",
      source: "Twelve Data",
    };
  }

  try {
    const { results, errors } = await fetchTwelveData("1h", 2);
    const worked = Object.keys(results).length;
    const failed = Object.keys(errors).length;

    return {
      ok: worked > 0,
      source: "Twelve Data",
      pairs: Object.keys(results),
      sample: results["EUR/USD"]?.[0]
        ? {
            ts: results["EUR/USD"][0][0],
            open: results["EUR/USD"][0][1],
            close: results["EUR/USD"][0][4],
          }
        : null,
      worked,
      failed,
      errors: failed > 0 ? errors : undefined,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), source: "Twelve Data" };
  }
}

// Fetch all 5 pairs (alias for fetchTwelveData, keeps same interface)
export async function fetchAllPairs(tf = "4h", count = 100) {
  return fetchTwelveData(tf, count);
}
