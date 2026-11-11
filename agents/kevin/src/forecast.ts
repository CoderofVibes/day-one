// Kevin's reorder forecast for one material at one plant. Need comes from the production plan
// inside the horizon times what each product actually used per batch at that plant (confirmed
// batch records), not from the formula alone (SPEC step 4). No LLM is involved: the numbers
// and the one-sentence explanation are computed.

import type { Ledger } from "@day-one/server/ledger/db";
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
  productionPlan,
  products,
  purchaseOrders,
  transfers,
} from "@day-one/server/ledger/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

export const DEFAULT_HORIZON_DAYS = 10;

/** Lot states that count as stock Kevin can plan to use. */
const USABLE = ["released", "in_use"] as const;
/** Only a funded order is committed supply. Received orders are represented by their lots. */
const HELD = ["received", "quarantine"] as const;

export interface IncomingMaterial {
  kind: "order" | "transfer" | "qc";
  ref: string;
  qtyBase: number;
  expectedUsableOn: string | null;
}

export interface ForecastInput {
  facility: string;
  material: string;
  /** The demo clock. */
  now: string;
  horizonDays?: number;
  /** Preview a proposed change without editing the production plan. */
  batchOverride?: { batchNo: string; units: number };
}

export interface Forecast {
  id: number;
  materialId: number;
  facilityId: number;
  horizonDays: number;
  plannedBatches: {
    batchNo: string;
    product: string;
    plannedFor: string;
    needBase: number;
    availableAfterBase: number;
  }[];
  needBase: number;
  onHandBase: number;
  onOrderBase: number;
  incoming: IncomingMaterial[];
  /** Supply with a usable date inside the horizon, excluding overdue and QC-held quantities. */
  scheduledBase: number;
  /** Largest cumulative deficit on a production date. */
  shortfallBase: number;
  reorderPointBase: number;
  /** Set when stock after the horizon would fall below the reorder point. */
  recommendQtyBase: number | null;
  /** The first planned batch that available supply cannot cover. */
  firstShort: { batchNo: string; date: string; qtyBase: number } | null;
  needBy: string | null;
  sentence: string;
}

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** Mass in kg, rounded to whole units for a spoken estimate. */
export function amount(base: number, dimension: string) {
  return dimension === "mass"
    ? `${Math.round(base / 1_000_000).toLocaleString("en-US")} kg`
    : `${base.toLocaleString("en-US")}`;
}

/** Kevin's forecast, recorded in `forecasts`. */
export function forecastMaterial(db: Ledger, input: ForecastInput): Forecast {
  const f = projectMaterial(db, input);
  const methodNote =
    `need = planned batches in ${f.horizonDays} days × actual use per tablet at this plant ` +
    `(formula when no history); shortfall = largest deficit on a batch date, using dated supply only`;
  const row = db
    .insert(forecasts)
    .values({
      materialId: f.materialId,
      facilityId: f.facilityId,
      horizonDays: f.horizonDays,
      projectedNeedBase: f.needBase,
      onHandBase: f.onHandBase,
      onOrderBase: f.onOrderBase,
      shortfallBase: f.shortfallBase,
      methodNote,
      createdAt: input.now,
    })
    .returning({ id: forecasts.id })
    .get();
  return { id: row.id, ...f };
}

/** The same numbers without writing a forecast row, for reads across every plant. */
export function projectMaterial(db: Ledger, input: ForecastInput): Omit<Forecast, "id"> {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const facility = db.select().from(facilities).where(eq(facilities.code, input.facility)).get();
  const material = db.select().from(materials).where(eq(materials.code, input.material)).get();
  if (!facility || !material) {
    throw new Error(`unknown facility ${input.facility} or material ${input.material}`);
  }
  const today = input.now.slice(0, 10);
  const until = new Date(Date.parse(input.now) + horizonDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const planned = db
    .select({
      batchNo: productionPlan.batchNo,
      productId: productionPlan.productId,
      product: products.code,
      plannedFor: productionPlan.plannedFor,
      batchTablets: productionPlan.batchTablets,
      formulaQtyBase: formulaLines.qtyPerBatchBase,
      standardTablets: products.standardBatchTablets,
    })
    .from(productionPlan)
    .innerJoin(products, eq(products.id, productionPlan.productId))
    .innerJoin(formulas, and(eq(formulas.productId, products.id), eq(formulas.status, "active")))
    .innerJoin(
      formulaLines,
      and(eq(formulaLines.formulaId, formulas.id), eq(formulaLines.materialId, material.id)),
    )
    .where(
      and(
        eq(productionPlan.facilityId, facility.id),
        eq(productionPlan.status, "planned"),
        gte(productionPlan.plannedFor, today),
        lte(productionPlan.plannedFor, until),
      ),
    )
    .orderBy(productionPlan.plannedFor, productionPlan.batchNo)
    .all();

  // Actual use per tablet of this material, per product, from confirmed batches at the plant.
  const usage = new Map<number, { base: number; tablets: number }>();
  for (const row of db
    .select({
      productId: batchRecords.productId,
      base: sql<number>`sum(${batchInputs.actualBase})`,
      tablets: batchRecords.theoreticalTablets,
    })
    .from(batchInputs)
    .innerJoin(batchRecords, eq(batchRecords.id, batchInputs.batchId))
    .where(
      and(
        eq(batchInputs.materialId, material.id),
        eq(batchRecords.facilityId, facility.id),
        eq(batchRecords.status, "confirmed"),
      ),
    )
    .groupBy(batchRecords.id)
    .all()) {
    const u = usage.get(row.productId) ?? { base: 0, tablets: 0 };
    usage.set(row.productId, { base: u.base + row.base, tablets: u.tablets + (row.tablets ?? 0) });
  }

  const demand = planned.map((p) => {
    const u = usage.get(p.productId);
    const units =
      input.batchOverride?.batchNo === p.batchNo ? input.batchOverride.units : p.batchTablets;
    const needBase = u?.tablets
      ? Math.round((u.base * units) / u.tablets)
      : Math.round((p.formulaQtyBase * units) / p.standardTablets);
    return { batchNo: p.batchNo, product: p.product, plannedFor: p.plannedFor, needBase };
  });
  const needBase = demand.reduce((sum, b) => sum + b.needBase, 0);

  const stock = db
    .select({ ref: lots.lotCode, state: lots.state, qtyBase: lotBalances.onHandBase })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .where(
      and(
        eq(lots.materialId, material.id),
        eq(lotBalances.facilityId, facility.id),
        inArray(lots.state, [...USABLE, ...HELD]),
        sql`${lotBalances.onHandBase} > 0`,
        sql`(${lots.expiresOn} is null or ${lots.expiresOn} >= ${today})`,
      ),
    )
    .orderBy(lots.lotCode)
    .all();
  const onHandBase = stock
    .filter((l) => l.state === "released" || l.state === "in_use")
    .reduce((sum, l) => sum + l.qtyBase, 0);
  const orders = db
    .select({
      ref: purchaseOrders.poNo,
      qtyBase: sql<number>`sum(${poLines.qtyBase})`,
      expectedUsableOn: purchaseOrders.expectedUsableOn,
    })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(
      and(
        eq(poLines.materialId, material.id),
        eq(purchaseOrders.shipToFacilityId, facility.id),
        eq(purchaseOrders.status, "funded"),
        sql`not exists (select 1 from receipts where receipts.po_id = ${purchaseOrders.id})`,
      ),
    )
    .groupBy(purchaseOrders.id)
    .orderBy(purchaseOrders.poNo)
    .all();
  const inTransit = db
    .select({
      ref: transfers.transferNo,
      qtyBase: transfers.qtyShippedBase,
      expectedUsableOn: transfers.expectedUsableOn,
    })
    .from(transfers)
    .innerJoin(lots, eq(lots.id, transfers.lotId))
    .where(
      and(
        eq(lots.materialId, material.id),
        eq(transfers.toFacilityId, facility.id),
        eq(transfers.state, "in_transit"),
      ),
    )
    .orderBy(transfers.transferNo)
    .all();
  const incoming: IncomingMaterial[] = [
    ...orders.map((o) => ({ ...o, kind: "order" as const })),
    ...inTransit.map((t) => ({ ...t, kind: "transfer" as const })),
    ...stock.flatMap((l) =>
      l.state === "received" || l.state === "quarantine"
        ? [{ ref: l.ref, qtyBase: l.qtyBase, kind: "qc" as const, expectedUsableOn: null }]
        : [],
    ),
  ];
  const onOrderBase = incoming.reduce((sum, s) => sum + (s.kind === "qc" ? 0 : s.qtyBase), 0);
  const scheduled = incoming.flatMap((s) =>
    s.expectedUsableOn && s.expectedUsableOn >= today && s.expectedUsableOn <= until
      ? [{ date: s.expectedUsableOn, qtyBase: s.qtyBase }]
      : [],
  );
  const scheduledBase = scheduled.reduce((sum, s) => sum + s.qtyBase, 0);
  let consumed = 0;
  const plannedBatches = demand.map((batch) => {
    consumed += batch.needBase;
    const byDate = scheduled.reduce(
      (sum, s) => sum + (s.date <= batch.plannedFor ? s.qtyBase : 0),
      0,
    );
    return { ...batch, availableAfterBase: onHandBase + byDate - consumed };
  });
  const first = plannedBatches.find((b) => b.availableAfterBase < 0);
  const firstShort = first
    ? { batchNo: first.batchNo, date: first.plannedFor, qtyBase: -first.availableAfterBase }
    : null;
  const needBy = firstShort?.date ?? null;
  const shortfallBase = plannedBatches.reduce(
    (worst, b) => Math.max(worst, -b.availableAfterBase),
    0,
  );
  // Count existing commitments when sizing any new purchase, even when their timing needs review.
  const afterBase = onHandBase + incoming.reduce((sum, s) => sum + s.qtyBase, 0) - needBase;
  const netShort = Math.max(0, -afterBase);
  const reorderPointBase = material.reorderPointBase ?? 0;
  const reorderQtyBase = material.reorderQtyBase ?? netShort;
  const recommendQtyBase =
    (firstShort && incoming.length > 0 && netShort === 0) ||
    (afterBase >= reorderPointBase && netShort === 0)
      ? null
      : netShort > 0 && reorderQtyBase > 0
        ? Math.ceil(netShort / reorderQtyBase) * reorderQtyBase
        : reorderQtyBase || null;

  const products_ = [...new Set(plannedBatches.map((b) => b.product.replace(/^P-/, "")))];
  const count = NUMBER_WORDS[plannedBatches.length] ?? String(plannedBatches.length);
  const fmt = (base: number) => amount(base, material.dimension);
  // "Calcium carbonate" reads lower case mid-sentence; "150 cc HDPE bottle" and "pH 7.00 buffer"
  // keep their own case.
  const midSentence = material.name.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
  const sentence = [
    plannedBatches.length
      ? `${count} more ${products_.join(" and ")} batch${plannedBatches.length === 1 ? "" : "es"} in the next ${horizonDays} days need${plannedBatches.length === 1 ? "s" : ""} about ${fmt(needBase)}.`
      : `No planned batches use ${midSentence} in the next ${horizonDays} days.`,
    shortfallBase > 0 ? `Short about ${fmt(shortfallBase)}.` : "",
    firstShort && incoming.length
      ? `${firstShort.batchNo} needs ${fmt(firstShort.qtyBase)} more by ${firstShort.date}. Check when incoming material will be usable or review the schedule.`
      : "",
    // Nothing runs short, so the order is for the reorder point: say what is left and why, so a
    // fresh recommendation is not read as a stale one (first-use review, findings 36 and 37).
    recommendQtyBase && netShort === 0 && shortfallBase === 0
      ? `That leaves about ${fmt(afterBase)} on hand and on order, under the ${fmt(reorderPointBase)} reorder point.`
      : "",
    recommendQtyBase ? `Recommend ordering ${fmt(recommendQtyBase)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    materialId: material.id,
    facilityId: facility.id,
    horizonDays,
    plannedBatches,
    needBase,
    onHandBase,
    onOrderBase,
    incoming,
    scheduledBase,
    shortfallBase,
    reorderPointBase,
    recommendQtyBase,
    firstShort,
    needBy,
    sentence,
  };
}
