// Day One's ledger → the ERP, through the connector. Used at cutover (the acquirer's books
// receive the plant's purchase orders, receipts and every inventory movement from the lot
// event log) and to catch up after the fact. Every post carries a Day One key, so running the
// sync twice changes nothing, and the demo's live hooks post the same keys.
//
// What becomes what (docs/ERP.md §3.3): a PO with its contract verdict; a `received` event
// with a PO → an item receipt into quarantine; without one → an opening adjustment; `released`
// and `rejected` → status changes; `consumed` → an issue to production (one per batch);
// `wasted` → waste, or a return when QC had rejected the lot; `count_adjust` → a count;
// `transfer_in` → a transfer for the shipped quantity plus a count for any shortfall.

import { and, asc, eq, gt } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import {
  batchInputs,
  batchRecords,
  chainTx,
  facilities,
  lotEvents,
  lots,
  materials,
  poLines,
  purchaseOrders,
  receipts,
  transfers,
  vendors,
} from "../ledger/schema.ts";
import type { ContractVerdict, ErpConnector, PoMirror } from "./types.ts";

export interface SyncOptions {
  /** Only lot events after this sequence number; default all. */
  sinceSeq?: number;
  log?: (line: string) => void;
}

export interface SyncSummary {
  purchaseOrders: number;
  receipts: number;
  qcDecisions: number;
  productionIssues: number;
  transfers: number;
  adjustments: number;
  lastSeq: number;
  /** Posts the ERP already had. */
  alreadyThere: number;
}

/** The contract's verdict for a Day One PO, read from its chain log, as the ERP records it. */
export function verdictOf(db: Ledger, po: typeof purchaseOrders.$inferSelect) {
  const txs = db
    .select()
    .from(chainTx)
    .where(and(eq(chainTx.relatedType, "purchase_order"), eq(chainTx.relatedId, po.id)))
    .orderBy(asc(chainTx.id))
    .all();
  const funding = txs.find((t) => t.kind === "submit_po" && t.status === "success");
  const refusal = [...txs].reverse().find((t) => t.kind === "submit_po" && t.status === "refused");
  const approval = txs.find((t) => t.kind === "approve_po" && t.status === "success");
  const base = {
    fundingTx: funding?.txHash ?? null,
    approvalTx: approval?.txHash ?? null,
    approvedBy: approval?.predecessorId ?? approval?.signerId ?? null,
  };
  const verdict: ContractVerdict =
    po.status === "cancelled"
      ? "cancelled"
      : po.status === "rejected"
        ? "refunded"
        : po.status === "refused"
          ? "refused"
          : po.status === "awaiting_approval"
            ? "awaitingApproval"
            : funding
              ? po.status === "paid"
                ? "paid"
                : "funded"
              : "paid";
  const reason =
    verdict === "refused" || verdict === "awaitingApproval"
      ? (refusal?.errorMessage ?? null)
      : !funding && (verdict === "paid" || verdict === "funded")
        ? "Settled before Day One: paid by check"
        : null;
  return { verdict, reason, ...base };
}

/** A Day One PO as the connector mirrors it. */
export function poMirrorOf(db: Ledger, po: typeof purchaseOrders.$inferSelect): PoMirror {
  const vendor = db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get();
  const facility = db.select().from(facilities).where(eq(facilities.id, po.shipToFacilityId)).get();
  const lines = db
    .select({ line: poLines, material: materials })
    .from(poLines)
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .where(eq(poLines.poId, po.id))
    .orderBy(asc(poLines.lineNo))
    .all();
  const first = db
    .select({ at: chainTx.createdAt })
    .from(chainTx)
    .where(and(eq(chainTx.relatedType, "purchase_order"), eq(chainTx.relatedId, po.id)))
    .orderBy(asc(chainTx.id))
    .get();
  return {
    poNo: po.poNo,
    vendorCode: vendor?.code ?? "",
    facilityCode: facility?.code ?? "",
    date: (first?.at ?? po.needBy ?? "2026-10-01").slice(0, 10),
    category: po.category,
    poHash: po.poHash,
    freightUsdc: po.freightUsdc,
    totalUsdc: po.totalUsdc,
    lines: lines.map(({ line, material }) => ({
      materialCode: material.code,
      qtyBase: line.qtyBase,
      unitPriceUsdc: line.unitPriceUsdc,
      extendedUsdc: line.extendedUsdc,
    })),
    ...verdictOf(db, po),
  };
}

export async function syncLedgerToErp(
  db: Ledger,
  erp: ErpConnector,
  opts: SyncOptions = {},
): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const summary: SyncSummary = {
    purchaseOrders: 0,
    receipts: 0,
    qcDecisions: 0,
    productionIssues: 0,
    transfers: 0,
    adjustments: 0,
    lastSeq: opts.sinceSeq ?? 0,
    alreadyThere: 0,
  };
  const count = (key: keyof Omit<SyncSummary, "lastSeq" | "alreadyThere">, created: boolean) => {
    if (created) summary[key] += 1;
    else summary.alreadyThere += 1;
  };
  const facilityCode = new Map(
    db
      .select()
      .from(facilities)
      .all()
      .map((f) => [f.id, f.code]),
  );
  const materialCode = new Map(
    db
      .select()
      .from(materials)
      .all()
      .map((m) => [m.id, m.code]),
  );
  const day = (iso: string) => iso.slice(0, 10);

  // 1. Purchase orders that reached the contract or predate it; drafts stay in Day One.
  const syncedPos = new Set<number>();
  for (const po of db.select().from(purchaseOrders).orderBy(asc(purchaseOrders.id)).all()) {
    if (po.status === "draft" || po.status === "submitted") continue;
    const mirror = poMirrorOf(db, po);
    const ref = await erp.pushPurchaseOrder(mirror);
    syncedPos.add(po.id);
    count("purchaseOrders", ref.created);
    log(
      `PO ${po.poNo}: ${ref.created ? "mirrored" : "already in the ERP"}, verdict ${mirror.verdict}, ERP ${ref.approvalStatus}`,
    );
  }

  // 2. Lot events, in order. Receipts and batch issues are grouped on their first event.
  const events = db
    .select({ event: lotEvents, lot: lots })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .where(gt(lotEvents.seq, opts.sinceSeq ?? 0))
    .orderBy(asc(lotEvents.seq))
    .all();
  const receiptsDone = new Set<number>();
  const batchesDone = new Set<number>();
  const transfersDone = new Set<number>();
  const returned = new Set<number>();
  const statusOf = new Map<number, "quarantine" | "good" | "rejected">();

  for (const { event, lot } of events) {
    const facility = facilityCode.get(event.facilityId) ?? "";
    const material = materialCode.get(lot.materialId) ?? "";
    summary.lastSeq = event.seq;
    switch (event.kind) {
      case "received": {
        // The PO a receipt belongs to: the event says so (seeded history), or the lot's PO line
        // does (lots Kevin receives).
        const poLine =
          lot.poLineId === null
            ? null
            : db.select().from(poLines).where(eq(poLines.id, lot.poLineId)).get();
        const poId =
          event.refType === "po" && event.refId !== null ? event.refId : (poLine?.poId ?? null);
        if (poId !== null && syncedPos.has(poId)) {
          if (receiptsDone.has(poId)) break;
          receiptsDone.add(poId);
          const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).get();
          const receipt = db.select().from(receipts).where(eq(receipts.poId, poId)).get();
          if (!po) break;
          const orderLines = db.select().from(poLines).where(eq(poLines.poId, po.id)).all();
          // Every lot received against this PO, with the quantity its `received` event booked;
          // each lot goes on the PO line for its material.
          const lines = db
            .select({ event: lotEvents, lot: lots })
            .from(lotEvents)
            .innerJoin(lots, eq(lots.id, lotEvents.lotId))
            .where(
              and(
                eq(lotEvents.kind, "received"),
                eq(lotEvents.refType, "po"),
                eq(lotEvents.refId, po.id),
              ),
            )
            .orderBy(asc(lotEvents.seq))
            .all()
            .map(({ event: rec, lot: l }) => {
              const line = l.poLineId
                ? orderLines.find((o) => o.id === l.poLineId)
                : orderLines.find((o) => o.materialId === l.materialId);
              return {
                poLine: line?.lineNo ?? 0,
                qtyBase: rec.qtyDeltaBase,
                lotCode: l.lotCode,
                lotId: l.id,
              };
            })
            .filter((l) => l.qtyBase > 0 && l.poLine > 0);
          const ref = await erp.postItemReceipt({
            poNo: po.poNo,
            ref: `RCV-${po.poNo}`,
            date: day(receipt?.receivedAt ?? event.occurredAt),
            lines: lines.map(({ lotId: _l, ...rest }) => rest),
            memo: receipt?.packingSlipFile ? `Packing slip ${receipt.packingSlipFile}` : null,
          });
          for (const l of lines) statusOf.set(l.lotId, "quarantine");
          count("receipts", ref.created);
          log(
            `Receipt ${po.poNo}: ${lines.map((l) => l.lotCode).join(", ")} → ${ref.tranId}${ref.created ? "" : " (already there)"}`,
          );
        } else {
          // Opening stock, or a receipt whose PO never reached the contract: an adjustment at standard cost.
          const ref = await erp.postInventoryMovement({
            kind: "opening",
            ref: `event:${event.seq}`,
            facilityCode: facility,
            date: day(event.occurredAt),
            memo: `Cutover: lot ${lot.lotCode} on hand in Day One`,
            lines: [
              {
                materialCode: material,
                lotCode: lot.lotCode,
                qtyBase: event.qtyDeltaBase,
                status: "quarantine",
              },
            ],
          });
          statusOf.set(lot.id, "quarantine");
          count("adjustments", ref.created);
        }
        break;
      }
      case "released":
      case "rejected": {
        const poLine =
          lot.poLineId === null
            ? null
            : db.select().from(poLines).where(eq(poLines.id, lot.poLineId)).get();
        const po = poLine
          ? db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poLine.poId)).get()
          : null;
        const ref = await erp.postQcDecision({
          ref: `QC-${lot.lotCode}`,
          poNo: po && syncedPos.has(po.id) ? po.poNo : null,
          lotCode: lot.lotCode,
          materialCode: material,
          facilityCode: facility,
          decision: event.kind === "released" ? "release" : "reject",
          reason: event.reason,
          date: day(event.occurredAt),
        });
        statusOf.set(lot.id, event.kind === "released" ? "good" : "rejected");
        if (event.kind === "rejected" && po && syncedPos.has(po.id)) returned.add(lot.id);
        count("qcDecisions", ref.created);
        break;
      }
      case "consumed": {
        if (event.refType === "batch" && event.refId !== null) {
          if (batchesDone.has(event.refId)) break;
          batchesDone.add(event.refId);
          const batch = db
            .select()
            .from(batchRecords)
            .where(eq(batchRecords.id, event.refId))
            .get();
          const inputs = db
            .select({ input: batchInputs, lot: lots })
            .from(batchInputs)
            .innerJoin(lots, eq(lots.id, batchInputs.lotId))
            .where(eq(batchInputs.batchId, event.refId))
            .orderBy(asc(batchInputs.id))
            .all();
          const ref = await erp.postInventoryMovement({
            kind: "production",
            ref: `batch:${batch?.batchNo ?? event.refId}`,
            facilityCode: facility,
            date: day(event.occurredAt),
            memo: `Batch record ${batch?.batchNo ?? event.refId}`,
            lines: inputs.map(({ input, lot: l }) => ({
              materialCode: materialCode.get(l.materialId) ?? "",
              lotCode: l.lotCode,
              qtyBase: -input.actualBase,
              status: statusOf.get(l.id) ?? "good",
            })),
          });
          count("productionIssues", ref.created);
          log(
            `Issue to production ${batch?.batchNo ?? event.refId}: ${inputs.length} lots → ${ref.tranId}${ref.created ? "" : " (already there)"}`,
          );
        } else {
          const ref = await erp.postInventoryMovement({
            kind: "production",
            ref: `event:${event.seq}`,
            facilityCode: facility,
            date: day(event.occurredAt),
            memo: event.reason ?? `Lot ${lot.lotCode} issued`,
            lines: [
              {
                materialCode: material,
                lotCode: lot.lotCode,
                qtyBase: event.qtyDeltaBase,
                status: statusOf.get(lot.id) ?? "good",
              },
            ],
          });
          count("productionIssues", ref.created);
        }
        break;
      }
      case "wasted": {
        if (returned.has(lot.id)) break; // the QC rejection already returned it to the vendor
        const status = statusOf.get(lot.id) ?? "good";
        const ref = await erp.postInventoryMovement({
          // A lot QC rejected before cutover goes back to its vendor as a count: no liability
          // was accrued for it here. A PO lot is returned by the QC decision itself.
          kind: status === "rejected" ? "count" : "waste",
          ref: `event:${event.seq}`,
          facilityCode: facility,
          date: day(event.occurredAt),
          memo: event.reason ?? `Lot ${lot.lotCode} wasted`,
          lines: [
            { materialCode: material, lotCode: lot.lotCode, qtyBase: event.qtyDeltaBase, status },
          ],
        });
        count("adjustments", ref.created);
        break;
      }
      case "count_adjust": {
        const ref = await erp.postInventoryMovement({
          kind: "count",
          ref: `event:${event.seq}`,
          facilityCode: facility,
          date: day(event.occurredAt),
          memo: event.reason ?? `Count adjustment on lot ${lot.lotCode}`,
          lines: [
            {
              materialCode: material,
              lotCode: lot.lotCode,
              qtyBase: event.qtyDeltaBase,
              status: statusOf.get(lot.id) ?? "good",
            },
          ],
        });
        count("adjustments", ref.created);
        break;
      }
      case "transfer_in": {
        if (event.refType !== "transfer" || event.refId === null || transfersDone.has(event.refId))
          break;
        transfersDone.add(event.refId);
        const transfer = db.select().from(transfers).where(eq(transfers.id, event.refId)).get();
        if (!transfer) break;
        const status = statusOf.get(lot.id) ?? "good";
        const ref = await erp.postInventoryMovement({
          kind: "transfer",
          ref: transfer.transferNo,
          fromFacilityCode: facilityCode.get(transfer.fromFacilityId) ?? "",
          toFacilityCode: facilityCode.get(transfer.toFacilityId) ?? "",
          date: day(event.occurredAt),
          memo: `Transfer ${transfer.transferNo}: lot ${lot.lotCode}`,
          lines: [
            {
              materialCode: material,
              lotCode: lot.lotCode,
              qtyBase: transfer.qtyShippedBase,
              status,
            },
          ],
        });
        count("transfers", ref.created);
        const short = transfer.qtyShippedBase - event.qtyDeltaBase;
        if (short > 0) {
          const adj = await erp.postInventoryMovement({
            kind: "count",
            ref: `${transfer.transferNo}:short`,
            facilityCode: facilityCode.get(transfer.toFacilityId) ?? "",
            date: day(event.occurredAt),
            memo: `Transfer ${transfer.transferNo} shortfall: shipped ${transfer.qtyShippedBase}, received ${event.qtyDeltaBase} (base units); under review in Day One`,
            lines: [{ materialCode: material, lotCode: lot.lotCode, qtyBase: -short, status }],
          });
          count("adjustments", adj.created);
        }
        log(
          `Transfer ${transfer.transferNo}: ${lot.lotCode} → ${ref.tranId}${short > 0 ? ` (short ${short} base units booked as a count)` : ""}`,
        );
        break;
      }
      default:
        // ordered, shipped, quarantined, issued, returned, transfer_out: no ERP posting.
        break;
    }
  }
  return summary;
}
