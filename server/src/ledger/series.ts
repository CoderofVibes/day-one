// The series the v2 charts draw (docs/VISION.md §6.7, §6.12.4), read straight from the ledger so
// every chart agrees with the pages beside it: output and yield per batch, stock over time per
// material and plant, spend per month, QC decisions per month. Pure reads; no model, no chain.

import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { LedgerDb } from "./events.ts";
import {
  batchInputs,
  batchRecords,
  facilities,
  lotEvents,
  lots,
  materials,
  products,
  purchaseOrders,
  qcDecisions,
  receipts,
} from "./schema.ts";

export interface BatchPoint {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  /** The day the batch was completed (YYYY-MM-DD). */
  date: string;
  units: number;
  theoreticalUnits: number;
  yieldBp: number;
  wasteBase: number;
  issuedBase: number;
}

/** Every confirmed batch, oldest first: what a yield line, an output bar or a waste bar reads. */
export function productionSeries(db: LedgerDb): BatchPoint[] {
  const issued = new Map<number, number>();
  for (const r of db
    .select({ batchId: batchInputs.batchId, qty: batchInputs.actualBase })
    .from(batchInputs)
    .all()) {
    issued.set(r.batchId, (issued.get(r.batchId) ?? 0) + r.qty);
  }
  return db
    .select({
      id: batchRecords.id,
      batchNo: batchRecords.batchNo,
      facility: facilities.code,
      product: products.code,
      productName: products.name,
      completedAt: batchRecords.completedAt,
      units: batchRecords.actualTablets,
      theoretical: batchRecords.theoreticalTablets,
      yieldBp: batchRecords.yieldBp,
      wasteBase: batchRecords.wasteBase,
    })
    .from(batchRecords)
    .innerJoin(facilities, eq(facilities.id, batchRecords.facilityId))
    .innerJoin(products, eq(products.id, batchRecords.productId))
    .where(and(eq(batchRecords.status, "confirmed"), isNotNull(batchRecords.completedAt)))
    .orderBy(asc(batchRecords.completedAt), asc(batchRecords.batchNo))
    .all()
    .map((b) => ({
      batchNo: b.batchNo,
      facility: b.facility,
      product: b.product,
      productName: b.productName,
      date: (b.completedAt ?? "").slice(0, 10),
      units: b.units ?? 0,
      theoreticalUnits: b.theoretical ?? 0,
      yieldBp: b.yieldBp ?? 0,
      wasteBase: b.wasteBase ?? 0,
      issuedBase: issued.get(b.id) ?? 0,
    }));
}

export interface StockPoint {
  /** When the stock changed (the event's time). */
  at: string;
  /** On hand at the plant after the change, in base units. */
  onHandBase: number;
  deltaBase: number;
  kind: string;
  lotCode: string;
}
export interface StockSeries {
  facility: string;
  material: string;
  name: string;
  dimension: string;
  reorderPointBase: number | null;
  points: StockPoint[];
}

/**
 * On hand of one material at one plant after every event that changed it, oldest first. Lots
 * in quarantine count as on hand here (they are in the building); the forecast counts usable
 * stock only.
 */
export function stockSeries(
  db: LedgerDb,
  input: { facility: string; material: string },
): StockSeries | null {
  const plant = db.select().from(facilities).where(eq(facilities.code, input.facility)).get();
  const mat = db.select().from(materials).where(eq(materials.code, input.material)).get();
  if (!plant || !mat) return null;
  let onHand = 0;
  const points = db
    .select({
      at: lotEvents.occurredAt,
      delta: lotEvents.qtyDeltaBase,
      kind: lotEvents.kind,
      lotCode: lots.lotCode,
    })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .where(
      and(
        eq(lots.materialId, mat.id),
        eq(lotEvents.facilityId, plant.id),
        ne(lotEvents.qtyDeltaBase, 0),
      ),
    )
    .orderBy(asc(lotEvents.seq))
    .all()
    .map((e) => {
      onHand += e.delta;
      return { at: e.at, onHandBase: onHand, deltaBase: e.delta, kind: e.kind, lotCode: e.lotCode };
    });
  return {
    facility: plant.code,
    material: mat.code,
    name: mat.name,
    dimension: mat.dimension,
    reorderPointBase: mat.reorderPointBase,
    points,
  };
}

/** Every material a plant has ever held, for a picker beside the stock chart. */
export function stockedMaterials(db: LedgerDb, facility: string): string[] {
  const plant = db.select().from(facilities).where(eq(facilities.code, facility)).get();
  if (!plant) return [];
  const rows = db
    .selectDistinct({ code: materials.code })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(eq(lotEvents.facilityId, plant.id))
    .orderBy(asc(materials.code))
    .all();
  return rows.map((r) => r.code);
}

export interface SpendMonth {
  /** YYYY-MM */
  month: string;
  facility: string;
  category: string;
  totalUsdc: number;
  pos: number;
}

/** Statuses a PO can have once a supplier is owed or paid for it. */
const RECEIVED = ["received", "released", "paid"] as const;
const COMMITTED = ["authorized", "approved", "funded"] as const;

/**
 * Spend per month, plant and category: a PO counts in the month its goods were received; a PO
 * funded but not yet received counts in `committed` (the money is held, the goods are not in).
 */
export function spendSeries(db: LedgerDb): { months: SpendMonth[]; committed: SpendMonth[] } {
  const received = db
    .select({
      poNo: purchaseOrders.poNo,
      facility: facilities.code,
      category: purchaseOrders.category,
      total: purchaseOrders.totalUsdc,
      receivedAt: receipts.receivedAt,
    })
    .from(purchaseOrders)
    .innerJoin(facilities, eq(facilities.id, purchaseOrders.shipToFacilityId))
    .innerJoin(receipts, eq(receipts.poId, purchaseOrders.id))
    .where(inArray(purchaseOrders.status, [...RECEIVED]))
    .orderBy(asc(receipts.receivedAt))
    .all();
  const seen = new Set<string>();
  const months = new Map<string, SpendMonth>();
  for (const r of received) {
    if (seen.has(r.poNo)) continue;
    seen.add(r.poNo);
    const month = r.receivedAt.slice(0, 7);
    const key = `${month}|${r.facility}|${r.category}`;
    const m = months.get(key) ?? {
      month,
      facility: r.facility,
      category: r.category,
      totalUsdc: 0,
      pos: 0,
    };
    m.totalUsdc += r.total;
    m.pos += 1;
    months.set(key, m);
  }
  const committed = new Map<string, SpendMonth>();
  for (const r of db
    .select({
      facility: facilities.code,
      category: purchaseOrders.category,
      total: purchaseOrders.totalUsdc,
    })
    .from(purchaseOrders)
    .innerJoin(facilities, eq(facilities.id, purchaseOrders.shipToFacilityId))
    .where(inArray(purchaseOrders.status, [...COMMITTED]))
    .all()) {
    const key = `${r.facility}|${r.category}`;
    const m = committed.get(key) ?? {
      month: "",
      facility: r.facility,
      category: r.category,
      totalUsdc: 0,
      pos: 0,
    };
    m.totalUsdc += r.total;
    m.pos += 1;
    committed.set(key, m);
  }
  const order = (a: SpendMonth, b: SpendMonth) =>
    a.month < b.month
      ? -1
      : a.month > b.month
        ? 1
        : `${a.facility}${a.category}` < `${b.facility}${b.category}`
          ? -1
          : 1;
  return {
    months: [...months.values()].sort(order),
    committed: [...committed.values()].sort(order),
  };
}

export interface QcMonth {
  month: string;
  facility: string;
  released: number;
  rejected: number;
}

/** QC decisions per month and plant: the plant of the event that recorded each decision. */
export function qcSeries(db: LedgerDb): QcMonth[] {
  const rows = db
    .select({
      decision: qcDecisions.decision,
      decidedAt: qcDecisions.decidedAt,
      facility: facilities.code,
    })
    .from(qcDecisions)
    .innerJoin(lotEvents, and(eq(lotEvents.refType, "qc"), eq(lotEvents.refId, qcDecisions.id)))
    .innerJoin(facilities, eq(facilities.id, lotEvents.facilityId))
    .orderBy(asc(qcDecisions.decidedAt))
    .all();
  const out = new Map<string, QcMonth>();
  for (const r of rows) {
    const month = r.decidedAt.slice(0, 7);
    const key = `${month}|${r.facility}`;
    const m = out.get(key) ?? { month, facility: r.facility, released: 0, rejected: 0 };
    if (r.decision === "released") m.released += 1;
    else m.rejected += 1;
    out.set(key, m);
  }
  return [...out.values()];
}

export interface ReorderWeek {
  /** The Monday the week starts on (YYYY-MM-DD); counted at the end of that Sunday. */
  week: string;
  facility: string;
  /** Materials the plant has held whose stock was below their reorder point. */
  below: number;
}

/**
 * How many materials each plant held below their reorder point at the end of each week, from
 * the first event to the last: one pass over the event log, no per-material queries.
 */
export function reorderSeries(db: LedgerDb): ReorderWeek[] {
  const rows = db
    .select({
      at: lotEvents.occurredAt,
      delta: lotEvents.qtyDeltaBase,
      facility: facilities.code,
      material: materials.code,
      reorder: materials.reorderPointBase,
    })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .innerJoin(facilities, eq(facilities.id, lotEvents.facilityId))
    .orderBy(asc(lotEvents.seq))
    .all();
  if (rows.length === 0) return [];
  const monday = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const stock = new Map<string, { onHand: number; reorder: number }>();
  const out: ReorderWeek[] = [];
  const plants = [...new Set(rows.map((r) => r.facility))].sort();
  const close = (week: string) => {
    for (const plant of plants) {
      let below = 0;
      for (const [key, s] of stock) {
        if (key.startsWith(`${plant}|`) && s.onHand < s.reorder) below += 1;
      }
      out.push({ week, facility: plant, below });
    }
  };
  let week = monday(rows[0]?.at ?? "");
  for (const r of rows) {
    const w = monday(r.at);
    while (w > week) {
      close(week);
      const next = new Date(`${week}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      week = next.toISOString().slice(0, 10);
    }
    const key = `${r.facility}|${r.material}`;
    const s = stock.get(key) ?? { onHand: 0, reorder: r.reorder ?? 0 };
    s.onHand += r.delta;
    stock.set(key, s);
  }
  close(week);
  return out;
}

/** Everything the charts read that does not depend on a chosen material. */
export function historySeries(db: LedgerDb) {
  return {
    production: productionSeries(db),
    spend: spendSeries(db),
    qc: qcSeries(db),
    belowReorder: reorderSeries(db),
  };
}
