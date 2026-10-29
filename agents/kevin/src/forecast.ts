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
} from "@day-one/server/ledger/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

export const DEFAULT_HORIZON_DAYS = 10;

/** Lot states that count as stock Kevin can plan to use. */
const USABLE = ["released", "in_use"] as const;
/** Stock already at the plant but not yet usable: it arrives with QC. */
const INCOMING = ["received", "quarantine"] as const;
/** PO states with goods still to come. */
const OPEN_PO = ["authorized", "approved", "funded"] as const;

export interface ForecastInput {
  facility: string;
  material: string;
  /** The demo clock. */
  now: string;
  horizonDays?: number;
}

export interface Forecast {
  id: number;
  materialId: number;
  facilityId: number;
  horizonDays: number;
  plannedBatches: { batchNo: string; product: string; plannedFor: string; needBase: number }[];
  needBase: number;
  onHandBase: number;
  onOrderBase: number;
  /** Need not covered by stock on hand and on order; 0 when covered. */
  shortfallBase: number;
  reorderPointBase: number;
  /** Set when stock after the horizon would fall below the reorder point. */
  recommendQtyBase: number | null;
  /** The date of the first planned batch that stock on hand and on order cannot cover. */
  needBy: string | null;
  sentence: string;
}

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** Mass in kg, rounded to whole units for a spoken estimate. */
function amount(base: number, dimension: string) {
  return dimension === "mass"
    ? `${Math.round(base / 1_000_000).toLocaleString("en-US")} kg`
    : `${base.toLocaleString("en-US")}`;
}

export function forecastMaterial(db: Ledger, input: ForecastInput): Forecast {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const facility = db.select().from(facilities).where(eq(facilities.code, input.facility)).get();
  const material = db.select().from(materials).where(eq(materials.code, input.material)).get();
  if (!facility || !material) {
    throw new Error(`unknown facility ${input.facility} or material ${input.material}`);
  }
  const until = new Date(Date.parse(input.now) + horizonDays * 86_400_000).toISOString();

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
        gte(productionPlan.plannedFor, input.now.slice(0, 10)),
        lte(productionPlan.plannedFor, until.slice(0, 10)),
      ),
    )
    .orderBy(productionPlan.plannedFor)
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

  const plannedBatches = planned.map((p) => {
    const u = usage.get(p.productId);
    const needBase = u?.tablets
      ? Math.round((u.base * p.batchTablets) / u.tablets)
      : Math.round((p.formulaQtyBase * p.batchTablets) / p.standardTablets);
    return { batchNo: p.batchNo, product: p.product, plannedFor: p.plannedFor, needBase };
  });
  const needBase = plannedBatches.reduce((sum, b) => sum + b.needBase, 0);

  const stock = (states: readonly string[]) =>
    db
      .select({ base: sql<number>`coalesce(sum(${lotBalances.onHandBase}), 0)` })
      .from(lotBalances)
      .innerJoin(lots, eq(lots.id, lotBalances.lotId))
      .where(
        and(
          eq(lots.materialId, material.id),
          eq(lotBalances.facilityId, facility.id),
          inArray(lots.state, [...states] as (typeof lots.state._.data)[]),
        ),
      )
      .get()?.base ?? 0;
  const onHandBase = stock(USABLE);
  const openPoBase =
    db
      .select({ base: sql<number>`coalesce(sum(${poLines.qtyBase}), 0)` })
      .from(poLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .where(
        and(
          eq(poLines.materialId, material.id),
          eq(purchaseOrders.shipToFacilityId, facility.id),
          inArray(purchaseOrders.status, [...OPEN_PO]),
        ),
      )
      .get()?.base ?? 0;
  const onOrderBase = stock(INCOMING) + openPoBase;

  const afterBase = onHandBase + onOrderBase - needBase;
  let covered = onHandBase + onOrderBase;
  const needBy =
    plannedBatches.find((b) => {
      covered -= b.needBase;
      return covered < 0;
    })?.plannedFor ?? null;
  const shortfallBase = Math.max(0, -afterBase);
  const reorderPointBase = material.reorderPointBase ?? 0;
  const reorderQtyBase = material.reorderQtyBase ?? shortfallBase;
  const recommendQtyBase =
    afterBase >= reorderPointBase
      ? null
      : shortfallBase > 0 && reorderQtyBase > 0
        ? Math.ceil(shortfallBase / reorderQtyBase) * reorderQtyBase
        : reorderQtyBase;

  const products_ = [...new Set(plannedBatches.map((b) => b.product.replace(/^P-/, "")))];
  const count = NUMBER_WORDS[plannedBatches.length] ?? String(plannedBatches.length);
  const fmt = (base: number) => amount(base, material.dimension);
  const sentence = [
    plannedBatches.length
      ? `${count} more ${products_.join(" and ")} batch${plannedBatches.length === 1 ? "" : "es"} in the next ${horizonDays} days need${plannedBatches.length === 1 ? "s" : ""} about ${fmt(needBase)}.`
      : `No planned batches use ${material.name.toLowerCase()} in the next ${horizonDays} days.`,
    shortfallBase > 0 ? `Short about ${fmt(shortfallBase)}.` : "",
    recommendQtyBase ? `Recommend ordering ${fmt(recommendQtyBase)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const methodNote =
    `need = planned batches in ${horizonDays} days × actual use per tablet at this plant ` +
    `(formula when no history); shortfall = need − on hand − on order`;
  const row = db
    .insert(forecasts)
    .values({
      materialId: material.id,
      facilityId: facility.id,
      horizonDays,
      projectedNeedBase: needBase,
      onHandBase,
      onOrderBase,
      shortfallBase,
      methodNote,
      createdAt: input.now,
    })
    .returning({ id: forecasts.id })
    .get();

  return {
    id: row.id,
    materialId: material.id,
    facilityId: facility.id,
    horizonDays,
    plannedBatches,
    needBase,
    onHandBase,
    onOrderBase,
    shortfallBase,
    reorderPointBase,
    recommendQtyBase,
    needBy,
    sentence,
  };
}
