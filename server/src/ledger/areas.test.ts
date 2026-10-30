import { beforeAll, describe, expect, it } from "vitest";
import { EQUIPMENT } from "../seed/equipment.ts";
import { seedLedger } from "../seed/index.ts";
import { areaViews } from "./areas.ts";
import { type Ledger, openLedger } from "./db.ts";
import { DEPARTMENTS } from "./schema.ts";

const NOW = "2026-11-16T08:05:00.000Z";

let db: Ledger;
beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the area sheets (docs/VISION.md §6.5.1)", () => {
  it("has a view for each of the twenty areas, with its equipment", () => {
    const views = areaViews(db, "B", NOW);
    expect(Object.keys(views).sort()).toEqual([...DEPARTMENTS].sort());
    for (const area of DEPARTMENTS) {
      const v = views[area];
      expect(v.sentence.length, area).toBeGreaterThan(0);
      expect(v.events.length, area).toBeLessThanOrEqual(5);
      expect(v.equipment.map((q) => q.id)).toEqual(EQUIPMENT[area].map((q) => q.id));
    }
  });

  it("puts receipts at receiving, QC decisions in the lab, issues in the weigh cells", () => {
    const v = areaViews(db, "B", NOW);
    expect(v.receiving.events.every((e) => /received/.test(e.text))).toBe(true);
    expect(v.qc_lab.events.every((e) => /by QC/.test(e.text))).toBe(true);
    expect(
      v.weigh_cells.events.every((e) => /issued to (B[RCP]-B-\d+|production)/.test(e.text)),
    ).toBe(true);
    expect(v.labeling.events.every((e) => /label/.test(e.text))).toBe(true);
    // Newest first.
    const at = v.weigh_cells.events.map((e) => e.at);
    expect([...at].sort().reverse()).toEqual(at);
  });

  it("holds the quarantined lot in quarantine with its equipment needing attention", () => {
    const v = areaViews(db, "B", NOW);
    expect(v.quarantine.lots.map((l) => l.state)).toEqual(["quarantine"]);
    expect(v.quarantine.sentence).toMatch(/1 lot waiting on QC, the oldest \d+ days\./);
    expect(v.quarantine.equipment[0]?.status).toBe("attention");
    expect(v.rm_storage.lots.every((l) => l.category !== "packaging")).toBe(true);
    expect(v.pkg_storage.lots.every((l) => l.category === "packaging")).toBe(true);
  });

  it("names the last batch on the line and the next one on the schedule", () => {
    const v = areaViews(db, "B", NOW);
    expect(v.tableting.batch?.batchNo).toMatch(/^B[RC]-B-/);
    expect(v.powder_fill.batch?.batchNo).toMatch(/^BP-B-/);
    expect((v.planning.batch?.at ?? "").slice(0, 10) >= NOW.slice(0, 10)).toBe(true);
    expect(v.planning.sentence).toMatch(/^Next on the schedule: /);
  });
});
