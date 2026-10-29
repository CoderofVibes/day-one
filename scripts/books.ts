// npm run books — the bookkeeper export from the seeded ledger: Kevin's note, the price-drift
// alerts, and the CSV of settled purchase orders Ruth imports into QuickBooks (FEATURES_V2
// §2). Pure reads, no keys, no network. The running API serves the same for its run at
// GET /api/books and /api/books/export.csv.
//   --csv    print only the CSV (for a redirect to a file)
//   --json   print one JSON line after the readable text

import { books, booksCsv } from "../server/src/ledger/books.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const args = process.argv.slice(2);
const db = openLedger();
seedLedger(db);

if (args.includes("--csv")) {
  process.stdout.write(booksCsv(db));
} else {
  const b = books(db);
  for (const line of b.sentences) console.log(line);
  console.log();
  process.stdout.write(booksCsv(db).replace(/\r\n/g, "\n"));
  if (args.includes("--json")) {
    console.log(
      JSON.stringify({
        settled: b.settled.map((po) => po.poNo),
        totalUsdc: b.totalUsdc,
        rows: b.rows,
        alerts: b.alerts,
        sentences: b.sentences,
      }),
    );
  }
}
