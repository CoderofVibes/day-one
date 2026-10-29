// The service layer behind the REST shape: who may do what, and each record as the API shows
// it. Record JSON loosely follows NetSuite's REST record style (reference fields as
// { id, refName }, sublists as { items: [...] }, custom body fields as custbody_*). Money is
// shown in dollars and quantities in the item's unit; inside, everything stays integer.

import { and, asc, desc, eq } from "drizzle-orm";
import type { ErpDb } from "./db.ts";
import { dollars, quantity, toBase, usd } from "./money.ts";
import {
  postInventoryAdjustment,
  postInventoryStatusChange,
  postInventoryTransfer,
} from "./posting/inventory.ts";
import { trialBalance } from "./posting/journal.ts";
import {
  approvedBillFor,
  createVendorBill,
  createVendorPayment,
  decideVendorBill,
  receiptsFor,
} from "./posting/payables.ts";
import {
  closePurchaseOrder,
  ErpRefusal,
  itemByCode,
  locationByCode,
  poByTranId,
  poLinesOf,
  postItemReceipt,
  releaseReceivedLot,
  returnReceivedLot,
  signPurchaseOrder,
  upsertPurchaseOrder,
  vendorByCode,
} from "./posting/purchasing.ts";
import {
  accounts,
  approvalRules,
  auditTrail,
  inventoryAdjustmentLines,
  inventoryAdjustments,
  inventoryBalances,
  inventoryStatusChangeLines,
  inventoryStatusChanges,
  inventoryTransferLines,
  inventoryTransfers,
  itemReceiptLines,
  itemReceipts,
  items,
  journalEntries,
  journalLines,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  type UserRole,
  users,
  vendorBillLines,
  vendorBills,
  vendorPayments,
  vendors,
} from "./schema.ts";

/** A received lot is in quarantine unless the body says it arrived already released. */
function receiptStatus(code: string | null | undefined): "quarantine" | "good" {
  if (code === undefined || code === null || code === "quarantine" || code === "good")
    return code ?? "quarantine";
  throw new ApiError(
    400,
    "INVALID_BODY",
    `"inventoryStatus" must be quarantine or good, not ${JSON.stringify(code)}.`,
  );
}

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Principal {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
}

export type Permission =
  | "read"
  | "write:purchaseOrder"
  | "write:itemReceipt"
  | "write:inventory"
  | "write:vendorBill"
  | "write:vendorPayment"
  | "sign:purchaseOrder"
  | "decide:vendorBill";

const READ_ONLY: Permission[] = ["read"];
const PERMISSIONS: Record<UserRole, Permission[]> = {
  administrator: [
    "read",
    "write:purchaseOrder",
    "write:itemReceipt",
    "write:inventory",
    "write:vendorBill",
    "write:vendorPayment",
    "sign:purchaseOrder",
    "decide:vendorBill",
  ],
  controller: ["read", "sign:purchaseOrder", "decide:vendorBill"],
  apManager: ["read", "decide:vendorBill"],
  approver: READ_ONLY,
  connector: [
    "read",
    "write:purchaseOrder",
    "write:itemReceipt",
    "write:inventory",
    "write:vendorBill",
    "write:vendorPayment",
  ],
  viewer: READ_ONLY,
  system: READ_ONLY,
};

export function authenticate(db: ErpDb, token: string | null): Principal {
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "A bearer token is required.");
  const user = db.select().from(users).where(eq(users.token, token)).get();
  if (!user) throw new ApiError(401, "INVALID_TOKEN", "The token matches no user.");
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

export function require(principal: Principal, permission: Permission) {
  if (!PERMISSIONS[principal.role].includes(permission)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      `${principal.fullName} (${principal.role}) may not ${permission.replace(":", " ")}.`,
    );
  }
}

/** The clock the API stamps records with; the demo pins it so runs are identical. */
export interface Clock {
  now(): string;
}

// ---------------------------------------------------------------- serialization

const ref = (id: number | string, refName: string) => ({ id: String(id), refName });
const status = (id: string) => ({
  id,
  refName: id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
});
const pct = (bp: number | null) => (bp === null ? null : bp / 100);
/** Unit prices and costs keep six decimals: a bottle costs $0.021, not $0.02. */
const rate = (units: number) => units / 1_000_000;

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

function itemRef(db: ErpDb, id: number) {
  const i = db.select().from(items).where(eq(items.id, id)).get();
  return i ? { ref: ref(i.id, i.itemId), item: i } : { ref: ref(id, "?"), item: null };
}
function vendorRef(db: ErpDb, id: number) {
  const v = db.select().from(vendors).where(eq(vendors.id, id)).get();
  return v ? ref(v.id, v.companyName) : ref(id, "?");
}
function locationRef(db: ErpDb, id: number) {
  const l = db.select().from(locations).where(eq(locations.id, id)).get();
  return l ? ref(l.id, l.name) : ref(id, "?");
}
function userRef(db: ErpDb, id: number | null) {
  if (id === null) return null;
  const u = db.select().from(users).where(eq(users.id, id)).get();
  return u ? ref(u.id, u.fullName) : ref(id, "?");
}
function accountRef(db: ErpDb, id: number) {
  const a = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return a ? ref(a.id, `${a.acctNumber} ${a.acctName}`) : ref(id, "?");
}
function journalRef(db: ErpDb, id: number | null) {
  if (id === null) return null;
  const j = db.select().from(journalEntries).where(eq(journalEntries.id, id)).get();
  return j ? ref(j.id, j.tranId) : null;
}
function qtyOf(item: Row<typeof items> | null, base: number) {
  return item ? quantity(base, item.baseUnitsPerUnit) : base;
}

export function serializeVendor(v: Row<typeof vendors>) {
  return {
    id: String(v.id),
    entityId: v.entityId,
    companyName: v.companyName,
    custentity_vendor_status: status(v.status),
    custentity_dayone_payout_account: v.payoutAccount,
    custentity_payout_verified_at: v.payoutVerifiedAt,
    terms: status(v.terms),
    custentity_vb_po_qty_tolerance: pct(v.vbPoQtyToleranceBp),
    custentity_vb_po_amt_tolerance: pct(v.vbPoAmtToleranceBp),
    custentity_vb_ir_qty_difference: v.vbIrQtyDifferenceBase,
    comments: v.comments,
  };
}

export function serializeItem(db: ErpDb, i: Row<typeof items>) {
  return {
    id: String(i.id),
    itemId: i.itemId,
    displayName: i.displayName,
    custitem_item_class: status(i.itemClass),
    unitsType: i.unitsType,
    assetAccount: accountRef(db, i.assetAccountId),
    cost: rate(i.costUsdc),
    isInactive: i.isInactive,
    custitem_dayone_material: i.itemId,
  };
}

export const serializeLocation = (l: Row<typeof locations>) => ({
  id: String(l.id),
  name: l.name,
  externalId: l.externalId,
  city: l.city,
});
export const serializeAccount = (a: Row<typeof accounts>) => ({
  id: String(a.id),
  acctNumber: a.acctNumber,
  acctName: a.acctName,
  acctType: status(a.acctType),
  isInactive: a.isInactive,
});

export function serializePurchaseOrder(db: ErpDb, po: Row<typeof purchaseOrders>) {
  const lines = poLinesOf(db, po.id);
  return {
    id: String(po.id),
    tranId: po.tranId,
    externalId: po.externalId,
    entity: vendorRef(db, po.vendorId),
    location: locationRef(db, po.locationId),
    tranDate: po.tranDate,
    status: status(po.status),
    approvalStatus: status(po.approvalStatus),
    approvedBy: userRef(db, po.approvedByUserId),
    approvalNote: po.approvalNote,
    custbody_freight: dollars(po.freightUsdc),
    total: dollars(po.totalUsdc),
    memo: po.memo,
    custbody_dayone_category: po.custbodyDayoneCategory,
    custbody_dayone_po_hash: po.custbodyDayonePoHash,
    custbody_contract_verdict: status(po.custbodyContractVerdict),
    custbody_contract_reason: po.custbodyContractReason,
    custbody_near_funding_tx: po.custbodyNearFundingTx,
    custbody_near_approval_tx: po.custbodyNearApprovalTx,
    custbody_near_approved_by: po.custbodyNearApprovedBy,
    createdBy: userRef(db, po.createdByUserId),
    createdAt: po.createdAt,
    item: {
      items: lines.map(({ line, item }) => ({
        line: line.line,
        item: ref(item.id, item.itemId),
        description: item.displayName,
        quantity: quantity(line.quantityBase, item.baseUnitsPerUnit),
        units: item.unitsType,
        rate: rate(line.rateUsdc),
        amount: dollars(line.amountUsdc),
        quantityReceived: quantity(line.quantityReceivedBase, item.baseUnitsPerUnit),
        quantityBilled: quantity(line.quantityBilledBase, item.baseUnitsPerUnit),
      })),
    },
  };
}

export function serializeItemReceipt(db: ErpDb, r: Row<typeof itemReceipts>) {
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.poId)).get();
  const lines = db
    .select()
    .from(itemReceiptLines)
    .where(eq(itemReceiptLines.receiptId, r.id))
    .orderBy(asc(itemReceiptLines.line))
    .all();
  return {
    id: String(r.id),
    tranId: r.tranId,
    externalId: r.externalId,
    createdFrom: po ? ref(po.id, po.tranId) : null,
    entity: po ? vendorRef(db, po.vendorId) : null,
    location: locationRef(db, r.locationId),
    tranDate: r.tranDate,
    memo: r.memo,
    journalEntry: journalRef(db, r.journalId),
    createdBy: userRef(db, r.createdByUserId),
    item: {
      items: lines.map((l) => {
        const { ref: itemR, item } = itemRef(db, l.itemId);
        return {
          line: l.line,
          orderLine:
            db
              .select({ line: purchaseOrderLines.line })
              .from(purchaseOrderLines)
              .where(eq(purchaseOrderLines.id, l.poLineId))
              .get()?.line ?? null,
          item: itemR,
          quantity: qtyOf(item, l.quantityBase),
          units: item?.unitsType,
          rate: rate(l.rateUsdc),
          amount: dollars(l.amountUsdc),
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  receiptInventoryNumber: l.lotNumber,
                  quantity: qtyOf(item, l.quantityBase),
                  inventoryStatus: status(l.inventoryStatus),
                },
              ],
            },
          },
        };
      }),
    },
  };
}

export function serializeInventoryAdjustment(db: ErpDb, a: Row<typeof inventoryAdjustments>) {
  const lines = db
    .select()
    .from(inventoryAdjustmentLines)
    .where(eq(inventoryAdjustmentLines.adjustmentId, a.id))
    .orderBy(asc(inventoryAdjustmentLines.line))
    .all();
  return {
    id: String(a.id),
    tranId: a.tranId,
    externalId: a.externalId,
    location: locationRef(db, a.locationId),
    tranDate: a.tranDate,
    custbody_reason: status(a.reason),
    account: accountRef(db, a.accountId),
    memo: a.memo,
    journalEntry: journalRef(db, a.journalId),
    createdBy: userRef(db, a.createdByUserId),
    inventory: {
      items: lines.map((l) => {
        const { ref: itemR, item } = itemRef(db, l.itemId);
        return {
          line: l.line,
          item: itemR,
          adjustQtyBy: qtyOf(item, l.adjustQtyBase),
          units: item?.unitsType,
          unitCost: rate(l.unitCostUsdc),
          amount: dollars(l.amountUsdc),
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  receiptInventoryNumber: l.lotNumber,
                  quantity: qtyOf(item, Math.abs(l.adjustQtyBase)),
                  inventoryStatus: status(l.inventoryStatus),
                },
              ],
            },
          },
        };
      }),
    },
  };
}

export function serializeInventoryTransfer(db: ErpDb, t: Row<typeof inventoryTransfers>) {
  const lines = db
    .select()
    .from(inventoryTransferLines)
    .where(eq(inventoryTransferLines.transferId, t.id))
    .orderBy(asc(inventoryTransferLines.line))
    .all();
  return {
    id: String(t.id),
    tranId: t.tranId,
    externalId: t.externalId,
    location: locationRef(db, t.fromLocationId),
    transferLocation: locationRef(db, t.toLocationId),
    tranDate: t.tranDate,
    memo: t.memo,
    createdBy: userRef(db, t.createdByUserId),
    inventory: {
      items: lines.map((l) => {
        const { ref: itemR, item } = itemRef(db, l.itemId);
        return {
          line: l.line,
          item: itemR,
          adjustQtyBy: qtyOf(item, l.quantityBase),
          units: item?.unitsType,
          amount: dollars(l.amountUsdc),
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  receiptInventoryNumber: l.lotNumber,
                  quantity: qtyOf(item, l.quantityBase),
                  inventoryStatus: status(l.inventoryStatus),
                },
              ],
            },
          },
        };
      }),
    },
  };
}

export function serializeInventoryStatusChange(db: ErpDb, c: Row<typeof inventoryStatusChanges>) {
  const lines = db
    .select()
    .from(inventoryStatusChangeLines)
    .where(eq(inventoryStatusChangeLines.changeId, c.id))
    .orderBy(asc(inventoryStatusChangeLines.line))
    .all();
  return {
    id: String(c.id),
    tranId: c.tranId,
    externalId: c.externalId,
    location: locationRef(db, c.locationId),
    tranDate: c.tranDate,
    memo: c.memo,
    createdBy: userRef(db, c.createdByUserId),
    inventory: {
      items: lines.map((l) => {
        const { ref: itemR, item } = itemRef(db, l.itemId);
        return {
          line: l.line,
          item: itemR,
          receiptInventoryNumber: l.lotNumber,
          quantity: qtyOf(item, l.quantityBase),
          units: item?.unitsType,
          previousStatus: status(l.previousStatus),
          revisedStatus: status(l.revisedStatus),
        };
      }),
    },
  };
}

export function serializeVendorBill(db: ErpDb, b: Row<typeof vendorBills>) {
  const po =
    b.poId === null
      ? null
      : db.select().from(purchaseOrders).where(eq(purchaseOrders.id, b.poId)).get();
  const lines = db
    .select()
    .from(vendorBillLines)
    .where(eq(vendorBillLines.billId, b.id))
    .orderBy(asc(vendorBillLines.line))
    .all();
  const duplicateOf =
    b.duplicateOfId === null
      ? null
      : db.select().from(vendorBills).where(eq(vendorBills.id, b.duplicateOfId)).get();
  const receipts = po ? receiptsFor(db, po.id) : [];
  return {
    id: String(b.id),
    tranId: b.tranId,
    externalId: b.externalId,
    entity: vendorRef(db, b.vendorId),
    createdFrom: po ? ref(po.id, po.tranId) : null,
    tranDate: b.tranDate,
    dueDate: b.dueDate,
    terms: status(b.terms),
    custbody_freight: dollars(b.freightUsdc),
    total: dollars(b.totalUsdc),
    amountPaid: dollars(b.amountPaidUsdc),
    amountRemaining: dollars(b.status === "rejected" ? 0 : b.totalUsdc - b.amountPaidUsdc),
    memo: b.memo,
    status: status(b.status),
    custbody_match_status: status(b.matchStatus),
    custbody_match_exceptions: JSON.parse(b.matchExceptionsJson),
    approvalStatus: status(b.approvalStatus),
    approvedBy: userRef(db, b.approvedByUserId),
    approvalNote: b.approvalNote,
    custbody_duplicate_of: duplicateOf ? ref(duplicateOf.id, duplicateOf.tranId) : null,
    custbody_price_drift: b.priceDriftJson ? JSON.parse(b.priceDriftJson) : null,
    journalEntry: journalRef(db, b.journalId),
    createdBy: userRef(db, b.createdByUserId),
    createdAt: b.createdAt,
    item: {
      items: lines.map((l) => {
        const { ref: itemR, item } = itemRef(db, l.itemId);
        return {
          line: l.line,
          item: itemR,
          description: l.description,
          quantity: qtyOf(item, l.quantityBase),
          units: item?.unitsType,
          rate: rate(l.rateUsdc),
          amount: dollars(l.amountUsdc),
          orderLine: l.poLineId,
        };
      }),
    },
    receipts: receipts.map(({ receipt, line }) => {
      const { item } = itemRef(db, line.itemId);
      return {
        tranId: receipt.tranId,
        tranDate: receipt.tranDate,
        line: line.line,
        receiptInventoryNumber: line.lotNumber,
        quantity: qtyOf(item, line.quantityBase),
        inventoryStatus: status(line.inventoryStatus),
      };
    }),
  };
}

export function serializeVendorPayment(db: ErpDb, p: Row<typeof vendorPayments>) {
  const bill =
    p.appliedBillId === null
      ? null
      : db.select().from(vendorBills).where(eq(vendorBills.id, p.appliedBillId)).get();
  return {
    id: String(p.id),
    tranId: p.tranId,
    externalId: p.externalId,
    entity: vendorRef(db, p.vendorId),
    tranDate: p.tranDate,
    account: accountRef(db, p.accountId),
    payment: dollars(p.amountUsdc),
    custbody_payment_method: status(p.paymentMethod),
    apply: {
      items: bill
        ? [{ doc: ref(bill.id, bill.tranId), amount: dollars(p.amountUsdc), apply: true }]
        : [],
    },
    custbody_on_account: bill === null,
    custbody_near_tx: p.custbodyNearTx,
    custbody_near_explorer_url: p.custbodyNearExplorerUrl,
    memo: p.memo,
    journalEntry: journalRef(db, p.journalId),
    createdBy: userRef(db, p.createdByUserId),
  };
}

export function serializeJournalEntry(db: ErpDb, j: Row<typeof journalEntries>) {
  const lines = db
    .select()
    .from(journalLines)
    .where(eq(journalLines.journalId, j.id))
    .orderBy(asc(journalLines.line))
    .all();
  return {
    id: String(j.id),
    tranId: j.tranId,
    tranDate: j.tranDate,
    memo: j.memo,
    custbody_source: { type: j.sourceType, id: j.sourceId === null ? null : String(j.sourceId) },
    createdBy: userRef(db, j.createdByUserId),
    line: {
      items: lines.map((l) => ({
        line: l.line,
        account: accountRef(db, l.accountId),
        debit: dollars(l.debitUsdc),
        credit: dollars(l.creditUsdc),
        memo: l.memo,
        location: l.locationId === null ? null : locationRef(db, l.locationId),
        entity: l.vendorId === null ? null : vendorRef(db, l.vendorId),
      })),
    },
  };
}

export function serializeAudit(db: ErpDb, a: Row<typeof auditTrail>) {
  return {
    id: String(a.id),
    at: a.at,
    user: userRef(db, a.userId),
    action: a.action,
    recordType: a.recordType,
    recordId: a.recordId === null ? null : String(a.recordId),
    tranId: a.tranId,
    detail: a.detail,
  };
}

export function serializeRule(r: Row<typeof approvalRules>) {
  return {
    id: String(r.id),
    scope: r.scope,
    ruleNo: r.ruleNo,
    description: r.description,
    minTotal: r.minTotalUsdc === null ? null : dollars(r.minTotalUsdc),
    maxTotal: r.maxTotalUsdc === null ? null : dollars(r.maxTotalUsdc),
    vendorStatus: r.vendorStatus,
    matchStatus: r.matchStatus,
    requires: r.requires,
    approverRole: r.approverRole,
  };
}

export function inventoryBalanceRows(
  db: ErpDb,
  filter: { location?: string | undefined; item?: string | undefined } = {},
) {
  const rows = db.select().from(inventoryBalances).all();
  return rows
    .map((b) => {
      const { ref: itemR, item } = itemRef(db, b.itemId);
      const loc = db.select().from(locations).where(eq(locations.id, b.locationId)).get();
      return {
        item: itemR,
        itemCode: item?.itemId ?? "?",
        displayName: item?.displayName ?? "?",
        location: loc ? ref(loc.id, loc.name) : ref(b.locationId, "?"),
        locationCode: loc?.externalId ?? "?",
        inventoryStatus: status(b.inventoryStatus),
        quantityOnHand: qtyOf(item, b.quantityOnHandBase),
        units: item?.unitsType ?? "",
        value: dollars(b.valueUsdc),
        averageCost:
          b.quantityOnHandBase === 0 || !item
            ? null
            : rate(Math.round((b.valueUsdc * item.baseUnitsPerUnit) / b.quantityOnHandBase)),
        quantityOnHandBase: b.quantityOnHandBase,
        valueUsdc: b.valueUsdc,
      };
    })
    .filter(
      (r) =>
        (!filter.location || r.locationCode === filter.location) &&
        (!filter.item || r.itemCode === filter.item),
    )
    .sort(
      (a, b) =>
        a.locationCode.localeCompare(b.locationCode) ||
        a.itemCode.localeCompare(b.itemCode) ||
        a.inventoryStatus.id.localeCompare(b.inventoryStatus.id),
    );
}

export function serializeTrialBalance(db: ErpDb) {
  const tb = trialBalance(db);
  return {
    balanced: tb.balanced,
    totalDebits: dollars(tb.totalDebits),
    totalCredits: dollars(tb.totalCredits),
    lines: tb.rows.map((r) => ({
      account: `${r.acctNumber} ${r.acctName}`,
      acctNumber: r.acctNumber,
      acctType: r.acctType,
      debit: dollars(r.debitUsdc),
      credit: dollars(r.creditUsdc),
      balance: dollars(r.balanceUsdc),
    })),
  };
}

// ---------------------------------------------------------------- request bodies → postings

type Body = Record<string, unknown>;
const obj = (v: unknown): Body =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {};
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
/** A reference field: { id } or { refName }, or a bare string. */
const refCode = (v: unknown) => str(obj(v).refName) ?? str(obj(v).id) ?? str(v);
const itemsOf = (v: unknown): Body[] => {
  const list = obj(v).items;
  return Array.isArray(list) ? list.map(obj) : [];
};
function need<T>(value: T | null, field: string): T {
  if (value === null || value === undefined)
    throw new ApiError(400, "INVALID_BODY", `"${field}" is required.`);
  return value;
}
const money = (v: unknown, field: string) => {
  const n = num(v);
  if (n === null)
    throw new ApiError(400, "INVALID_BODY", `"${field}" must be a number of dollars.`);
  return usd(n);
};

export function purchaseOrderFromBody(db: ErpDb, body: Body, principal: Principal, at: string) {
  const lines = itemsOf(body.item).map((l) => {
    const item = itemByCode(db, need(refCode(l.item), "item.items[].item"));
    return {
      itemCode: item.itemId,
      quantityBase: toBase(need(num(l.quantity), "item.items[].quantity"), item.baseUnitsPerUnit),
      rateUsdc: money(l.rate, "item.items[].rate"),
      ...(num(l.amount) !== null ? { amountUsdc: usd(num(l.amount) as number) } : {}),
    };
  });
  return {
    tranId: need(str(body.tranId), "tranId"),
    vendorCode: need(refCode(body.entity), "entity"),
    locationCode: need(refCode(body.location), "location"),
    tranDate: need(str(body.tranDate), "tranDate"),
    category: str(body.custbody_dayone_category),
    poHash: str(body.custbody_dayone_po_hash),
    freightUsdc:
      num(body.custbody_freight) === null ? 0 : usd(num(body.custbody_freight) as number),
    ...(num(body.total) !== null ? { totalUsdc: usd(num(body.total) as number) } : {}),
    memo: str(body.memo),
    lines,
    verdict: need(
      refCode(body.custbody_contract_verdict),
      "custbody_contract_verdict",
    ) as Parameters<typeof upsertPurchaseOrder>[1]["verdict"],
    reason: str(body.custbody_contract_reason),
    fundingTx: str(body.custbody_near_funding_tx),
    approvalTx: str(body.custbody_near_approval_tx),
    approvedBy: str(body.custbody_near_approved_by),
    userId: principal.id,
    at,
  };
}

const VERDICTS = ["funded", "awaitingApproval", "refused", "cancelled", "refunded", "paid"];

export function createPurchaseOrder(db: ErpDb, body: Body, principal: Principal, clock: Clock) {
  require(principal, "write:purchaseOrder");
  const input = purchaseOrderFromBody(db, body, principal, clock.now());
  if (!VERDICTS.includes(input.verdict))
    throw new ApiError(
      400,
      "INVALID_BODY",
      `custbody_contract_verdict must be one of ${VERDICTS.join(", ")}.`,
    );
  if (!input.lines.length)
    throw new ApiError(400, "INVALID_BODY", "A purchase order needs at least one line.");
  return refusalToApi(() => upsertPurchaseOrder(db, input));
}

export function patchPurchaseOrder(
  db: ErpDb,
  tranId: string,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  const po = poByTranId(db, tranId);
  if (!po) throw new ApiError(404, "NOT_FOUND", `No purchase order ${tranId}.`);
  const at = clock.now();
  if (body.approvalStatus !== undefined) {
    require(principal, "sign:purchaseOrder");
    if (refCode(body.approvalStatus) !== "approved")
      throw new ApiError(
        400,
        "INVALID_BODY",
        "Only approvalStatus approved is supported on a PATCH.",
      );
    return refusalToApi(() =>
      signPurchaseOrder(db, {
        tranId,
        userId: principal.id,
        note: str(body.approvalNote) ?? undefined,
        at,
      }),
    );
  }
  require(principal, "write:purchaseOrder");
  const verdict = refCode(body.custbody_contract_verdict);
  if (!verdict || !VERDICTS.includes(verdict))
    throw new ApiError(
      400,
      "INVALID_BODY",
      `custbody_contract_verdict must be one of ${VERDICTS.join(", ")}.`,
    );
  if (verdict === "cancelled" || verdict === "refunded") {
    return refusalToApi(() =>
      closePurchaseOrder(db, {
        tranId,
        verdict,
        reason: str(body.custbody_contract_reason),
        userId: principal.id,
        at,
      }),
    );
  }
  const lines = poLinesOf(db, po.id).map(({ line, item }) => ({
    itemCode: item.itemId,
    quantityBase: line.quantityBase,
    rateUsdc: line.rateUsdc,
    amountUsdc: line.amountUsdc,
  }));
  const vendor = db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get();
  const location = db.select().from(locations).where(eq(locations.id, po.locationId)).get();
  return refusalToApi(() =>
    upsertPurchaseOrder(db, {
      tranId,
      vendorCode: vendor?.entityId ?? "",
      locationCode: location?.externalId ?? "",
      tranDate: po.tranDate,
      freightUsdc: po.freightUsdc,
      totalUsdc: po.totalUsdc,
      lines,
      verdict: verdict as Parameters<typeof upsertPurchaseOrder>[1]["verdict"],
      reason: str(body.custbody_contract_reason),
      fundingTx: str(body.custbody_near_funding_tx),
      approvalTx: str(body.custbody_near_approval_tx),
      approvedBy: str(body.custbody_near_approved_by),
      userId: principal.id,
      at,
    }),
  );
}

export function createItemReceipt(
  db: ErpDb,
  poTranId: string,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  require(principal, "write:itemReceipt");
  const lines = itemsOf(body.item).flatMap((l) => {
    const poLine = need(num(l.orderLine ?? l.line), "item.items[].orderLine");
    const po = poByTranId(db, poTranId);
    if (!po) throw new ApiError(404, "NOT_FOUND", `No purchase order ${poTranId}.`);
    const target = poLinesOf(db, po.id).find((p) => p.line.line === poLine);
    if (!target) throw new ApiError(400, "INVALID_BODY", `${poTranId} has no line ${poLine}.`);
    const assignments = itemsOf(obj(l.inventoryDetail).inventoryAssignment);
    if (!assignments.length)
      throw new ApiError(
        400,
        "INVALID_BODY",
        "Each receipt line needs an inventoryDetail.inventoryAssignment with the Day One lot.",
      );
    return assignments.map((a) => ({
      poLine,
      quantityBase: toBase(
        need(num(a.quantity ?? l.quantity), "quantity"),
        target.item.baseUnitsPerUnit,
      ),
      lotNumber: need(str(a.receiptInventoryNumber), "receiptInventoryNumber"),
      inventoryStatus: receiptStatus(refCode(a.inventoryStatus)),
    }));
  });
  return refusalToApi(() =>
    postItemReceipt(db, {
      externalId: need(str(body.externalId), "externalId"),
      poTranId,
      tranDate: need(str(body.tranDate), "tranDate"),
      memo: str(body.memo),
      lines,
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

export function createInventoryStatusChange(
  db: ErpDb,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  require(principal, "write:inventory");
  const lot = need(str(body.receiptInventoryNumber), "receiptInventoryNumber");
  const revised = refCode(body.revisedStatus);
  const poTranId = refCode(body.createdFrom);
  if (poTranId === null) {
    // A lot that came without a purchase order (opening stock): a plain status change.
    const location = locationByCode(db, need(refCode(body.location), "location"));
    const item = itemByCode(db, need(refCode(body.item), "item"));
    const previous = refCode(body.previousStatus) ?? "quarantine";
    if (
      !["quarantine", "good", "rejected"].includes(previous) ||
      !revised ||
      !["quarantine", "good", "rejected"].includes(revised)
    ) {
      throw new ApiError(
        400,
        "INVALID_BODY",
        "previousStatus and revisedStatus must be quarantine, good or rejected.",
      );
    }
    return refusalToApi(() =>
      postInventoryStatusChange(db, {
        externalId: need(str(body.externalId), "externalId"),
        locationId: location.id,
        tranDate: need(str(body.tranDate), "tranDate"),
        memo: str(body.memo) ?? undefined,
        lines: [
          {
            itemId: item.id,
            lotNumber: lot,
            previousStatus: previous as "quarantine" | "good" | "rejected",
            revisedStatus: revised as "quarantine" | "good" | "rejected",
          },
        ],
        userId: principal.id,
        at: clock.now(),
      }),
    );
  }
  const common = {
    externalId: need(str(body.externalId), "externalId"),
    poTranId,
    lotNumber: lot,
    tranDate: need(str(body.tranDate), "tranDate"),
    userId: principal.id,
    at: clock.now(),
  };
  if (revised === "good") return refusalToApi(() => releaseReceivedLot(db, common));
  if (revised === "rejected")
    return refusalToApi(
      () => returnReceivedLot(db, { ...common, reason: str(body.memo) ?? "Rejected by QC" }).change,
    );
  throw new ApiError(400, "INVALID_BODY", "revisedStatus must be good or rejected.");
}

const REASONS = ["opening", "production", "waste", "count", "return"] as const;

export function createInventoryAdjustment(
  db: ErpDb,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  require(principal, "write:inventory");
  const reason = refCode(body.custbody_reason) as (typeof REASONS)[number] | null;
  if (!reason || !REASONS.includes(reason))
    throw new ApiError(
      400,
      "INVALID_BODY",
      `custbody_reason must be one of ${REASONS.join(", ")}.`,
    );
  const location = locationByCode(db, need(refCode(body.location), "location"));
  const lines = itemsOf(body.inventory).flatMap((l) => {
    const item = itemByCode(db, need(refCode(l.item), "inventory.items[].item"));
    const assignments = itemsOf(obj(l.inventoryDetail).inventoryAssignment);
    const unitCost = num(l.unitCost);
    const sign = Math.sign(need(num(l.adjustQtyBy), "adjustQtyBy")) || 1;
    const rows = assignments.length
      ? assignments
      : [
          {
            receiptInventoryNumber: l.receiptInventoryNumber,
            quantity: Math.abs(num(l.adjustQtyBy) ?? 0),
            inventoryStatus: l.inventoryStatus,
          },
        ];
    return rows.map((a) => ({
      itemId: item.id,
      lotNumber: need(str(a.receiptInventoryNumber), "receiptInventoryNumber"),
      inventoryStatus: (refCode(a.inventoryStatus) ?? "good") as "quarantine" | "good" | "rejected",
      adjustQtyBase: sign * toBase(need(num(a.quantity), "quantity"), item.baseUnitsPerUnit),
      ...(unitCost !== null ? { unitCostUsdc: usd(unitCost) } : {}),
    }));
  });
  return refusalToApi(() =>
    postInventoryAdjustment(db, {
      externalId: need(str(body.externalId), "externalId"),
      locationId: location.id,
      tranDate: need(str(body.tranDate), "tranDate"),
      reason,
      memo: str(body.memo) ?? undefined,
      lines,
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

export function createInventoryTransfer(db: ErpDb, body: Body, principal: Principal, clock: Clock) {
  require(principal, "write:inventory");
  const from = locationByCode(db, need(refCode(body.location), "location"));
  const to = locationByCode(db, need(refCode(body.transferLocation), "transferLocation"));
  const lines = itemsOf(body.inventory).flatMap((l) => {
    const item = itemByCode(db, need(refCode(l.item), "inventory.items[].item"));
    const assignments = itemsOf(obj(l.inventoryDetail).inventoryAssignment);
    const rows = assignments.length
      ? assignments
      : [
          {
            receiptInventoryNumber: l.receiptInventoryNumber,
            quantity: l.adjustQtyBy,
            inventoryStatus: l.inventoryStatus,
          },
        ];
    return rows.map((a) => ({
      itemId: item.id,
      lotNumber: need(str(a.receiptInventoryNumber), "receiptInventoryNumber"),
      inventoryStatus: (refCode(a.inventoryStatus) ?? "good") as "quarantine" | "good" | "rejected",
      quantityBase: toBase(need(num(a.quantity), "quantity"), item.baseUnitsPerUnit),
    }));
  });
  return refusalToApi(() =>
    postInventoryTransfer(db, {
      externalId: need(str(body.externalId), "externalId"),
      fromLocationId: from.id,
      toLocationId: to.id,
      tranDate: need(str(body.tranDate), "tranDate"),
      memo: str(body.memo) ?? undefined,
      lines,
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

export function createVendorBillFromBody(
  db: ErpDb,
  body: Body,
  principal: Principal,
  clock: Clock,
  poTranId: string | null = null,
) {
  require(principal, "write:vendorBill");
  const lines = itemsOf(body.item).map((l) => {
    const item = itemByCode(db, need(refCode(l.item), "item.items[].item"));
    return {
      itemCode: item.itemId,
      description: str(l.description),
      quantityBase: toBase(need(num(l.quantity), "item.items[].quantity"), item.baseUnitsPerUnit),
      rateUsdc: money(l.rate, "item.items[].rate"),
      ...(num(l.amount) !== null ? { amountUsdc: usd(num(l.amount) as number) } : {}),
      poLine: num(l.orderLine),
    };
  });
  return refusalToApi(() =>
    createVendorBill(db, {
      tranId: need(str(body.tranId), "tranId"),
      externalId: str(body.externalId),
      vendorCode: need(refCode(body.entity), "entity"),
      poTranId: poTranId ?? refCode(body.createdFrom),
      tranDate: need(str(body.tranDate), "tranDate"),
      dueDate: str(body.dueDate),
      freightUsdc:
        num(body.custbody_freight) === null ? 0 : usd(num(body.custbody_freight) as number),
      totalUsdc: money(body.total, "total"),
      memo: str(body.memo),
      lines,
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

export function patchVendorBill(
  db: ErpDb,
  id: number,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  require(principal, "decide:vendorBill");
  const decision = refCode(body.approvalStatus);
  if (decision !== "approved" && decision !== "rejected")
    throw new ApiError(400, "INVALID_BODY", "approvalStatus must be approved or rejected.");
  return refusalToApi(() =>
    decideVendorBill(db, {
      billId: id,
      decision: decision === "approved" ? "approve" : "reject",
      note: str(body.approvalNote) ?? "",
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

export function createVendorPaymentFromBody(
  db: ErpDb,
  body: Body,
  principal: Principal,
  clock: Clock,
) {
  require(principal, "write:vendorPayment");
  const applyItems = itemsOf(body.apply);
  const doc = applyItems[0] ? refCode(applyItems[0].doc) : null;
  const po = refCode(body.createdFrom);
  const method = refCode(body.custbody_payment_method) ?? "escrowRelease";
  if (method !== "escrowRelease" && method !== "check")
    throw new ApiError(
      400,
      "INVALID_BODY",
      "custbody_payment_method must be escrowRelease or check.",
    );
  return refusalToApi(() =>
    createVendorPayment(db, {
      externalId: need(str(body.externalId), "externalId"),
      vendorCode: need(refCode(body.entity), "entity"),
      tranDate: need(str(body.tranDate), "tranDate"),
      amountUsdc: money(body.payment, "payment"),
      paymentMethod: method,
      applyTo: doc ? { billTranId: doc } : po ? { poTranId: po } : null,
      nearTx: str(body.custbody_near_tx),
      explorerUrl: str(body.custbody_near_explorer_url),
      memo: str(body.memo),
      userId: principal.id,
      at: clock.now(),
    }),
  );
}

/** Day One asks before a release: is there an approved, unpaid bill for this PO? */
export function billStatusForPo(db: ErpDb, poTranId: string) {
  const po = poByTranId(db, poTranId);
  if (!po) return { purchaseOrder: null, bill: null };
  const bill = approvedBillFor(db, poTranId);
  const latest = db
    .select()
    .from(vendorBills)
    .where(eq(vendorBills.poId, po.id))
    .orderBy(desc(vendorBills.id))
    .get();
  return {
    purchaseOrder: ref(po.id, po.tranId),
    bill: bill ? serializeVendorBill(db, bill) : latest ? serializeVendorBill(db, latest) : null,
  };
}

/** Turns a posting refusal into an API error the connector can read. */
function refusalToApi<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ErpRefusal) {
      const status =
        error.code === "VENDOR_NOT_IN_MASTER" ||
        error.code === "PO_NOT_FOUND" ||
        error.code === "BILL_NOT_FOUND" ||
        error.code === "ITEM_NOT_IN_MASTER"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 409;
      throw new ApiError(status, error.code, error.message);
    }
    if (error instanceof Error && error.name === "PostingError")
      throw new ApiError(409, "POSTING_REFUSED", error.message);
    throw error;
  }
}

// ---------------------------------------------------------------- readers

export const readers = {
  vendor: {
    list: (db: ErpDb) =>
      db.select().from(vendors).orderBy(asc(vendors.entityId)).all().map(serializeVendor),
    get: (db: ErpDb, key: string) => {
      const v = db
        .select()
        .from(vendors)
        .where(/^\d+$/.test(key) ? eq(vendors.id, Number(key)) : eq(vendors.entityId, key))
        .get();
      return v ? serializeVendor(v) : null;
    },
  },
  inventoryItem: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(items)
        .orderBy(asc(items.itemId))
        .all()
        .map((i) => serializeItem(db, i)),
    get: (db: ErpDb, key: string) => {
      const i = db
        .select()
        .from(items)
        .where(/^\d+$/.test(key) ? eq(items.id, Number(key)) : eq(items.itemId, key))
        .get();
      return i ? serializeItem(db, i) : null;
    },
  },
  location: {
    list: (db: ErpDb) => db.select().from(locations).all().map(serializeLocation),
    get: (db: ErpDb, key: string) => {
      const l = db
        .select()
        .from(locations)
        .where(/^\d+$/.test(key) ? eq(locations.id, Number(key)) : eq(locations.externalId, key))
        .get();
      return l ? serializeLocation(l) : null;
    },
  },
  account: {
    list: (db: ErpDb) =>
      db.select().from(accounts).orderBy(asc(accounts.acctNumber)).all().map(serializeAccount),
    get: (db: ErpDb, key: string) => {
      const a = db
        .select()
        .from(accounts)
        .where(/^\d+$/.test(key) ? eq(accounts.id, Number(key)) : eq(accounts.acctNumber, key))
        .get();
      return a ? serializeAccount(a) : null;
    },
  },
  purchaseOrder: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(purchaseOrders)
        .orderBy(asc(purchaseOrders.id))
        .all()
        .map((p) => serializePurchaseOrder(db, p)),
    get: (db: ErpDb, key: string) => {
      const p = db
        .select()
        .from(purchaseOrders)
        .where(
          /^\d+$/.test(key) ? eq(purchaseOrders.id, Number(key)) : eq(purchaseOrders.tranId, key),
        )
        .get();
      return p ? serializePurchaseOrder(db, p) : null;
    },
  },
  itemReceipt: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(itemReceipts)
        .orderBy(asc(itemReceipts.id))
        .all()
        .map((r) => serializeItemReceipt(db, r)),
    get: (db: ErpDb, key: string) => {
      const r = db
        .select()
        .from(itemReceipts)
        .where(/^\d+$/.test(key) ? eq(itemReceipts.id, Number(key)) : eq(itemReceipts.tranId, key))
        .get();
      return r ? serializeItemReceipt(db, r) : null;
    },
  },
  inventoryAdjustment: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(inventoryAdjustments)
        .orderBy(asc(inventoryAdjustments.id))
        .all()
        .map((a) => serializeInventoryAdjustment(db, a)),
    get: (db: ErpDb, key: string) => {
      const a = db
        .select()
        .from(inventoryAdjustments)
        .where(
          /^\d+$/.test(key)
            ? eq(inventoryAdjustments.id, Number(key))
            : eq(inventoryAdjustments.tranId, key),
        )
        .get();
      return a ? serializeInventoryAdjustment(db, a) : null;
    },
  },
  inventoryTransfer: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(inventoryTransfers)
        .orderBy(asc(inventoryTransfers.id))
        .all()
        .map((t) => serializeInventoryTransfer(db, t)),
    get: (db: ErpDb, key: string) => {
      const t = db
        .select()
        .from(inventoryTransfers)
        .where(
          /^\d+$/.test(key)
            ? eq(inventoryTransfers.id, Number(key))
            : eq(inventoryTransfers.tranId, key),
        )
        .get();
      return t ? serializeInventoryTransfer(db, t) : null;
    },
  },
  inventoryStatusChange: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(inventoryStatusChanges)
        .orderBy(asc(inventoryStatusChanges.id))
        .all()
        .map((c) => serializeInventoryStatusChange(db, c)),
    get: (db: ErpDb, key: string) => {
      const c = db
        .select()
        .from(inventoryStatusChanges)
        .where(
          /^\d+$/.test(key)
            ? eq(inventoryStatusChanges.id, Number(key))
            : eq(inventoryStatusChanges.tranId, key),
        )
        .get();
      return c ? serializeInventoryStatusChange(db, c) : null;
    },
  },
  vendorBill: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(vendorBills)
        .orderBy(asc(vendorBills.id))
        .all()
        .map((b) => serializeVendorBill(db, b)),
    get: (db: ErpDb, key: string) => {
      const b = db
        .select()
        .from(vendorBills)
        .where(/^\d+$/.test(key) ? eq(vendorBills.id, Number(key)) : eq(vendorBills.tranId, key))
        .get();
      return b ? serializeVendorBill(db, b) : null;
    },
  },
  vendorPayment: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(vendorPayments)
        .orderBy(asc(vendorPayments.id))
        .all()
        .map((p) => serializeVendorPayment(db, p)),
    get: (db: ErpDb, key: string) => {
      const p = db
        .select()
        .from(vendorPayments)
        .where(
          /^\d+$/.test(key) ? eq(vendorPayments.id, Number(key)) : eq(vendorPayments.tranId, key),
        )
        .get();
      return p ? serializeVendorPayment(db, p) : null;
    },
  },
  journalEntry: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(journalEntries)
        .orderBy(asc(journalEntries.id))
        .all()
        .map((j) => serializeJournalEntry(db, j)),
    get: (db: ErpDb, key: string) => {
      const j = db
        .select()
        .from(journalEntries)
        .where(
          /^\d+$/.test(key) ? eq(journalEntries.id, Number(key)) : eq(journalEntries.tranId, key),
        )
        .get();
      return j ? serializeJournalEntry(db, j) : null;
    },
  },
  auditTrail: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(auditTrail)
        .orderBy(asc(auditTrail.id))
        .all()
        .map((a) => serializeAudit(db, a)),
    get: (db: ErpDb, key: string) => {
      const a = db
        .select()
        .from(auditTrail)
        .where(eq(auditTrail.id, Number(key)))
        .get();
      return a ? serializeAudit(db, a) : null;
    },
  },
  approvalRule: {
    list: (db: ErpDb) =>
      db
        .select()
        .from(approvalRules)
        .orderBy(asc(approvalRules.scope), asc(approvalRules.ruleNo))
        .all()
        .map(serializeRule),
    get: (db: ErpDb, key: string) => {
      const r = db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.id, Number(key)))
        .get();
      return r ? serializeRule(r) : null;
    },
  },
} as const;

export type RecordType = keyof typeof readers;
export const RECORD_TYPES = Object.keys(readers) as RecordType[];

/** Vendor by code or payout account, for the connector's payee check. */
export function findVendorByAccount(db: ErpDb, account: string) {
  const v = db.select().from(vendors).where(eq(vendors.payoutAccount, account)).get();
  return v ? serializeVendor(v) : null;
}

export { and, vendorByCode };
