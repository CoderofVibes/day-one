// The longer past (production.ts) must not move anything the hand-written seed and the recorded
// run depend on. These tests hold each promise its header makes.

import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import {
  batchInputs,
  batchRecords,
  departments,
  facilities,
  lotBalances,
  lots,
  materials,
  productionPlan,
  purchaseOrders,
} from "../ledger/schema.ts";
import { HISTORY_BATCHES, PLANNED_BATCHES } from "./history.ts";
import { seedLedger } from "./index.ts";
import { LOTS } from "./lots.ts";
import { productionHistory } from "./production.ts";
import { MATERIALS, PRODUCTS } from "./reference.ts";

let db: Ledger;
const generated = productionHistory(new Set(LOTS.map((l) => l.code)));
const generatedCodes = new Set(generated.lots.map((l) => l.code));

beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

function onHand(lotCodes: string[], material: string, facility: string) {
  if (lotCodes.length === 0) return 0;
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${lotBalances.onHandBase}), 0)` })
      .from(lotBalances)
      .innerJoin(lots, eq(lots.id, lotBalances.lotId))
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .innerJoin(facilities, eq(facilities.id, lotBalances.facilityId))
      .where(
        and(
          inArray(lots.lotCode, lotCodes),
          eq(materials.code, material),
          eq(facilities.code, facility),
        ),
      )
      .get()?.total ?? 0
  );
}

describe("the catalogue (docs/VISION.md §6.12)", () => {
  it("has ten products, 54 materials and twenty areas at Hollow Pine", () => {
    expect(PRODUCTS).toHaveLength(10);
    expect(MATERIALS).toHaveLength(54);
    const b = db
      .select({ code: departments.code })
      .from(departments)
      .innerJoin(facilities, eq(facilities.id, departments.facilityId))
      .where(eq(facilities.code, "B"))
      .all();
    expect(b).toHaveLength(20);
  });
});

describe("the longer past keeps to its own lots", () => {
  it("draws its batches only from its own lots, and the hand-written batches never from them", () => {
    const draws = db
      .select({ batchNo: batchRecords.batchNo, lot: lots.lotCode })
      .from(batchInputs)
      .innerJoin(batchRecords, eq(batchRecords.id, batchInputs.batchId))
      .innerJoin(lots, eq(lots.id, batchInputs.lotId))
      .all();
    const generatedBatches = new Set(generated.batches.map((b) => b.batchNo));
    const handWritten = new Set(HISTORY_BATCHES.map((b) => b.batchNo));
    for (const d of draws) {
      if (generatedBatches.has(d.batchNo)) expect(generatedCodes.has(d.lot), d.batchNo).toBe(true);
      if (handWritten.has(d.batchNo)) expect(generatedCodes.has(d.lot), d.batchNo).toBe(false);
    }
    expect(draws.some((d) => generatedBatches.has(d.batchNo))).toBe(true);
  });

  it("leaves no ascorbic acid or calcium carbonate of its own at any plant", () => {
    const codes = [...generatedCodes];
    for (const facility of ["A", "B", "C"]) {
      expect(onHand(codes, "ASC", facility)).toBe(0);
      expect(onHand(codes, "CAC", facility)).toBe(0);
    }
  });

  it("never touches the materials the recorded run's story turns on", () => {
    const story = ["ASC", "CAC", "BTL", "CAP", "ACN", "BUF", "LCM", "LVC", "LEX", "MGO"];
    expect(
      generated.lots.filter((l) => story.includes(l.material) && l.receivedOn >= "2026-08-28"),
    ).toEqual([]);
  });

  it("holds enough of its own stock for the plan it covers, at the demo clock", () => {
    // Every planned batch of a product the history covers, through Dec 7, against its own lots.
    const covered = new Map<string, number>();
    for (const p of generated.plan) {
      const product = PRODUCTS.find((x) => x.code === p.product);
      if (!product || ["P-VC500", "P-CMD"].includes(p.product)) continue;
      for (const [code, kgPerBatch] of product.lines) {
        const key = `${p.facility}|${code}`;
        covered.set(key, (covered.get(key) ?? 0) + Math.round(kgPerBatch * 1_000_000));
      }
    }
    for (const [key, need] of covered) {
      const [facility, code] = key.split("|") as [string, string];
      expect(onHand([...generatedCodes], code, facility), key).toBeGreaterThanOrEqual(need);
    }
  });
});

describe("numbers that already existed keep their place", () => {
  it("numbers Hollow Pine's POs PO-1007 to PO-1034, each under the ERP's $25,000 threshold", () => {
    const nos = generated.pos.map((p) => Number(p.poNo.slice(3)));
    expect(nos[nos.length - 1]).toBe(1034);
    expect(nos).toEqual(nos.map((_, i) => (nos[0] as number) + i));
    for (const po of db.select().from(purchaseOrders).all()) {
      expect(po.totalUsdc, po.poNo).toBeLessThanOrEqual(25_000_000_000);
      expect(po.totalUsdc % 10_000, po.poNo).toBe(0);
    }
    expect(generated.pos.every((p) => p.orderedAt < "2026-09-24")).toBe(true);
  });

  it("keeps every plant's batch numbers in date order, hand-written ones included", () => {
    const rows = db
      .select({ batchNo: batchRecords.batchNo, at: batchRecords.startedAt })
      .from(batchRecords)
      .all();
    const byPrefix = new Map<string, { n: number; at: string }[]>();
    for (const r of rows) {
      const prefix = r.batchNo.slice(0, 4);
      const list = byPrefix.get(prefix) ?? [];
      list.push({ n: Number(r.batchNo.slice(5)), at: r.at ?? "" });
      byPrefix.set(prefix, list);
    }
    for (const [prefix, list] of byPrefix) {
      const byNumber = [...list].sort((a, b) => a.n - b.n).map((x) => x.at);
      expect(byNumber, prefix).toEqual([...byNumber].sort());
    }
  });

  it("numbers every batch and planned batch with its own plant's letter", () => {
    for (const b of [...generated.batches, ...generated.plan]) {
      expect(b.batchNo.slice(3, 4), b.batchNo).toBe(b.facility);
    }
  });

  it("plans the next four weeks without a number the demo or the group run uses", () => {
    const plans = db.select({ batchNo: productionPlan.batchNo }).from(productionPlan).all();
    const nos = plans.map((p) => p.batchNo);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos).toEqual(expect.arrayContaining(PLANNED_BATCHES.map((p) => p.batchNo)));
    expect(nos).not.toContain("BR-A-2210");
    // Nothing new at Hollow Pine uses ascorbic acid or calcium carbonate before Nov 30.
    const early = generated.plan.filter(
      (p) => ["P-VC500", "P-CMD"].includes(p.product) && p.plannedFor < "2026-11-30",
    );
    expect(early).toEqual([]);
  });
});
