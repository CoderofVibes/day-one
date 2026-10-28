import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { appendLotEvent } from "@day-one/server/ledger/events";
import {
  batchInputs,
  batchRecords,
  facilities,
  forecasts,
  formulaLines,
  formulas,
  lotBalances,
  lots,
  materials,
  poLines,
  products,
  purchaseOrders,
  vendors,
} from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KG = 1_000_000;
const AT = "2026-11-09T13:05:00.000Z";

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

const idOf = <T extends { id: number }>(row: T | undefined) => {
  if (!row) throw new Error("missing row");
  return row.id;
};

/**
 * What confirming BR-B-1045 posts (FICTIONAL_DATA §7): ascorbic acid as 187.450 kg from the
 * transferred lot and 224.900 kg from ASC-260921-02, every other material at its formula
 * quantity, first in, first out. The extraction task will post the real record.
 */
function confirmBr1045() {
  const plantB = idOf(db.select().from(facilities).where(eq(facilities.code, "B")).get());
  const product = idOf(db.select().from(products).where(eq(products.code, "P-VC500")).get());
  const formula = idOf(db.select().from(formulas).where(eq(formulas.productId, product)).get());
  const batch = db
    .insert(batchRecords)
    .values({
      batchNo: "BR-B-1045",
      productId: product,
      formulaId: formula,
      facilityId: plantB,
      theoreticalTablets: 800_000,
      status: "confirmed",
      confirmedAt: AT,
    })
    .returning()
    .get();
  const draws: { lotId: number; materialId: number; qty: number }[] = [];
  for (const line of db
    .select({
      materialId: formulaLines.materialId,
      code: materials.code,
      qty: formulaLines.qtyPerBatchBase,
    })
    .from(formulaLines)
    .innerJoin(materials, eq(materials.id, formulaLines.materialId))
    .where(eq(formulaLines.formulaId, formula))
    .all()) {
    if (line.code === "ASC") {
      for (const [code, qty] of [
        ["ASC-261009-01", 187_450_000],
        ["ASC-260921-02", 224_900_000],
      ] as const) {
        draws.push({
          lotId: idOf(db.select().from(lots).where(eq(lots.lotCode, code)).get()),
          materialId: line.materialId,
          qty,
        });
      }
      continue;
    }
    let remaining = line.qty;
    for (const c of db
      .select({ lotId: lots.id, onHand: lotBalances.onHandBase })
      .from(lotBalances)
      .innerJoin(lots, eq(lots.id, lotBalances.lotId))
      .where(
        and(
          eq(lots.materialId, line.materialId),
          eq(lotBalances.facilityId, plantB),
          inArray(lots.state, ["released", "in_use"]),
          gt(lotBalances.onHandBase, 0),
        ),
      )
      .orderBy(asc(lots.lotCode))
      .all()) {
      const qty = Math.min(remaining, c.onHand);
      if (qty === 0) break;
      remaining -= qty;
      draws.push({ lotId: c.lotId, materialId: line.materialId, qty });
    }
    if (remaining > 0) throw new Error(`BR-B-1045 is short of ${line.code}`);
  }
  for (const d of draws) {
    const lot = db.select().from(lots).where(eq(lots.id, d.lotId)).get();
    const base = {
      lotId: d.lotId,
      facilityId: plantB,
      refType: "batch" as const,
      refId: batch.id,
      actorType: "kevin" as const,
      occurredAt: AT,
    };
    if (lot?.state === "released") appendLotEvent(db, { ...base, kind: "issued", qtyDeltaBase: 0 });
    const consumed = appendLotEvent(db, { ...base, kind: "consumed", qtyDeltaBase: -d.qty });
    db.insert(batchInputs)
      .values({
        batchId: batch.id,
        lotId: d.lotId,
        materialId: d.materialId,
        actualBase: d.qty,
        issueEventId: consumed.id,
      })
      .run();
  }
}

describe("forecast", () => {
  it("finds the two planned VC500 batches and the demo shortfall after BR-B-1045", () => {
    confirmBr1045();
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(f.plannedBatches.map((b) => b.batchNo)).toEqual(["BR-B-1047", "BR-B-1048"]);
    expect(f.onHandBase).toBe(310 * KG);
    // History used exactly 412 kg per batch, BR-B-1045 used 412.350 kg: the average decides.
    expect(f.needBase).toBe(Math.round(((412 * 2 + 412.35) * KG) / 3) * 2);
    expect(f.shortfallBase).toBe(f.needBase - 310 * KG);
    expect(f.recommendQtyBase).toBe(700 * KG);
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

  it("counts open POs as on order", () => {
    confirmBr1045();
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
    const after = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
    expect(after.onOrderBase).toBe(700 * KG);
    expect(after.shortfallBase).toBe(0);
    expect(after.sentence).not.toMatch(/Short/);
  });

  it("asks for nothing when the plan does not use the material", () => {
    const f = forecastMaterial(db, { facility: "B", material: "VD3", now: NOW });
    expect(f.plannedBatches).toEqual([]);
    expect(f.recommendQtyBase).toBeNull();
    expect(f.sentence).toMatch(/^No planned batches use/);
  });

  it("leaves batches outside the horizon out", () => {
    const f = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW, horizonDays: 5 });
    expect(f.plannedBatches.map((b) => b.batchNo)).toEqual(["BR-B-1047"]);
    expect(f.sentence).toMatch(/^One more VC500 batch in the next 5 days/);
  });

  it("only flags ascorbic acid among the VC500 materials at the demo clock", () => {
    confirmBr1045();
    const flagged = ["ASC", "SOR", "MCC", "CTA", "FOR", "MGS", "SIO", "SUC"].filter(
      (code) => forecastMaterial(db, { facility: "B", material: code, now: NOW }).recommendQtyBase,
    );
    expect(flagged).toEqual(["ASC"]);
  });
});
