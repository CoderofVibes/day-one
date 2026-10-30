import { beforeAll, describe, expect, it } from "vitest";
import { seedLedger } from "../seed/index.ts";
import { type Ledger, openLedger } from "./db.ts";
import { batchRecordViews, lotViews, purchaseOrderViews, rfqViews } from "./views.ts";

const NOW = "2026-11-16T08:05:00.000Z";

let db: Ledger;
beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the page reads (docs/VISION.md §6.6)", () => {
  it("lists every purchase order newest first, with its lines, receipt and QC decision", () => {
    const pos = purchaseOrderViews(db);
    expect(pos).toHaveLength(34);
    expect(pos.every((p) => p.status === "paid" && p.date !== null)).toBe(true);
    const dates = pos.map((p) => p.date ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
    const two = pos.find((p) => p.poNo === "PO-1039");
    expect(two?.lines.map((l) => l.material)).toEqual(["CAC", "MGO"]);
    expect(two?.lines.reduce((s, l) => s + l.extendedUsdc, 0)).toBe(two?.totalUsdc);
    expect(two?.receipt).toMatchObject({ match: "matched", by: "Tommy Reyes" });
    expect(two?.qc).toMatchObject({ decision: "released", by: "Priya Natarajan" });
    expect(purchaseOrderViews(db, "B").every((p) => p.facility === "B")).toBe(true);
  });

  it("has no requests for quotes before the run asks for any", () => {
    expect(rfqViews(db)).toEqual([]);
  });

  it("lists the lots a plant holds, each with its state and days since it last moved", () => {
    const lots = lotViews(db, "B", NOW);
    expect(lots.length).toBeGreaterThan(0);
    const live = new Set(["on_order", "en_route", "received", "quarantine", "released", "in_use"]);
    expect(lots.every((l) => l.facility === "B" && live.has(l.state))).toBe(true);
    expect(lots.filter((l) => l.state === "quarantine")).toHaveLength(1);
    for (const l of lots.filter((x) => x.state === "released")) {
      expect(l.onHandBase, l.lotCode).toBeGreaterThan(0);
      expect(l.daysInState, l.lotCode).toBeGreaterThanOrEqual(0);
    }
  });

  it("lists a plant's batch records newest first, with yield against the product's expected", () => {
    const batches = batchRecordViews(db, "B");
    expect(batches).toHaveLength(45);
    expect(batches.every((b) => b.facility === "B" && b.status === "confirmed")).toBe(true);
    const done = batches.map((b) => b.completedAt ?? "");
    expect([...done].sort().reverse()).toEqual(done);
    expect(batches[0]).toMatchObject({ batchNo: "BP-B-0509", expectedYieldBp: 9000 });
  });
});
