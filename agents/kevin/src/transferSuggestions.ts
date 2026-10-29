// Before you buy, look at the other plants (FEATURES_V2 §3, forecast side). For each material,
// Kevin projects every plant over the horizon. A plant is short when stock on hand and on order
// minus the planned need falls below the reorder point; another plant has surplus when its usable
// stock minus its own need stays above the reorder point. Kevin proposes moving the smaller of
// the two, from released lots that do not expire inside the horizon, earliest expiry first.
// A read only: nothing is moved until someone approves, and approval is not built yet.

import type { Ledger } from "@day-one/server/ledger/db";
import {
  facilities,
  lotBalances,
  lots,
  materials,
  poLines,
  purchaseOrders,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { amount, DEFAULT_HORIZON_DAYS, projectMaterial } from "./forecast.ts";

/** PO states whose price was really paid or committed. */
const PRICED_PO = ["funded", "shipped", "received", "released", "paid"] as const;

export interface TransferLot {
  lotCode: string;
  qtyBase: number;
  expiresOn: string | null;
}

export interface TransferSuggestion {
  material: string;
  materialName: string;
  dimension: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  qtyBase: number;
  lots: TransferLot[];
  /** What the receiving plant lacks to stay at its reorder point over the horizon. */
  shortBase: number;
  /** What the sending plant holds above its own need and reorder point. */
  surplusBase: number;
  /** The reorder Kevin would otherwise recommend at the receiving plant, if any. */
  avoidedOrderBase: number | null;
  /** The moved quantity at the last price paid, in micro-USDC; null with no price history. */
  valueUsdc: number | null;
  sentence: string;
}

export interface SuggestInput {
  now: string;
  horizonDays?: number;
  /** One material only; every material by default. */
  material?: string;
}

/** Last price paid per base unit, from the newest priced PO line of the material. */
function lastPrice(db: Ledger, materialId: number) {
  const row = db
    .select({ qty: poLines.qtyBase, ext: poLines.extendedUsdc })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(
      and(
        eq(poLines.materialId, materialId),
        sql`${purchaseOrders.status} in (${sql.join(
          PRICED_PO.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(purchaseOrders.id))
    .get();
  return row && row.qty > 0 ? row.ext / row.qty : null;
}

export function suggestTransfers(db: Ledger, input: SuggestInput): TransferSuggestion[] {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const until = new Date(Date.parse(input.now) + horizonDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const plants = db
    .select()
    .from(facilities)
    .where(sql`${facilities.role} <> 'hq'`)
    .orderBy(asc(facilities.code))
    .all();
  const mats = db
    .select()
    .from(materials)
    .where(input.material ? eq(materials.code, input.material) : undefined)
    .orderBy(asc(materials.code))
    .all();

  const out: TransferSuggestion[] = [];
  for (const m of mats) {
    const reorderPoint = m.reorderPointBase ?? 0;
    const positions = plants.map((p) => {
      const f = projectMaterial(db, {
        facility: p.code,
        material: m.code,
        now: input.now,
        horizonDays,
      });
      // Movable: released lots at this plant that outlast the horizon. A lot in use is on the
      // line; quarantined and received lots wait for QC.
      const movable = db
        .select({
          lotCode: lots.lotCode,
          qtyBase: lotBalances.onHandBase,
          expiresOn: lots.expiresOn,
        })
        .from(lotBalances)
        .innerJoin(lots, eq(lots.id, lotBalances.lotId))
        .where(
          and(
            eq(lots.materialId, m.id),
            eq(lotBalances.facilityId, p.id),
            eq(lots.state, "released"),
            gt(lotBalances.onHandBase, 0),
            sql`(${lots.expiresOn} is null or ${lots.expiresOn} > ${until})`,
          ),
        )
        .orderBy(sql`${lots.expiresOn} is null`, asc(lots.expiresOn), asc(lots.lotCode))
        .all();
      const movableBase = movable.reduce((s, l) => s + l.qtyBase, 0);
      const after = f.onHandBase + f.onOrderBase - f.needBase;
      return {
        plant: p,
        forecast: f,
        movable,
        shortBase: Math.max(0, reorderPoint - after),
        // Surplus counts usable stock only: what is on order is not there to send.
        surplusBase: Math.max(0, Math.min(f.onHandBase - f.needBase - reorderPoint, movableBase)),
      };
    });

    // Plants that stock nothing of it and need nothing are not short of it.
    const short = positions.filter(
      (p) => p.shortBase > 0 && (p.forecast.onHandBase > 0 || p.forecast.needBase > 0),
    );
    const price = short.length ? lastPrice(db, m.id) : null;
    for (const to of short) {
      let remaining = to.shortBase;
      for (const from of positions) {
        if (remaining <= 0) break;
        if (from === to || from.surplusBase <= 0) continue;
        const qtyBase = Math.min(remaining, from.surplusBase);
        const picked: TransferLot[] = [];
        let left = qtyBase;
        for (const lot of from.movable) {
          if (left <= 0) break;
          const take = Math.min(left, lot.qtyBase);
          picked.push({ lotCode: lot.lotCode, qtyBase: take, expiresOn: lot.expiresOn });
          lot.qtyBase -= take;
          left -= take;
        }
        from.surplusBase -= qtyBase;
        remaining -= qtyBase;

        const covered = remaining <= 0;
        const avoidedOrderBase = covered ? to.forecast.recommendQtyBase : null;
        // Rounded to the cent, the smallest amount the books show.
        const valueUsdc = price === null ? null : Math.round((qtyBase * price) / 10_000) * 10_000;
        const fmt = (base: number) => amount(base, m.dimension);
        const sentence = [
          `Before you buy: ${from.plant.name} has ${fmt(from.surplusBase + qtyBase)} of ${m.name} (${m.code}) above its own need and reorder point.`,
          `Moving ${fmt(qtyBase)} (${picked.map((l) => l.lotCode).join(", ")}) to ${to.plant.name} ${
            covered
              ? "keeps it at its reorder point"
              : `covers ${fmt(qtyBase)} of the ${fmt(to.shortBase)} it lacks`
          }${avoidedOrderBase ? ` instead of ordering ${fmt(avoidedOrderBase)}` : ""}.`,
          valueUsdc === null
            ? ""
            : `That is about ${formatUsd(BigInt(valueUsdc))} of stock at the last price paid.`,
        ]
          .filter(Boolean)
          .join(" ");
        out.push({
          material: m.code,
          materialName: m.name,
          dimension: m.dimension,
          from: from.plant.code,
          fromName: from.plant.name,
          to: to.plant.code,
          toName: to.plant.name,
          qtyBase,
          lots: picked,
          shortBase: to.shortBase,
          surplusBase: from.surplusBase + qtyBase,
          avoidedOrderBase,
          valueUsdc,
          sentence,
        });
      }
    }
  }
  return out;
}
