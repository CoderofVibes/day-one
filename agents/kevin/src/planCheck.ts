// Kevin's two checks on a buy that someone asks for, rather than one his own forecast found:
// is the quantity something the production plan can use, and is the price in line with what
// the plant has been paying? Both are Kevin's judgement, on top of the contract's limits: a
// request can sit under every limit and still be wrong for the plant.

import type { Ledger } from "@day-one/server/ledger/db";
import { facilities, materials, poLines, purchaseOrders } from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { eq } from "drizzle-orm";
import { amount, type Forecast } from "./forecast.ts";

const DAY_MS = 86_400_000;

/** A request more than this many times what the plan can use is refused, not drafted. */
export const OVER_ORDER_FACTOR = 2;
/** A quote this far above the 12-month median paid goes to the director, under any limit. */
export const PRICE_SPIKE_RATIO = 1.25;

export interface PlanVerdict {
  ok: boolean;
  /** The most the plan can use: the horizon's need plus the reorder point, less stock on hand and on order. */
  usableBase: number;
  sentence: string;
}

/** Whether a requested quantity fits what the production plan will draw. */
export function orderAgainstPlan(
  forecast: Forecast,
  requestedBase: number,
  dimension: string,
  materialName: string,
): PlanVerdict {
  const incoming = forecast.incoming.reduce((total, s) => total + s.qtyBase, 0);
  const held = incoming - forecast.onOrderBase;
  const unfilled = forecast.needBase - forecast.onHandBase - incoming;
  const usableBase =
    forecast.firstShort && incoming > 0 && unfilled <= 0
      ? 0
      : Math.max(forecast.recommendQtyBase ?? 0, unfilled + forecast.reorderPointBase, 0);
  const ok = requestedBase <= Math.max(usableBase, 1) * OVER_ORDER_FACTOR;
  const asked = amount(requestedBase, dimension);
  const usable = amount(usableBase, dimension);
  const batches = forecast.plannedBatches.length;
  return {
    ok,
    usableBase,
    sentence: ok
      ? `${asked} of ${materialName.toLowerCase()} fits the plan: ${batches} planned batches in the next ${forecast.horizonDays} days can use up to ${usable} beyond stock on hand and on order.`
      : `I won't draft ${asked} of ${materialName.toLowerCase()}. The ${batches} batches planned in the next ${forecast.horizonDays} days need ${amount(forecast.needBase, dimension)}; with ${amount(forecast.onHandBase, dimension)} on hand, ${amount(forecast.onOrderBase, dimension)} on order${held ? `, ${amount(held, dimension)} waiting on QC` : ""} and the ${amount(forecast.reorderPointBase, dimension)} reorder point, the plan can use ${usable} more. Anything bigger needs a production plan that calls for it.`,
  };
}

export interface PriceBand {
  medianUsdc: number;
  orders: number;
}

/** One price the plant paid: a PO line, from the ledger or from the plant's own books. */
export interface PricePoint {
  material: string;
  facility: string;
  /** When it was ordered (or needed, for a ledger PO without an order date). */
  at: string;
  unitPriceUsdc: number;
}

/** Every priced PO line in the ledger that was actually placed. */
export function ledgerPricePoints(db: Ledger): PricePoint[] {
  return db
    .select({
      material: materials.code,
      facility: facilities.code,
      at: purchaseOrders.needBy,
      status: purchaseOrders.status,
      unitPriceUsdc: poLines.unitPriceUsdc,
    })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .innerJoin(facilities, eq(facilities.id, purchaseOrders.shipToFacilityId))
    .all()
    .filter((r) => r.at !== null && r.status !== "draft" && r.status !== "cancelled")
    .map((r) => ({
      material: r.material,
      facility: r.facility,
      at: r.at as string,
      unitPriceUsdc: r.unitPriceUsdc,
    }));
}

/** The median unit price paid for a material at a plant over the 12 months before `now`. */
export function paidPriceBand(
  points: readonly PricePoint[],
  material: string,
  facility: string,
  now: string,
): PriceBand | null {
  const since = new Date(Date.parse(now) - 365 * DAY_MS).toISOString().slice(0, 10);
  const today = now.slice(0, 10);
  const prices = points
    .filter(
      (p) =>
        p.material === material &&
        p.facility === facility &&
        p.at.slice(0, 10) >= since &&
        p.at.slice(0, 10) <= today,
    )
    .map((p) => p.unitPriceUsdc)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  const medianUsdc =
    prices.length % 2 === 1
      ? (prices[mid] as number)
      : Math.round(((prices[mid - 1] as number) + (prices[mid] as number)) / 2);
  return { medianUsdc, orders: prices.length };
}

/** "41% above the $7.10/kg median paid on 6 orders over the last 12 months", or null when in line. */
export function priceSpike(
  unitPriceUsdc: number,
  band: PriceBand | null,
  unit: string,
): string | null {
  if (!band || band.medianUsdc <= 0) return null;
  const ratio = unitPriceUsdc / band.medianUsdc;
  if (ratio < PRICE_SPIKE_RATIO) return null;
  return `${Math.round((ratio - 1) * 100)}% above the ${formatUsd(BigInt(band.medianUsdc))}/${unit} median paid on ${band.orders} order${band.orders === 1 ? "" : "s"} over the last 12 months`;
}

/** The parts of a plant's twelve-month world (server/src/world) the price check reads. */
export interface PricedBooks {
  meta: { facility: string };
  pos: { orderedAt: string; lines: { material: string; unitPriceUsdc: number }[] }[];
}

/** Every PO line in the plants' own books, the twelve months the acquisition brought with it. */
export function bookPricePoints(worlds: readonly PricedBooks[]): PricePoint[] {
  return worlds.flatMap((w) =>
    w.pos.flatMap((po) =>
      po.lines.map((l) => ({
        material: l.material,
        facility: w.meta.facility,
        at: po.orderedAt,
        unitPriceUsdc: l.unitPriceUsdc,
      })),
    ),
  );
}
