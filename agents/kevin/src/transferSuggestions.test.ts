import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { verifyChain } from "@day-one/server/ledger/events";
import {
  facilities,
  lotBalances,
  lotEvents,
  lots,
  materials,
  staff,
  transferDismissals,
  transfers,
} from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkTransfers } from "./discrepancies.ts";
import { projectMaterial } from "./forecast.ts";
import {
  approveTransfer,
  dismissTransfer,
  receiveTransfer,
  suggestTransfers,
  transfersInTransit,
} from "./transferSuggestions.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KG = 1_000_000;

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

const bottles = () => suggestTransfers(db, { now: NOW, material: "BTL" });

describe("transfer suggestions", () => {
  it("proposes Lakeview's spare bottles to Hollow Pine before a reorder", () => {
    const [s, ...rest] = bottles();
    expect(rest).toEqual([]);
    // Hollow Pine holds 24,000 against a reorder point of 40,000; Lakeview holds 136,000.
    expect(s).toMatchObject({
      from: "C",
      to: "B",
      qtyBase: 16_000,
      shortBase: 16_000,
      surplusBase: 96_000,
      avoidedOrderBase: 100_000,
      lots: [{ lotCode: "BTL-260905-01", qtyBase: 16_000 }],
      // PO-1037 paid $2,100.00 for 100,000 bottles.
      valueUsdc: 336 * 1_000_000,
    });
    expect(s?.sentence).toBe(
      "Before you buy: Acme Lakeview has 96,000 of 150 cc HDPE bottle (BTL) above its own need and reorder point. " +
        "Moving 16,000 (BTL-260905-01) to Hollow Pine Tablet Co. keeps it at its reorder point instead of ordering 100,000. " +
        "That is about $336.00 of stock at the last price paid.",
    );
  });

  it("proposes nothing for ascorbic acid: Riverside's 12.55 kg is below its own reorder point", () => {
    expect(suggestTransfers(db, { now: NOW, material: "ASC" })).toEqual([]);
  });

  it("never moves more than the surplus above the sender's need and reorder point", () => {
    // Riverside lacks about 550 kg of calcium carbonate; Hollow Pine holds 875 kg against 800.
    const [s] = suggestTransfers(db, { now: NOW, material: "CAC" });
    expect(s).toMatchObject({ from: "B", to: "A", qtyBase: 75 * KG, avoidedOrderBase: null });
    expect(s?.sentence).toContain("covers 75 kg of the 550 kg it lacks");
  });

  it("skips a lot that expires inside the horizon", () => {
    db.update(lots).set({ expiresOn: "2026-11-15" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    const [s] = bottles();
    expect(s?.lots).toEqual([{ lotCode: "BTL-261007-01", qtyBase: 16_000, expiresOn: null }]);
  });

  it("takes the earliest-expiring lot first", () => {
    db.update(lots).set({ expiresOn: "2027-06-30" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    db.update(lots).set({ expiresOn: "2027-03-31" }).where(eq(lots.lotCode, "BTL-261007-01")).run();
    expect(bottles()[0]?.lots.map((l) => l.lotCode)).toEqual(["BTL-261007-01"]);
  });

  it("never moves quarantined stock", () => {
    db.update(lots).set({ state: "quarantine" }).where(eq(lots.lotCode, "BTL-261007-01")).run();
    db.update(lots).set({ state: "quarantine" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    expect(bottles()).toEqual([]);
  });

  it("matches the seeded ASC-261009-01 discrepancy as before", () => {
    expect(checkTransfers(db, { now: NOW })).toHaveLength(1);
  });

  it("writes no forecast rows", () => {
    const count = () =>
      db.$client.prepare("select count(*) as n from forecasts").get() as { n: number };
    const before = count().n;
    suggestTransfers(db, { now: NOW });
    expect(count().n).toBe(before);
  });
});

describe("approving, receiving and dismissing a transfer", () => {
  const jordan = () => {
    const row = db.select().from(staff).where(eq(staff.name, "Jordan Pike")).get();
    if (!row) throw new Error("no Jordan Pike in the seed");
    return row.id;
  };
  const plant = (code: string) => {
    const row = db.select().from(facilities).where(eq(facilities.code, code)).get();
    if (!row) throw new Error(`no plant ${code}`);
    return row.id;
  };
  const balance = (lotCode: string, code: string) => {
    const lot = db.select().from(lots).where(eq(lots.lotCode, lotCode)).get();
    return (
      db
        .select()
        .from(lotBalances)
        .where(and(eq(lotBalances.lotId, lot?.id ?? 0), eq(lotBalances.facilityId, plant(code))))
        .get()?.onHandBase ?? 0
    );
  };
  const btlAtB = () => projectMaterial(db, { facility: "B", material: "BTL", now: NOW });

  it("books the lot out of Lakeview, counts it on order at Hollow Pine, and stops proposing it", () => {
    const before = btlAtB();
    expect(before.recommendQtyBase).toBe(100_000);
    const out = approveTransfer(db, "BTL:C-B", { staffId: jordan(), now: NOW });
    expect(out.transfers).toEqual([
      { transferNo: "TR-C-B-261109", lotCode: "BTL-260905-01", qtyBase: 16_000 },
    ]);
    expect(out.sentence).toBe(
      "Approved: 16,000 of 150 cc HDPE bottle leaves Acme Lakeview for Hollow Pine Tablet Co. " +
        "(TR-C-B-261109). Hollow Pine Tablet Co.'s forecast counts it as on order until it is received.",
    );
    const t = db.select().from(transfers).where(eq(transfers.transferNo, "TR-C-B-261109")).get();
    expect(t).toMatchObject({ state: "in_transit", qtyShippedBase: 16_000, inEventId: null });
    const event = db
      .select()
      .from(lotEvents)
      .where(eq(lotEvents.id, t?.outEventId ?? 0))
      .get();
    expect(event).toMatchObject({
      kind: "transfer_out",
      qtyDeltaBase: -16_000,
      actorType: "staff",
    });
    // The covered quantity is no longer drafted as a purchase.
    const after = btlAtB();
    expect(after.onOrderBase - before.onOrderBase).toBe(16_000);
    expect(after.recommendQtyBase).toBeNull();
    expect(bottles()).toEqual([]);
    expect(transfersInTransit(db)).toMatchObject([
      { transferNo: "TR-C-B-261109", from: "C", to: "B", qtyBase: 16_000 },
    ]);
    expect(verifyChain(db).ok).toBe(true);
  });

  it("receives the transfer in full with no discrepancy, and the stock is usable at Hollow Pine", () => {
    const before = balance("BTL-260905-01", "B");
    approveTransfer(db, "BTL:C-B", { staffId: jordan(), now: NOW });
    const got = receiveTransfer(db, "TR-C-B-261109", { staffId: jordan(), now: NOW });
    expect(got).toEqual({
      transferNo: "TR-C-B-261109",
      receivedBase: 16_000,
      discrepancies: [],
      sentence: "TR-C-B-261109: 16,000 of 150 cc HDPE bottle received; the counts agree.",
    });
    expect(balance("BTL-260905-01", "B") - before).toBe(16_000);
    expect(btlAtB().recommendQtyBase).toBeNull();
    expect(transfersInTransit(db)).toEqual([]);
    expect(() => receiveTransfer(db, "TR-C-B-261109", { staffId: jordan(), now: NOW })).toThrow(
      "is received",
    );
  });

  it("raises the usual discrepancy when the count comes in short", () => {
    approveTransfer(db, "BTL:C-B", { staffId: jordan(), now: NOW });
    const got = receiveTransfer(db, "TR-C-B-261109", {
      staffId: jordan(),
      now: NOW,
      receivedBase: 15_000,
    });
    expect(got.discrepancies).toHaveLength(1);
    expect(got.discrepancies[0]).toMatchObject({ shippedBase: 16_000, receivedBase: 15_000 });
  });

  it("does not propose a dismissed move again while the shortfall stays the same", () => {
    const out = dismissTransfer(db, "BTL:C-B", { staffId: jordan(), now: NOW });
    expect(out.sentence).toBe(
      "Dismissed: no move of 150 cc HDPE bottle to Hollow Pine Tablet Co.; Kevin asks again only if its shortfall changes.",
    );
    expect(bottles()).toEqual([]);
    expect(() => approveTransfer(db, "BTL:C-B", { staffId: jordan(), now: NOW })).toThrow(
      "no transfer proposal BTL:C-B right now",
    );
    // A different shortfall is a new question.
    db.delete(transferDismissals).run();
    db.insert(transferDismissals)
      .values({
        materialId: db.select().from(materials).where(eq(materials.code, "BTL")).get()?.id ?? 0,
        fromFacilityId: plant("C"),
        toFacilityId: plant("B"),
        shortBase: 1,
        dismissedAt: NOW,
      })
      .run();
    expect(bottles()).toHaveLength(1);
  });
});
