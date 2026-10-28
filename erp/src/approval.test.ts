import { beforeEach, describe, expect, it } from "vitest";
import { evaluatePurchaseOrder, evaluateVendorBill } from "./approval.ts";
import { type Erp, openErp } from "./db.ts";
import { usd } from "./money.ts";
import { seedErp } from "./seed/index.ts";

let db: Erp;
beforeEach(() => {
  db = openErp();
  seedErp(db);
});

describe("the approval matrix for purchase orders", () => {
  it("records the contract's verdict as the approval, never a limit of its own", () => {
    const funded = evaluatePurchaseOrder(db, {
      totalUsdc: usd(612),
      vendorStatus: "approved",
      verdict: "funded",
      fundingTx: "DYHs",
    });
    expect(funded).toMatchObject({ approvalStatus: "approved", ruleNo: 4, requiredRole: null });
    expect(funded.note).toContain("tx DYHs");
    // $5,150 is over Kevin's $2,500 contract limit; the ERP does not know or care, it records
    // the director's on-chain approval when the verdict carries it.
    const waiting = evaluatePurchaseOrder(db, {
      totalUsdc: usd(5150),
      vendorStatus: "approved",
      verdict: "awaitingApproval",
      reason:
        "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.",
    });
    expect(waiting.approvalStatus).toBe("pendingApproval");
    const approved = evaluatePurchaseOrder(db, {
      totalUsdc: usd(5150),
      vendorStatus: "approved",
      verdict: "funded",
      fundingTx: "B3Hn",
      approvalTx: "3pC5",
      approvedBy: "director.plant-b.acme-holdings.testnet",
    });
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.note).toContain("director.plant-b.acme-holdings.testnet");
    const refused = evaluatePurchaseOrder(db, {
      totalUsdc: usd(1000),
      vendorStatus: "approved",
      verdict: "refused",
      reason: "harrow-chemical.testnet is not an approved supplier; no approval can override this.",
    });
    expect(refused.approvalStatus).toBe("rejected");
    expect(refused.note).toContain("not an approved supplier");
  });

  it("adds the HQ controller over $25,000 and for vendors on hold, and rejects blocked vendors", () => {
    const big = evaluatePurchaseOrder(db, {
      totalUsdc: usd(30_000),
      vendorStatus: "approved",
      verdict: "funded",
      fundingTx: "x",
      approvalTx: "y",
    });
    expect(big).toMatchObject({
      approvalStatus: "pendingApproval",
      ruleNo: 3,
      requiredRole: "controller",
    });
    const signed = evaluatePurchaseOrder(db, {
      totalUsdc: usd(30_000),
      vendorStatus: "approved",
      verdict: "funded",
      fundingTx: "x",
      approvalTx: "y",
      signedByRole: "controller",
    });
    expect(signed.approvalStatus).toBe("approved");
    const hold = evaluatePurchaseOrder(db, {
      totalUsdc: usd(1480),
      vendorStatus: "onHold",
      verdict: "funded",
      fundingTx: "x",
      approvalTx: "y",
    });
    expect(hold).toMatchObject({
      approvalStatus: "pendingApproval",
      ruleNo: 2,
      requiredRole: "controller",
    });
    const blocked = evaluatePurchaseOrder(db, {
      totalUsdc: usd(10),
      vendorStatus: "blocked",
      verdict: "funded",
      fundingTx: "x",
    });
    expect(blocked).toMatchObject({ approvalStatus: "rejected", ruleNo: 1 });
    expect(
      evaluatePurchaseOrder(db, {
        totalUsdc: usd(25_000),
        vendorStatus: "approved",
        verdict: "funded",
        fundingTx: "x",
        approvalTx: "y",
      }).ruleNo,
    ).toBe(4);
  });
});

describe("the approval matrix for vendor bills", () => {
  it("auto-approves a matched bill up to $10,000 and routes the rest to the AP manager", () => {
    expect(evaluateVendorBill(db, { totalUsdc: usd(5150), matchStatus: "matched" })).toMatchObject({
      approvalStatus: "approved",
      ruleNo: 4,
    });
    expect(
      evaluateVendorBill(db, { totalUsdc: usd(10_000), matchStatus: "matched" }).approvalStatus,
    ).toBe("approved");
    expect(
      evaluateVendorBill(db, { totalUsdc: usd(10_000.01), matchStatus: "matched" }),
    ).toMatchObject({ approvalStatus: "pendingApproval", requiredRole: "apManager" });
    expect(evaluateVendorBill(db, { totalUsdc: usd(100), matchStatus: "exception" })).toMatchObject(
      { approvalStatus: "pendingApproval", ruleNo: 2, requiredRole: "apManager" },
    );
    expect(
      evaluateVendorBill(db, {
        totalUsdc: usd(100),
        matchStatus: "exception",
        signedByRole: "apManager",
      }).approvalStatus,
    ).toBe("approved");
    expect(
      evaluateVendorBill(db, { totalUsdc: usd(1150), matchStatus: "duplicate" }),
    ).toMatchObject({ approvalStatus: "rejected", ruleNo: 1 });
    expect(
      evaluateVendorBill(db, {
        totalUsdc: usd(1150),
        matchStatus: "duplicate",
        signedByRole: "apManager",
      }).approvalStatus,
    ).toBe("rejected");
  });
});
