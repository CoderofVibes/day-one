import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { seedLedger } from "@day-one/server/seed";
import { beforeEach, describe, expect, it } from "vitest";
import { massBalance } from "./massBalance.ts";
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
    expect(cmdB).toMatchObject({ batches: 1, unaccountedBase: 0, flagged: false });
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
