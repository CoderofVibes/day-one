import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { verifyChain } from "@day-one/server/ledger/events";
import {
  discrepancies,
  facilities,
  lotBalances,
  lotEvents,
  lots,
  staff,
  transfers,
} from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkTransfers, reviewDiscrepancy } from "./discrepancies.ts";
import { confirmBr1045, idOf } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:05:00.000Z";
const KG = 1_000_000;

let db: Ledger;
beforeEach(() => {
  db = openLedger(":memory:");
  seedLedger(db);
});

const plantA = () => idOf(db.select().from(facilities).where(eq(facilities.code, "A")).get());
const ascLot = () => idOf(db.select().from(lots).where(eq(lots.lotCode, "ASC-261009-01")).get());
const bookAtA = () =>
  db
    .select({ base: lotBalances.onHandBase })
    .from(lotBalances)
    .where(and(eq(lotBalances.lotId, ascLot()), eq(lotBalances.facilityId, plantA())))
    .get()?.base ?? 0;

describe("the cross-facility discrepancy (SPEC step 3, FICTIONAL_DATA §8)", () => {
  it("finds the phantom 12.55 kg at Plant A once BR-B-1045 has consumed the lot", () => {
    confirmBr1045(db);
    const found = checkTransfers(db, { now: NOW });
    expect(found).toHaveLength(1);
    const d = found[0];
    expect(d).toMatchObject({
      transferNo: "TR-A-B-261102",
      lotCode: "ASC-261009-01",
      material: "ASC",
      shippedBase: 200 * KG,
      receivedBase: 187.45 * KG,
      sourceBookBase: 12.55 * KG,
    });
    expect(d?.sentence).toBe(
      "Plant A still shows 12.55 kg of lot ASC-261009-01, but Plant B weighed in 187.45 kg of the 200 kg sent. Proposed adjustment sent to Plant A for review.",
    );
    expect(d?.proposed).toMatchObject({
      kind: "count_adjust",
      qtyDeltaBase: -12.55 * KG,
      facilityId: plantA(),
      actorType: "kevin",
    });
    const row = db.select().from(discrepancies).where(eq(discrepancies.lotId, ascLot())).get();
    expect(row).toMatchObject({
      kind: "transfer_qty",
      status: "proposed_adjustment",
      detectedBy: "kevin",
      expectedBase: 200 * KG,
      observedBase: 187.45 * KG,
    });
    expect(
      db.select({ s: transfers.state }).from(transfers).where(eq(transfers.lotId, ascLot())).get()
        ?.s,
    ).toBe("discrepancy");
    // The books are untouched until Plant A reviews it.
    expect(bookAtA()).toBe(12.55 * KG);
  });

  it("raises each discrepancy once and leaves the Plant C transfers alone", () => {
    confirmBr1045(db);
    expect(checkTransfers(db, { now: NOW })).toHaveLength(1);
    expect(checkTransfers(db, { now: NOW })).toHaveLength(0);
    expect(db.select().from(discrepancies).all()).toHaveLength(1);
    const fromC = db
      .select({ state: transfers.state })
      .from(transfers)
      .innerJoin(facilities, eq(facilities.id, transfers.fromFacilityId))
      .where(eq(facilities.code, "C"))
      .all();
    expect(fromC.map((t) => t.state)).toEqual(["received", "received", "received", "received"]);
  });

  // The fiction has no Plant A persona (FICTIONAL_DATA §2); HQ's integration lead reviews.
  it("applies the adjustment as the reviewer: Plant A's book goes to zero on an intact chain", () => {
    confirmBr1045(db);
    const [d] = checkTransfers(db, { now: NOW });
    const reviewer = idOf(db.select().from(staff).where(eq(staff.name, "Jordan Pike")).get());
    const result = reviewDiscrepancy(db, d?.id ?? 0, {
      staffId: reviewer,
      decision: "apply",
      now: "2026-11-09T15:00:00.000Z",
    });
    expect(result.status).toBe("adjusted");
    expect(result.event).toMatchObject({
      kind: "count_adjust",
      qtyDeltaBase: -12.55 * KG,
      actorType: "staff",
      actorId: reviewer,
      refType: "transfer",
    });
    expect(bookAtA()).toBe(0);
    expect(verifyChain(db)).toEqual({ ok: true });
    expect(db.select().from(discrepancies).get()?.status).toBe("adjusted");
    expect(db.select().from(transfers).where(eq(transfers.lotId, ascLot())).get()?.state).toBe(
      "resolved",
    );
    expect(() =>
      reviewDiscrepancy(db, d?.id ?? 0, { staffId: reviewer, decision: "apply", now: NOW }),
    ).toThrow(/not awaiting review/);
  });

  it("dismissing keeps the books and posts no event", () => {
    confirmBr1045(db);
    const [d] = checkTransfers(db, { now: NOW });
    const before = db.select().from(lotEvents).all().length;
    const reviewer = idOf(db.select().from(staff).where(eq(staff.name, "Jordan Pike")).get());
    const result = reviewDiscrepancy(db, d?.id ?? 0, {
      staffId: reviewer,
      decision: "dismiss",
      now: NOW,
    });
    expect(result).toEqual({ event: null, status: "dismissed" });
    expect(db.select().from(lotEvents).all().length).toBe(before);
    expect(bookAtA()).toBe(12.55 * KG);
  });
});
