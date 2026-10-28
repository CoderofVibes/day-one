import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome, NearEvent } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { verifyChain } from "@day-one/server/ledger/events";
import {
  lotBalances,
  lotEvents,
  lots,
  purchaseOrders,
  qcDecisions,
  receipts,
  staff,
} from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";
import { draftPoFromRanking, type PoDraft, rankQuotes, requestQuotes } from "./purchasing.ts";
import { decideQc, type PackingSlip, receiptAnchorItem, receiveDelivery } from "./receiving.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const RECEIVED_AT = "2026-11-16T14:20:00.000Z";
const RELEASED_AT = "2026-11-16T16:05:00.000Z";
const POLICY = "spend-policy.acme-holdings.testnet";
const RECEIVING = "receiving.plant-b.acme-holdings.testnet";
const QC = "qc.plant-b.acme-holdings.testnet";
const KG = 1_000_000;

const result = (status: ChainOutcome["status"], txHash: string, events: NearEvent[] = []) => ({
  status,
  txHash,
  errorMessage: status === "refused" ? "Only the plant's QC lead can decide." : null,
  events,
  returnValue: null,
  blockHeight: 1,
});
const nep297 = (event: string): NearEvent => ({ standard: "dayone", version: "1.0.0", event });

class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  onChainPo: unknown = { status: "Shipped", supplier_lot: "NG-24-8812" };
  constructor(private readonly outcomes: ChainOutcome[]) {}
  async send(call: ChainCall) {
    this.calls.push(call);
    const next = this.outcomes.shift();
    if (!next) throw new Error(`unexpected call ${call.method}`);
    return next;
  }
  async view(_view: ChainView) {
    return this.onChainPo;
  }
}

/** FICTIONAL_DATA §11: Northgate's packing list NG-PS-60417 for PO-1042. */
const slip = (over: Partial<PackingSlip["lines"][number]> = {}): PackingSlip => ({
  slipNo: "NG-PS-60417",
  poNo: "PO-1042",
  vendorName: "Northgate Ingredients",
  lines: [
    {
      description: "Ascorbic acid, fine granular",
      shippedBase: 700 * KG,
      backorderedBase: 0,
      supplierLot: "NG-24-8812",
      ...over,
    },
  ],
  file: "data/packing-slips/NG-PS-60417.jpg",
  sha256: "c0ffee".padEnd(64, "0"),
});

let db: Ledger;
let po: PoDraft;
let tommy: number;
let priya: number;

beforeEach(() => {
  db = openLedger();
  seedLedger(db);
  confirmBr1045(db);
  const now = "2026-11-09T13:00:00.000Z";
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now });
  const rfq = requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);
  po = draftPoFromRanking(db, rankQuotes(db, rfq, now), "PO-1042", "5a17".repeat(8));
  // Funded after Linda's approval (approval.test.ts); the supplier has shipped on chain.
  db.update(purchaseOrders).set({ status: "funded" }).where(eq(purchaseOrders.id, po.id)).run();
  const id = (name: string) => db.select().from(staff).where(eq(staff.name, name)).get()?.id ?? 0;
  tommy = id("Tommy Reyes");
  priya = id("Priya Natarajan");
});

const ctx = (now: string) => ({ policyContract: POLICY, now });
const poStatus = () =>
  db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status;

async function receive(fake: FakeChain, s = slip()) {
  return receiveDelivery(
    db,
    new ChainClient(db, fake),
    { slip: s, receiverStaffId: tommy },
    ctx(RECEIVED_AT),
  );
}

describe("receiving", () => {
  it("confirms a matching slip with Tommy's key and quarantines the new lot (step 10)", async () => {
    const fake = new FakeChain([result("success", "ReceiptHash")]);
    const r = await receive(fake);

    expect(r.status).toBe("received");
    expect(r.sentences).toEqual([
      "Tommy photographed the packing slip. Matches PO-1042: 700 kg ascorbic acid, supplier lot NG-24-8812. Lot ASC-261116-01 is in quarantine.",
    ]);
    expect(fake.calls).toEqual([
      expect.objectContaining({
        kind: "confirm_receipt",
        signerId: RECEIVING,
        predecessorId: RECEIVING,
        viaRelayer: true,
        args: { po_id: "PO-1042" },
      }),
    ]);
    const lot = db.select().from(lots).where(eq(lots.lotCode, "ASC-261116-01")).get();
    expect(lot).toMatchObject({ state: "quarantine", vendorLotCode: "NG-24-8812" });
    const events = db
      .select()
      .from(lotEvents)
      .where(eq(lotEvents.lotId, lot?.id ?? 0))
      .orderBy(asc(lotEvents.seq))
      .all();
    expect(events.map((e) => [e.kind, e.qtyDeltaBase])).toEqual([
      ["received", 700 * KG],
      ["quarantined", 0],
    ]);
    expect(db.select().from(receipts).where(eq(receipts.poId, po.id)).get()).toMatchObject({
      matchStatus: "matched",
      receivedBy: tommy,
    });
    expect(poStatus()).toBe("received");
    expect(verifyChain(db)).toEqual({ ok: true });
  });

  it("holds a short delivery without touching the chain (NG-PS-60417-X)", async () => {
    const fake = new FakeChain([]);
    const r = await receive(fake, slip({ shippedBase: 675 * KG, backorderedBase: 25 * KG }));

    expect(r.status).toBe("mismatch");
    expect(r.sentences).toEqual([
      "Short 25 kg against PO-1042; the slip shows 25 kg back-ordered.",
      "Receipt of PO-1042 is on hold until someone decides.",
    ]);
    expect(fake.calls).toHaveLength(0);
    expect(db.select().from(receipts).where(eq(receipts.poId, po.id)).get()?.matchStatus).toBe(
      "mismatch",
    );
    expect(db.select().from(lots).where(eq(lots.lotCode, "ASC-261116-01")).get()).toBeUndefined();
    expect(poStatus()).toBe("funded");
  });

  it("flags a supplier lot that differs from the one shipped on chain", async () => {
    const r = await receive(new FakeChain([]), slip({ supplierLot: "NG-24-8813" }));
    expect(r.sentences[0]).toBe(
      "Supplier lot NG-24-8813 on the slip, but Northgate Ingredients shipped NG-24-8812.",
    );
  });

  it("does not receive a PO the supplier has not shipped", async () => {
    const fake = new FakeChain([]);
    fake.onChainPo = { status: "Funded", supplier_lot: null };
    const r = await receive(fake);
    expect(r.sentences[0]).toBe("Northgate Ingredients has not marked PO-1042 as shipped yet.");
    expect(fake.calls).toHaveLength(0);
  });

  it("anchors the matched receipt as a salted fingerprint", async () => {
    const r = await receive(new FakeChain([result("success", "ReceiptHash")]));
    const item = receiptAnchorItem(db, r.receiptId ?? 0, "ab".repeat(16));
    expect(item).toMatchObject({ kind: "receipt", refId: "RCV-PO-1042", prev: null });
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(receiptAnchorItem(db, r.receiptId ?? 0, "cd".repeat(16)).hash).not.toBe(item.hash);
  });
});

describe("QC", () => {
  const qc = (fake: FakeChain, decision: "release" | "reject", reason?: string) =>
    decideQc(
      db,
      new ChainClient(db, fake),
      { lotCode: "ASC-261116-01", decision, qcStaffId: priya, reason },
      ctx(RELEASED_AT),
    );
  const lotState = () =>
    db.select().from(lots).where(eq(lots.lotCode, "ASC-261116-01")).get()?.state;

  it("releases the lot and pays the supplier from escrow (steps 11 and 12)", async () => {
    await receive(new FakeChain([result("success", "ReceiptHash")]));
    const fake = new FakeChain([result("success", "ReleaseHash", [nep297("po_released")])]);
    const r = await qc(fake, "release");

    expect(r.sentences).toEqual(["Priya released lot ASC-261116-01.", "PO-1042 — paid $5,150.00."]);
    expect(fake.calls[0]).toMatchObject({
      kind: "qc_release",
      signerId: QC,
      viaRelayer: true,
      args: { po_id: "PO-1042" },
    });
    expect(lotState()).toBe("released");
    expect(poStatus()).toBe("paid");
    expect(db.select().from(qcDecisions).where(eq(qcDecisions.poId, po.id)).get()).toMatchObject({
      decision: "released",
      decidedBy: priya,
    });
  });

  it("keeps the lot in quarantine and the money held when the payout fails", async () => {
    await receive(new FakeChain([result("success", "ReceiptHash")]));
    const r = await qc(
      new FakeChain([result("success", "H", [nep297("payout_failed")])]),
      "release",
    );

    expect(r.status).toBe("payout_failed");
    expect(r.sentences[0]).toContain("the payment to Northgate Ingredients did not go through");
    expect(lotState()).toBe("quarantine");
    expect(poStatus()).toBe("received");
    expect(db.select().from(qcDecisions).where(eq(qcDecisions.poId, po.id)).all()).toHaveLength(0);
  });

  it("rejects the lot, refunds the budget and returns the goods", async () => {
    await receive(new FakeChain([result("success", "ReceiptHash")]));
    const fake = new FakeChain([result("success", "RejectHash", [nep297("po_refunded")])]);
    const r = await qc(fake, "reject", "Assay 97.1%, below the 99.0% spec.");

    expect(r.sentences).toEqual([
      "Priya rejected lot ASC-261116-01: Assay 97.1%, below the 99.0% spec.",
      "PO-1042 refunded: $5,150.00 is back in the plant budget, and the lot goes back to Northgate Ingredients.",
    ]);
    expect(fake.calls[0]).toMatchObject({
      kind: "qc_reject",
      args: { po_id: "PO-1042", reason: "Assay 97.1%, below the 99.0% spec." },
    });
    expect(lotState()).toBe("wasted");
    const lot = db.select().from(lots).where(eq(lots.lotCode, "ASC-261116-01")).get();
    const balance = db
      .select()
      .from(lotBalances)
      .where(eq(lotBalances.lotId, lot?.id ?? 0))
      .get();
    expect(balance?.onHandBase).toBe(0);
    expect(poStatus()).toBe("rejected");
    expect(verifyChain(db)).toEqual({ ok: true });
  });

  it("changes nothing when the contract refuses the decision", async () => {
    await receive(new FakeChain([result("success", "ReceiptHash")]));
    const r = await qc(new FakeChain([result("refused", "H")]), "release");
    expect(r.status).toBe("refused");
    expect(r.sentences[0]).toBe(
      "QC decision on lot ASC-261116-01 was refused: Only the plant's QC lead can decide.",
    );
    expect(lotState()).toBe("quarantine");
    expect(poStatus()).toBe("received");
  });

  it("will not decide on a lot that is not in quarantine", async () => {
    await receive(new FakeChain([result("success", "ReceiptHash")]));
    await qc(new FakeChain([result("success", "R", [nep297("po_released")])]), "release");
    const fake = new FakeChain([]);
    const r = await qc(fake, "reject");
    expect(r.sentences).toEqual(["Lot ASC-261116-01 is not in quarantine."]);
    expect(fake.calls).toHaveLength(0);
  });
});
