// Production plan (docs/UPGRADE_BRIEF.md §2.1.3): batches scheduled to meet demand within the
// plant's lines. Each line (the tablet line, the capsule room, the powder room) runs one batch a
// working day; on each day it runs the product furthest behind its demand, looked at
// buildAheadDays ahead, once that product is half a batch behind.

import { ROUTES } from "../seed/production.ts";
import {
  addDays,
  type Calendar,
  cumulativeDemand,
  dates,
  daysBetween,
  PLANNING_YIELD,
  productSpec,
  type WeeklyDemand,
} from "./calendar.ts";
import type { PlantParams } from "./config.ts";
import type { ProductCode } from "./types.ts";

export interface PlannedRun {
  batchNo: string;
  product: ProductCode;
  plannedFor: string;
}

/** The batch-number prefix a product runs under at a plant: "BR-B", "BC-B", "BP-B". */
export function prefixOf(product: ProductCode, facility: string) {
  const route = ROUTES[product];
  if (!route) throw new Error(`world: no route for ${product}`);
  return route.prefix.replace(/-[A-Z]+$/, `-${facility}`);
}

export const batchNo = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, "0")}`;

/**
 * Batches from `from` to `to` (both included) for a plant, unnumbered. The plant starts the
 * segment built ahead, as a running plant is.
 */
export function schedule(
  plant: PlantParams,
  weeks: readonly WeeklyDemand[],
  cal: Calendar,
  from: string,
  to: string,
  /** Demand after this day is not built ahead for (the next segment's own plan meets it). */
  demandUntil = "9999-12-31",
): { product: ProductCode; plannedFor: string }[] {
  const products = plant.products.map((p) => {
    const demandTo = cumulativeDemand(weeks, p.product);
    const perBatch = productSpec(p.product).batchTablets * PLANNING_YIELD;
    return {
      product: p.product,
      line: prefixOf(p.product, plant.facility),
      demandTo,
      perBatch,
      produced: demandTo(from, addDays(from, plant.buildAheadDays)),
      last: addDays(from, -plant.minGapDays),
    };
  });
  const out: { product: ProductCode; plannedFor: string }[] = [];
  for (const d of dates(from, to)) {
    if (!cal.isWorkingDay(d)) continue;
    const ahead = addDays(d, plant.buildAheadDays);
    const horizon = ahead < demandUntil ? ahead : demandUntil;
    for (const line of [...new Set(products.map((p) => p.line))]) {
      let best: (typeof products)[number] | null = null;
      let bestBehind = 0.5;
      for (const p of products.filter((x) => x.line === line)) {
        if (daysBetween(p.last, d) < plant.minGapDays) continue;
        const behind = (p.demandTo(from, horizon) - p.produced) / p.perBatch;
        if (behind >= bestBehind) {
          best = p;
          bestBehind = behind;
        }
      }
      if (best) {
        best.produced += best.perBatch;
        best.last = d;
        out.push({ product: best.product, plannedFor: d });
      }
    }
  }
  return out;
}
