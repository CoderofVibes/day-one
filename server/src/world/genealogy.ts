// The worlds' part of the lot genealogy (docs/UPGRADE_BRIEF.md §2.3): the generated lots,
// batches and draws the ledger does not hold, every plant's finished-goods lots (the ledger has
// none: its batch_outputs table is empty) and their shipments to customers, as the same rows
// genealogyTables() reads from the ledger. mergeGenealogyTables joins the two; the ledger's
// rows win where both hold a record.

import type { GenealogyTables } from "../ledger/genealogy.ts";
import { vendorLotCode } from "../seed/lots.ts";
import { MATERIALS, PRODUCTS, VENDORS } from "../seed/reference.ts";
import type { World } from "./index.ts";

const MG_PER_KG = 1_000_000;

/** Genealogy rows from the worlds: generated eras, plus finished goods and shipments for all. */
export function worldGenealogyTables(worlds: readonly World[]): GenealogyTables {
  const t: GenealogyTables = {
    lots: [],
    received: [],
    receipts: [],
    qc: [],
    poLines: [],
    batches: [],
    inputs: [],
    outputs: [],
    shipments: [],
  };
  const balance = new Map<string, number>();
  const lastAt = new Map<string, string>();
  for (const w of worlds) {
    for (const m of w.movements) {
      balance.set(m[1], (balance.get(m[1]) ?? 0) + m[3]);
      // Where a lot is now: the plant of its last movement in (or the only plant it was at).
      if (m[3] > 0 || !lastAt.has(m[1])) lastAt.set(m[1], w.meta.facility);
    }
  }
  const seen = new Set<string>();
  for (const w of worlds) {
    const facility = w.meta.facility;
    const customers = new Map(w.customers.map((c) => [c.code, c.name]));
    for (const l of w.lots) {
      if (l.era === "anchor" || seen.has(l.lot)) continue;
      seen.add(l.lot);
      const m = MATERIALS.find((x) => x.code === l.material);
      const onHand = balance.get(l.lot) ?? 0;
      t.lots.push({
        code: l.lot,
        material: l.material,
        materialName: m?.name ?? l.material,
        category: m?.category ?? "",
        dimension: m?.uom === "kg" ? "mass" : "count",
        vendor: l.vendor,
        vendorName: VENDORS.find((x) => x.code === l.vendor)?.name ?? null,
        vendorLot: vendorLotCode(l.vendor, l.lot),
        state: l.qc?.result === "rejected" ? "rejected" : onHand > 0 ? "released" : "consumed",
        facility: lastAt.get(l.lot) ?? facility,
        onHandBase: onHand,
        producedBy: null,
      });
      t.received.push({ lot: l.lot, qtyBase: l.qtyBase, at: l.receivedAt, po: l.poNo });
      if (l.qc) t.qc.push({ lot: l.lot, decision: l.qc.result, decidedAt: l.qc.at, by: null });
    }
    for (const r of w.receipts) {
      if (r.era === "anchor") continue;
      t.receipts.push({ po: r.poNo, receivedAt: r.receivedAt, by: null });
    }
    for (const p of w.pos) {
      if (p.era === "anchor") continue;
      for (const l of p.lines) {
        const kg = MATERIALS.find((x) => x.code === l.material)?.uom === "kg";
        t.poLines.push({
          po: p.poNo,
          material: l.material,
          unitPriceUsdc: l.unitPriceUsdc,
          basePerUnit: kg ? MG_PER_KG : 1,
        });
      }
    }
    for (const b of w.batches) {
      if (b.era === "anchor") continue;
      t.batches.push({
        batchNo: b.batchNo,
        facility,
        product: b.product,
        productName: PRODUCTS.find((p) => p.code === b.product)?.name ?? b.product,
        completedAt: `${b.date}T18:00:00.000Z`,
        units: b.actualUnits,
      });
      for (const c of b.consumption)
        t.inputs.push({ batch: b.batchNo, lot: c.lot, qtyBase: c.actualBase });
    }
    const fgLeft = new Map<string, number>();
    for (const m of w.fgMovements) fgLeft.set(m[1], (fgLeft.get(m[1]) ?? 0) + m[2]);
    for (const f of w.fgLots) {
      const left = fgLeft.get(f.fgLot) ?? 0;
      t.lots.push({
        code: f.fgLot,
        material: f.product,
        materialName: PRODUCTS.find((p) => p.code === f.product)?.name ?? f.product,
        category: "finished_good",
        dimension: "count",
        vendor: null,
        vendorName: null,
        vendorLot: null,
        state: left > 0 ? "released" : "consumed",
        facility,
        onHandBase: left,
        producedBy: f.batchNo,
      });
      t.received.push({
        lot: f.fgLot,
        qtyBase: f.units,
        at: `${f.madeOn}T18:00:00.000Z`,
        po: null,
      });
      if (f.batchNo) t.outputs.push({ batch: f.batchNo, lot: f.fgLot });
    }
    for (const s of w.shipments) {
      for (const l of s.lines)
        t.shipments.push({
          shipmentNo: s.shipmentNo,
          customer: customers.get(s.customer) ?? s.customer,
          facility,
          shippedAt: s.shippedAt,
          lot: l.fgLot,
          qtyBase: l.units,
        });
    }
  }
  return t;
}

/**
 * The ledger's rows and the worlds', one index: a lot, batch or PO line the ledger holds is
 * taken from the ledger; the worlds add the rest. Batches are listed by completion, as the ledger lists them.
 */
export function mergeGenealogyTables(
  ledger: GenealogyTables,
  world: GenealogyTables,
): GenealogyTables {
  const lotCodes = new Set(ledger.lots.map((l) => l.code));
  const batchNos = new Set(ledger.batches.map((b) => b.batchNo));
  const poNos = new Set(ledger.poLines.map((l) => l.po));
  const newLots = world.lots.filter((l) => !lotCodes.has(l.code));
  const added = new Set(newLots.map((l) => l.code));
  const newBatches = world.batches.filter((b) => !batchNos.has(b.batchNo));
  const addedBatches = new Set(newBatches.map((b) => b.batchNo));
  return {
    lots: [...ledger.lots, ...newLots],
    received: [...ledger.received, ...world.received.filter((r) => added.has(r.lot))],
    receipts: [...ledger.receipts, ...world.receipts.filter((r) => !poNos.has(r.po))],
    qc: [...ledger.qc, ...world.qc.filter((q) => added.has(q.lot))],
    poLines: [...ledger.poLines, ...world.poLines.filter((l) => !poNos.has(l.po))],
    batches: [...ledger.batches, ...newBatches].sort(
      (a, b) =>
        (a.completedAt ?? "").localeCompare(b.completedAt ?? "") ||
        a.batchNo.localeCompare(b.batchNo),
    ),
    inputs: [...ledger.inputs, ...world.inputs.filter((i) => addedBatches.has(i.batch))],
    outputs: [...ledger.outputs, ...world.outputs],
    shipments: [...ledger.shipments, ...world.shipments],
  };
}
