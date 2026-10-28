// Loads the fictional company into an empty ledger: reference rows first, then every lot
// event in time order through appendLotEvent, so the seed obeys the same rules as live writes.

import { eq } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import { appendLotEvent } from "../ledger/events.ts";
import {
  departments,
  facilities,
  formulaLines,
  formulas,
  lots,
  materials,
  materialUnitConversions,
  products,
  staff,
  transfers,
  units,
  vendorMaterials,
  vendors,
} from "../ledger/schema.ts";
import { LOTS, type Step, TRANSFERS } from "./lots.ts";
import {
  DEPARTMENTS_BY_FACILITY,
  EXPECTED_YIELD_BP,
  FACILITIES,
  FORMULAS_EFFECTIVE_FROM,
  kg,
  MATERIALS,
  PRODUCTS,
  STAFF,
  TOLERANCE_BP,
  toBase,
  UNITS,
  VENDORS,
} from "./reference.ts";

/** When Plants A and C joined Acme's systems; Plant B has not yet. */
const ONLINE_SINCE = "2026-01-01T00:00:00.000Z";

function idOf<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`seed: unknown code ${key}`);
  return value;
}

export function seedLedger(db: Ledger) {
  db.transaction((tx) => {
    tx.insert(units)
      .values(
        UNITS.map((u) => ({
          code: u.code,
          dimension: u.dimension,
          toBaseNum: u.num,
          toBaseDen: u.den,
        })),
      )
      .run();

    const facilityId = new Map<string, number>();
    for (const f of FACILITIES) {
      const row = tx
        .insert(facilities)
        .values({
          code: f.code,
          name: f.name,
          role: f.role,
          nearAccountId: f.account,
          onboardingStatus: f.code === "B" ? "grey" : "online",
        })
        .returning()
        .get();
      facilityId.set(f.code, row.id);
    }

    for (const [code, depts] of Object.entries(DEPARTMENTS_BY_FACILITY)) {
      const online = code !== "B";
      tx.insert(departments)
        .values(
          depts.map((d) => ({
            facilityId: idOf(facilityId, code),
            code: d as (typeof departments.$inferInsert)["code"],
            onboardingStatus: online ? ("online" as const) : ("grey" as const),
            onboardedAt: online ? ONLINE_SINCE : null,
          })),
        )
        .run();
    }

    tx.insert(staff)
      .values(
        STAFF.map((s) => ({
          facilityId: idOf(facilityId, s.facility),
          name: s.name,
          role: s.role,
          nearAccountId: "account" in s ? s.account : null,
        })),
      )
      .run();

    const materialId = new Map<string, number>();
    for (const mat of MATERIALS) {
      const row = tx
        .insert(materials)
        .values({
          code: mat.code,
          name: mat.name,
          category: mat.category,
          dimension: mat.uom === "kg" ? "mass" : "count",
          baseUnit: mat.uom === "kg" ? "mg" : "each",
          reorderPointBase: toBase(mat, mat.reorderPoint),
          reorderQtyBase: toBase(mat, mat.reorderQty),
        })
        .returning()
        .get();
      materialId.set(mat.code, row.id);
    }
    // Ascorbic acid ships in 25 kg bags (§8).
    tx.insert(materialUnitConversions)
      .values({ materialId: idOf(materialId, "ASC"), unitCode: "bag", toBaseNum: kg(25) })
      .run();

    for (const p of PRODUCTS) {
      const product = tx
        .insert(products)
        .values({
          code: p.code,
          name: p.name,
          tabletWeightMg: p.tabletWeightMg,
          standardBatchTablets: p.batchTablets,
          expectedYieldBp: EXPECTED_YIELD_BP,
        })
        .returning()
        .get();
      const formula = tx
        .insert(formulas)
        .values({
          productId: product.id,
          version: 1,
          status: "active",
          effectiveFrom: FORMULAS_EFFECTIVE_FROM,
        })
        .returning()
        .get();
      tx.insert(formulaLines)
        .values(
          p.lines.map(([code, kgPerBatch, overageBp]) => ({
            formulaId: formula.id,
            materialId: idOf(materialId, code),
            qtyPerBatchBase: kg(kgPerBatch),
            overageBp,
            toleranceBp: TOLERANCE_BP,
          })),
        )
        .run();
    }

    const vendorId = new Map<string, number>();
    for (const v of VENDORS) {
      const row = tx
        .insert(vendors)
        .values({
          code: v.code,
          name: v.name,
          nearAccountId: v.account ?? null,
          qualificationStatus: v.qualification,
          notes: v.notes ?? null,
        })
        .returning()
        .get();
      vendorId.set(v.code, row.id);
      tx.insert(vendorMaterials)
        .values(
          v.supplies.map((code) => ({
            vendorId: row.id,
            materialId: idOf(materialId, code),
            approvedSource: v.qualification === "qualified" || v.qualification === "conditional",
          })),
        )
        .run();
    }

    const lotId = new Map<string, number>();
    for (const lot of LOTS) {
      const row = tx
        .insert(lots)
        .values({
          lotCode: lot.code,
          materialId: idOf(materialId, lot.material),
          vendorId: idOf(vendorId, lot.vendor),
          vendorLotCode: `${lot.vendor}-${lot.code.split("-")[1]}${lot.code.split("-")[2]}`,
        })
        .returning()
        .get();
      lotId.set(lot.code, row.id);
    }

    const transferId = new Map<string, number>();
    for (const tr of TRANSFERS) {
      const mat = MATERIALS.find((x) => x.code === tr.lot.split("-")[0]);
      if (!mat) throw new Error(`seed: no material for ${tr.lot}`);
      const row = tx
        .insert(transfers)
        .values({
          transferNo: tr.transferNo,
          lotId: idOf(lotId, tr.lot),
          fromFacilityId: idOf(facilityId, tr.from),
          toFacilityId: idOf(facilityId, tr.to),
          qtyShippedBase: toBase(mat, tr.shipped),
          qtyReceivedBase: toBase(mat, tr.received),
          state: "in_transit",
        })
        .returning()
        .get();
      transferId.set(tr.transferNo, row.id);
    }

    // Every step of every lot, in time order (stable for equal times).
    const steps: { lot: (typeof LOTS)[number]; step: Step }[] = LOTS.flatMap((lot) =>
      lot.steps.map((step) => ({ lot, step })),
    ).sort((a, b) => (a.step.at < b.step.at ? -1 : a.step.at > b.step.at ? 1 : 0));

    for (const { lot, step } of steps) {
      const mat = MATERIALS.find((x) => x.code === lot.material);
      if (!mat) throw new Error(`seed: no material ${lot.material}`);
      const trId = step.transfer ? idOf(transferId, step.transfer) : null;
      const event = appendLotEvent(tx, {
        lotId: idOf(lotId, lot.code),
        kind: step.kind,
        qtyDeltaBase: toBase(mat, step.qty ?? 0),
        facilityId: idOf(facilityId, step.facility ?? lot.facility),
        refType: trId === null ? null : "transfer",
        refId: trId,
        actorType: "system",
        reason: step.reason ?? null,
        occurredAt: step.at,
      });
      if (trId !== null) {
        tx.update(transfers)
          .set(
            step.kind === "transfer_out"
              ? { outEventId: event.id }
              : { inEventId: event.id, state: "received" },
          )
          .where(eq(transfers.id, trId))
          .run();
      }
    }
  });
}
