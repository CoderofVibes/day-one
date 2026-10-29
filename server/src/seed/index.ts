// Loads the fictional company into an empty ledger: reference rows first, then the history POs,
// then every lot event, transfer and batch draw in time order through appendLotEvent, so the
// seed obeys the same rules as live writes.

import { and, asc, eq, gt } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import { appendLotEvent } from "../ledger/events.ts";
import {
  batchInputs,
  batchRecords,
  departments,
  facilities,
  formulaLines,
  formulas,
  lotBalances,
  lots,
  materials,
  materialUnitConversions,
  poLines,
  productionPlan,
  products,
  purchaseOrders,
  qcDecisions,
  receipts,
  staff,
  transfers,
  units,
  vendorMaterials,
  vendors,
} from "../ledger/schema.ts";
import {
  type BatchSpec,
  HISTORY_BATCHES,
  HISTORY_POS,
  PLANNED_BATCHES,
  QC_SAMPLE_MG,
} from "./history.ts";
import { LOTS, TRANSFERS, t, vendorLotCode } from "./lots.ts";
import {
  DEPARTMENTS_BY_FACILITY,
  EXPECTED_YIELD_BP,
  FACILITIES,
  type FacilityCode,
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

/** Summarized batches book their draws early in the morning, before any receipt or transfer. */
const BATCH_TIMES = { issued: "06:00", consumed: "06:30", returned: "06:50", completed: "18:00" };

/** Token base units (6 decimals) from a dollar price such as 0.021. */
const usd = (dollars: number) => Math.round(dollars * 1_000_000);

const lotMaterial = (lotCode: string) => lotCode.split("-")[0] ?? "";

function material(code: string) {
  const mat = MATERIALS.find((x) => x.code === code);
  if (!mat) throw new Error(`seed: no material ${code}`);
  return mat;
}

function idOf<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`seed: unknown code ${key}`);
  return value;
}

/** `referenceOnly` stops after the reference rows: no POs, lots or history (an empty plant). */
export function seedLedger(db: Ledger, options: { referenceOnly?: boolean } = {}) {
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

    const productInfo = new Map<
      string,
      {
        productId: number;
        formulaId: number;
        tabletWeightMg: number;
        batchTablets: number;
        lines: (typeof PRODUCTS)[number]["lines"];
      }
    >();
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
      productInfo.set(p.code, {
        productId: product.id,
        formulaId: formula.id,
        tabletWeightMg: p.tabletWeightMg,
        batchTablets: p.batchTablets,
        lines: p.lines,
      });
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

    if (options.referenceOnly) return;

    const lotId = new Map<string, number>();
    for (const lot of LOTS) {
      const row = tx
        .insert(lots)
        .values({
          lotCode: lot.code,
          materialId: idOf(materialId, lot.material),
          vendorId: idOf(vendorId, lot.vendor),
          vendorLotCode: vendorLotCode(lot.vendor, lot.code),
        })
        .returning()
        .get();
      lotId.set(lot.code, row.id);
    }

    const staffId = (name: string) => {
      const row = tx.select().from(staff).where(eq(staff.name, name)).get();
      if (!row) throw new Error(`seed: no staff ${name}`);
      return row.id;
    };
    // Plant B's receiving lead and QC manager sign its history; A and C have no named staff.
    const receiver: Partial<Record<FacilityCode, number>> = { B: staffId("Tommy Reyes") };
    const qcLead: Partial<Record<FacilityCode, number>> = { B: staffId("Priya Natarajan") };

    const poId = new Map<string, number>();
    for (const po of HISTORY_POS) {
      const lines = po.lines.map(([code, qty, price], i) => {
        const mat = material(code);
        const unitPriceUsdc = usd(price);
        return {
          lineNo: i + 1,
          materialId: idOf(materialId, code),
          qtyBase: toBase(mat, qty),
          unit: mat.uom === "kg" ? "kg" : "each",
          unitPriceUsdc,
          extendedUsdc: Math.round(qty * unitPriceUsdc),
        };
      });
      const row = tx
        .insert(purchaseOrders)
        .values({
          poNo: po.poNo,
          vendorId: idOf(vendorId, po.vendor),
          shipToFacilityId: idOf(facilityId, po.shipTo),
          category: po.category,
          totalUsdc: lines.reduce((sum, l) => sum + l.extendedUsdc, 0),
          status: "paid",
          createdBy: "staff",
        })
        .returning()
        .get();
      tx.insert(poLines)
        .values(lines.map((l) => ({ ...l, poId: row.id })))
        .run();
      poId.set(po.poNo, row.id);
    }

    const transferId = new Map<string, number>();
    for (const tr of TRANSFERS) {
      const mat = material(lotMaterial(tr.lot));
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

    // One timeline of lot steps, transfers and batches, applied in time order (stable for
    // equal times), so each batch draws from exactly the stock released by its day.
    const timeline: { at: string; apply: () => void }[] = [];

    for (const lot of LOTS) {
      const mat = material(lot.material);
      const po = lot.po ? idOf(poId, lot.po) : null;
      for (const step of lot.steps) {
        timeline.push({
          at: step.at,
          apply: () => {
            const facilityCode = step.facility ?? lot.facility;
            let ref: { refType: "po" | "qc"; refId: number } | null = null;
            if (step.kind === "received" && po !== null) {
              ref = { refType: "po", refId: po };
              const booked = tx.select().from(receipts).where(eq(receipts.poId, po)).get();
              if (!booked) {
                tx.insert(receipts)
                  .values({
                    poId: po,
                    facilityId: idOf(facilityId, facilityCode),
                    matchStatus: "matched",
                    receivedBy: receiver[facilityCode] ?? null,
                    receivedAt: step.at,
                  })
                  .run();
              }
            }
            if (step.kind === "released" || step.kind === "rejected") {
              const decision = tx
                .insert(qcDecisions)
                .values({
                  lotId: idOf(lotId, lot.code),
                  poId: po,
                  decision: step.kind,
                  decidedBy: qcLead[facilityCode] ?? null,
                  decidedAt: step.at,
                })
                .returning()
                .get();
              ref = { refType: "qc", refId: decision.id };
            }
            appendLotEvent(tx, {
              lotId: idOf(lotId, lot.code),
              kind: step.kind,
              qtyDeltaBase: toBase(mat, step.qty ?? 0),
              facilityId: idOf(facilityId, facilityCode),
              refType: ref?.refType ?? null,
              refId: ref?.refId ?? null,
              actorType: "system",
              reason: step.reason ?? null,
              occurredAt: step.at,
            });
          },
        });
      }
    }

    for (const tr of TRANSFERS) {
      const mat = material(lotMaterial(tr.lot));
      const id = idOf(transferId, tr.transferNo);
      const move = (
        kind: "transfer_out" | "transfer_in",
        at: string,
        qty: number,
        facility: FacilityCode,
      ) =>
        timeline.push({
          at,
          apply: () => {
            const event = appendLotEvent(tx, {
              lotId: idOf(lotId, tr.lot),
              kind,
              qtyDeltaBase: toBase(mat, qty),
              facilityId: idOf(facilityId, facility),
              refType: "transfer",
              refId: id,
              actorType: "system",
              occurredAt: at,
            });
            tx.update(transfers)
              .set(
                kind === "transfer_out"
                  ? { outEventId: event.id }
                  : { inEventId: event.id, state: "received" },
              )
              .where(eq(transfers.id, id))
              .run();
          },
        });
      move("transfer_out", tr.shippedAt, -tr.shipped, tr.from);
      move("transfer_in", tr.receivedAt, tr.received, tr.to);
    }

    /** Books a summarized batch, drawing each formula line first-in, first-out. */
    const bookBatch = (batch: BatchSpec) => {
      const product = idOf(productInfo, batch.product);
      const facility = idOf(facilityId, batch.facility);
      const issuedMg = product.lines.reduce(
        (sum, [code, kgPerBatch]) => sum + kg(kgPerBatch) + (batch.extraMg?.[code] ?? 0),
        0,
      );
      const at = (hhmm: string) => t(batch.date, hhmm);
      const row = tx
        .insert(batchRecords)
        .values({
          batchNo: batch.batchNo,
          productId: product.productId,
          formulaId: product.formulaId,
          facilityId: facility,
          startedAt: at(BATCH_TIMES.issued),
          completedAt: at(BATCH_TIMES.completed),
          theoreticalTablets: product.batchTablets,
          actualTablets: batch.tablets,
          yieldBp: Math.round((batch.tablets * 10_000) / product.batchTablets),
          wasteBase:
            batch.wasteMg ?? issuedMg - batch.tablets * product.tabletWeightMg - QC_SAMPLE_MG,
          status: "confirmed",
          confirmedAt: at(BATCH_TIMES.completed),
        })
        .returning()
        .get();

      // Pick the lots first, then issue, consume and return in three passes so event times
      // stay in order across lots.
      const draws: { lotId: number; materialId: number; qty: number }[] = [];
      for (const [code, kgPerBatch] of product.lines) {
        let remaining = kg(kgPerBatch) + (batch.extraMg?.[code] ?? 0);
        const candidates = tx
          .select({ lotId: lots.id, onHand: lotBalances.onHandBase })
          .from(lotBalances)
          .innerJoin(lots, eq(lots.id, lotBalances.lotId))
          .where(
            and(
              eq(lots.materialId, idOf(materialId, code)),
              eq(lots.state, "released"),
              eq(lotBalances.facilityId, facility),
              gt(lotBalances.onHandBase, 0),
            ),
          )
          .orderBy(asc(lots.lotCode))
          .all();
        for (const c of candidates) {
          if (remaining === 0) break;
          const qty = Math.min(remaining, c.onHand);
          remaining -= qty;
          draws.push({ lotId: c.lotId, materialId: idOf(materialId, code), qty });
        }
        if (remaining > 0) {
          throw new Error(`seed: ${batch.batchNo} is short ${remaining} mg of ${code}`);
        }
      }

      const event = (lot: number, kind: "issued" | "consumed" | "returned", qty: number) =>
        appendLotEvent(tx, {
          lotId: lot,
          kind,
          qtyDeltaBase: qty,
          facilityId: facility,
          refType: "batch",
          refId: row.id,
          actorType: "system",
          occurredAt: at(BATCH_TIMES[kind]),
        });
      for (const d of draws) event(d.lotId, "issued", 0);
      const consumed = draws.map((d) => event(d.lotId, "consumed", -d.qty));
      tx.insert(batchInputs)
        .values(
          draws.map((d, i) => ({
            batchId: row.id,
            lotId: d.lotId,
            materialId: d.materialId,
            actualBase: d.qty,
            issueEventId: consumed[i]?.id ?? null,
          })),
        )
        .run();
      for (const e of consumed) if (e.toState === "in_use") event(e.lotId, "returned", 0);
    };

    for (const batch of HISTORY_BATCHES) {
      timeline.push({ at: t(batch.date, BATCH_TIMES.issued), apply: () => bookBatch(batch) });
    }

    timeline
      .map((item, i) => ({ ...item, i }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i))
      .forEach((item) => {
        item.apply();
      });

    tx.insert(productionPlan)
      .values(
        PLANNED_BATCHES.map((p) => {
          const product = idOf(productInfo, p.product);
          return {
            batchNo: p.batchNo,
            productId: product.productId,
            facilityId: idOf(facilityId, p.facility),
            plannedFor: p.plannedFor,
            batchTablets: product.batchTablets,
          };
        }),
      )
      .run();
  });
}
