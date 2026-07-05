// Standalone scanner — runs the same detection + email logic on a loop,
// independent of the dashboard/browser. Use this for 24/7 alerts.
//
//   npm run worker
//
import { readStore, writeStore } from "./lib/store.js";
import { runScan, ensureDnaLibrary } from "./lib/scanner.js";
import { listUsers } from "./lib/auth.js";

async function loop() {
  let waitMs = 60000;
  try {
    const lines = [];
    for (const user of listUsers()) {
      const store = await readStore(user);
      waitMs = (store.settings.pollIntervalSeconds || 60) * 1000;
      await ensureDnaLibrary(store);
      const out = await runScan(store, {});
      await writeStore(user, store);
      const alerts = out.results.reduce((a, r) => a + ((r.alerts && r.alerts.length) || 0), 0);
      const pairs = out.results
        .map((r) => (r.status === "error" ? `${r.pair}:ERR` : `${r.pair}:${r.direction || "-"}`))
        .join(" ");
      lines.push(`${user}[ ${pairs} ] alerts:${alerts}`);
    }
    console.log(new Date().toISOString(), "|", lines.join("  ||  "));
  } catch (e) {
    console.error(new Date().toISOString(), "| scan error:", e.message || e);
  }
  setTimeout(loop, waitMs);
}

console.log("Worker started. Watching for engulfing signals…");
loop();
