// npm run erp:demo — the whole purchasing loop (the same replayed testnet run as npm run demo,
// no keys, no network) with the acquirer's ERP attached through the connector: the cutover
// sync and the migrated AP history first, then every step's `erp:` lines, then what the ERP's
// books show. Writes data/runtime/erp.db for npm run erp.
//   --json    print one JSON line after the readable text
//   --memory  do not write the database file

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEMO_CLOCK, type DemoSalts, runDemo } from "../agents/kevin/src/demo.ts";
import { KevinErp } from "../agents/kevin/src/erp.ts";
import type { PackingSlip } from "../agents/kevin/src/receiving.ts";
import { acceptAndShip } from "../agents/suppliers/src/shipping.ts";
import { inventoryBalanceRows, readers, serializeTrialBalance } from "../erp/src/api.ts";
import { formatUsd } from "../erp/src/money.ts";
import { ChainClient } from "../server/src/chain/client.ts";
import { ReplayTransport } from "../server/src/chain/replay.ts";
import { ERP_DB_FILE, rebuildErp } from "../server/src/erp-connector/rebuild.ts";
import { ReplayLlm } from "../server/src/llm/client.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const at = (p: string) => join(root, p);
const file = args.includes("--memory") ? ":memory:" : (process.env.ERP_DB ?? at(ERP_DB_FILE));
const ACCOUNTS = JSON.parse(readFileSync(at("config/testnet-accounts.json"), "utf8")) as {
  root: string;
  spendPolicy: string;
};
const KEVIN = `kevin.plant-b.${ACCOUNTS.root}`;

// 1. The ERP: masters, cutover from Day One's seed, migrated AP history.
const cutover: string[] = [];
const {
  erpDb,
  dayOne: db,
  connector,
  sync,
  history,
} = await rebuildErp(file, (l) => cutover.push(l));

// 2. The replayed demo loop, as scripts/demo.ts sets it up, plus the ERP hooks.
let clock: string = DEMO_CLOCK.start;
const transport = ReplayTransport.fromFile(at("data/replay/demo-chain.json"));
const chain = new ChainClient(db, transport, () => clock);
const llm = ReplayLlm.fromFile(at("data/replay/demo-llm.json"));
const salts = JSON.parse(readFileSync(at("data/replay/demo-salts.json"), "utf8")) as DemoSalts;
const image = readFileSync(at("data/batch-records/BR-B-1045.jpg"));
const slipFile = "data/packing-slips/NG-PS-60417.jpg";
const truth = JSON.parse(readFileSync(at("data/packing-slips/NG-PS-60417.truth.json"), "utf8")) as {
  slipNo: string;
  poNo: string;
  shipFrom: string[];
  description: string;
  shipped: string;
  backOrdered: string;
  supplierLot: string;
};
const kg = (text: string) => Math.round((Number.parseFloat(text.replace(/,/g, "")) || 0) * 1e6);
const slip: PackingSlip = {
  slipNo: truth.slipNo,
  poNo: truth.poNo,
  vendorName: truth.shipFrom[0] ?? "",
  lines: [
    {
      description: truth.description,
      shippedBase: kg(truth.shipped),
      backorderedBase: kg(truth.backOrdered),
      supplierLot: truth.supplierLot,
    },
  ],
  file: slipFile,
  sha256: sha256(readFileSync(at(slipFile))),
};

const run = await runDemo({
  db,
  chain,
  llm,
  setClock: (iso) => {
    clock = iso;
  },
  kevin: KEVIN,
  policyContract: ACCOUNTS.spendPolicy,
  relayer: "dayone-relayer.testnet",
  tokenSymbol: "DTUSD",
  batchRecord: {
    file: "data/batch-records/BR-B-1045.jpg",
    sha256: sha256(image),
    image: { mediaType: "image/jpeg", base64: image.toString("base64") },
  },
  batchRecordCount: readdirSync(at("data/batch-records")).filter((f) => f.endsWith(".jpg")).length,
  slip,
  invoiceText: (
    JSON.parse(readFileSync(at("data/attacks/invoices.json"), "utf8")) as {
      invoices: { genuine: string };
    }
  ).invoices.genuine,
  ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: ACCOUNTS.spendPolicy }),
  salts,
  erp: new KevinErp(connector),
});
transport.assertDone();

// 3. What the ERP's books show after the run.
const tb = serializeTrialBalance(erpDb);
const bills = readers.vendorBill.list(erpDb);
const payments = readers.vendorPayment.list(erpDb);
const ascB = inventoryBalanceRows(erpDb, { location: "B", item: "ASC" }).filter(
  (r) => r.quantityOnHandBase !== 0,
);

console.log("Day One demo with the acquirer's ERP attached (replay of the recorded testnet run)\n");
console.log("Cutover: Day One → ERP through the connector");
console.log(
  `  ${sync.purchaseOrders} purchase orders, ${sync.receipts} receipts, ${sync.transfers} transfers, ${sync.productionIssues} issues to production, ` +
    `${sync.qcDecisions} QC decisions, ${sync.adjustments} adjustments; ERP balances derived from them, none typed in.`,
);
console.log(
  `  AP history: ${history.bills.filter((b) => b.matchStatus === "matched").length} bills matched to PO and receipt, ` +
    `${history.bills
      .filter((b) => b.matchStatus === "duplicate")
      .map((b) => `${b.invoiceNo} rejected as a duplicate of ${b.duplicateOf}`)
      .join(", ")}, ` +
    `${history.bills
      .filter((b) => b.priceDrift)
      .map((b) => `${b.invoiceNo} price drift +${(b.priceDrift / 100).toFixed(1)}% noted`)
      .join(", ")}.\n`,
);
for (const step of run.steps) {
  for (const text of step.staff) console.log(text);
  for (const text of step.chain) console.log(`  ${text}`);
  for (const text of step.erp ?? []) console.log(`  ${text}`);
}
console.log("\nThe ERP's books after the run:");
for (const b of bills.filter((x) => x.createdFrom?.refName === "PO-1042")) {
  console.log(
    `  Bill ${b.tranId}: ${formatUsd(Math.round(b.total * 1e6))}, 3-way match ${b.custbody_match_status.id}, ${b.approvalStatus.id}, ${b.status.id}`,
  );
}
for (const p of payments.filter((x) => x.custbody_payment_method.id === "escrowRelease")) {
  console.log(
    `  Payment ${p.tranId}: ${formatUsd(Math.round(p.payment * 1e6))} ${p.apply.items[0] ? `applied to ${p.apply.items[0].doc.refName}` : "on account"}, settlement ref ${p.externalId}`,
  );
}
for (const r of ascB)
  console.log(
    `  Inventory, ${r.location.refName}: ${r.itemCode} ${r.inventoryStatus.id} ${r.quantityOnHand} ${r.units} = ${formatUsd(r.valueUsdc)}`,
  );
console.log(
  `  Trial balance: ${tb.balanced ? "debits = credits" : "OUT OF BALANCE"} (${formatUsd(Math.round(tb.totalDebits * 1e6))}).`,
);
if (file !== ":memory:")
  console.log(
    `\nWritten to ${file.slice(root.length + 1)}; npm run erp serves it at http://localhost:8087/`,
  );

const ok = run.ok && tb.balanced;
if (json) {
  console.log(
    JSON.stringify({
      ok,
      cutover: { sync, history },
      steps: run.steps,
      erp: {
        bills: bills.map((b) => ({
          tranId: b.tranId,
          po: b.createdFrom?.refName,
          match: b.custbody_match_status.id,
          approval: b.approvalStatus.id,
          status: b.status.id,
          total: b.total,
        })),
        payments: payments.map((p) => ({
          tranId: p.tranId,
          amount: p.payment,
          appliedTo: p.apply.items[0]?.doc.refName ?? null,
          ref: p.externalId,
        })),
        trialBalance: tb,
      },
    }),
  );
}
process.exitCode = ok ? 0 : 1;

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
