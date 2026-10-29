// Purchase orders and item receipts. A PO is mirrored from Day One by PO number and carries the
// contract's verdict; the approval matrix turns that verdict (and Acme's own HQ rules) into the
// ERP's approval status. An item receipt posts the goods into quarantine at the PO price and
// accrues the liability; a return to the vendor reverses it.

import { and, asc, eq } from "drizzle-orm";
import { type ContractVerdict, type Decision, evaluatePurchaseOrder } from "../approval.ts";
import type { ErpDb } from "../db.ts";
import { extend } from "../money.ts";
import {
  accounts,
  type InventoryStatus,
  itemReceiptLines,
  itemReceipts,
  items,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  users,
  vendors,
} from "../schema.ts";
import { SETTINGS } from "../seed/data.ts";
import { audit } from "./audit.ts";
import { postInventoryAdjustment, postInventoryStatusChange, postMovement } from "./inventory.ts";
import { nextTranId, PostingError, postJournal } from "./journal.ts";

/** A refusal the connector can act on: the code names the rule. */
export class ErpRefusal extends PostingError {
  override name = "ErpRefusal";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function vendorByCode(db: ErpDb, entityId: string) {
  const v = db.select().from(vendors).where(eq(vendors.entityId, entityId)).get();
  if (!v) throw new ErpRefusal("VENDOR_NOT_IN_MASTER", `${entityId} is not in the vendor master.`);
  return v;
}

export function itemByCode(db: ErpDb, itemId: string) {
  const i = db.select().from(items).where(eq(items.itemId, itemId)).get();
  if (!i) throw new ErpRefusal("ITEM_NOT_IN_MASTER", `${itemId} is not in the item master.`);
  return i;
}

export function locationByCode(db: ErpDb, externalId: string) {
  const l = db.select().from(locations).where(eq(locations.externalId, externalId)).get();
  if (!l) throw new ErpRefusal("LOCATION_UNKNOWN", `No location ${externalId}.`);
  return l;
}

export function poByTranId(db: ErpDb, tranId: string) {
  return db.select().from(purchaseOrders).where(eq(purchaseOrders.tranId, tranId)).get() ?? null;
}

export function poLinesOf(db: ErpDb, poId: number) {
  return db
    .select({ line: purchaseOrderLines, item: items })
    .from(purchaseOrderLines)
    .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.poId, poId))
    .orderBy(asc(purchaseOrderLines.line))
    .all();
}

// ---------------------------------------------------------------- purchaseOrder

export interface PoLineInput {
  itemCode: string;
  quantityBase: number;
  rateUsdc: number;
  amountUsdc?: number;
}

export interface PoInput {
  /** Day One's PO number. */
  tranId: string;
  vendorCode: string;
  locationCode: string;
  tranDate: string;
  category?: string | null;
  poHash?: string | null;
  freightUsdc?: number;
  totalUsdc?: number;
  memo?: string | null;
  lines: PoLineInput[];
  verdict: ContractVerdict;
  reason?: string | null;
  fundingTx?: string | null;
  approvalTx?: string | null;
  approvedBy?: string | null;
  userId: number;
  at: string;
}

export interface PoResult {
  id: number;
  tranId: string;
  created: boolean;
  status: (typeof purchaseOrders.$inferSelect)["status"];
  approvalStatus: Decision["approvalStatus"];
  decision: Decision;
}

function statusFor(verdict: ContractVerdict, decision: Decision, current?: string) {
  if (decision.approvalStatus === "rejected") return "rejected" as const;
  if (decision.approvalStatus === "pendingApproval") return "pendingApproval" as const;
  if (verdict === "cancelled" || verdict === "refunded") return "closed" as const;
  if (current && current !== "pendingApproval" && current !== "rejected") {
    return current as (typeof purchaseOrders.$inferSelect)["status"];
  }
  return "pendingReceipt" as const;
}

/**
 * Mirrors a Day One PO (create) or records a new verdict for it (update). Lines are written
 * once, on create; a later call with the same PO number updates only the verdict fields.
 */
export function upsertPurchaseOrder(db: ErpDb, input: PoInput): PoResult {
  const vendor = vendorByCode(db, input.vendorCode);
  const location = locationByCode(db, input.locationCode);
  const lines = input.lines.map((l, i) => {
    const item = itemByCode(db, l.itemCode);
    return {
      line: i + 1,
      itemId: item.id,
      quantityBase: l.quantityBase,
      rateUsdc: l.rateUsdc,
      amountUsdc: l.amountUsdc ?? extend(l.quantityBase, l.rateUsdc, item.baseUnitsPerUnit),
    };
  });
  const freightUsdc = input.freightUsdc ?? 0;
  const totalUsdc = input.totalUsdc ?? lines.reduce((s, l) => s + l.amountUsdc, 0) + freightUsdc;
  const existing = poByTranId(db, input.tranId);
  const signedByRole = existing?.approvedByUserId
    ? (db.select().from(users).where(eq(users.id, existing.approvedByUserId)).get()?.role ?? null)
    : null;
  const decision = evaluatePurchaseOrder(db, {
    totalUsdc,
    vendorStatus: vendor.status,
    verdict: input.verdict,
    reason: input.reason ?? null,
    fundingTx: input.fundingTx ?? existing?.custbodyNearFundingTx ?? null,
    approvalTx: input.approvalTx ?? existing?.custbodyNearApprovalTx ?? null,
    approvedBy: input.approvedBy ?? existing?.custbodyNearApprovedBy ?? null,
    signedByRole: signedByRole === "controller" ? "controller" : null,
  });
  const verdictFields = {
    custbodyContractVerdict: input.verdict,
    custbodyContractReason: input.reason ?? existing?.custbodyContractReason ?? null,
    custbodyNearFundingTx: input.fundingTx ?? existing?.custbodyNearFundingTx ?? null,
    custbodyNearApprovalTx: input.approvalTx ?? existing?.custbodyNearApprovalTx ?? null,
    custbodyNearApprovedBy: input.approvedBy ?? existing?.custbodyNearApprovedBy ?? null,
    approvalStatus: decision.approvalStatus,
    approvalNote: `Rule ${decision.ruleNo}: ${decision.note}`,
  };

  if (existing) {
    const status = statusFor(input.verdict, decision, existing.status);
    db.update(purchaseOrders)
      .set({ ...verdictFields, status })
      .where(eq(purchaseOrders.id, existing.id))
      .run();
    audit(db, {
      at: input.at,
      userId: input.userId,
      action: "update",
      recordType: "purchaseOrder",
      recordId: existing.id,
      tranId: input.tranId,
      detail: `verdict ${input.verdict}${input.reason ? ` (${input.reason})` : ""}; ${decision.approvalStatus}`,
    });
    return {
      id: existing.id,
      tranId: input.tranId,
      created: false,
      status,
      approvalStatus: decision.approvalStatus,
      decision,
    };
  }

  const status = statusFor(input.verdict, decision);
  const row = db
    .insert(purchaseOrders)
    .values({
      tranId: input.tranId,
      externalId: input.tranId,
      vendorId: vendor.id,
      locationId: location.id,
      tranDate: input.tranDate,
      status,
      freightUsdc,
      totalUsdc,
      memo: input.memo ?? null,
      custbodyDayoneCategory: input.category ?? null,
      custbodyDayonePoHash: input.poHash ?? null,
      ...verdictFields,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  db.insert(purchaseOrderLines)
    .values(lines.map((l) => ({ ...l, poId: row.id })))
    .run();
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "purchaseOrder",
    recordId: row.id,
    tranId: input.tranId,
    detail: `${vendor.companyName}, ${lines.length} lines, verdict ${input.verdict}; ${decision.approvalStatus} (rule ${decision.ruleNo})`,
  });
  return {
    id: row.id,
    tranId: input.tranId,
    created: true,
    status,
    approvalStatus: decision.approvalStatus,
    decision,
  };
}

/** The HQ controller's signature on a PO the matrix routed to them. */
export function signPurchaseOrder(
  db: ErpDb,
  input: { tranId: string; userId: number; note?: string | undefined; at: string },
) {
  const po = poByTranId(db, input.tranId);
  if (!po) throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${input.tranId}.`);
  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (user?.role !== "controller")
    throw new ErpRefusal("FORBIDDEN", "Only the HQ controller signs purchase orders.");
  const vendor = db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get();
  const decision = evaluatePurchaseOrder(db, {
    totalUsdc: po.totalUsdc,
    vendorStatus: vendor?.status ?? "approved",
    verdict: po.custbodyContractVerdict,
    reason: po.custbodyContractReason,
    fundingTx: po.custbodyNearFundingTx,
    approvalTx: po.custbodyNearApprovalTx,
    approvedBy: po.custbodyNearApprovedBy,
    signedByRole: "controller",
  });
  db.update(purchaseOrders)
    .set({
      approvalStatus: decision.approvalStatus,
      approvedByUserId: user.id,
      approvalNote: `Rule ${decision.ruleNo}: ${decision.note}${input.note ? ` — ${input.note}` : ""}`,
      status: statusFor(po.custbodyContractVerdict, decision, po.status),
    })
    .where(eq(purchaseOrders.id, po.id))
    .run();
  audit(db, {
    at: input.at,
    userId: user.id,
    action: "approve",
    recordType: "purchaseOrder",
    recordId: po.id,
    tranId: po.tranId,
    detail: `${decision.approvalStatus}${input.note ? `: ${input.note}` : ""}`,
  });
  return decision;
}

// ---------------------------------------------------------------- itemReceipt

export interface ReceiptLineInput {
  poLine: number;
  quantityBase: number;
  /** Day One's lot code. */
  lotNumber: string;
  inventoryStatus?: InventoryStatus;
}

export interface ReceiptInput {
  /** Day One's receipt reference, e.g. RCV-PO-1042. */
  externalId: string;
  poTranId: string;
  tranDate: string;
  memo?: string | null;
  lines: ReceiptLineInput[];
  userId: number;
  at: string;
}

function refreshPoStatus(db: ErpDb, poId: number) {
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).get();
  if (!po || po.status === "closed" || po.status === "rejected" || po.status === "pendingApproval")
    return;
  const lines = db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId)).all();
  const received = lines.reduce((s, l) => s + l.quantityReceivedBase, 0);
  const ordered = lines.reduce((s, l) => s + l.quantityBase, 0);
  const billed = lines.reduce((s, l) => s + l.quantityBilledBase, 0);
  const status =
    received === 0
      ? "pendingReceipt"
      : billed >= ordered
        ? "fullyBilled"
        : received >= ordered
          ? "pendingBilling"
          : "partiallyReceived";
  db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, poId)).run();
}

/** Receives goods against a PO: into quarantine at the PO price, liability accrued. */
export function postItemReceipt(db: ErpDb, input: ReceiptInput) {
  const existing = db
    .select()
    .from(itemReceipts)
    .where(eq(itemReceipts.externalId, input.externalId))
    .get();
  if (existing) return { id: existing.id, tranId: existing.tranId, created: false as const };
  const po = poByTranId(db, input.poTranId);
  if (!po)
    throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${input.poTranId} to receive against.`);
  if (po.approvalStatus !== "approved") {
    throw new ErpRefusal(
      "PO_NOT_APPROVED",
      `${po.tranId} is ${po.approvalStatus}; nothing can be received against it.`,
    );
  }
  const poLines = poLinesOf(db, po.id);
  // Every line is checked before anything is written (the router also runs each request in one
  // transaction, so a later failure cannot leave half a receipt).
  if (input.lines.length === 0)
    throw new ErpRefusal(
      "RECEIPT_EMPTY",
      `A receipt against ${po.tranId} needs at least one line.`,
    );
  for (const l of input.lines) {
    if (!poLines.some((p) => p.line.line === l.poLine))
      throw new ErpRefusal("PO_LINE_UNKNOWN", `${po.tranId} has no line ${l.poLine}.`);
  }
  // Received so far per PO line, so two lots on one line both count (review fix, Oct 29).
  const received = new Map(poLines.map((p) => [p.line.id, p.line.quantityReceivedBase]));
  const tranId = nextTranId(db, itemReceipts, "IR");
  const header = db
    .insert(itemReceipts)
    .values({
      tranId,
      externalId: input.externalId,
      poId: po.id,
      locationId: po.locationId,
      tranDate: input.tranDate,
      memo: input.memo ?? null,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  const journal: { account: string; debitUsdc?: number; creditUsdc?: number; memo: string }[] = [];
  const accrued = SETTINGS.accruedPurchasesAccount;
  input.lines.forEach((l, i) => {
    const target = poLines.find((p) => p.line.line === l.poLine);
    if (!target) throw new ErpRefusal("PO_LINE_UNKNOWN", `${po.tranId} has no line ${l.poLine}.`);
    const amountUsdc = extend(l.quantityBase, target.line.rateUsdc, target.item.baseUnitsPerUnit);
    const status = l.inventoryStatus ?? "quarantine";
    db.insert(itemReceiptLines)
      .values({
        receiptId: header.id,
        line: i + 1,
        poLineId: target.line.id,
        itemId: target.item.id,
        quantityBase: l.quantityBase,
        rateUsdc: target.line.rateUsdc,
        amountUsdc,
        lotNumber: l.lotNumber,
        inventoryStatus: status,
      })
      .run();
    postMovement(db, {
      sourceType: "itemReceipt",
      sourceId: header.id,
      sourceLine: i + 1,
      itemId: target.item.id,
      locationId: po.locationId,
      inventoryStatus: status,
      lotNumber: l.lotNumber,
      quantityDeltaBase: l.quantityBase,
      valueDeltaUsdc: amountUsdc,
      postedAt: input.at,
    });
    const receivedBase = (received.get(target.line.id) ?? 0) + l.quantityBase;
    received.set(target.line.id, receivedBase);
    db.update(purchaseOrderLines)
      .set({ quantityReceivedBase: receivedBase })
      .where(eq(purchaseOrderLines.id, target.line.id))
      .run();
    const asset = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, target.item.assetAccountId))
      .get();
    const memo = `${po.tranId} line ${l.poLine} ${target.item.itemId} lot ${l.lotNumber}`;
    journal.push({ account: asset?.acctNumber ?? "1400", debitUsdc: amountUsdc, memo });
    journal.push({ account: accrued, creditUsdc: amountUsdc, memo });
  });
  const journalId = postJournal(db, {
    tranDate: input.tranDate,
    memo: `${tranId} receipt of ${po.tranId}`,
    sourceType: "itemReceipt",
    sourceId: header.id,
    lines: journal.map((l) => ({ ...l, locationId: po.locationId, vendorId: po.vendorId })),
    userId: input.userId,
    at: input.at,
  });
  db.update(itemReceipts).set({ journalId }).where(eq(itemReceipts.id, header.id)).run();
  refreshPoStatus(db, po.id);
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "itemReceipt",
    recordId: header.id,
    tranId,
    detail: `${po.tranId}: ${input.lines.map((l) => `lot ${l.lotNumber}`).join(", ")} into quarantine`,
  });
  return { id: header.id, tranId, created: true as const, journalId };
}

/** QC released a received lot: quarantine → good. */
export function releaseReceivedLot(
  db: ErpDb,
  input: {
    externalId: string;
    poTranId: string;
    lotNumber: string;
    tranDate: string;
    userId: number;
    at: string;
  },
) {
  const po = poByTranId(db, input.poTranId);
  if (!po) throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${input.poTranId}.`);
  const line = db
    .select({ l: itemReceiptLines })
    .from(itemReceiptLines)
    .innerJoin(itemReceipts, eq(itemReceipts.id, itemReceiptLines.receiptId))
    .where(and(eq(itemReceipts.poId, po.id), eq(itemReceiptLines.lotNumber, input.lotNumber)))
    .get();
  if (!line)
    throw new ErpRefusal(
      "LOT_NOT_RECEIVED",
      `Lot ${input.lotNumber} was not received on ${po.tranId}.`,
    );
  return postInventoryStatusChange(db, {
    externalId: input.externalId,
    locationId: po.locationId,
    tranDate: input.tranDate,
    memo: `QC release ${input.lotNumber} (${po.tranId})`,
    lines: [
      {
        itemId: line.l.itemId,
        lotNumber: input.lotNumber,
        previousStatus: "quarantine",
        revisedStatus: "good",
      },
    ],
    userId: input.userId,
    at: input.at,
  });
}

/** QC rejected a received lot: quarantine → rejected, then returned to the vendor and the receipt reversed. */
export function returnReceivedLot(
  db: ErpDb,
  input: {
    externalId: string;
    poTranId: string;
    lotNumber: string;
    tranDate: string;
    reason: string;
    userId: number;
    at: string;
  },
) {
  const po = poByTranId(db, input.poTranId);
  if (!po) throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${input.poTranId}.`);
  const row = db
    .select({ l: itemReceiptLines })
    .from(itemReceiptLines)
    .innerJoin(itemReceipts, eq(itemReceipts.id, itemReceiptLines.receiptId))
    .where(and(eq(itemReceipts.poId, po.id), eq(itemReceiptLines.lotNumber, input.lotNumber)))
    .get();
  if (!row)
    throw new ErpRefusal(
      "LOT_NOT_RECEIVED",
      `Lot ${input.lotNumber} was not received on ${po.tranId}.`,
    );
  const change = postInventoryStatusChange(db, {
    externalId: `${input.externalId}:status`,
    locationId: po.locationId,
    tranDate: input.tranDate,
    memo: `QC rejected ${input.lotNumber}: ${input.reason}`,
    lines: [
      {
        itemId: row.l.itemId,
        lotNumber: input.lotNumber,
        previousStatus: "quarantine",
        revisedStatus: "rejected",
      },
    ],
    userId: input.userId,
    at: input.at,
  });
  const adjustment = postInventoryAdjustment(db, {
    externalId: `${input.externalId}:return`,
    locationId: po.locationId,
    tranDate: input.tranDate,
    reason: "return",
    memo: `Returned to vendor: ${input.lotNumber} (${po.tranId})`,
    lines: [
      {
        itemId: row.l.itemId,
        lotNumber: input.lotNumber,
        inventoryStatus: "rejected",
        adjustQtyBase: -row.l.quantityBase,
      },
    ],
    userId: input.userId,
    at: input.at,
  });
  if (adjustment.created) {
    const poLine = db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, row.l.poLineId))
      .get();
    if (poLine) {
      db.update(purchaseOrderLines)
        .set({
          quantityReceivedBase: Math.max(0, poLine.quantityReceivedBase - row.l.quantityBase),
        })
        .where(eq(purchaseOrderLines.id, poLine.id))
        .run();
    }
    refreshPoStatus(db, po.id);
  }
  return { change, adjustment };
}

/** Closes a PO whose escrow was cancelled or refunded: no further receipts or bills. */
export function closePurchaseOrder(
  db: ErpDb,
  input: {
    tranId: string;
    verdict: "cancelled" | "refunded";
    reason?: string | null;
    userId: number;
    at: string;
  },
) {
  const po = poByTranId(db, input.tranId);
  if (!po) throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${input.tranId}.`);
  db.update(purchaseOrders)
    .set({
      status: "closed",
      custbodyContractVerdict: input.verdict,
      custbodyContractReason: input.reason ?? po.custbodyContractReason,
    })
    .where(eq(purchaseOrders.id, po.id))
    .run();
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "update",
    recordType: "purchaseOrder",
    recordId: po.id,
    tranId: po.tranId,
    detail: `closed: ${input.verdict}${input.reason ? ` (${input.reason})` : ""}`,
  });
  return { id: po.id, tranId: po.tranId };
}
