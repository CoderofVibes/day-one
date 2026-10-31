// Lot genealogy (docs/UPGRADE_BRIEF.md §2.3): which batches each lot went into, what those
// batches made, and where that went, forward to shipments and customers and back to the
// supplier's lot, the receipt and the PO. One read of the ledger's tables (genealogyTables) and
// one pure build over plain rows (buildGenealogy), so the index grows with the data. The walk
// over it lives with the page that draws it (web/src/genealogy.ts).
//
// What the ledger holds today: raw lots with their receipts and POs, and batch_inputs linking
// them to batches. batch_outputs is empty and there is no shipments table (DATA_MODEL), so the
// index says it has no finished-goods lots or shipments and traces stop at the batch. Shipment
// rows are part of the build so a ledger that records them is traced to its customers.

import { asc, eq, isNotNull } from "drizzle-orm";
import type { LedgerDb } from "./events.ts";
import {
  batchInputs,
  batchOutputs,
  batchRecords,
  facilities,
  lotBalances,
  lotEvents,
  lots,
  materials,
  poLines,
  products,
  purchaseOrders,
  qcDecisions,
  receipts,
  staff,
  units,
  vendors,
} from "./schema.ts";

export interface GenealogyLot {
  code: string;
  material: string;
  materialName: string;
  category: string;
  dimension: string;
  vendor: string | null;
  vendorName: string | null;
  /** The supplier's own lot reference, the one a supplier's notice names. */
  vendorLot: string | null;
  state: string | null;
  facility: string | null;
  onHandBase: number;
  receivedBase: number;
  receivedAt: string | null;
  po: string | null;
  receipt: { receivedAt: string; by: string | null } | null;
  qc: { decision: string; decidedAt: string; by: string | null } | null;
  /** Price per unit (kg or each) and base units per that unit; null when nothing prices it. */
  price: { unitPriceUsdc: number; basePerUnit: number; from: "po" | "average" } | null;
  /** The batch that made this lot (finished goods); null for a lot bought in. */
  producedBy: string | null;
  /** Batches that drew from this lot, in the order they were completed. */
  usedIn: string[];
  shippedIn: string[];
}
export interface GenealogyBatch {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  completedAt: string | null;
  units: number | null;
  inputs: { lot: string; qtyBase: number }[];
  outputs: string[];
}
export interface GenealogyShipment {
  shipmentNo: string;
  customer: string;
  facility: string;
  shippedAt: string;
  lots: { lot: string; qtyBase: number }[];
}
export interface Genealogy {
  lots: Record<string, GenealogyLot>;
  batches: Record<string, GenealogyBatch>;
  shipments: Record<string, GenealogyShipment>;
  /** Whether the ledger records finished-goods lots and shipments at all. */
  has: { fgLots: boolean; shipments: boolean };
}

/** The ledger's rows the index is built from, as plain values. */
export interface GenealogyTables {
  lots: Omit<
    GenealogyLot,
    "receivedBase" | "receivedAt" | "po" | "receipt" | "qc" | "price" | "usedIn" | "shippedIn"
  >[];
  received: { lot: string; qtyBase: number; at: string; po: string | null }[];
  receipts: { po: string; receivedAt: string; by: string | null }[];
  qc: { lot: string; decision: string; decidedAt: string; by: string | null }[];
  poLines: { po: string; material: string; unitPriceUsdc: number; basePerUnit: number }[];
  batches: Omit<GenealogyBatch, "inputs" | "outputs">[];
  inputs: { batch: string; lot: string; qtyBase: number }[];
  outputs: { batch: string; lot: string }[];
  shipments: {
    shipmentNo: string;
    customer: string;
    facility: string;
    shippedAt: string;
    lot: string;
    qtyBase: number;
  }[];
}

/** Reads the rows behind the index from the ledger. */
export function genealogyTables(db: LedgerDb): GenealogyTables {
  const facilityCode = new Map(
    db
      .select({ id: facilities.id, code: facilities.code })
      .from(facilities)
      .all()
      .map((f) => [f.id, f.code]),
  );
  const staffName = new Map(
    db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .all()
      .map((s) => [s.id, s.name]),
  );
  const named = (id: number | null) => (id === null ? null : (staffName.get(id) ?? null));
  const onHand = new Map<number, number>();
  for (const b of db.select().from(lotBalances).all()) {
    onHand.set(b.lotId, (onHand.get(b.lotId) ?? 0) + b.onHandBase);
  }
  const batchNo = new Map(
    db
      .select({ id: batchRecords.id, batchNo: batchRecords.batchNo })
      .from(batchRecords)
      .all()
      .map((b) => [b.id, b.batchNo]),
  );

  const lotRows = db
    .select({
      id: lots.id,
      code: lots.lotCode,
      material: materials.code,
      materialName: materials.name,
      category: materials.category,
      dimension: materials.dimension,
      vendor: vendors.code,
      vendorName: vendors.name,
      vendorLot: lots.vendorLotCode,
      state: lots.state,
      facilityId: lots.currentFacilityId,
      producedById: lots.producedByBatchId,
    })
    .from(lots)
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .leftJoin(vendors, eq(vendors.id, lots.vendorId))
    .orderBy(asc(lots.lotCode))
    .all();
  const lotCode = new Map(lotRows.map((l) => [l.id, l.code]));
  const codeOf = (id: number) => {
    const code = lotCode.get(id);
    if (code === undefined) throw new Error(`genealogy: no lot ${id}`);
    return code;
  };
  const batchOf = (id: number) => {
    const no = batchNo.get(id);
    if (no === undefined) throw new Error(`genealogy: no batch ${id}`);
    return no;
  };
  const poNo = new Map(
    db
      .select({ id: purchaseOrders.id, poNo: purchaseOrders.poNo })
      .from(purchaseOrders)
      .all()
      .map((p) => [p.id, p.poNo]),
  );

  return {
    lots: lotRows.map((l) => ({
      code: l.code,
      material: l.material,
      materialName: l.materialName,
      category: l.category,
      dimension: l.dimension,
      vendor: l.vendor,
      vendorName: l.vendorName,
      vendorLot: l.vendorLot,
      state: l.state,
      facility: l.facilityId === null ? null : (facilityCode.get(l.facilityId) ?? null),
      onHandBase: onHand.get(l.id) ?? 0,
      producedBy: l.producedById === null ? null : batchOf(l.producedById),
    })),
    received: db
      .select({
        lotId: lotEvents.lotId,
        qtyBase: lotEvents.qtyDeltaBase,
        at: lotEvents.occurredAt,
        refType: lotEvents.refType,
        refId: lotEvents.refId,
      })
      .from(lotEvents)
      .where(eq(lotEvents.kind, "received"))
      .orderBy(asc(lotEvents.seq))
      .all()
      .map((e) => ({
        lot: codeOf(e.lotId),
        qtyBase: e.qtyBase,
        at: e.at,
        po: e.refType === "po" && e.refId !== null ? (poNo.get(e.refId) ?? null) : null,
      })),
    receipts: db
      .select({ poId: receipts.poId, receivedAt: receipts.receivedAt, by: receipts.receivedBy })
      .from(receipts)
      .orderBy(asc(receipts.receivedAt))
      .all()
      .map((r) => ({ po: poNo.get(r.poId) ?? "", receivedAt: r.receivedAt, by: named(r.by) })),
    qc: db
      .select()
      .from(qcDecisions)
      .orderBy(asc(qcDecisions.decidedAt))
      .all()
      .map((q) => ({
        lot: codeOf(q.lotId),
        decision: q.decision,
        decidedAt: q.decidedAt,
        by: named(q.decidedBy),
      })),
    poLines: db
      .select({
        poId: poLines.poId,
        material: materials.code,
        unitPriceUsdc: poLines.unitPriceUsdc,
        num: units.toBaseNum,
        den: units.toBaseDen,
      })
      .from(poLines)
      .innerJoin(materials, eq(materials.id, poLines.materialId))
      .leftJoin(units, eq(units.code, poLines.unit))
      .all()
      .map((l) => ({
        po: poNo.get(l.poId) ?? "",
        material: l.material,
        unitPriceUsdc: l.unitPriceUsdc,
        // "each" is not a unit row; a count's base unit is one each.
        basePerUnit: l.num === null ? 1 : l.num / (l.den ?? 1),
      })),
    batches: db
      .select({
        batchNo: batchRecords.batchNo,
        facilityId: batchRecords.facilityId,
        product: products.code,
        productName: products.name,
        completedAt: batchRecords.completedAt,
        units: batchRecords.actualTablets,
      })
      .from(batchRecords)
      .innerJoin(products, eq(products.id, batchRecords.productId))
      .orderBy(asc(batchRecords.completedAt), asc(batchRecords.batchNo))
      .all()
      .map(({ facilityId, ...b }) => ({ ...b, facility: facilityCode.get(facilityId) ?? "" })),
    inputs: db
      .select({
        batchId: batchInputs.batchId,
        lotId: batchInputs.lotId,
        qty: batchInputs.actualBase,
      })
      .from(batchInputs)
      .orderBy(asc(batchInputs.id))
      .all()
      .map((i) => ({ batch: batchOf(i.batchId), lot: codeOf(i.lotId), qtyBase: i.qty })),
    outputs: [
      ...db
        .select()
        .from(batchOutputs)
        .all()
        .map((o) => ({ batch: batchOf(o.batchId), lot: codeOf(o.outputLotId) })),
      ...db
        .select({ id: lots.id, batchId: lots.producedByBatchId })
        .from(lots)
        .where(isNotNull(lots.producedByBatchId))
        .all()
        .map((l) => ({ batch: batchOf(l.batchId ?? 0), lot: codeOf(l.id) })),
    ],
    // The ledger has no shipments table yet (docs/DATA_MODEL.md); the build takes its rows when
    // one exists.
    shipments: [],
  };
}

/** Links the rows both ways. Pure: the same tables give the same index. */
export function buildGenealogy(t: GenealogyTables): Genealogy {
  const lotsOut: Record<string, GenealogyLot> = {};
  const received = new Map<string, GenealogyTables["received"][number]>();
  for (const r of t.received) if (!received.has(r.lot)) received.set(r.lot, r);
  const receipt = new Map<string, GenealogyTables["receipts"][number]>();
  for (const r of t.receipts) if (!receipt.has(r.po)) receipt.set(r.po, r);
  const qc = new Map<string, GenealogyTables["qc"][number]>();
  for (const q of t.qc) qc.set(q.lot, q);

  // A lot bought on a PO is priced from that PO's line; any other from the average of the
  // material's PO lines.
  const poPrice = new Map<string, { unitPriceUsdc: number; basePerUnit: number }>();
  const byMaterial = new Map<string, { sum: number; n: number; basePerUnit: number }>();
  for (const l of t.poLines) {
    poPrice.set(`${l.po}|${l.material}`, {
      unitPriceUsdc: l.unitPriceUsdc,
      basePerUnit: l.basePerUnit,
    });
    const m = byMaterial.get(l.material) ?? { sum: 0, n: 0, basePerUnit: l.basePerUnit };
    m.sum += l.unitPriceUsdc;
    m.n += 1;
    byMaterial.set(l.material, m);
  }
  const priceOf = (material: string, po: string | null): GenealogyLot["price"] => {
    const own = po === null ? undefined : poPrice.get(`${po}|${material}`);
    if (own) return { ...own, from: "po" };
    const avg = byMaterial.get(material);
    if (!avg) return null;
    return {
      unitPriceUsdc: Math.round(avg.sum / avg.n),
      basePerUnit: avg.basePerUnit,
      from: "average",
    };
  };

  for (const l of t.lots) {
    const r = received.get(l.code);
    const po = r?.po ?? null;
    const rec = po === null ? undefined : receipt.get(po);
    const q = qc.get(l.code);
    lotsOut[l.code] = {
      ...l,
      receivedBase: r?.qtyBase ?? 0,
      receivedAt: r?.at ?? null,
      po,
      receipt: rec ? { receivedAt: rec.receivedAt, by: rec.by } : null,
      qc: q ? { decision: q.decision, decidedAt: q.decidedAt, by: q.by } : null,
      price: priceOf(l.material, po),
      producedBy: l.producedBy,
      usedIn: [],
      shippedIn: [],
    };
  }

  const batches: Record<string, GenealogyBatch> = {};
  for (const b of t.batches) batches[b.batchNo] = { ...b, inputs: [], outputs: [] };
  const batch = (no: string) => {
    const b = batches[no];
    if (!b) throw new Error(`genealogy: no batch ${no}`);
    return b;
  };
  const lot = (code: string) => {
    const l = lotsOut[code];
    if (!l) throw new Error(`genealogy: no lot ${code}`);
    return l;
  };
  for (const i of t.inputs) {
    const b = batch(i.batch);
    const same = b.inputs.find((x) => x.lot === i.lot);
    if (same) same.qtyBase += i.qtyBase;
    else b.inputs.push({ lot: i.lot, qtyBase: i.qtyBase });
    const l = lot(i.lot);
    if (!l.usedIn.includes(i.batch)) l.usedIn.push(i.batch);
  }
  for (const o of t.outputs) {
    const b = batch(o.batch);
    if (!b.outputs.includes(o.lot)) b.outputs.push(o.lot);
    lot(o.lot).producedBy = o.batch;
  }
  // Batches are listed by completion, so each lot's usedIn follows the same order.
  const order = new Map(t.batches.map((b, i) => [b.batchNo, i]));
  for (const l of Object.values(lotsOut)) {
    l.usedIn.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  const shipments: Record<string, GenealogyShipment> = {};
  for (const s of t.shipments) {
    const out = shipments[s.shipmentNo] ?? {
      shipmentNo: s.shipmentNo,
      customer: s.customer,
      facility: s.facility,
      shippedAt: s.shippedAt,
      lots: [],
    };
    out.lots.push({ lot: s.lot, qtyBase: s.qtyBase });
    shipments[s.shipmentNo] = out;
    const l = lot(s.lot);
    if (!l.shippedIn.includes(s.shipmentNo)) l.shippedIn.push(s.shipmentNo);
  }

  return {
    lots: lotsOut,
    batches,
    shipments,
    has: { fgLots: t.outputs.length > 0, shipments: t.shipments.length > 0 },
  };
}

/** The ledger's genealogy index. */
export function genealogy(db: LedgerDb): Genealogy {
  return buildGenealogy(genealogyTables(db));
}
