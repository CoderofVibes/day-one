import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { seedLedger } from "@day-one/server/seed";
import { beforeAll, describe, expect, it } from "vitest";
import { plantForecast, plantSchedule } from "./schedule.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KG = 1_000_000;

let db: Ledger;
beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the plant's schedule (docs/VISION.md §6.6)", () => {
  it("lays out Hollow Pine's next two weeks with what each batch draws and what it costs", () => {
    const s = plantSchedule(db, { facility: "B", now: NOW, days: 14 });
    expect(s.batches.map((b) => `${b.batchNo} ${b.plannedFor}`)).toEqual([
      "BC-B-0310 2026-11-17",
      "BR-B-1047 2026-11-17",
      "BP-B-0510 2026-11-19",
      "BR-B-1048 2026-11-19",
      "BR-B-1049 2026-11-19",
    ]);
    // Before BR-B-1045 is confirmed: 722.350 kg covers the first Vitamin C batch, not both.
    const first = s.batches.find((b) => b.batchNo === "BR-B-1047");
    expect(first?.draws.find((d) => d.material === "ASC")).toMatchObject({
      needBase: 412 * KG,
      afterBase: (722.35 - 412) * KG,
    });
    expect(first?.short).toEqual([]);
    expect(s.batches.find((b) => b.batchNo === "BR-B-1048")?.short).toEqual(["ASC"]);
    // The new products' batches are covered by their own stock (FICTIONAL_DATA §17).
    for (const no of ["BC-B-0310", "BP-B-0510", "BR-B-1049"]) {
      expect(s.batches.find((b) => b.batchNo === no)?.short, no).toEqual([]);
    }
    // Cost at the last price paid. Ascorbic acid at Hollow Pine is opening stock, never bought
    // on a Day One PO before the run, so it has no price on record yet and says so.
    expect(first?.unpriced).toEqual(["ASC"]);
    expect(first?.costUsdc).toBeGreaterThan(0);
    expect(s.costUsdc).toBe(s.batches.reduce((sum, b) => sum + b.costUsdc, 0));
    expect(s.unpriced).toEqual(["ASC"]);
    expect(s.sentence).toBe(
      "5 batches planned at Hollow Pine Tablet Co. from Nov 9 to Nov 23; 1 would run short: BR-B-1048 (ASC).",
    );
  });

  it("says when nothing is planned", () => {
    const s = plantSchedule(db, { facility: "C", now: NOW, days: 14 });
    expect(s.batches).toEqual([]);
    expect(s.sentence).toBe("Nothing planned at Acme Lakeview from Nov 9 to Nov 23.");
  });
});

describe("the plant's forecast", () => {
  it("puts ascorbic acid first and recommends the lab chemicals and packaging the brief names", () => {
    const f = plantForecast(db, { facility: "B", now: NOW });
    expect(f[0]).toMatchObject({ material: "ASC", short: true });
    const reorder = f.filter((x) => x.reorder).map((x) => x.material);
    expect(reorder).toEqual(expect.arrayContaining(["ASC", "ACN", "BTL", "CAP"]));
    // Nothing the new products use is short or below its reorder point at the clock.
    for (const code of ["ZNG", "MEL", "PBB", "PSY", "DCP", "BT1", "CP3", "CAN", "HPC"]) {
      const row = f.find((x) => x.material === code);
      expect(row, code).toBeDefined();
      expect(row?.short, code).toBe(false);
      expect(row?.reorder, code).toBe(false);
    }
  });
});
