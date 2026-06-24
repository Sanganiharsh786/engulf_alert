// Standalone scanner — runs the same detection + email logic on a loop,
// independent of the dashboard/browser. Use this for 24/7 alerts.
//
//   npm run worker
//
import { readStore, writeStore } from "./lib/store.js";
import { runScan } from "./lib/scanner.js";

async function loop() {
  let waitMs = 60000;
  try {
    const store = await readStore();
    waitMs = (store.settings.pollIntervalSeconds || 60) * 1000;
    const out = await runScan(store);
    await writeStore(store);
    const alerts = out.results.reduce((a, r) => a + ((r.alerts && r.alerts.length) || 0), 0);
    const line = out.results
      .map((r) => (r.status === "error" ? `${r.pair}:ERR` : `${r.pair}:${r.direction || "-"}`))
      .join("  ");
    console.log(new Date().toISOString(), `| ${line} | new alerts: ${alerts}`);
  } catch (e) {
    console.error(new Date().toISOString(), "| scan error:", e.message || e);
  }
  setTimeout(loop, waitMs);
}

console.log("Worker started. Watching for engulfing signals…");
loop();
