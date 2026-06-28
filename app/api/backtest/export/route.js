import { readStore } from "@/lib/store";
import { runBacktest } from "@/lib/backtest";
import { currentUser } from "@/lib/session";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const store = await readStore(user);
  const out = await runBacktest(store, { bars: 1000 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Engulfing Alerts";
  wb.created = new Date();

  // Summary sheet
  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    { header: "Pair", key: "pair", width: 16 },
    { header: "Market", key: "market", width: 10 },
    { header: "Timeframe", key: "tf", width: 10 },
    { header: "Signals", key: "signals", width: 10 },
    { header: "Closed", key: "closed", width: 10 },
    { header: "Wins", key: "wins", width: 8 },
    { header: "Losses", key: "losses", width: 8 },
    { header: "Open", key: "open", width: 8 },
    { header: "Win rate %", key: "winRate", width: 12 },
    { header: "Net R", key: "netR", width: 10 },
  ];
  sum.getRow(1).font = { bold: true };
  for (const s of out.summaries) {
    if (s.error) {
      sum.addRow({ pair: s.pair, market: "ERROR: " + s.error });
    } else {
      sum.addRow(s);
    }
  }

  // Trades sheet
  const tr = wb.addWorksheet("Trades");
  tr.columns = [
    { header: "Date/Time (UTC)", key: "time", width: 18 },
    { header: "Day", key: "day", width: 8 },
    { header: "Pair", key: "pair", width: 14 },
    { header: "Direction", key: "direction", width: 10 },
    { header: "Level", key: "level", width: 20 },
    { header: "Entry", key: "entry", width: 12 },
    { header: "Stop", key: "stop", width: 12 },
    { header: "Take profit", key: "tp", width: 12 },
    { header: "SL pips", key: "slPips", width: 10 },
    { header: "Lots", key: "lots", width: 10 },
    { header: "Outcome", key: "outcome", width: 10 },
    { header: "Bars held", key: "barsHeld", width: 10 },
    { header: "R", key: "r", width: 8 },
  ];
  tr.getRow(1).font = { bold: true };
  for (const t of out.trades) tr.addRow(t);

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="backtest-${stamp}.xlsx"`,
    },
  });
}
