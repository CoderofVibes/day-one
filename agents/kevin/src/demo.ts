// The demo loop (DEMO_SCRIPT §2): one run from seed data through Kevin's whole purchasing day.
// Every step is the real module the product uses; this file only sequences them on the demo
// clock and prints each step's staff line and its `chain:` line for the behind-the-curtain view.
// The chain and the models come in as a ChainClient and an LlmClient, so the same run goes
// live on testnet (recording fixtures) or replays them with no keys.
//
// Steps not built yet are left out rather than faked: the step 3 discrepancy (PLAN Nov 8), the
// tier-1 quote anchors on step 5, the USDC proof on step 13 (bonus) and the departments count
// on step 14 (the plant map). They join the run when their features exist.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchRecords,
  chainTx,
  facilities,
  materials,
  staff,
  vendors,
} from "@day-one/server/ledger/schema";
import type { LlmClient, LlmImage } from "@day-one/server/llm/types";
import { formatUsd } from "@day-one/server/money";
import { anchorBatch } from "@day-one/server/records/anchors";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { count, eq, min, ne } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { handleApprovalReply } from "./approval.ts";
import type { KevinErp } from "./erp.ts";
import {
  batchRecordAnchorItem,
  batchRecordProof,
  confirmBatchRecord,
  saveBatchDraft,
  transcribeBatchRecord,
} from "./extraction.ts";
import { forecastMaterial } from "./forecast.ts";
import { matchInvoice, readInvoice } from "./invoices.ts";
import { draftPo, draftPoFromRanking, rankQuotes, requestQuotes } from "./purchasing.ts";
import { decideQc, type PackingSlip, receiptAnchorItem, receiveDelivery } from "./receiving.ts";
import { submitPo } from "./submit.ts";

/** The demo clock (DEMO_SCRIPT §2) for each step. */
export const DEMO_CLOCK = {
  start: "2026-11-09T13:00:00.000Z",
  confirm: "2026-11-09T13:05:00.000Z",
  purchase: "2026-11-09T13:10:00.000Z",
  approve: "2026-11-09T13:25:00.000Z",
  ship: "2026-11-13T09:00:00.000Z",
  receive: "2026-11-16T14:20:00.000Z",
  release: "2026-11-16T16:05:00.000Z",
} as const;

/** Salts for the PO hashes and record fingerprints; fixed per recording so replay matches. */
export interface DemoSalts {
  po1041: string;
  po1042: string;
  batch: string;
  receipt: string;
}

/** The supplier's side, signed from its own account (agents/suppliers). */
export type ShipFn = (shipment: {
  poNo: string;
  poId: number;
  supplierAccount: string;
  amount: bigint;
  supplierLot: string;
}) => Promise<{ status: string; reason?: string; outcomes: LoggedOutcome[] }>;

export interface DemoDeps {
  db: Ledger;
  chain: ChainClient;
  llm: LlmClient;
  /** Moves the chain log's clock; the run sets it before each step. */
  setClock: (iso: string) => void;
  kevin: string;
  policyContract: string;
  /** The account that pays for staff calls sent through the relayer. */
  relayer: string;
  tokenSymbol: string;
  /** The photographed BR-B-1045 page and its SHA-256. */
  batchRecord: { file: string; sha256: string; image: LlmImage };
  /** How many batch records the plant handed over (FICTIONAL_DATA §7). */
  batchRecordCount: number;
  slip: PackingSlip;
  invoiceText: string;
  ship: ShipFn;
  salts: DemoSalts;
  /** The acquirer's ERP, when the run is integrated with it (docs/ERP.md); its lines go to `erp`. */
  erp?: KevinErp;
}

export interface DemoStep {
  step: number;
  title: string;
  staff: string[];
  chain: string[];
  /** What the ERP connector posted during the step; absent when no ERP is attached. */
  erp?: string[];
}

export interface DemoResult {
  steps: DemoStep[];
  /** The file `npm run verify` checks for BR-B-1045 (DEMO_SCRIPT §3 step 3). */
  batchProof: ReturnType<typeof batchRecordProof> & { anchored_tx: string | null };
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  ok: boolean;
}

const NEEDS_APPROVAL = "director approval required.";
const DAY_MS = 86_400_000;

/** Stops the run with the step's own words when a step does not land. */
class DemoStopped extends Error {
  override name = "DemoStopped";
}

export async function runDemo(deps: DemoDeps): Promise<DemoResult> {
  const { db, chain } = deps;
  const steps: DemoStep[] = [];
  const add = (
    step: number,
    title: string,
    staffLines: string[],
    chainLines: string[] = [],
    erpLines: string[] = [],
  ) => {
    const s: DemoStep = { step, title, staff: staffLines, chain: chainLines };
    if (erpLines.length) s.erp = erpLines;
    steps.push(s);
    return s;
  };
  const amount = (units: bigint | number) =>
    `${formatUsd(BigInt(units)).replace("$", "")} ${deps.tokenSymbol}`;
  const ctx = { kevin: deps.kevin, policyContract: deps.policyContract };
  const escrowed = (o: LoggedOutcome, total: number) =>
    o.status === "success" ? `escrow funded ${amount(total)}` : undefined;
  const relayed = (account: string | null) =>
    `signed by ${account ?? "unknown"}, paid by ${deps.relayer}`;
  const staffBy = (where: ReturnType<typeof eq>) => {
    const row = db.select().from(staff).where(where).get();
    if (!row) throw new Error("demo: staff member missing from the seed");
    return row;
  };
  const expect = (ok: boolean, why: string) => {
    if (!ok) throw new DemoStopped(why);
  };

  let ok = true;
  let anchoredTx: string | null = null;
  let batchId = 0;
  try {
    // 0. Seed and the contract's budget.
    deps.setClock(DEMO_CLOCK.start);
    const n = (table: SQLiteTable) => db.select({ n: count() }).from(table).get()?.n ?? 0;
    // History starts with the first seeded batch; opening lots were received earlier.
    const first = db
      .select({ at: min(batchRecords.startedAt) })
      .from(batchRecords)
      .get()?.at;
    const plants = db
      .select({ n: count() })
      .from(facilities)
      .where(ne(facilities.role, "hq"))
      .get()?.n;
    const historyDays = first
      ? Math.round((Date.parse(DEMO_CLOCK.start) - Date.parse(first)) / DAY_MS)
      : 0;
    const budget = (await chain.view({
      contractId: deps.policyContract,
      method: "get_budget",
    })) as { budget: string; escrowed: string };
    add(
      0,
      "Load seed",
      [
        `Loaded ${plants ?? 0} facilities, ${n(materials)} materials, ${n(vendors)} vendors, ` +
          `${deps.batchRecordCount} batch records, ${historyDays} days of history.`,
      ],
      [
        `chain: spend-policy budget ${amount(BigInt(budget.budget))}, ` +
          `escrowed ${amount(BigInt(budget.escrowed))}`,
      ],
    );

    // 1. Kevin reads BR-B-1045.
    const { extraction, model } = await transcribeBatchRecord(deps.llm, deps.batchRecord.image);
    const draft = saveBatchDraft(db, extraction, {
      file: deps.batchRecord.file,
      sha256: deps.batchRecord.sha256,
      model,
    });
    batchId = draft.batchId;
    add(1, "Upload BR-B-1045", [draft.review.sentence]);
    expect(
      !draft.review.flags.some((f) => f.blocking),
      "BR-B-1045 has blocking flags; Ray must answer them before the run can go on.",
    );

    // 2. Ray confirms; Kevin anchors the record's fingerprint.
    deps.setClock(DEMO_CLOCK.confirm);
    const ray = staffBy(eq(staff.name, "Ray Delgado"));
    const confirmed = confirmBatchRecord(db, batchId, {
      staffId: ray.id,
      now: DEMO_CLOCK.confirm,
      salt: deps.salts.batch,
    });
    const batchAnchor = await anchorBatch(db, chain, [batchRecordAnchorItem(db, batchId)], {
      ...ctx,
      now: DEMO_CLOCK.confirm,
    });
    anchoredTx = batchAnchor.txHash;
    const erpBatch = deps.erp ? [await deps.erp.batchConfirmed(db, batchId)] : [];
    add(
      2,
      "Ray confirms",
      [confirmed.sentence],
      [
        chainLine(
          `anchored ${confirmed.review.batchNo} 0x${confirmed.recordHash.slice(0, 8)}…`,
          batchAnchor,
        ),
      ],
      erpBatch,
    );
    expect(batchAnchor.status === "success", `anchoring BR-B-1045 ${batchAnchor.status}`);

    // 4. Forecast.
    deps.setClock(DEMO_CLOCK.purchase);
    const forecast = forecastMaterial(db, {
      facility: "B",
      material: "ASC",
      now: DEMO_CLOCK.start,
    });
    add(4, "Forecast", [forecast.sentence]);

    // 5. Quotes.
    const rfq = requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);
    const ranking = rankQuotes(db, rfq, DEMO_CLOCK.start);
    add(5, "Quotes", [ranking.sentence]);

    // 6. The small PO funds in one call.
    const plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get();
    if (!plantB) throw new Error("demo: Plant B missing from the seed");
    const po1041 = draftPo(db, {
      poNo: "PO-1041",
      vendor: "BLS",
      facilityId: plantB.id,
      lines: [
        { material: "ACN", qtyBase: 4, unitPriceUsdc: 128_000_000 },
        { material: "BUF", qtyBase: 4, unitPriceUsdc: 25_000_000 },
      ],
      needBy: null,
      salt: deps.salts.po1041,
    });
    // With an ERP attached, Kevin checks the payee against its vendor master before every
    // submit and mirrors the PO with the contract's verdict after it.
    const erp1041 = deps.erp ? [(await deps.erp.checkPayee(po1041)).line] : [];
    const small = await submitPo(db, chain, po1041, {
      ...ctx,
      summary: "lab chemicals",
      now: DEMO_CLOCK.purchase,
    });
    if (deps.erp) erp1041.push(await deps.erp.poSubmitted(db, po1041.id));
    add(
      6,
      "Small PO",
      [small.sentence],
      [
        chainLine(
          `submit_po ${po1041.poNo}`,
          small.outcome,
          escrowed(small.outcome, po1041.totalUsdc),
        ),
      ],
      erp1041,
    );
    expect(small.status === "funded", `${po1041.poNo} was not funded`);

    // 7. The big PO: the contract refuses it and Kevin asks the approver in his policy.
    const po1042 = draftPoFromRanking(db, ranking, "PO-1042", deps.salts.po1042);
    const erp1042 = deps.erp ? [(await deps.erp.checkPayee(po1042)).line] : [];
    const big = await submitPo(db, chain, po1042, {
      ...ctx,
      summary: "700 kg ascorbic acid",
      now: DEMO_CLOCK.purchase,
    });
    if (deps.erp) erp1042.push(await deps.erp.poSubmitted(db, po1042.id));
    add(7, "Big PO", [big.sentence], [chainLine(`submit_po ${po1042.poNo}`, big.outcome)], erp1042);
    expect(big.status === "awaiting_approval", `${po1042.poNo} did not go to approval`);

    // 8–9. Linda texts YES 1042; the approval is relayed and Kevin retries.
    deps.setClock(DEMO_CLOCK.approve);
    const linda = staffBy(eq(staff.name, "Linda Park"));
    const reply = await handleApprovalReply(
      db,
      chain,
      { fromStaffId: linda.id, text: "YES 1042" },
      { ...ctx, now: DEMO_CLOCK.approve },
    );
    const [approvedLine, sentLine, ...rest] = reply.sentences;
    add(
      8,
      "Linda texts",
      [`Linda: YES 1042 → ${approvedLine ?? ""}`],
      reply.approval
        ? [chainLine(`approve_po ${po1042.poNo}`, reply.approval, relayed(linda.nearAccountId))]
        : [],
    );
    expect(reply.approval?.status === "success", "the approval did not go through");
    const erpRetry = deps.erp && reply.retry ? [await deps.erp.poSubmitted(db, po1042.id)] : [];
    add(
      9,
      "Kevin retries",
      [sentLine ?? "", ...rest].filter(Boolean),
      reply.retry
        ? [
            chainLine(
              `submit_po ${po1042.poNo}`,
              reply.retry.outcome,
              escrowed(reply.retry.outcome, po1042.totalUsdc),
            ),
          ]
        : [],
      erpRetry,
    );
    expect(reply.retry?.status === "funded", `${po1042.poNo} was not funded on retry`);

    // The supplier accepts and ships from its own account (no staff line in the script).
    deps.setClock(DEMO_CLOCK.ship);
    const slipLot = deps.slip.lines[0]?.supplierLot ?? "";
    const shipped = await deps.ship({
      poNo: po1042.poNo,
      poId: po1042.id,
      supplierAccount: po1042.vendor.account ?? "",
      amount: BigInt(po1042.totalUsdc),
      supplierLot: slipLot,
    });
    add(
      9,
      "Supplier ships",
      [],
      shipped.outcomes.map((o) =>
        chainLine(`${methodOf(db, o.id)} ${po1042.poNo}`, o, `signed by ${po1042.vendor.account}`),
      ),
    );
    expect(shipped.status === "shipped", `Northgate did not ship: ${shipped.reason ?? ""}`);

    // 10. Tommy's packing slip.
    deps.setClock(DEMO_CLOCK.receive);
    const tommy = staffBy(eq(staff.name, "Tommy Reyes"));
    const received = await receiveDelivery(
      db,
      chain,
      { slip: deps.slip, receiverStaffId: tommy.id },
      { policyContract: deps.policyContract, now: DEMO_CLOCK.receive },
    );
    // Northgate's invoice arrives with the delivery. Kevin reads it now so the ERP can match
    // it to the PO and the receipt before QC's release pays the escrow (docs/ERP.md §3.7).
    const reading = await readInvoice(deps.llm, deps.invoiceText);
    const invoice = matchInvoice(db, reading, deps.invoiceText);
    const erpDelivery =
      deps.erp && received.receiptId ? [await deps.erp.received(db, received.receiptId)] : [];
    if (deps.erp && received.receiptId)
      erpDelivery.push((await deps.erp.invoiceRead(db, reading)).line);
    add(
      10,
      "Delivery",
      received.sentences,
      received.outcome
        ? [
            chainLine(
              `confirm_receipt ${po1042.poNo}`,
              received.outcome,
              relayed(tommy.nearAccountId),
            ),
          ]
        : [],
      erpDelivery,
    );
    expect(received.status === "received", `the delivery was not received (${received.status})`);

    // 11. Priya releases the lot; the escrow pays Northgate in the same transaction.
    deps.setClock(DEMO_CLOCK.release);
    const priya = staffBy(eq(staff.name, "Priya Natarajan"));
    const lotCode = received.lotCodes[0] ?? "";
    const qc = await decideQc(
      db,
      chain,
      { lotCode, decision: "release", qcStaffId: priya.id },
      { policyContract: deps.policyContract, now: DEMO_CLOCK.release },
    );
    const [releasedLine, paidLine] = qc.sentences;
    const erpQc =
      deps.erp && qc.status === "released"
        ? await deps.erp.qcDecided(db, {
            lotCode,
            poNo: po1042.poNo,
            decision: "release",
            txHash: qc.outcome?.txHash ?? null,
            explorerUrl: qc.outcome?.explorerUrl ?? null,
            at: DEMO_CLOCK.release,
          })
        : [];
    add(
      11,
      "QC release",
      [releasedLine ?? ""],
      qc.outcome
        ? [
            chainLine(
              `qc_release ${po1042.poNo}`,
              qc.outcome,
              qc.status === "released"
                ? `${amount(po1042.totalUsdc)} → ${po1042.vendor.account}`
                : undefined,
            ),
          ]
        : [],
      erpQc,
    );
    expect(qc.status === "released", `QC release ended ${qc.status}`);

    // 12. Paid; the invoice (read at delivery) matches; Kevin anchors the receipt.
    const receiptAnchor = await anchorBatch(
      db,
      chain,
      [receiptAnchorItem(db, received.receiptId ?? 0, deps.salts.receipt)],
      { ...ctx, now: DEMO_CLOCK.release },
    );
    add(
      12,
      "Paid",
      [
        invoice.status === "matched"
          ? `${paidLine ?? ""} Invoice matched to PO and receipt.`
          : `${paidLine ?? ""} ${invoice.sentence}`,
      ],
      [chainLine(`anchored receipt ${po1042.poNo}`, receiptAnchor)],
    );
    expect(invoice.status === "matched", invoice.sentence);
    expect(receiptAnchor.status === "success", `anchoring the receipt ${receiptAnchor.status}`);
  } catch (error) {
    if (!(error instanceof DemoStopped)) throw error;
    ok = false;
    add(-1, "Stopped", [`The demo stopped: ${error.message}`]);
  }

  // 14. What happened on chain.
  const rows = db.select().from(chainTx).all();
  const refused = rows.filter((r) => r.status === "refused");
  const summary = {
    transactions: rows.length,
    refusedByDesign: refused.filter((r) => r.errorMessage?.endsWith(NEEDS_APPROVAL)).length,
    refusedOther: refused.filter((r) => !r.errorMessage?.endsWith(NEEDS_APPROVAL)).length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
  add(
    14,
    "Summary",
    [],
    [
      `chain: ${summary.transactions} transactions, ${summary.refusedByDesign} refused by design, ` +
        (summary.refusedOther ? `${summary.refusedOther} refused otherwise, ` : "") +
        `${summary.failed} failed.`,
    ],
  );
  ok &&= summary.failed === 0 && summary.refusedOther === 0;

  const confirmed = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
  return {
    steps,
    batchProof:
      confirmed?.status === "confirmed"
        ? { ...batchRecordProof(db, batchId), anchored_tx: anchoredTx }
        : (null as unknown as DemoResult["batchProof"]),
    summary,
    ok,
  };
}

/** `chain: submit_po PO-1042 ✓ (tx …) · extra` or `✗ REFUSED "reason" (tx …)`. */
function chainLine(what: string, o: LoggedOutcome, extra?: string) {
  const tx = `(tx ${o.txHash ?? "none"})`;
  if (o.status === "refused") return `chain: ${what} ✗ REFUSED "${o.errorMessage ?? ""}" ${tx}`;
  if (o.status === "failed") return `chain: ${what} ✗ FAILED "${o.errorMessage ?? ""}" ${tx}`;
  if (extra?.startsWith("signed by")) return `chain: ${what} ✓ ${extra} ${tx}`;
  return `chain: ${what} ✓ ${tx}${extra ? ` · ${extra}` : ""}`;
}

function methodOf(db: Ledger, chainTxId: number) {
  return (
    db.select({ m: chainTx.method }).from(chainTx).where(eq(chainTx.id, chainTxId)).get()?.m ?? ""
  );
}
