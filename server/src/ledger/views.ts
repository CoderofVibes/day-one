// The tables the v2 pages list (docs/VISION.md §6.6): every purchase order with its approval,
// receipt and QC decision; every request for quotes with its quotes; every lot with its state and
// age; every batch record with its flags. Pure reads of the ledger, so a page and its charts
// agree; nothing here names an account, a key or a transaction (the curtain shows those).

import { asc, eq } from "drizzle-orm";
import type { LedgerDb } from "./events.ts";
import {
  approvals,
  batchRecords,
  extractionFlags,
  facilities,
  lotBalances,
  lotEvents,
  lots,
  materials,
  poLines,
  products,
  purchaseOrders,
  qcDecisions,
  quotes,
  receipts,
  rfqs,
  staff,
  vendors,
} from "./schema.ts";

export interface PoLineView {
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  unit: string;
  unitPriceUsdc: number;
  extendedUsdc: number;
}
export interface PoView {
  poNo: string;
  vendor: string;
  vendorName: string;
  facility: string;
  category: string;
  totalUsdc: number;
  status: string;
  needBy: string | null;
  createdBy: string;
  /** The first dated thing that happened to the PO: approval asked, received or QC decided. */
  date: string | null;
  lines: PoLineView[];
  approval: {
    approver: string;
    state: string;
    request: string;
    response: string | null;
    requestedAt: string;
    respondedAt: string | null;
  } | null;
  receipt: { receivedAt: string; match: string; notes: string | null; by: string | null } | null;
  qc: { decision: string; decidedAt: string; lot: string; by: string | null } | null;
}

/** Every purchase order, newest first; `facility` keeps the ones shipped to that plant. */
export function purchaseOrderViews(db: LedgerDb, facility?: string): PoView[] {
  const people = new Map(
    db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .all()
      .map((s) => [s.id, s.name]),
  );
  const linesByPo = new Map<number, PoLineView[]>();
  for (const l of db
    .select({
      poId: poLines.poId,
      material: materials.code,
      name: materials.name,
      dimension: materials.dimension,
      qtyBase: poLines.qtyBase,
      unit: poLines.unit,
      unitPriceUsdc: poLines.unitPriceUsdc,
      extendedUsdc: poLines.extendedUsdc,
    })
    .from(poLines)
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .orderBy(asc(poLines.poId), asc(poLines.lineNo))
    .all()) {
    const { poId, ...line } = l;
    linesByPo.set(poId, [...(linesByPo.get(poId) ?? []), line]);
  }
  const approvalByPo = new Map<number, PoView["approval"]>();
  for (const a of db.select().from(approvals).orderBy(asc(approvals.id)).all()) {
    approvalByPo.set(a.poId, {
      approver: people.get(a.approverStaffId) ?? "",
      state: a.state,
      request: a.requestText,
      response: a.responseText,
      requestedAt: a.requestedAt,
      respondedAt: a.respondedAt,
    });
  }
  const receiptByPo = new Map<number, PoView["receipt"]>();
  for (const r of db.select().from(receipts).orderBy(asc(receipts.receivedAt)).all()) {
    if (receiptByPo.has(r.poId)) continue;
    receiptByPo.set(r.poId, {
      receivedAt: r.receivedAt,
      match: r.matchStatus,
      notes: r.mismatchNotes,
      by: r.receivedBy === null ? null : (people.get(r.receivedBy) ?? null),
    });
  }
  const qcByPo = new Map<number, PoView["qc"]>();
  for (const q of db
    .select({
      poId: qcDecisions.poId,
      decision: qcDecisions.decision,
      decidedAt: qcDecisions.decidedAt,
      lot: lots.lotCode,
      by: qcDecisions.decidedBy,
    })
    .from(qcDecisions)
    .innerJoin(lots, eq(lots.id, qcDecisions.lotId))
    .orderBy(asc(qcDecisions.decidedAt))
    .all()) {
    if (q.poId === null) continue;
    qcByPo.set(q.poId, {
      decision: q.decision,
      decidedAt: q.decidedAt,
      lot: q.lot,
      by: q.by === null ? null : (people.get(q.by) ?? null),
    });
  }
  const rows = db
    .select({
      id: purchaseOrders.id,
      poNo: purchaseOrders.poNo,
      vendor: vendors.code,
      vendorName: vendors.name,
      facility: facilities.code,
      category: purchaseOrders.category,
      totalUsdc: purchaseOrders.totalUsdc,
      status: purchaseOrders.status,
      needBy: purchaseOrders.needBy,
      createdBy: purchaseOrders.createdBy,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .innerJoin(facilities, eq(facilities.id, purchaseOrders.shipToFacilityId))
    .all();
  const out: PoView[] = [];
  for (const { id, ...po } of rows) {
    if (facility && po.facility !== facility) continue;
    const approval = approvalByPo.get(id) ?? null;
    const receipt = receiptByPo.get(id) ?? null;
    const qc = qcByPo.get(id) ?? null;
    const date =
      [approval?.requestedAt, receipt?.receivedAt, qc?.decidedAt].filter(
        (d): d is string => typeof d === "string",
      )[0] ?? null;
    out.push({ ...po, date, lines: linesByPo.get(id) ?? [], approval, receipt, qc });
  }
  // Newest first; an order with nothing dated yet (just placed, in flight) leads.
  return out.sort(
    (a, b) => (b.date ?? "~").localeCompare(a.date ?? "~") || b.poNo.localeCompare(a.poNo, "en"),
  );
}

export interface QuoteView {
  vendor: string;
  vendorName: string;
  standing: string;
  unitPriceUsdc: number;
  freightUsdc: number;
  leadTimeDays: number;
  status: string;
  exclusionReason: string | null;
}
export interface RfqView {
  rfqNo: string;
  facility: string;
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  needBy: string;
  createdBy: string;
  quotes: QuoteView[];
}

/** Every request for quotes, newest number first, with its quotes cheapest first. */
export function rfqViews(db: LedgerDb, facility?: string): RfqView[] {
  const byRfq = new Map<number, QuoteView[]>();
  for (const q of db
    .select({
      rfqId: quotes.rfqId,
      vendor: vendors.code,
      vendorName: vendors.name,
      standing: vendors.qualificationStatus,
      unitPriceUsdc: quotes.unitPriceUsdc,
      freightUsdc: quotes.freightUsdc,
      leadTimeDays: quotes.leadTimeDays,
      status: quotes.status,
      exclusionReason: quotes.exclusionReason,
    })
    .from(quotes)
    .innerJoin(vendors, eq(vendors.id, quotes.vendorId))
    .orderBy(asc(quotes.unitPriceUsdc))
    .all()) {
    const { rfqId, ...quote } = q;
    byRfq.set(rfqId, [...(byRfq.get(rfqId) ?? []), quote]);
  }
  return db
    .select({
      id: rfqs.id,
      rfqNo: rfqs.rfqNo,
      facility: facilities.code,
      material: materials.code,
      name: materials.name,
      dimension: materials.dimension,
      qtyBase: rfqs.qtyBase,
      needBy: rfqs.needBy,
      createdBy: rfqs.createdBy,
    })
    .from(rfqs)
    .innerJoin(materials, eq(materials.id, rfqs.materialId))
    .innerJoin(facilities, eq(facilities.id, rfqs.facilityId))
    .all()
    .filter((r) => !facility || r.facility === facility)
    .map(({ id, ...r }) => ({ ...r, quotes: byRfq.get(id) ?? [] }))
    .sort((a, b) => b.rfqNo.localeCompare(a.rfqNo, "en"));
}

export interface LotView {
  lotCode: string;
  material: string;
  name: string;
  category: string;
  dimension: string;
  vendor: string | null;
  state: string;
  facility: string;
  onHandBase: number;
  expiresOn: string | null;
  /** When the lot was first seen (ordered, received or made) and last moved. */
  firstAt: string;
  lastAt: string;
  /** Days since the last move, at `now`. */
  daysInState: number;
}

/**
 * The lots a plant holds or expects at `now`: on order, on the way, in quarantine, released or in
 * use. Consumed, wasted and rejected lots are history and stay out.
 */
export function lotViews(db: LedgerDb, facility: string, now: string): LotView[] {
  const LIVE = new Set(["on_order", "en_route", "received", "quarantine", "released", "in_use"]);
  const span = new Map<number, { first: string; last: string }>();
  for (const e of db
    .select({ lotId: lotEvents.lotId, at: lotEvents.occurredAt })
    .from(lotEvents)
    .orderBy(asc(lotEvents.seq))
    .all()) {
    if (e.at > now) continue;
    const s = span.get(e.lotId);
    if (!s) span.set(e.lotId, { first: e.at, last: e.at });
    else {
      if (e.at < s.first) s.first = e.at;
      if (e.at > s.last) s.last = e.at;
    }
  }
  const onHand = new Map<string, number>();
  for (const b of db.select().from(lotBalances).all())
    onHand.set(`${b.lotId}|${b.facilityId}`, b.onHandBase);
  const vendorName = new Map(
    db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .all()
      .map((v) => [v.id, v.name]),
  );
  const out: LotView[] = [];
  for (const l of db
    .select({
      id: lots.id,
      lotCode: lots.lotCode,
      material: materials.code,
      name: materials.name,
      category: materials.category,
      dimension: materials.dimension,
      vendorId: lots.vendorId,
      state: lots.state,
      facilityId: lots.currentFacilityId,
      facility: facilities.code,
      expiresOn: lots.expiresOn,
    })
    .from(lots)
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .innerJoin(facilities, eq(facilities.id, lots.currentFacilityId))
    .all()) {
    if (l.facility !== facility || !l.state || !LIVE.has(l.state)) continue;
    const s = span.get(l.id);
    if (!s) continue;
    out.push({
      lotCode: l.lotCode,
      material: l.material,
      name: l.name,
      category: l.category,
      dimension: l.dimension,
      vendor: l.vendorId === null ? null : (vendorName.get(l.vendorId) ?? null),
      state: l.state,
      facility: l.facility,
      onHandBase: onHand.get(`${l.id}|${l.facilityId}`) ?? 0,
      expiresOn: l.expiresOn,
      firstAt: s.first,
      lastAt: s.last,
      daysInState: Math.floor((Date.parse(now) - Date.parse(s.last)) / 86_400_000),
    });
  }
  return out.sort(
    (a, b) =>
      a.material.localeCompare(b.material, "en") || a.lotCode.localeCompare(b.lotCode, "en"),
  );
}

export interface BatchRecordView {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  status: string;
  completedAt: string | null;
  units: number | null;
  theoreticalUnits: number | null;
  yieldBp: number | null;
  expectedYieldBp: number;
  wasteBase: number | null;
  confirmedBy: string | null;
  /** From a scan Kevin read (the rest were entered before Day One, from the paper binder). */
  fromScan: boolean;
  flags: { kind: string; message: string; resolved: boolean }[];
}

/** Every batch record, newest first. */
export function batchRecordViews(db: LedgerDb, facility?: string): BatchRecordView[] {
  const people = new Map(
    db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .all()
      .map((s) => [s.id, s.name]),
  );
  const flags = new Map<number, BatchRecordView["flags"]>();
  for (const f of db.select().from(extractionFlags).orderBy(asc(extractionFlags.id)).all()) {
    flags.set(f.batchId, [
      ...(flags.get(f.batchId) ?? []),
      { kind: f.kind, message: f.message, resolved: f.resolvedBy !== null },
    ]);
  }
  return db
    .select({
      id: batchRecords.id,
      batchNo: batchRecords.batchNo,
      facility: facilities.code,
      product: products.code,
      productName: products.name,
      status: batchRecords.status,
      completedAt: batchRecords.completedAt,
      units: batchRecords.actualTablets,
      theoreticalUnits: batchRecords.theoreticalTablets,
      yieldBp: batchRecords.yieldBp,
      expectedYieldBp: products.expectedYieldBp,
      wasteBase: batchRecords.wasteBase,
      confirmedBy: batchRecords.confirmedBy,
      sourceFile: batchRecords.sourceFile,
    })
    .from(batchRecords)
    .innerJoin(facilities, eq(facilities.id, batchRecords.facilityId))
    .innerJoin(products, eq(products.id, batchRecords.productId))
    .all()
    .filter((b) => !facility || b.facility === facility)
    .map(({ id, confirmedBy, sourceFile, ...b }) => ({
      ...b,
      confirmedBy: confirmedBy === null ? null : (people.get(confirmedBy) ?? null),
      fromScan: sourceFile !== null,
      flags: flags.get(id) ?? [],
    }))
    .sort(
      (a, b) =>
        (b.completedAt ?? "").localeCompare(a.completedAt ?? "") ||
        b.batchNo.localeCompare(a.batchNo, "en"),
    );
}
