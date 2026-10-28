// Test support: what confirming BR-B-1045 posts, so forecast and purchasing tests start from
// the demo state at step 4.

import type { Ledger } from "@day-one/server/ledger/db";
import { appendLotEvent } from "@day-one/server/ledger/events";
import {
  batchInputs,
  batchRecords,
  facilities,
  formulaLines,
  formulas,
  lotBalances,
  lots,
  materials,
  products,
} from "@day-one/server/ledger/schema";
import { and, asc, eq, gt, inArray } from "drizzle-orm";

const AT = "2026-11-09T13:05:00.000Z";

export const idOf = <T extends { id: number }>(row: T | undefined) => {
  if (!row) throw new Error("missing row");
  return row.id;
};

/**
 * What confirming BR-B-1045 posts (FICTIONAL_DATA §7): ascorbic acid as 187.450 kg from the
 * transferred lot and 224.900 kg from ASC-260921-02, every other material at its formula
 * quantity, first in, first out. The extraction task will post the real record.
 */
export function confirmBr1045(db: Ledger) {
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
