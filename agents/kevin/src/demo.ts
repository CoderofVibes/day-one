// The demo loop (DEMO_SCRIPT §2): one run from seed data through Kevin's whole purchasing day.
// Every step is the real module the product uses; this file only sequences them on the demo
// clock and prints each step's staff line and its `chain:` line for the behind-the-curtain view.
// The chain and the models come in as a ChainClient and an LlmClient, so the same run goes
// live on testnet (recording fixtures) or replays them with no keys.
//
// The run is a machine of phases that staff actions advance (`startDemo`): Ray uploads and
// confirms, Kevin buys, Linda texts, Tommy photographs the slip, Priya decides. The scripted
// demo (`runDemo`, npm run demo) plays the phases in the recorded order; the HTTP API (api/)
// plays them one click at a time. Both print the same lines.
//
// Steps not built yet are left out rather than faked: the USDC proof on step 13 (bonus) and the
// departments count on step 14 (the plant map). They join the run when their features exist.
// Step 5's quotes come over the bus from whoever `deps.quotes` asks: the supplier agents, which
// anchor their quote fingerprints from their own accounts, or a plain answer set.

import { type ChainClient, explorerUrl, type LoggedOutcome } from "@day-one/server/chain/client";
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
import { quoteProof } from "@day-one/server/quotes";
import { anchorBatch } from "@day-one/server/records/anchors";
import { count, eq, min, ne } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { handleApprovalReply } from "./approval.ts";
import { checkTransfers } from "./discrepancies.ts";
import {
  batchRecordAnchorItem,
  batchRecordProof,
  confirmBatchRecord,
  saveBatchDraft,
  transcribeBatchRecord,
} from "./extraction.ts";
import { forecastMaterial } from "./forecast.ts";
import { matchInvoice, readInvoice } from "./invoices.ts";
import {
  draftPo,
  draftPoFromRanking,
  openRfq,
  type QuoteAnswer,
  type Rfq,
  rankQuotes,
  recordQuotes,
} from "./purchasing.ts";
import {
  decideQc,
  type PackingSlip,
  type ReceiveResult,
  receiptAnchorItem,
  receiveDelivery,
} from "./receiving.ts";
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
  /** One per supplier account, for the quote fingerprints the agents anchor. */
  quotes: Record<string, string>;
}

/** Who answers Kevin's RFQ: the supplier agents on the bus, or a plain answer set. */
export type QuotesFn = (rfq: Rfq) => Promise<QuoteAnswer[]>;

/** The supplier's side, signed from its own account (agents/suppliers). */
export type ShipFn = (shipment: {
  poNo: string;
  poId: number;
  supplierAccount: string;
  amount: bigint;
  supplierLot: string;
}) => Promise<{ status: string; reason?: string; outcomes: LoggedOutcome[] }>;

export interface BatchRecordPage {
  file: string;
  sha256: string;
  image: LlmImage;
}

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
  batchRecord: BatchRecordPage;
  /** How many batch records the plant handed over (FICTIONAL_DATA §7). */
  batchRecordCount: number;
  slip: PackingSlip;
  invoiceText: string;
  quotes: QuotesFn;
  ship: ShipFn;
  salts: DemoSalts;
}

export interface DemoStep {
  step: number;
  title: string;
  staff: string[];
  chain: string[];
}

export interface DemoResult {
  steps: DemoStep[];
  /** The file `npm run verify` checks for BR-B-1045 (DEMO_SCRIPT §3 step 3). */
  batchProof: ReturnType<typeof batchRecordProof> & { anchored_tx: string | null };
  /** One verifiable file per quote a supplier agent anchored. */
  quoteProofs: ReturnType<typeof quoteProof>[];
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  ok: boolean;
}

/** The phases of the run, in order. Each staff action advances one of them. */
export const DEMO_PHASES = [
  "load",
  "upload",
  "confirm",
  "purchase",
  "reply",
  "receive",
  "qc",
  "finish",
  "done",
] as const;
export type DemoPhase = (typeof DEMO_PHASES)[number];

/** A phase was asked for out of turn. */
export class DemoOrderError extends Error {
  override name = "DemoOrderError";
  constructor(
    readonly expected: DemoPhase,
    readonly asked: DemoPhase,
  ) {
    super(`the run is at "${expected}", not "${asked}"`);
  }
}

export interface DemoMachine {
  readonly steps: DemoStep[];
  /** The phase the run is waiting for. */
  readonly next: DemoPhase;
  /** Why the run stopped early, if it did. */
  readonly stopped: string | null;
  /** The draft Kevin read and the purchaser has not confirmed yet. */
  readonly draft: { batchId: number; batchNo: string } | null;
  /** The lot waiting for QC, once the delivery is in. */
  readonly quarantined: string | null;
  /** 0. Seed counts and the contract's budget. */
  load(): Promise<DemoStep[]>;
  /** 1. Kevin reads the page (the recorded BR-B-1045 unless another is given). */
  upload(page?: BatchRecordPage): Promise<DemoStep[]>;
  /** 2. The purchaser confirms; Kevin anchors the record. */
  confirm(staffName?: string): Promise<DemoStep[]>;
  /** 4–7. Forecast, quotes, the small PO funds, the big PO is refused. */
  purchase(): Promise<DemoStep[]>;
  /** 8–9. The approver texts back; Kevin retries; the supplier accepts and ships. */
  reply(fromStaffName: string, text: string): Promise<DemoStep[]>;
  /** 10. Receiving photographs the packing slip. */
  receive(slip?: PackingSlip, receiverName?: string): Promise<DemoStep[]>;
  /** 11–12. QC decides; a release pays the supplier and Kevin matches the invoice. */
  qc(decision: "release" | "reject", lotCode?: string, qcName?: string): Promise<DemoStep[]>;
  /** 14. The chain summary and the proof file. */
  finish(): DemoResult;
}

const NEEDS_APPROVAL = "director approval required.";
/** The contract's answer to an unapproved supplier anchoring its quote (QuickChem on step 5). */
const NOT_A_SUPPLIER =
  "Only a registered purchasing agent or an approved supplier can anchor records.";
const DAY_MS = 86_400_000;
const PURCHASER = "Ray Delgado";
const RECEIVER = "Tommy Reyes";
const QC = "Priya Natarajan";
const APPROVER = "Linda Park";

/** Stops the run with the step's own words when a step does not land. */
class DemoStopped extends Error {
  override name = "DemoStopped";
}

export function startDemo(deps: DemoDeps): DemoMachine {
  return new Demo(deps);
}

/** The scripted run: every phase in the recorded order (DEMO_SCRIPT §2). */
export async function runDemo(deps: DemoDeps): Promise<DemoResult> {
  const demo = startDemo(deps);
  const phases = [
    () => demo.load(),
    () => demo.upload(),
    () => demo.confirm(),
    () => demo.purchase(),
    () => demo.reply(APPROVER, "YES 1042"),
    () => demo.receive(),
    () => demo.qc("release"),
  ];
  for (const phase of phases) {
    if (demo.stopped) break;
    await phase();
  }
  return demo.finish();
}

class Demo implements DemoMachine {
  readonly steps: DemoStep[] = [];
  next: DemoPhase = "load";
  stopped: string | null = null;
  draft: { batchId: number; batchNo: string } | null = null;
  quarantined: string | null = null;

  private batchId = 0;
  private anchoredTx: string | null = null;
  private po1042: ReturnType<typeof draftPoFromRanking> | null = null;
  private rfq: Rfq | null = null;
  private received: ReceiveResult | null = null;
  private result: DemoResult | null = null;

  constructor(private readonly deps: DemoDeps) {}

  private get db() {
    return this.deps.db;
  }
  private get chain() {
    return this.deps.chain;
  }
  private get ctx() {
    return { kevin: this.deps.kevin, policyContract: this.deps.policyContract };
  }

  private add(step: number, title: string, staffLines: string[], chainLines: string[] = []) {
    const s = { step, title, staff: staffLines, chain: chainLines };
    this.steps.push(s);
    return s;
  }
  private amount(units: bigint | number) {
    return `${formatUsd(BigInt(units)).replace("$", "")} ${this.deps.tokenSymbol}`;
  }
  private escrowed(o: LoggedOutcome, total: number) {
    return o.status === "success" ? `escrow funded ${this.amount(total)}` : undefined;
  }
  private relayed(account: string | null) {
    return `signed by ${account ?? "unknown"}, paid by ${this.deps.relayer}`;
  }
  private staffBy(name: string) {
    const row = this.db.select().from(staff).where(eq(staff.name, name)).get();
    if (!row) throw new DemoStopped(`${name} is not on the staff list`);
    return row;
  }
  private expect(ok: boolean, why: string) {
    if (!ok) throw new DemoStopped(why);
  }

  /** Runs one phase in turn; a step that does not land stops the run with its own words. */
  private async phase(name: DemoPhase, after: DemoPhase, body: () => Promise<void>) {
    if (this.next !== name) throw new DemoOrderError(this.next, name);
    const from = this.steps.length;
    try {
      await body();
      this.next = after;
    } catch (error) {
      if (!(error instanceof DemoStopped)) throw error;
      this.stopped = error.message;
      this.add(-1, "Stopped", [`The demo stopped: ${error.message}`]);
      this.next = "finish";
    }
    return this.steps.slice(from);
  }

  load() {
    return this.phase("load", "upload", async () => {
      const { db, deps } = this;
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
      const budget = (await this.chain.view({
        contractId: deps.policyContract,
        method: "get_budget",
      })) as { budget: string; escrowed: string };
      this.add(
        0,
        "Load seed",
        [
          `Loaded ${plants ?? 0} facilities, ${n(materials)} materials, ${n(vendors)} vendors, ` +
            `${deps.batchRecordCount} batch records, ${historyDays} days of history.`,
        ],
        [
          `chain: spend-policy budget ${this.amount(BigInt(budget.budget))}, ` +
            `escrowed ${this.amount(BigInt(budget.escrowed))}`,
        ],
      );
    });
  }

  upload(page: BatchRecordPage = this.deps.batchRecord) {
    return this.phase("upload", "confirm", async () => {
      const { extraction, model } = await transcribeBatchRecord(this.deps.llm, page.image);
      const draft = saveBatchDraft(this.db, extraction, {
        file: page.file,
        sha256: page.sha256,
        model,
      });
      this.batchId = draft.batchId;
      this.draft = { batchId: draft.batchId, batchNo: draft.review.batchNo };
      this.add(1, `Upload ${draft.review.batchNo}`, [draft.review.sentence]);
      this.expect(
        !draft.review.flags.some((f) => f.blocking),
        `${draft.review.batchNo} has blocking flags; Ray must answer them before the run can go on.`,
      );
    });
  }

  confirm(staffName = PURCHASER) {
    return this.phase("confirm", "purchase", async () => {
      this.deps.setClock(DEMO_CLOCK.confirm);
      const who = this.staffBy(staffName);
      const confirmed = confirmBatchRecord(this.db, this.batchId, {
        staffId: who.id,
        now: DEMO_CLOCK.confirm,
        salt: this.deps.salts.batch,
      });
      this.draft = null;
      const batchAnchor = await anchorBatch(
        this.db,
        this.chain,
        [batchRecordAnchorItem(this.db, this.batchId)],
        { ...this.ctx, now: DEMO_CLOCK.confirm },
      );
      this.anchoredTx = batchAnchor.txHash;
      this.add(
        2,
        `${firstName(who.name)} confirms`,
        [confirmed.sentence],
        [
          chainLine(
            `anchored ${confirmed.review.batchNo} 0x${confirmed.recordHash.slice(0, 8)}…`,
            batchAnchor,
          ),
        ],
      );
      this.expect(
        batchAnchor.status === "success",
        `anchoring ${confirmed.review.batchNo} ${batchAnchor.status}`,
      );

      // 3. Consuming a transferred lot is what exposes a transfer discrepancy (SPEC step 3).
      for (const found of checkTransfers(this.db, { now: DEMO_CLOCK.confirm })) {
        this.add(3, "Discrepancy", [found.sentence]);
      }
    });
  }

  purchase() {
    return this.phase("purchase", "reply", async () => {
      const { db, chain, deps } = this;
      // 4. Forecast.
      deps.setClock(DEMO_CLOCK.purchase);
      const forecast = forecastMaterial(db, {
        facility: "B",
        material: "ASC",
        now: DEMO_CLOCK.start,
      });
      this.add(4, "Forecast", [forecast.sentence]);

      // 5. Quotes over the bus; each supplier agent anchors its quote from its own account.
      const rfq = openRfq(db, forecast, "RFQ-2611-01");
      const answers = await deps.quotes(rfq);
      recordQuotes(db, rfq, answers);
      this.rfq = rfq;
      const ranking = rankQuotes(db, rfq, DEMO_CLOCK.start);
      this.add(
        5,
        "Quotes",
        [ranking.sentence],
        answers.flatMap((a) =>
          a.anchor
            ? [chainLine(`anchor quote ${rfq.rfqNo}`, a.anchor, `signed by ${a.account}`)]
            : [],
        ),
      );

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
      const small = await submitPo(db, chain, po1041, {
        ...this.ctx,
        summary: "lab chemicals",
        now: DEMO_CLOCK.purchase,
      });
      this.add(
        6,
        "Small PO",
        [small.sentence],
        [
          chainLine(
            `submit_po ${po1041.poNo}`,
            small.outcome,
            this.escrowed(small.outcome, po1041.totalUsdc),
          ),
        ],
      );
      this.expect(small.status === "funded", `${po1041.poNo} was not funded`);

      // 7. The big PO: the contract refuses it and Kevin asks the approver in his policy.
      const po1042 = draftPoFromRanking(db, ranking, "PO-1042", deps.salts.po1042);
      this.po1042 = po1042;
      const big = await submitPo(db, chain, po1042, {
        ...this.ctx,
        summary: "700 kg ascorbic acid",
        now: DEMO_CLOCK.purchase,
      });
      this.add(7, "Big PO", [big.sentence], [chainLine(`submit_po ${po1042.poNo}`, big.outcome)]);
      this.expect(big.status === "awaiting_approval", `${po1042.poNo} did not go to approval`);
    });
  }

  reply(fromStaffName: string, text: string) {
    return this.phase("reply", "receive", async () => {
      const { db, chain, deps } = this;
      const po1042 = this.po1042;
      if (!po1042) throw new Error("demo: reply before the big PO");
      // 8–9. The approver texts back; the approval is relayed and Kevin retries.
      deps.setClock(DEMO_CLOCK.approve);
      const approver = this.staffBy(fromStaffName);
      const first = firstName(approver.name);
      const reply = await handleApprovalReply(
        db,
        chain,
        { fromStaffId: approver.id, text },
        { ...this.ctx, now: DEMO_CLOCK.approve },
      );
      const [approvedLine, sentLine, ...rest] = reply.sentences;
      this.add(
        8,
        `${first} texts`,
        [`${first}: ${text} → ${approvedLine ?? ""}`],
        reply.approval
          ? [
              chainLine(
                `approve_po ${po1042.poNo}`,
                reply.approval,
                this.relayed(approver.nearAccountId),
              ),
            ]
          : [],
      );
      this.expect(reply.approval?.status === "success", "the approval did not go through");
      this.add(
        9,
        "Kevin retries",
        [sentLine ?? "", ...rest].filter(Boolean),
        reply.retry
          ? [
              chainLine(
                `submit_po ${po1042.poNo}`,
                reply.retry.outcome,
                this.escrowed(reply.retry.outcome, po1042.totalUsdc),
              ),
            ]
          : [],
      );
      this.expect(reply.retry?.status === "funded", `${po1042.poNo} was not funded on retry`);

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
      this.add(
        9,
        "Supplier ships",
        [],
        shipped.outcomes.map((o) =>
          chainLine(
            `${methodOf(db, o.id)} ${po1042.poNo}`,
            o,
            `signed by ${po1042.vendor.account}`,
          ),
        ),
      );
      this.expect(
        shipped.status === "shipped",
        `${po1042.vendor.name.split(" ")[0]} did not ship: ${shipped.reason ?? ""}`,
      );
    });
  }

  receive(slip: PackingSlip = this.deps.slip, receiverName = RECEIVER) {
    return this.phase("receive", "qc", async () => {
      const po1042 = this.po1042;
      if (!po1042) throw new Error("demo: delivery before the big PO");
      this.deps.setClock(DEMO_CLOCK.receive);
      const receiver = this.staffBy(receiverName);
      const received = await receiveDelivery(
        this.db,
        this.chain,
        { slip, receiverStaffId: receiver.id },
        { policyContract: this.deps.policyContract, now: DEMO_CLOCK.receive },
      );
      this.received = received;
      this.quarantined = received.lotCodes[0] ?? null;
      this.add(
        10,
        "Delivery",
        received.sentences,
        received.outcome
          ? [
              chainLine(
                `confirm_receipt ${po1042.poNo}`,
                received.outcome,
                this.relayed(receiver.nearAccountId),
              ),
            ]
          : [],
      );
      this.expect(
        received.status === "received",
        `the delivery was not received (${received.status})`,
      );
    });
  }

  qc(decision: "release" | "reject", lotCode = this.quarantined ?? "", qcName = QC) {
    return this.phase("qc", "finish", async () => {
      const { db, chain, deps } = this;
      const po1042 = this.po1042;
      const received = this.received;
      if (!po1042 || !received) throw new Error("demo: QC before the delivery");
      // 11. QC decides; a release pays the supplier in the same transaction.
      deps.setClock(DEMO_CLOCK.release);
      const inspector = this.staffBy(qcName);
      const qc = await decideQc(
        db,
        chain,
        { lotCode, decision, qcStaffId: inspector.id },
        { policyContract: deps.policyContract, now: DEMO_CLOCK.release },
      );
      const [decidedLine, paidLine] = qc.sentences;
      const method = decision === "release" ? "qc_release" : "qc_reject";
      this.quarantined = null;
      this.add(
        11,
        decision === "release" ? "QC release" : "QC reject",
        [decidedLine ?? ""],
        qc.outcome
          ? [
              chainLine(
                `${method} ${po1042.poNo}`,
                qc.outcome,
                qc.status === "released"
                  ? `${this.amount(po1042.totalUsdc)} → ${po1042.vendor.account}`
                  : undefined,
              ),
            ]
          : [],
      );
      if (decision === "reject") {
        this.expect(qc.status === "rejected", `QC reject ended ${qc.status}`);
        return;
      }
      this.expect(qc.status === "released", `QC release ended ${qc.status}`);

      // 12. Paid; the invoice matches; Kevin anchors the receipt.
      const reading = await readInvoice(deps.llm, deps.invoiceText);
      const invoice = matchInvoice(db, reading, deps.invoiceText);
      const receiptAnchor = await anchorBatch(
        db,
        chain,
        [receiptAnchorItem(db, received.receiptId ?? 0, deps.salts.receipt)],
        { ...this.ctx, now: DEMO_CLOCK.release },
      );
      this.add(
        12,
        "Paid",
        [
          invoice.status === "matched"
            ? `${paidLine ?? ""} Invoice matched to PO and receipt.`
            : `${paidLine ?? ""} ${invoice.sentence}`,
        ],
        [chainLine(`anchored receipt ${po1042.poNo}`, receiptAnchor)],
      );
      this.expect(invoice.status === "matched", invoice.sentence);
      this.expect(
        receiptAnchor.status === "success",
        `anchoring the receipt ${receiptAnchor.status}`,
      );
    });
  }

  finish(): DemoResult {
    if (this.result) return this.result;
    if (this.next !== "finish") throw new DemoOrderError(this.next, "finish");
    const { db } = this;
    // 14. What happened on chain.
    const rows = db.select().from(chainTx).all();
    const refused = rows.filter((r) => r.status === "refused");
    const byDesign = (r: (typeof rows)[number]) =>
      r.errorMessage?.endsWith(NEEDS_APPROVAL) ||
      (r.method === "anchor" && r.errorMessage === NOT_A_SUPPLIER);
    const summary = {
      transactions: rows.length,
      refusedByDesign: refused.filter(byDesign).length,
      refusedOther: refused.filter((r) => !byDesign(r)).length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
    this.add(
      14,
      "Summary",
      [],
      [
        `chain: ${summary.transactions} transactions, ${summary.refusedByDesign} refused by design, ` +
          (summary.refusedOther ? `${summary.refusedOther} refused otherwise, ` : "") +
          `${summary.failed} failed.`,
      ],
    );
    const ok = !this.stopped && summary.failed === 0 && summary.refusedOther === 0;

    const confirmed = db.select().from(batchRecords).where(eq(batchRecords.id, this.batchId)).get();
    this.next = "done";
    this.result = {
      steps: this.steps,
      batchProof:
        confirmed?.status === "confirmed"
          ? { ...batchRecordProof(db, this.batchId), anchored_tx: this.anchoredTx }
          : (null as unknown as DemoResult["batchProof"]),
      quoteProofs: (this.rfq?.quotes ?? [])
        .filter((q) => q.anchor?.status === "success")
        .map((q) => quoteProof(q.terms, q.salt, q.anchor?.txHash ?? null)),
      summary,
      ok,
    };
    return this.result;
  }
}

/** The transcript npm run demo prints and checks: every line, then the explorer links. */
export function formatTranscript(db: Ledger, steps: DemoStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    for (const text of step.staff) lines.push(text);
    for (const text of step.chain) lines.push(`  ${text}`);
  }
  const txs = db
    .select()
    .from(chainTx)
    .all()
    .filter((r) => r.txHash)
    .map((r) => `  ${r.method} ${explorerUrl(r.network, r.txHash)}`);
  return `${[...lines, "", "Explorer links:", ...txs].join("\n")}\n`;
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
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
