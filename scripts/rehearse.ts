// npm run rehearse — the relayed half of the demo, live on testnet, on a throwaway PO, before a
// recording (LESSONS, Oct 28: a PO id is used once per contract). The supplier agents quote
// RFQ-90xx over the bus and anchor their quotes from their own accounts (QuickChem's is refused:
// not an approved supplier), Kevin submits the big order as PO-90xx, the contract refuses it,
// Linda's "YES 90xx" is relayed and Kevin's retry funds escrow, Northgate accepts and ships from
// its own account, Tommy's receipt is relayed, then Priya's QC reject is relayed and refunds the
// escrow, so the budget and spend counters end where they began.
//   npm run rehearse            first unused id from PO-9042 up
//   npm run rehearse -- 9050    that id
//   --json                      print one JSON line after the readable text

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { handleApprovalReply } from "../agents/kevin/src/approval.ts";
import { DEMO_CLOCK } from "../agents/kevin/src/demo.ts";
import { forecastMaterial } from "../agents/kevin/src/forecast.ts";
import {
  draftPoFromRanking,
  openRfq,
  rankQuotes,
  recordQuotes,
} from "../agents/kevin/src/purchasing.ts";
import { decideQc, type PackingSlip, receiveDelivery } from "../agents/kevin/src/receiving.ts";
import { type ContractFeatures, contractExtras } from "../agents/kevin/src/settlementExtras.ts";
import { submitPo } from "../agents/kevin/src/submit.ts";
import { demoBus } from "../agents/suppliers/src/bus.ts";
import { acceptAndShip } from "../agents/suppliers/src/shipping.ts";
import { AttestationClient } from "../server/src/attestation/fetch.ts";
import { ChainClient, explorerUrl, type LoggedOutcome } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import type { ContractStanding } from "../server/src/erp-connector/credentials.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { chainTx, materials, poLines, staff } from "../server/src/ledger/schema.ts";
import { createLlm } from "../server/src/llm/client.ts";
import { quoteProof } from "../server/src/quotes.ts";
import { plantBStaff } from "../server/src/relayer/relayer.ts";
import { seedLedger } from "../server/src/seed/index.ts";
import { DEMO_QUOTES } from "../server/src/seed/quotes.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const at = (p: string) => join(root, p);
const ACCOUNTS = JSON.parse(readFileSync(at("config/testnet-accounts.json"), "utf8")) as {
  network: string;
  root: string;
  spendPolicy: string;
};
const KEVIN = `kevin.plant-b.${ACCOUNTS.root}`;
const RELAYER = "dayone-relayer.testnet";

class Stop extends Error {}

if (!existsSync(at(`.near-credentials/testnet/${RELAYER}.json`))) {
  fail(`The relayer's server key is missing (.near-credentials/testnet/${RELAYER}.json).`);
}
const transport = new LiveTransport(ACCOUNTS.network, undefined, undefined, {
  relayerId: RELAYER,
  policyContract: ACCOUNTS.spendPolicy,
  staffMethods: plantBStaff(ACCOUNTS.root),
});
const view = (method: string, a: Record<string, unknown> = {}) =>
  transport.view({ contractId: ACCOUNTS.spendPolicy, method, args: a });

// A named PO that a stopped rehearsal left shipped resumes at the receipt, which refunds it.
const asked = args.find((a) => /^\d+$/.test(a));
let number = asked ? Number(asked) : 9042;
let resumeFrom: { status: string; amount: string; supplier_lot: string | null } | null = null;
for (;;) {
  const found = (await view("get_po", { po_id: `PO-${number}` })) as typeof resumeFrom;
  if (!found) break;
  if (asked && found.status === "Shipped") {
    resumeFrom = found;
    break;
  }
  if (asked) fail(`PO-${number} is already on chain (${found.status}); pick an unused number.`);
  number += 1;
}
const poNo = `PO-${number}`;
const heldAtStart = BigInt(resumeFrom?.amount ?? 0);

// Each rehearsal ends in a QC reject of a Northgate delivery, which counts on Northgate's
// supplier credential (CONTRACTS.md §3.1): rejects in a row suspend it until HQ reinstates it.
const NORTHGATE = "northgate-ingredients.testnet";
const REINSTATE = `near contract call-function as-transaction ${ACCOUNTS.spendPolicy} reinstate_supplier json-args '{"supplier":"${NORTHGATE}"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as ${ACCOUNTS.root} network-config testnet sign-with-keychain send`;
/** Northgate's standing, or null on a contract deployed before supplier credentials. */
async function northgate() {
  try {
    return (await view("get_supplier_standing", { supplier: NORTHGATE })) as ContractStanding;
  } catch {
    return null;
  }
}
if (!resumeFrom && (await northgate())?.standing === "Suspended") {
  fail(
    `Northgate is suspended after rejected rehearsal deliveries; HQ reinstates it first: ${REINSTATE}`,
  );
}

const db = openLedger();
seedLedger(db);
// Ledger time is the demo clock: the forecast and quotes read the seeded history.
const now = DEMO_CLOCK.start;
const chain = new ChainClient(db, transport, () => now);
// CONTRACTS.md §11, once deploy:testnet has turned it on: quantities, receipts and, above the
// threshold, Kevin's decision signed in NEAR AI Cloud's enclave (a live call, a few cents).
const features =
  (ACCOUNTS as { contractFeatures?: ContractFeatures & { signedAboveUsd?: number } })
    .contractFeatures ?? {};
if (features.signedDecisions && existsSync(at(".env"))) process.loadEnvFile(at(".env"));
const extras =
  features.receiptSettlement || features.signedDecisions
    ? contractExtras(db, {
        features,
        llm: features.signedDecisions
          ? createLlm(at("data/replay/rehearse-llm.json"), {
              ...process.env,
              DAYONE_MODE: "live",
              LLM_RECORD_FIXTURES: "false",
            })
          : undefined,
        signatures: (chatId) =>
          new AttestationClient(process.env.NEARAI_API_KEY ?? "").signature(chatId),
        signedAboveUsdc: (features.signedAboveUsd ?? 2_500) * 1_000_000,
        onDecision: (po, d) => console.log(`  decision on ${po.poNo}: ${d.line}`),
      })
    : undefined;
const ctx = { kevin: KEVIN, policyContract: ACCOUNTS.spendPolicy, now, ...(extras && { extras }) };
const person = (name: string) => {
  const row = db.select().from(staff).where(eq(staff.name, name)).get();
  if (!row) throw new Error(`${name} is missing from the seed`);
  return row;
};

const before = await state();
const lines: string[] = [`Rehearsing ${poNo} live on testnet (budget ${before.budget}).`];
const steps: { step: string; status: string; tx: string | null }[] = [];
const log = (step: string, status: string, o?: LoggedOutcome | null) => {
  steps.push({ step, status, tx: o?.txHash ?? null });
  const link = o?.txHash ? ` ${explorerUrl(ACCOUNTS.network, o.txHash)}` : "";
  lines.push(`  ${step}: ${status}${o?.errorMessage ? ` "${o.errorMessage}"` : ""}${link}`);
};

let ok = false;
/** One verifiable file per quote a supplier anchored, in the --json output. */
let quoteProofs: ReturnType<typeof quoteProof>[] = [];
try {
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now });
  const rfq = openRfq(db, forecast, `RFQ-${number}`);
  // A resumed PO's quotes were anchored by the stopped run; the plain answers re-draft it.
  if (resumeFrom) recordQuotes(db, rfq, DEMO_QUOTES.ASC ?? []);
  else {
    const bus = demoBus(chain, {
      policyContract: ACCOUNTS.spendPolicy,
      salt: () => randomBytes(16).toString("hex"),
    });
    const answers = await bus.requestQuotes(rfq);
    for (const a of answers) log(`anchor quote (${a.account})`, a.anchor.status, a.anchor);
    recordQuotes(db, rfq, answers);
    quoteProofs = rfq.quotes
      .filter((q) => q.anchor?.status === "success")
      .map((q) => quoteProof(q.terms, q.salt, q.anchor?.txHash ?? null));
  }
  const ranking = rankQuotes(db, rfq, now);
  const po = draftPoFromRanking(db, ranking, poNo, randomBytes(16).toString("hex"));
  const lot = resumeFrom?.supplier_lot ?? `REH-${number}-01`;
  if (resumeFrom) lines.push(`  resuming: ${poNo} is shipped on chain as lot ${lot}`);
  else await placeAndShip(po, lot);

  const [line] = db
    .select({ qtyBase: poLines.qtyBase, name: materials.name })
    .from(poLines)
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .where(eq(poLines.poId, po.id))
    .all();
  const slip: PackingSlip = {
    slipNo: `REH-PS-${number}`,
    poNo,
    vendorName: po.vendor.name,
    lines: [
      {
        description: line?.name ?? "",
        shippedBase: line?.qtyBase ?? 0,
        backorderedBase: 0,
        supplierLot: lot,
      },
    ],
    file: "rehearsal",
    sha256: "0".repeat(64),
  };
  const received = await receiveDelivery(
    db,
    chain,
    { slip, receiverStaffId: person("Tommy Reyes").id },
    {
      policyContract: ACCOUNTS.spendPolicy,
      now,
      receiptSettlement: Boolean(features.receiptSettlement),
    },
  );
  log("confirm_receipt (relayed)", received.status, received.outcome);
  if (received.status !== "received") throw new Stop(received.sentences.join(" "));

  const qc = await decideQc(
    db,
    chain,
    {
      lotCode: received.lotCodes[0] ?? "",
      decision: "reject",
      qcStaffId: person("Priya Natarajan").id,
      reason: "Rehearsal: refund the escrow.",
    },
    { policyContract: ACCOUNTS.spendPolicy, now },
  );
  log("qc_reject (relayed)", qc.status, qc.outcome);
  if (qc.status !== "rejected") throw new Stop(`QC ended ${qc.status}`);
  ok = true;
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  lines.push(`Stopped: ${error.message}`);
}

const after = await state();
const restored =
  BigInt(after.budget) === BigInt(before.budget) + heldAtStart &&
  BigInt(after.escrowed) === BigInt(before.escrowed) - heldAtStart;
lines.push(
  `Budget ${after.budget}, escrowed ${after.escrowed}: ` +
    (restored
      ? "every unit is back in the budget."
      : `CHANGED (was ${before.budget}, ${before.escrowed}).`),
);
const standing = await northgate();
const record = standing?.credential?.reputation;
if (record) {
  const rule = (await view("get_suspension_rule")) as number;
  lines.push(
    `Northgate's delivery record: ${record.released} released, ${record.rejected} rejected, ${record.consecutive_rejects} rejected in a row (suspended at ${rule}).`,
  );
  if (standing.standing === "Suspended") {
    lines.push(
      `Northgate is suspended by this rehearsal's reject; before the demo or another rehearsal, HQ reinstates it: ${REINSTATE}`,
    );
  }
}
lines.push(ok && restored ? "PASS" : "FAIL");
console.log(lines.join("\n"));
if (json) {
  const txs = db.select().from(chainTx).all().length;
  console.log(
    JSON.stringify({ po: poNo, ok: ok && restored, before, after, txs, steps, quoteProofs }),
  );
}
process.exitCode = ok && restored ? 0 : 1;

/** Steps 7–9 and the supplier's side: refused, approved by relay, funded, accepted, shipped. */
async function placeAndShip(po: ReturnType<typeof draftPoFromRanking>, lot: string) {
  const big = await submitPo(db, chain, po, { ...ctx, summary: "ascorbic acid (rehearsal)" });
  log("submit_po", big.status, big.outcome);
  if (big.status !== "awaiting_approval") throw new Stop("the PO did not go to approval");

  const reply = await handleApprovalReply(
    db,
    chain,
    { fromStaffId: person("Linda Park").id, text: `YES ${number}` },
    ctx,
  );
  log("approve_po (relayed)", reply.approval?.status ?? "not sent", reply.approval);
  log("submit_po retry", reply.retry?.status ?? "not sent", reply.retry?.outcome);
  if (reply.retry?.status !== "funded") throw new Stop("the retry was not funded");

  const shipped = await acceptAndShip(
    chain,
    {
      poNo,
      poId: po.id,
      supplierAccount: po.vendor.account ?? "",
      amount: BigInt(po.totalUsdc),
      supplierLot: lot,
    },
    { policyContract: ACCOUNTS.spendPolicy },
  );
  for (const o of shipped.outcomes) log("supplier", o.status, o);
  if (shipped.status !== "shipped") throw new Stop(`the supplier did not ship: ${shipped.reason}`);
}

async function state() {
  const b = (await view("get_budget")) as { budget: string; escrowed: string };
  return { budget: b.budget, escrowed: b.escrowed };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
