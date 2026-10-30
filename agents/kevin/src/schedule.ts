// The plant's schedule and its effect on stock and spend (docs/VISION.md §6.6 "Schedule",
// §6.12.3 stage 3): every planned batch in the window with what it draws, whether stock on hand
// and on order covers it, and what it costs at the last price paid; and Kevin's forecast for
// every material the plant holds or plans to use. Pure reads: no forecast rows are written.

import type { Ledger } from "@day-one/server/ledger/db";
import {
  facilities,
  formulaLines,
  formulas,
  lotEvents,
  lots,
  materials,
  poLines,
  productionPlan,
  products,
} from "@day-one/server/ledger/schema";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { type Forecast, projectMaterial } from "./forecast.ts";

const DAY_MS = 86_400_000;

export interface ScheduleDraw {
  material: string;
  name: string;
  dimension: string;
  needBase: number;
  /** Stock on hand and on order left after this batch and every earlier one in the window. */
  afterBase: number;
}
export interface ScheduledBatch {
  batchNo: string;
  product: string;
  productName: string;
  plannedFor: string;
  units: number;
  draws: ScheduleDraw[];
  /** Materials the batch would run short of: stock on hand and on order does not cover it. */
  short: string[];
  /** The batch's materials at the last price paid for each; `unpriced` ones are left out. */
  costUsdc: number;
  /** Materials never bought on a PO (opening stock): no price on record, so not in the cost. */
  unpriced: string[];
}
export interface PlantSchedule {
  facility: string;
  from: string;
  to: string;
  batches: ScheduledBatch[];
  costUsdc: number;
  unpriced: string[];
  sentence: string;
}

/** The last unit price paid for a material, per inventory unit (kg or each), in micro-dollars. */
function lastPrice(db: Ledger, materialId: number) {
  return (
    db
      .select({ price: poLines.unitPriceUsdc })
      .from(poLines)
      .where(eq(poLines.materialId, materialId))
      .orderBy(desc(poLines.poId))
      .limit(1)
      .get()?.price ?? 0
  );
}

/** Planned batches from `now` for `days`, each with its draws, cover and cost. */
export function plantSchedule(
  db: Ledger,
  input: { facility: string; now: string; days?: number },
): PlantSchedule {
  const days = input.days ?? 14;
  const plant = db.select().from(facilities).where(eq(facilities.code, input.facility)).get();
  if (!plant) throw new Error(`unknown facility ${input.facility}`);
  const from = input.now.slice(0, 10);
  const to = new Date(Date.parse(input.now) + days * DAY_MS).toISOString().slice(0, 10);

  const planned = db
    .select({
      batchNo: productionPlan.batchNo,
      productId: productionPlan.productId,
      product: products.code,
      productName: products.name,
      plannedFor: productionPlan.plannedFor,
      units: productionPlan.batchTablets,
      standard: products.standardBatchTablets,
    })
    .from(productionPlan)
    .innerJoin(products, eq(products.id, productionPlan.productId))
    .where(
      and(
        eq(productionPlan.facilityId, plant.id),
        eq(productionPlan.status, "planned"),
        gte(productionPlan.plannedFor, from),
        lte(productionPlan.plannedFor, to),
      ),
    )
    .orderBy(asc(productionPlan.plannedFor), asc(productionPlan.batchNo))
    .all();

  // Stock on hand and on order, per material, as Kevin's forecast counts it.
  const left = new Map<string, number>();
  const prices = new Map<number, number>();
  const batches = planned.map((p) => {
    const lines = db
      .select({
        materialId: materials.id,
        code: materials.code,
        name: materials.name,
        dimension: materials.dimension,
        qty: formulaLines.qtyPerBatchBase,
      })
      .from(formulaLines)
      .innerJoin(
        formulas,
        and(eq(formulas.id, formulaLines.formulaId), eq(formulas.status, "active")),
      )
      .innerJoin(materials, eq(materials.id, formulaLines.materialId))
      .where(eq(formulas.productId, p.productId))
      .orderBy(asc(formulaLines.id))
      .all();
    let costUsdc = 0;
    const unpriced: string[] = [];
    const draws = lines.map((l) => {
      if (!left.has(l.code)) {
        const f = projectMaterial(db, {
          facility: plant.code,
          material: l.code,
          now: input.now,
          horizonDays: 0,
        });
        left.set(l.code, f.onHandBase + f.onOrderBase);
      }
      const needBase = Math.round((l.qty * p.units) / (p.standard || p.units));
      const afterBase = (left.get(l.code) ?? 0) - needBase;
      left.set(l.code, afterBase);
      const price = prices.get(l.materialId) ?? lastPrice(db, l.materialId);
      prices.set(l.materialId, price);
      const perUnit = l.dimension === "mass" ? 1_000_000 : 1;
      if (price === 0) unpriced.push(l.code);
      costUsdc += Math.round((needBase * price) / perUnit);
      return { material: l.code, name: l.name, dimension: l.dimension, needBase, afterBase };
    });
    return {
      batchNo: p.batchNo,
      product: p.product,
      productName: p.productName,
      plannedFor: p.plannedFor,
      units: p.units,
      draws,
      short: draws.filter((d) => d.afterBase < 0).map((d) => d.material),
      costUsdc,
      unpriced,
    };
  });
  const costUsdc = batches.reduce((s, b) => s + b.costUsdc, 0);
  const unpriced = [...new Set(batches.flatMap((b) => b.unpriced))].sort();
  const shortBatches = batches.filter((b) => b.short.length > 0);
  const sentence =
    batches.length === 0
      ? `Nothing planned at ${plant.name} from ${from} to ${to}.`
      : `${batches.length} batch${batches.length === 1 ? "" : "es"} planned at ${plant.name} to ${to}; ` +
        (shortBatches.length === 0
          ? "stock on hand and on order covers every one."
          : `${shortBatches.length} would run short: ${shortBatches
              .map((b) => `${b.batchNo} (${b.short.join(", ")})`)
              .join("; ")}.`);
  return { facility: plant.code, from, to, batches, costUsdc, unpriced, sentence };
}

export interface MaterialForecast extends Omit<Forecast, "id"> {
  material: string;
  name: string;
  category: string;
  dimension: string;
  /** Short inside the horizon: stock on hand and on order does not cover the plan. */
  short: boolean;
  /** Below its reorder point after the horizon: Kevin recommends ordering. */
  reorder: boolean;
}

/** Kevin's forecast for every material the plant holds or plans to use, short ones first. */
export function plantForecast(
  db: Ledger,
  input: { facility: string; now: string; horizonDays?: number },
): MaterialForecast[] {
  const plant = db.select().from(facilities).where(eq(facilities.code, input.facility)).get();
  if (!plant) throw new Error(`unknown facility ${input.facility}`);
  const held = db
    .selectDistinct({ id: materials.id })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(eq(lotEvents.facilityId, plant.id))
    .all()
    .map((r) => r.id);
  const planned = db
    .selectDistinct({ id: formulaLines.materialId })
    .from(productionPlan)
    .innerJoin(
      formulas,
      and(eq(formulas.productId, productionPlan.productId), eq(formulas.status, "active")),
    )
    .innerJoin(formulaLines, eq(formulaLines.formulaId, formulas.id))
    .where(eq(productionPlan.facilityId, plant.id))
    .all()
    .map((r) => r.id);
  const ids = new Set([...held, ...planned]);
  const rows = db
    .select()
    .from(materials)
    .orderBy(asc(materials.code))
    .all()
    .filter((m) => ids.has(m.id));
  const out = rows.map((m) => {
    const f = projectMaterial(db, {
      facility: plant.code,
      material: m.code,
      now: input.now,
      ...(input.horizonDays === undefined ? {} : { horizonDays: input.horizonDays }),
    });
    return {
      ...f,
      material: m.code,
      name: m.name,
      category: m.category,
      dimension: m.dimension,
      short: f.shortfallBase > 0,
      reorder: f.recommendQtyBase !== null,
    };
  });
  const rank = (f: MaterialForecast) => (f.short ? 0 : f.reorder ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.material < b.material ? -1 : 1));
}
