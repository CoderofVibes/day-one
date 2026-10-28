import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Erp, openErp } from "../db.ts";
import { formatUsd, usd } from "../money.ts";
import {
  inventoryBalances,
  purchaseOrderLines,
  purchaseOrders,
  users,
  vendorBills,
} from "../schema.ts";
import { seedErp } from "../seed/index.ts";
import { trialBalance } from "./journal.ts";
import {
  approvedBillFor,
  createVendorBill,
  createVendorPayment,
  decideVendorBill,
} from "./payables.ts";
import {
  ErpRefusal,
  postItemReceipt,
  releaseReceivedLot,
  returnReceivedLot,
  upsertPurchaseOrder,
} from "./purchasing.ts";

const KG = 1_000_000;
let db: Erp;
let kevin: number;
let marcy: number;
let jordan: number;
const AT = "2026-11-16T14:20:00.000Z";

beforeEach(() => {
  db = openErp();
  seedErp(db);
  const id = (u: string) => db.select().from(users).where(eq(users.username, u)).get()?.id ?? 0;
  kevin = id("kevin.dayone");
  marcy = id("marcy.allen");
  jordan = id("jordan.pike");
});

/** PO-1042 as Kevin mirrors it after the director's approval and the contract's funding. */
function po1042(overrides: Partial<Parameters<typeof upsertPurchaseOrder>[1]> = {}) {
  return upsertPurchaseOrder(db, {
    tranId: "PO-1042",
    vendorCode: "NGI",
    locationCode: "B",
    tranDate: "2026-11-09",
    category: "raw_material",
    poHash: "ab".repeat(32),
    freightUsdc: usd(180),
    lines: [{ itemCode: "ASC", quantityBase: 700 * KG, rateUsdc: usd(7.1) }],
    verdict: "funded",
    fundingTx: "B3Hn",
    approvalTx: "3pC5",
    approvedBy: "director.plant-b.acme-holdings.testnet",
    userId: kevin,
    at: "2026-11-09T13:25:00.000Z",
    ...overrides,
  });
}

function receive1042() {
  return postItemReceipt(db, {
    externalId: "RCV-PO-1042",
    poTranId: "PO-1042",
    tranDate: "2026-11-16",
    lines: [{ poLine: 1, quantityBase: 700 * KG, lotNumber: "ASC-261116-01" }],
    userId: kevin,
    at: AT,
  });
}

function bill1042(over: Partial<Parameters<typeof createVendorBill>[1]> = {}) {
  return createVendorBill(db, {
    tranId: "NG-INV-24190",
    vendorCode: "NGI",
    poTranId: "PO-1042",
    tranDate: "2026-11-16",
    freightUsdc: usd(180),
    totalUsdc: usd(5150),
    lines: [
      {
        itemCode: "ASC",
        description: "Ascorbic acid, USP fine powder",
        quantityBase: 700 * KG,
        rateUsdc: usd(7.1),
      },
    ],
    userId: kevin,
    at: AT,
    ...over,
  });
}

describe("purchase orders and receipts", () => {
  it("mirrors a PO with the contract's verdict and totals its lines", () => {
    const refused = po1042({
      verdict: "awaitingApproval",
      reason:
        "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.",
      fundingTx: null,
      approvalTx: null,
      approvedBy: null,
    });
    expect(refused).toMatchObject({
      created: true,
      status: "pendingApproval",
      approvalStatus: "pendingApproval",
    });
    const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.tranId, "PO-1042")).get();
    expect(po?.totalUsdc).toBe(usd(5150));
    const funded = po1042();
    expect(funded).toMatchObject({
      created: false,
      status: "pendingReceipt",
      approvalStatus: "approved",
    });
    expect(
      db.select().from(purchaseOrders).where(eq(purchaseOrders.tranId, "PO-1042")).get()
        ?.custbodyNearApprovalTx,
    ).toBe("3pC5");
    expect(db.select().from(purchaseOrderLines).all()).toHaveLength(1);
  });

  it("refuses a vendor outside the master and rejects a blocked one", () => {
    expect(() => po1042({ vendorCode: "HRW" })).toThrow(ErpRefusal);
    try {
      po1042({ vendorCode: "HRW" });
    } catch (e) {
      expect((e as ErpRefusal).code).toBe("VENDOR_NOT_IN_MASTER");
    }
    const blocked = po1042({ tranId: "PO-1050", vendorCode: "QCD" });
    expect(blocked).toMatchObject({ status: "rejected", approvalStatus: "rejected" });
  });

  it("receives into quarantine at the PO price and accrues the liability; QC release makes it good", () => {
    po1042();
    const receipt = receive1042();
    expect(receipt).toMatchObject({ tranId: "IR-1", created: true });
    expect(receive1042()).toMatchObject({ id: receipt.id, created: false });
    const bal = db.select().from(inventoryBalances).all();
    expect(bal).toEqual([
      expect.objectContaining({
        inventoryStatus: "quarantine",
        quantityOnHandBase: 700 * KG,
        valueUsdc: usd(4970),
      }),
    ]);
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "2100")?.balanceUsdc).toBe(-usd(4970));
    expect(db.select().from(purchaseOrders).get()?.status).toBe("pendingBilling");
    releaseReceivedLot(db, {
      externalId: "qc:ASC-261116-01",
      poTranId: "PO-1042",
      lotNumber: "ASC-261116-01",
      tranDate: "2026-11-16",
      userId: kevin,
      at: AT,
    });
    const good = db
      .select()
      .from(inventoryBalances)
      .all()
      .filter((b) => b.quantityOnHandBase > 0);
    expect(good).toEqual([
      expect.objectContaining({ inventoryStatus: "good", quantityOnHandBase: 700 * KG }),
    ]);
  });

  it("returns a rejected lot to the vendor and reverses the receipt", () => {
    po1042();
    receive1042();
    returnReceivedLot(db, {
      externalId: "qc:ASC-261116-01",
      poTranId: "PO-1042",
      lotNumber: "ASC-261116-01",
      tranDate: "2026-11-16",
      reason: "Assay below spec",
      userId: kevin,
      at: AT,
    });
    expect(
      db
        .select()
        .from(inventoryBalances)
        .all()
        .every((b) => b.quantityOnHandBase === 0 && b.valueUsdc === 0),
    ).toBe(true);
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "2100")?.balanceUsdc).toBe(0);
    expect(tb.rows.find((r) => r.acctNumber === "1400")?.balanceUsdc).toBe(0);
    expect(db.select().from(purchaseOrderLines).get()?.quantityReceivedBase).toBe(0);
    expect(db.select().from(purchaseOrders).get()?.status).toBe("pendingReceipt");
  });

  it("will not receive against a PO the matrix has not approved", () => {
    po1042({ verdict: "awaitingApproval", fundingTx: null, approvalTx: null });
    expect(() => receive1042()).toThrow(/pendingApproval/);
  });
});

describe("vendor bills", () => {
  it("matches Northgate's bill, auto-approves it and posts it", () => {
    po1042();
    receive1042();
    const bill = bill1042();
    expect(bill).toMatchObject({
      created: true,
      matchStatus: "matched",
      approvalStatus: "approved",
      status: "open",
      exceptions: [],
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "2000")?.balanceUsdc).toBe(-usd(5150));
    expect(tb.rows.find((r) => r.acctNumber === "2100")?.balanceUsdc).toBe(0);
    expect(tb.rows.find((r) => r.acctNumber === "5200")?.balanceUsdc).toBe(usd(180));
    expect(db.select().from(purchaseOrders).get()?.status).toBe("fullyBilled");
    expect(approvedBillFor(db, "PO-1042")?.tranId).toBe("NG-INV-24190");
    expect(bill1042()).toMatchObject({ id: bill.id, created: false });
  });

  it("holds an inflated bill for Marcy without posting it, and she decides with a reason", () => {
    po1042();
    receive1042();
    const bill = bill1042({
      totalUsdc: usd(5745),
      lines: [{ itemCode: "ASC", quantityBase: 700 * KG, rateUsdc: usd(7.95) }],
    });
    expect(bill).toMatchObject({
      matchStatus: "exception",
      approvalStatus: "pendingApproval",
      status: "open",
    });
    expect(bill.exceptions.map((e) => e.code)).toEqual(["AMT_VS_PO"]);
    expect(trialBalance(db).rows.find((r) => r.acctNumber === "2000")?.balanceUsdc).toBe(0);
    expect(approvedBillFor(db, "PO-1042")).toBeNull();
    expect(() =>
      decideVendorBill(db, {
        billId: bill.id,
        decision: "approve",
        note: "",
        userId: marcy,
        at: AT,
      }),
    ).toThrow(/reason/);
    expect(() =>
      decideVendorBill(db, {
        billId: bill.id,
        decision: "approve",
        note: "ok",
        userId: kevin,
        at: AT,
      }),
    ).toThrow(/Only the AP manager/);
    const rejected = decideVendorBill(db, {
      billId: bill.id,
      decision: "reject",
      note: "Billed $7.95/kg against the agreed $7.10; asked Northgate for a corrected invoice.",
      userId: marcy,
      at: AT,
    });
    expect(rejected).toMatchObject({ approvalStatus: "rejected", status: "rejected" });
    expect(trialBalance(db).rows.find((r) => r.acctNumber === "2000")?.balanceUsdc).toBe(0);
  });

  it("rejects a duplicate by normalized number and by PO plus amount, and never lets it be approved", () => {
    po1042();
    receive1042();
    bill1042();
    const reissued = bill1042({
      tranId: "NG-INV-24190-R",
      tranDate: "2026-11-23",
      memo: "Reissued",
    });
    expect(reissued).toMatchObject({
      matchStatus: "duplicate",
      approvalStatus: "rejected",
      status: "rejected",
      duplicateOf: "NG-INV-24190",
    });
    expect(reissued.exceptions[0]?.message).toContain("same invoice number as NG-INV-24190");
    const sameAmount = bill1042({ tranId: "NG-INV-24411", tranDate: "2026-12-01" });
    expect(sameAmount).toMatchObject({ matchStatus: "duplicate", duplicateOf: "NG-INV-24190" });
    expect(sameAmount.exceptions[0]?.message).toContain("$5,150.00");
    expect(() =>
      decideVendorBill(db, {
        billId: reissued.id,
        decision: "approve",
        note: "really",
        userId: jordan,
        at: AT,
      }),
    ).toThrow(/duplicate/);
    expect(
      db
        .select()
        .from(vendorBills)
        .all()
        .filter((b) => b.journalId !== null),
    ).toHaveLength(1);
  });

  it("notes price drift over 10% against the vendor's last approved bill without holding the bill", () => {
    upsertPurchaseOrder(db, {
      tranId: "PO-1035",
      vendorCode: "PEC",
      locationCode: "B",
      tranDate: "2026-09-24",
      lines: [{ itemCode: "MGS", quantityBase: 50 * KG, rateUsdc: usd(8.2) }],
      verdict: "paid",
      fundingTx: "check",
      userId: kevin,
      at: AT,
    });
    postItemReceipt(db, {
      externalId: "RCV-PO-1035",
      poTranId: "PO-1035",
      tranDate: "2026-10-01",
      lines: [{ poLine: 1, quantityBase: 50 * KG, lotNumber: "MGS-261001-01" }],
      userId: kevin,
      at: AT,
    });
    createVendorBill(db, {
      tranId: "PEC-55120",
      vendorCode: "PEC",
      poTranId: "PO-1035",
      tranDate: "2026-10-02",
      totalUsdc: usd(410),
      lines: [{ itemCode: "MGS", quantityBase: 50 * KG, rateUsdc: usd(8.2) }],
      userId: kevin,
      at: AT,
    });
    upsertPurchaseOrder(db, {
      tranId: "PO-1040",
      vendorCode: "PEC",
      locationCode: "B",
      tranDate: "2026-10-15",
      lines: [{ itemCode: "MGS", quantityBase: 50 * KG, rateUsdc: usd(9.35) }],
      verdict: "paid",
      fundingTx: "check",
      userId: kevin,
      at: AT,
    });
    postItemReceipt(db, {
      externalId: "RCV-PO-1040",
      poTranId: "PO-1040",
      tranDate: "2026-10-21",
      lines: [{ poLine: 1, quantityBase: 50 * KG, lotNumber: "MGS-261021-01" }],
      userId: kevin,
      at: AT,
    });
    const drift = createVendorBill(db, {
      tranId: "PEC-55388",
      vendorCode: "PEC",
      poTranId: "PO-1040",
      tranDate: "2026-10-22",
      totalUsdc: usd(467.5),
      lines: [{ itemCode: "MGS", quantityBase: 50 * KG, rateUsdc: usd(9.35) }],
      userId: kevin,
      at: AT,
    });
    expect(drift).toMatchObject({ matchStatus: "matched", approvalStatus: "approved" });
    expect(drift.priceDrift).toEqual([
      {
        itemCode: "MGS",
        rateUsdc: usd(9.35),
        lastRateUsdc: usd(8.2),
        lastInvoice: "PEC-55120",
        driftBp: 1402,
      },
    ]);
  });

  it("refuses a bill from a blocked vendor", () => {
    expect(() =>
      createVendorBill(db, {
        tranId: "QC-1",
        vendorCode: "QCD",
        poTranId: null,
        tranDate: "2026-11-01",
        totalUsdc: usd(10),
        lines: [{ itemCode: "ASC", quantityBase: KG, rateUsdc: usd(10) }],
        userId: kevin,
        at: AT,
      }),
    ).toThrow(/blocked/);
  });
});

describe("vendor payments", () => {
  it("applies the escrow release to the approved bill and clears AP", () => {
    po1042();
    receive1042();
    bill1042();
    const payment = createVendorPayment(db, {
      externalId: "14QHzV9P",
      vendorCode: "NGI",
      tranDate: "2026-11-16",
      amountUsdc: usd(5150),
      paymentMethod: "escrowRelease",
      applyTo: { poTranId: "PO-1042" },
      nearTx: "14QHzV9P",
      explorerUrl: "https://testnet.nearblocks.io/txns/14QHzV9P",
      userId: kevin,
      at: AT,
    });
    expect(payment).toMatchObject({
      tranId: "VP-1",
      created: true,
      appliedTo: "NG-INV-24190",
      prepayment: false,
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "2000")?.balanceUsdc).toBe(0);
    expect(tb.rows.find((r) => r.acctNumber === "1050")?.balanceUsdc).toBe(usd(25_000) - usd(5150));
    expect(db.select().from(vendorBills).get()?.status).toBe("paidInFull");
    expect(
      createVendorPayment(db, {
        externalId: "14QHzV9P",
        vendorCode: "NGI",
        tranDate: "2026-11-16",
        amountUsdc: usd(5150),
        paymentMethod: "escrowRelease",
        applyTo: { poTranId: "PO-1042" },
        userId: kevin,
        at: AT,
      }),
    ).toMatchObject({ id: payment.id, created: false });
  });

  it("holds a payment on account when the bill is not approved, and says why", () => {
    po1042();
    receive1042();
    bill1042({
      totalUsdc: usd(5745),
      lines: [{ itemCode: "ASC", quantityBase: 700 * KG, rateUsdc: usd(7.95) }],
    });
    const payment = createVendorPayment(db, {
      externalId: "tx1",
      vendorCode: "NGI",
      tranDate: "2026-11-16",
      amountUsdc: usd(5150),
      paymentMethod: "escrowRelease",
      applyTo: { poTranId: "PO-1042" },
      userId: kevin,
      at: AT,
    });
    expect(payment).toMatchObject({ prepayment: true, appliedTo: null });
    expect(payment.reason).toContain("pendingApproval (match exception)");
    expect(trialBalance(db).balanced).toBe(true);
    expect(
      formatUsd(trialBalance(db).rows.find((r) => r.acctNumber === "2000")?.balanceUsdc ?? 0),
    ).toBe("$5,150.00");
  });
});
