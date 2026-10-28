import { openErp } from "@day-one/erp/db";
import { createRouter } from "@day-one/erp/http/router";
import { trialBalance } from "@day-one/erp/posting";
import { loadApHistory, seedErp } from "@day-one/erp/seed";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import { facilities, lotBalances, lots, materials } from "../ledger/schema.ts";
import { seedLedger } from "../seed/index.ts";
import { inProcessTransport, MockNetSuiteConnector } from "./mock-netsuite.ts";
import { syncLedgerToErp } from "./sync.ts";

let dayOne: Ledger;
let erpDb: ReturnType<typeof openErp>;
let erp: MockNetSuiteConnector;

beforeEach(() => {
  dayOne = openLedger();
  seedLedger(dayOne);
  erpDb = openErp();
  seedErp(erpDb);
  const handle = createRouter(erpDb, { now: () => "2026-11-09T12:00:00.000Z" });
  erp = new MockNetSuiteConnector(inProcessTransport(handle, "demo-token-kevin"));
});

/** Day One's on-hand quantity per material and facility: the sum of its lot balances. */
function dayOneBalances() {
  const rows = dayOne
    .select({ material: materials.code, facility: facilities.code, qty: lotBalances.onHandBase })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .innerJoin(facilities, eq(facilities.id, lotBalances.facilityId))
    .all();
  const out = new Map<string, number>();
  for (const r of rows)
    out.set(`${r.material}@${r.facility}`, (out.get(`${r.material}@${r.facility}`) ?? 0) + r.qty);
  return out;
}

describe("the cutover sync", () => {
  it("mirrors the history and derives ERP balances that equal Day One's, lot by lot", async () => {
    const summary = await syncLedgerToErp(dayOne, erp);
    expect(summary.purchaseOrders).toBe(6);
    expect(summary.receipts).toBe(6);
    expect(summary.transfers).toBe(5);
    expect(summary.productionIssues).toBe(9); // 8 history batches + Plant A's dispensing draw
    expect(summary.alreadyThere).toBe(0);

    const expected = dayOneBalances();
    const actual = new Map<string, number>();
    for (const b of await erp.getInventory()) {
      const key = `${b.materialCode}@${b.facilityCode}`;
      actual.set(key, (actual.get(key) ?? 0) + b.qtyBase);
    }
    for (const [key, qty] of expected) expect(actual.get(key) ?? 0, key).toBe(qty);
    for (const [key, qty] of actual) if (qty !== 0) expect(expected.get(key) ?? 0, key).toBe(qty);

    // Plant B's ascorbic acid before BR-B-1045: 722.350 kg, all released (FICTIONAL_DATA §6).
    const ascB = (await erp.getInventory({ facilityCode: "B", materialCode: "ASC" })).filter(
      (b) => b.qtyBase !== 0,
    );
    expect(ascB).toEqual([expect.objectContaining({ status: "good", qtyBase: 722_350_000 })]);
    // One MGS lot waits for QC in quarantine (§6).
    const mgsB = await erp.getInventory({ facilityCode: "B", materialCode: "MGS" });
    expect(mgsB.find((b) => b.status === "quarantine")?.qtyBase).toBe(50_000_000);
    // Plant A still books the phantom 12.550 kg of ASC-261009-01 (§8): the ERP mirrors the books.
    const ascA = await erp.getInventory({ facilityCode: "A", materialCode: "ASC" });
    expect(ascA.reduce((s, b) => s + b.qtyBase, 0)).toBe(12_550_000);

    const tb = trialBalance(erpDb);
    expect(tb.balanced).toBe(true);
    const inventoryValue = tb.rows
      .filter((r) => r.acctNumber.startsWith("14"))
      .reduce((s, r) => s + r.balanceUsdc, 0);
    // The balances view is exact in micro-dollars; the API rounds each row to cents.
    const view = erpDb.$client
      .prepare("select coalesce(sum(value_usdc), 0) as v from inventory_balances")
      .get() as { v: number };
    expect(inventoryValue).toBe(view.v);
    const erpValue = (await erp.getInventory()).reduce((s, b) => s + b.valueUsdc, 0);
    expect(Math.abs(inventoryValue - erpValue)).toBeLessThan(10_000 * 40);
  });

  it("changes nothing when run again", async () => {
    const first = await syncLedgerToErp(dayOne, erp);
    const again = await syncLedgerToErp(dayOne, erp);
    expect(
      again.purchaseOrders +
        again.receipts +
        again.transfers +
        again.productionIssues +
        again.adjustments +
        again.qcDecisions,
    ).toBe(0);
    expect(again.alreadyThere).toBe(
      first.purchaseOrders +
        first.receipts +
        first.transfers +
        first.productionIssues +
        first.adjustments +
        first.qcDecisions,
    );
    expect(trialBalance(erpDb).balanced).toBe(true);
  });

  it("matches the migrated AP history against the synced POs and receipts", async () => {
    await syncLedgerToErp(dayOne, erp);
    const history = loadApHistory(erpDb);
    const by = Object.fromEntries(history.bills.map((b) => [b.invoiceNo, b]));
    for (const inv of [
      "PEC-55120",
      "FP-2026-0912",
      "LP-88231",
      "OFH-3317",
      "SMS-10442",
      "PEC-55388",
    ]) {
      expect(by[inv], inv).toMatchObject({ matchStatus: "matched", approvalStatus: "approved" });
    }
    expect(by["OFH-3317-R"]).toMatchObject({
      matchStatus: "duplicate",
      approvalStatus: "rejected",
      duplicateOf: "OFH-3317",
    });
    expect(by["PEC-55388"]?.priceDrift).toBe(1402);
    expect(
      history.checks.every((c) => c.appliedTo === c.checkNo.replace(/.*/, c.appliedTo ?? "")),
    ).toBe(true);
    expect(history.checks.map((c) => c.appliedTo)).toEqual([
      "PEC-55120",
      "FP-2026-0912",
      "LP-88231",
      "OFH-3317",
      "SMS-10442",
      "PEC-55388",
    ]);
    const tb = trialBalance(erpDb);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "2000")?.balanceUsdc).toBe(0);
    expect(tb.rows.find((r) => r.acctNumber === "2100")?.balanceUsdc).toBe(0);
    expect(tb.rows.find((r) => r.acctNumber === "1000")?.balanceUsdc).toBe(
      -(25_000 + 9_632.5) * 1_000_000,
    );
  });
});

describe("the connector's payee check", () => {
  it("accepts only an approved vendor paid to its verified account", async () => {
    expect(
      (await erp.verifyPayee({ vendorCode: "NGI", account: "northgate-ingredients.testnet" })).code,
    ).toBe("OK");
    expect(
      (await erp.verifyPayee({ vendorCode: "NGI", account: "northgate-lngredients.testnet" })).code,
    ).toBe("PAYOUT_ACCOUNT_MISMATCH");
    expect(
      (await erp.verifyPayee({ vendorCode: "QCD", account: "quickchem-direct.testnet" })).code,
    ).toBe("VENDOR_NOT_APPROVED");
    expect((await erp.verifyPayee({ vendorCode: "DDN", account: null })).code).toBe(
      "VENDOR_NOT_APPROVED",
    );
    expect((await erp.verifyPayee({ vendorCode: "SMS", account: null })).code).toBe(
      "NO_PAYOUT_ACCOUNT",
    );
    const ghost = await erp.verifyPayee({ vendorCode: "HRW", account: "harrow-chemical.testnet" });
    expect(ghost).toMatchObject({ ok: false, code: "VENDOR_NOT_IN_MASTER", vendor: null });
    expect((await erp.listVendors({ status: "approved" })).map((v) => v.code)).not.toContain("QCD");
  });
});
