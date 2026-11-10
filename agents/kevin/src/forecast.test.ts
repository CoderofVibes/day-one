import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { forecasts, lots, poLines, purchaseOrders, vendors } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";
import { confirmBr1045, idOf } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KG = 1_000_000;

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("forecast", () => {
  it("finds the two planned VC500 batches and the demo shortfall after BR-B-1045", () => {
    confirmBr1045(db);
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(f.plannedBatches.map((b) => b.batchNo)).toEqual(["BR-B-1047", "BR-B-1048"]);
    expect(f.onHandBase).toBe(310 * KG);
    // History used exactly 412 kg per batch (the two of §10 and the four of §17), BR-B-1045 used
    // 412.350 kg: the average decides. The sentence rounds it to 824 kg either way.
    expect(f.needBase).toBe(Math.round(((412 * 6 + 412.35) * KG) / 7) * 2);
    expect(f.shortfallBase).toBe(f.needBase - 310 * KG);
    expect(f.recommendQtyBase).toBe(700 * KG);
    expect(f.needBy).toBe("2026-11-17");
    expect(f.sentence).toBe(
      "Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. Recommend ordering 700 kg.",
    );
    const row = db.select().from(forecasts).where(eq(forecasts.id, f.id)).get();
    expect(row).toMatchObject({ horizonDays: 10, onHandBase: 310 * KG, createdAt: NOW });
  });

  it("does not ask for ascorbic acid before BR-B-1045 beyond what the plan needs", () => {
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(f.onHandBase).toBe(722_350_000);
    expect(f.needBase).toBe(824 * KG);
    expect(f.shortfallBase).toBe(824 * KG - 722_350_000);
    expect(f.recommendQtyBase).toBe(700 * KG);
  });

  it("distinguishes unknown, late, overdue and on-time supply without ordering twice", () => {
    confirmBr1045(db);
    const before = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(before.onOrderBase).toBe(0);
    const po = db
      .insert(purchaseOrders)
      .values({
        poNo: "PO-1042",
        vendorId: idOf(db.select().from(vendors).where(eq(vendors.code, "NGI")).get()),
        shipToFacilityId: before.facilityId,
        category: "raw_material",
        totalUsdc: 5_150_000_000,
        status: "funded",
        createdBy: "kevin",
      })
      .returning()
      .get();
    db.insert(poLines)
      .values({
        poId: po.id,
        lineNo: 1,
        materialId: before.materialId,
        qtyBase: 700 * KG,
        unit: "kg",
        unitPriceUsdc: 7_100_000,
        extendedUsdc: 4_970_000_000,
      })
      .run();
    const check = () => forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    const unknown = check();
    expect(unknown.onOrderBase).toBe(700 * KG);
    expect(unknown.shortfallBase).toBe(before.shortfallBase);
    expect(unknown.firstShort).toMatchObject({ batchNo: "BR-B-1047", date: "2026-11-17" });
    expect(unknown.recommendQtyBase).toBeNull();

    db.update(purchaseOrders)
      .set({ expectedUsableOn: "2026-11-18" })
      .where(eq(purchaseOrders.id, po.id))
      .run();
    const late = check();
    expect(late.firstShort).toEqual(unknown.firstShort);
    expect(late.plannedBatches[1]?.availableAfterBase).toBeGreaterThan(0);
    expect(late.recommendQtyBase).toBeNull();

    db.update(purchaseOrders)
      .set({ expectedUsableOn: "2026-11-08" })
      .where(eq(purchaseOrders.id, po.id))
      .run();
    expect(check().scheduledBase).toBe(0);

    db.update(purchaseOrders)
      .set({ expectedUsableOn: "2026-11-17" })
      .where(eq(purchaseOrders.id, po.id))
      .run();
    expect(check()).toMatchObject({ scheduledBase: 700 * KG, firstShort: null, shortfallBase: 0 });
  });

  it("keeps QC-held material separate from usable and in-transit supply", () => {
    confirmBr1045(db);
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    db.update(lots).set({ state: "quarantine" }).where(eq(lots.materialId, f.materialId)).run();
    const held = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(held).toMatchObject({ onHandBase: 0, scheduledBase: 0, onOrderBase: 0 });
    expect(held.incoming.reduce((sum, s) => sum + s.qtyBase, 0)).toBe(f.onHandBase);
    expect(held.firstShort?.qtyBase).toBe(f.plannedBatches[0]?.needBase);
  });

  it("asks for nothing when the plan does not use the material", () => {
    const f = forecastMaterial(db, { facility: "B", material: "VD3", now: NOW });
    expect(f.plannedBatches).toEqual([]);
    expect(f.recommendQtyBase).toBeNull();
    expect(f.sentence).toMatch(/^No planned batches use/);
  });

  it("leaves batches outside the horizon out", () => {
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW, horizonDays: 9 });
    expect(f.plannedBatches.map((b) => b.batchNo)).toEqual(["BR-B-1047"]);
    expect(f.sentence).toMatch(/^One more VC500 batch in the next 9 days/);
  });

  it("only flags ascorbic acid among the VC500 materials at the demo clock", () => {
    confirmBr1045(db);
    const flagged = ["ASC", "SOR", "MCC", "CTA", "FOR", "MGS", "SIO", "SUC"].filter(
      (code) => forecastMaterial(db, { facility: "B", material: code, now: NOW }).recommendQtyBase,
    );
    expect(flagged).toEqual(["ASC"]);
  });
});
