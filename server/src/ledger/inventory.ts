// Three facilities, one truth (SPEC step 3): what each plant holds of each material, from the
// lot balances, with the material's reorder point and every transfer discrepancy and its
// proposed adjustment. A read for the HQ view; nothing here changes the ledger.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Ledger } from "./db.ts";
import type { LotEventInput } from "./events.ts";
import { discrepancies, facilities, lotBalances, lots, materials, transfers } from "./schema.ts";

/** Lot states that hold quantity on a plant's floor. */
const ON_FLOOR = ["received", "quarantine", "released", "in_use"] as const;
/** Of those, what Kevin can plan to use; the rest waits for QC. */
const USABLE = ["released", "in_use"] as const;

export interface PlantStock {
  onHandBase: number;
  usableBase: number;
  lots: number;
  /** On hand below the material's reorder point, at a plant that stocks it. */
  low: boolean;
}

export interface MaterialStock {
  code: string;
  name: string;
  category: string;
  dimension: string;
  baseUnit: string;
  reorderPointBase: number | null;
  /** Keyed by facility code; only plants that hold any of it appear. */
  byPlant: Record<string, PlantStock>;
}

export interface DiscrepancyView {
  id: number;
  kind: string;
  status: string;
  lotCode: string | null;
  material: string | null;
  facility: string;
  expectedBase: number;
  observedBase: number;
  explanation: string | null;
  /** For a waste correction, `qtyDeltaBase` is the waste to add, not a stock movement. */
  proposed: { facility: string; qtyDeltaBase: number; reason: string | null } | null;
  transferNo: string | null;
  /** The batch a mass-balance waste correction is for. */
  batchNo: string | null;
}

export interface PlantInventory {
  facilities: { code: string; name: string; role: string }[];
  materials: MaterialStock[];
  discrepancies: DiscrepancyView[];
}

export function plantInventory(db: Ledger): PlantInventory {
  const plants = db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      role: facilities.role,
    })
    .from(facilities)
    .where(sql`${facilities.role} <> 'hq'`)
    .orderBy(asc(facilities.code))
    .all();
  const codeOf = new Map(plants.map((p) => [p.id, p.code]));

  const rows = db
    .select({
      materialId: lots.materialId,
      facilityId: lotBalances.facilityId,
      state: lots.state,
      base: sql<number>`coalesce(sum(${lotBalances.onHandBase}), 0)`,
      lots: sql<number>`count(*)`,
    })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .where(
      and(
        inArray(lots.state, [...ON_FLOOR] as (typeof lots.state._.data)[]),
        sql`${lotBalances.onHandBase} > 0`,
      ),
    )
    .groupBy(lots.materialId, lotBalances.facilityId, lots.state)
    .all();

  const byMaterial = new Map<number, Record<string, PlantStock>>();
  for (const r of rows) {
    const plant = codeOf.get(r.facilityId);
    if (!plant) continue;
    const stock = byMaterial.get(r.materialId) ?? {};
    const s = stock[plant] ?? { onHandBase: 0, usableBase: 0, lots: 0, low: false };
    s.onHandBase += r.base;
    s.lots += r.lots;
    if ((USABLE as readonly string[]).includes(r.state ?? "")) s.usableBase += r.base;
    stock[plant] = s;
    byMaterial.set(r.materialId, stock);
  }

  const mats = db
    .select()
    .from(materials)
    .orderBy(asc(materials.category), asc(materials.code))
    .all()
    .filter((m) => byMaterial.has(m.id))
    .map((m) => {
      const byPlant = byMaterial.get(m.id) ?? {};
      for (const s of Object.values(byPlant)) {
        s.low = m.reorderPointBase !== null && s.onHandBase < m.reorderPointBase;
      }
      return {
        code: m.code,
        name: m.name,
        category: m.category,
        dimension: m.dimension,
        baseUnit: m.baseUnit,
        reorderPointBase: m.reorderPointBase,
        byPlant,
      };
    });

  const found = db
    .select({
      d: discrepancies,
      lotCode: lots.lotCode,
      materialCode: materials.code,
      facilityCode: facilities.code,
    })
    .from(discrepancies)
    .leftJoin(lots, eq(lots.id, discrepancies.lotId))
    .leftJoin(materials, eq(materials.id, lots.materialId))
    .innerJoin(facilities, eq(facilities.id, discrepancies.facilityId))
    .orderBy(asc(discrepancies.id))
    .all()
    .map(({ d, lotCode, materialCode, facilityCode }) => {
      const parsed = d.proposedEventJson
        ? (JSON.parse(d.proposedEventJson) as
            | LotEventInput
            | {
                kind: "waste_correction";
                batchNo: string;
                facilityId: number;
                wasteDeltaBase: number;
                reason: string;
              })
        : null;
      // A mass-balance waste correction moves no lot: its quantity is waste added on review.
      const waste = parsed?.kind === "waste_correction" ? parsed : null;
      const proposed = waste
        ? { facilityId: waste.facilityId, qtyDeltaBase: waste.wasteDeltaBase, reason: waste.reason }
        : (parsed as LotEventInput | null);
      const transfer =
        !waste &&
        proposed &&
        "refType" in proposed &&
        proposed.refType === "transfer" &&
        proposed.refId
          ? db
              .select({ no: transfers.transferNo })
              .from(transfers)
              .where(eq(transfers.id, proposed.refId))
              .get()?.no
          : null;
      return {
        id: d.id,
        kind: d.kind,
        status: d.status,
        lotCode,
        material: materialCode,
        facility: facilityCode,
        expectedBase: d.expectedBase,
        observedBase: d.observedBase,
        explanation: d.explanation,
        proposed: proposed
          ? {
              facility: codeOf.get(proposed.facilityId) ?? String(proposed.facilityId),
              qtyDeltaBase: proposed.qtyDeltaBase,
              reason: proposed.reason ?? null,
            }
          : null,
        transferNo: transfer ?? null,
        batchNo: waste?.batchNo ?? null,
      };
    });

  return {
    facilities: plants.map(({ code, name, role }) => ({ code, name, role })),
    materials: mats,
    discrepancies: found,
  };
}
