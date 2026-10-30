import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { plantInventory } from "@day-one/server/ledger/inventory";
import { batchRecords, discrepancies, lotEvents } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { reviewDiscrepancy } from "./discrepancies.ts";
import { massBalance, proposeWasteCorrections } from "./massBalance.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

let db: Ledger;
beforeEach(() => {
  db = openLedger(":memory:");
  seedLedger(db);
});

describe("mass balance (FICTIONAL_DATA §15)", () => {
  it("finds Riverside's unaccounted P-CMD material, batch by batch, to the milligram", () => {
    const { batches } = massBalance(db);
    const riverside = batches.filter((b) => b.facility === "A" && b.product === "P-CMD");
    expect(riverside.map((b) => b.batchNo)).toEqual(["BR-A-2201", "BR-A-2204"]);
    for (const b of riverside) {
      expect(b).toMatchObject({
        issuedBase: 842_502_468,
        tablets: 450_500,
        tabletsBase: 759_092_500,
        qcBase: 500_000,
        wasteBase: 25_310_454,
        unaccountedBase: 57_599_514,
        unaccountedBp: 684,
        unitEffectBase: 2_468,
        flagged: true,
      });
    }
  });

  it("finds Hollow Pine balancing to the gram on the same product, and flags nothing there", () => {
    const { batches, periods } = massBalance(db);
    const hollowPine = batches.filter((b) => b.facility === "B");
    expect(hollowPine.length).toBeGreaterThan(0);
    for (const b of hollowPine) expect(b.unaccountedBase).toBe(0);
    expect(periods.filter((p) => p.flagged).map((p) => [p.facility, p.product])).toEqual([
      ["A", "P-CMD"],
    ]);
    const cmdB = periods.find((p) => p.facility === "B" && p.product === "P-CMD");
    // BR-B-1038 and the two July–August batches of FICTIONAL_DATA §17.
    expect(cmdB).toMatchObject({ batches: 3, unaccountedBase: 0, flagged: false });
  });

  it("sums the period and says in one line that units are not the cause", () => {
    const { periods, sentences } = massBalance(db);
    const cmdA = periods.find((p) => p.facility === "A" && p.product === "P-CMD");
    expect(cmdA).toMatchObject({
      facilityName: "Acme Riverside",
      batches: 2,
      issuedBase: 2 * 842_502_468,
      unaccountedBase: 115_199_028,
      unaccountedBp: 684,
      unitEffectBase: 4_936,
      from: "2026-10-13T18:00:00.000Z",
      to: "2026-10-27T18:00:00.000Z",
    });
    expect(sentences).toEqual([
      "P-CMD at Riverside: 115.2 kg of material issued over two batches is in neither the tablets nor the recorded waste (6.84%). Hollow Pine balances to the gram. Rounding between units explains 0.005 kg of it. Riverside's waste looks under-recorded, which also makes its cost per bottle look lower.",
    ]);
  });

  it("proposes one waste correction per flagged batch for Plant A, never twice", () => {
    expect(massBalance(db).unproposed).toEqual(["BR-A-2201", "BR-A-2204"]);
    const proposed = proposeWasteCorrections(db);
    expect(proposed.map((p) => [p.batchNo, p.facility, p.wasteDeltaBase])).toEqual([
      ["BR-A-2201", "A", 57_599_514],
      ["BR-A-2204", "A", 57_599_514],
    ]);
    expect(proposed[0]?.sentence).toBe(
      "BR-A-2201 at Riverside: 842.5 kg issued, 759.1 kg in tablets, 0.500 kg in QC samples and 25.3 kg written as waste, so 57.6 kg is missing. Proposed for Plant A to review: record it as waste beside the batch record, which stays as written.",
    );
    expect(proposeWasteCorrections(db)).toEqual([]);
    expect(massBalance(db).unproposed).toEqual([]);
    const shown = plantInventory(db).discrepancies.filter((d) => d.batchNo);
    expect(shown.map((d) => [d.batchNo, d.status, d.proposed?.facility])).toEqual([
      ["BR-A-2201", "proposed_adjustment", "A"],
      ["BR-A-2204", "proposed_adjustment", "A"],
    ]);
  });

  it("counts an applied correction as waste, ignores a dismissed one, and leaves the records as written", () => {
    const [first, second] = proposeWasteCorrections(db);
    const events = () => db.select().from(lotEvents).all().length;
    const before = events();
    const reviewer = { staffId: 1, now: "2026-11-09T14:00:00.000Z" };
    expect(reviewDiscrepancy(db, first?.id ?? 0, { ...reviewer, decision: "apply" })).toEqual({
      event: null,
      status: "adjusted",
    });
    reviewDiscrepancy(db, second?.id ?? 0, { ...reviewer, decision: "dismiss" });
    expect(events()).toBe(before);
    expect(() => reviewDiscrepancy(db, first?.id ?? 0, { ...reviewer, decision: "apply" })).toThrow(
      /adjusted, not awaiting review/,
    );

    const { batches, periods, sentences } = massBalance(db);
    expect(batches.find((b) => b.batchNo === "BR-A-2201")).toMatchObject({
      wasteBase: 25_310_454,
      reviewedWasteBase: 57_599_514,
      unaccountedBase: 0,
      flagged: false,
    });
    expect(batches.find((b) => b.batchNo === "BR-A-2204")).toMatchObject({
      reviewedWasteBase: 0,
      flagged: true,
    });
    const record = db
      .select()
      .from(batchRecords)
      .where(eq(batchRecords.batchNo, "BR-A-2201"))
      .get();
    expect(record?.wasteBase).toBe(25_310_454);
    expect(periods.find((p) => p.facility === "A" && p.product === "P-CMD")).toMatchObject({
      reviewedWasteBase: 57_599_514,
      unaccountedBase: 57_599_514,
      unaccountedBp: 342,
      flagged: true,
    });
    expect(sentences.at(-1)).toBe(
      "P-CMD at Riverside: Plant A recorded 57.6 kg more waste on review. The batch records stay as written; the cost per bottle now carries it.",
    );
    const stored = db
      .select()
      .from(discrepancies)
      .where(eq(discrepancies.id, first?.id ?? 0))
      .get();
    expect(JSON.parse(stored?.proposedEventJson ?? "{}")).toMatchObject({
      reviewedBy: 1,
      reviewedAt: reviewer.now,
    });
  });

  it("takes a period and a threshold, and includes records that came in through extraction", () => {
    expect(massBalance(db, { to: "2026-10-20T00:00:00.000Z" }).periods).toEqual(
      expect.arrayContaining([expect.objectContaining({ facility: "A", batches: 1 })]),
    );
    expect(massBalance(db, { thresholdBp: 1_000 }).sentences).toEqual([]);
    confirmBr1045(db);
    const after = massBalance(db);
    const br1045 = after.batches.find((b) => b.batchNo === "BR-B-1045");
    expect(br1045).toBeDefined();
    expect(br1045?.issuedBase).toBeGreaterThan(0);
  });
});
