// npm run erp:seed — rebuild the acquirer's mock ERP from scratch in seconds: the masters,
// then the cutover sync of Day One's seeded history through the connector (purchase orders,
// receipts, every inventory movement), then the migrated AP history matched against them.
// Writes data/runtime/erp.db (gitignored) for npm run erp.
//   --json    print one JSON line after the readable text

import { join, resolve } from "node:path";
import { formatUsd } from "../erp/src/money.ts";
import { ERP_DB_FILE, rebuildErp } from "../server/src/erp-connector/rebuild.ts";

const root = resolve(import.meta.dirname, "..");
const json = process.argv.includes("--json");
const file = process.env.ERP_DB ?? join(root, ERP_DB_FILE);

const lines: string[] = [];
const { sync, history, tb } = await rebuildErp(file, (l) => lines.push(l), process.env);

console.log(`Rebuilt the acquirer's ERP at ${file.slice(root.length + 1)}\n`);
console.log("Cutover sync from Day One's ledger (through the connector):");
for (const l of lines) console.log(`  ${l}`);
console.log(
  `  ${sync.purchaseOrders} purchase orders, ${sync.receipts} item receipts, ${sync.transfers} transfers, ` +
    `${sync.productionIssues} issues to production, ${sync.qcDecisions} QC decisions, ${sync.adjustments} adjustments.\n`,
);
console.log("Migrated AP history (bills Acme received before Day One):");
for (const b of history.bills) {
  const note =
    b.matchStatus === "duplicate"
      ? `DUPLICATE of ${b.duplicateOf} — rejected`
      : `${b.matchStatus}, ${b.approvalStatus}${b.priceDrift ? ` (price drift +${(b.priceDrift / 100).toFixed(1)}% noted)` : ""}`;
  console.log(`  ${b.invoiceNo.padEnd(14)} ${note}`);
}
console.log(`  ${history.checks.length} checks applied.\n`);
const inventory = tb.rows
  .filter((r) => r.acctNumber.startsWith("14"))
  .reduce((s, r) => s + r.balanceUsdc, 0);
console.log(
  `Trial balance: ${tb.balanced ? "debits = credits" : "OUT OF BALANCE"} (${formatUsd(tb.totalDebits)}). ` +
    `Inventory on the books: ${formatUsd(inventory)}.`,
);
console.log("\nnpm run erp serves it at http://localhost:8087/");
if (json) console.log(JSON.stringify({ file, sync, history, balanced: tb.balanced }));
process.exitCode = tb.balanced ? 0 : 1;
