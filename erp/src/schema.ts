// The mock ERP's own database (data/runtime/erp.db), as Drizzle tables. Record and field names
// loosely follow NetSuite's REST record style (vendor, inventoryItem, location, purchaseOrder,
// itemReceipt, vendorBill, vendorPayment, journalEntry); docs/ERP.md is the spec.
//
// Conventions shared with the rest of the repo: money is integer micro-dollars in *_usdc
// columns; quantities are integers in the item's base unit (mg or each) in *_base columns;
// timestamps are ISO-8601 UTC text. Every table is STRICT: drizzle-kit does not emit it, so each
// generated migration gets "STRICT" added by hand, and db.test.ts fails if a table lacks it.
//
// Inventory balances are never a column anyone writes. `inventory_movements` is the one ledger
// every receipt, adjustment, transfer and status change posts to, and `inventory_balances` is a
// view that sums it. Likewise the general ledger is `journal_lines`, summed by the trial balance.

import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  integer,
  sqliteTable,
  sqliteView,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

function oneOf(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  const list = sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  );
  return check(name, sql`${column} in (${list})` as SQL);
}

const id = () => integer().primaryKey({ autoIncrement: true });
const flag = () => integer({ mode: "boolean" });

// ---------------------------------------------------------------- Masters

export const ACCOUNT_TYPES = [
  "bank",
  "otherCurrentAsset",
  "accountsPayable",
  "otherCurrentLiability",
  "equity",
  "costOfGoodsSold",
  "expense",
] as const;

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    acctNumber: text().notNull().unique(),
    acctName: text().notNull(),
    acctType: text({ enum: ACCOUNT_TYPES }).notNull(),
    isInactive: flag().notNull().default(false),
  },
  (t) => [oneOf("accounts_type", t.acctType, ACCOUNT_TYPES)],
);

export const locations = sqliteTable("locations", {
  id: id(),
  name: text().notNull(),
  /** Day One's facility code (A, B, C): how the connector addresses the location. */
  externalId: text().notNull().unique(),
  city: text(),
});

export const USER_ROLES = [
  "administrator",
  "controller",
  "apManager",
  "approver",
  "connector",
  "viewer",
  "system",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable(
  "users",
  {
    id: id(),
    username: text().notNull().unique(),
    fullName: text().notNull(),
    role: text({ enum: USER_ROLES }).notNull(),
    /** Bearer token for the API; demo values from the seed, never a real secret. */
    token: text().unique(),
    /** The approver's on-chain account, so an `approve_po` transaction maps to a user. */
    externalId: text().unique(),
    locationId: integer().references(() => locations.id),
  },
  (t) => [oneOf("users_role", t.role, USER_ROLES)],
);

export const VENDOR_STATUS = ["approved", "onHold", "blocked"] as const;
export type VendorStatus = (typeof VENDOR_STATUS)[number];
export const TERMS = ["net30", "onQcRelease"] as const;

export const vendors = sqliteTable(
  "vendors",
  {
    id: id(),
    /** The vendor code, e.g. NGI; Day One's vendor code too. */
    entityId: text().notNull().unique(),
    companyName: text().notNull(),
    status: text({ enum: VENDOR_STATUS }).notNull(),
    /** The verified payout account the escrow may pay; null = paid by check. */
    payoutAccount: text(),
    payoutVerifiedAt: text(),
    terms: text({ enum: TERMS }).notNull().default("net30"),
    /** 3-way match limits, basis points (200 = 2%); null = the subsidiary default. */
    vbPoQtyToleranceBp: integer(),
    vbPoAmtToleranceBp: integer(),
    /** Absolute quantity (base units) a bill may exceed the receipt by; null = default. */
    vbIrQtyDifferenceBase: integer(),
    comments: text(),
  },
  (t) => [oneOf("vendors_status", t.status, VENDOR_STATUS), oneOf("vendors_terms", t.terms, TERMS)],
);

export const ITEM_CLASSES = ["rawMaterial", "packaging", "labSupply", "finishedGood"] as const;

export const items = sqliteTable(
  "items",
  {
    id: id(),
    /** The item code, e.g. ASC; Day One's material code. */
    itemId: text().notNull().unique(),
    displayName: text().notNull(),
    itemClass: text({ enum: ITEM_CLASSES }).notNull(),
    /** kg or ea: what the API shows quantities in. */
    unitsType: text().notNull(),
    /** Base units per unit: 1,000,000 mg per kg, 1 per each. */
    baseUnitsPerUnit: integer().notNull(),
    assetAccountId: integer()
      .notNull()
      .references(() => accounts.id),
    /** Standard cost per unit, micro-dollars; values opening balances at cutover. */
    costUsdc: integer().notNull().default(0),
    isInactive: flag().notNull().default(false),
  },
  (t) => [oneOf("items_class", t.itemClass, ITEM_CLASSES)],
);

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const RULE_SCOPES = ["purchaseOrder", "vendorBill"] as const;
export const RULE_REQUIRES = [
  "contractVerdict",
  "controller",
  "apManager",
  "auto",
  "reject",
] as const;

/** The approval matrix, as rows; approval.ts evaluates them in `ruleNo` order. */
export const approvalRules = sqliteTable(
  "approval_rules",
  {
    id: id(),
    scope: text({ enum: RULE_SCOPES }).notNull(),
    ruleNo: integer().notNull(),
    description: text().notNull(),
    minTotalUsdc: integer(),
    maxTotalUsdc: integer(),
    vendorStatus: text({ enum: VENDOR_STATUS }),
    /** For bills: 'matched', 'exception' or 'duplicate'; null = any. */
    matchStatus: text(),
    requires: text({ enum: RULE_REQUIRES }).notNull(),
    approverRole: text({ enum: USER_ROLES }),
  },
  (t) => [
    unique().on(t.scope, t.ruleNo),
    oneOf("approval_rules_scope", t.scope, RULE_SCOPES),
    oneOf("approval_rules_requires", t.requires, RULE_REQUIRES),
  ],
);

// ---------------------------------------------------------------- Purchasing

export const PO_STATUS = [
  "pendingApproval",
  "pendingReceipt",
  "partiallyReceived",
  "pendingBilling",
  "fullyBilled",
  "closed",
  "rejected",
] as const;
export const APPROVAL_STATUS = ["pendingApproval", "approved", "rejected"] as const;
export const CONTRACT_VERDICTS = [
  "funded",
  "awaitingApproval",
  "refused",
  "cancelled",
  "refunded",
  "paid",
] as const;

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: id(),
    /** Day One's PO number (PO-1042). */
    tranId: text().notNull().unique(),
    externalId: text().notNull().unique(),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    locationId: integer()
      .notNull()
      .references(() => locations.id),
    tranDate: text().notNull(),
    status: text({ enum: PO_STATUS }).notNull(),
    approvalStatus: text({ enum: APPROVAL_STATUS }).notNull(),
    approvedByUserId: integer().references(() => users.id),
    approvalNote: text(),
    freightUsdc: integer().notNull().default(0),
    totalUsdc: integer().notNull(),
    memo: text(),
    /** Day One's spend category, recorded for the audit trail only; the contract enforces it. */
    custbodyDayoneCategory: text(),
    custbodyDayonePoHash: text(),
    custbodyContractVerdict: text({ enum: CONTRACT_VERDICTS }).notNull(),
    custbodyContractReason: text(),
    custbodyNearFundingTx: text(),
    custbodyNearApprovalTx: text(),
    custbodyNearApprovedBy: text(),
    createdByUserId: integer()
      .notNull()
      .references(() => users.id),
    createdAt: text().notNull(),
  },
  (t) => [
    oneOf("purchase_orders_status", t.status, PO_STATUS),
    oneOf("purchase_orders_approval", t.approvalStatus, APPROVAL_STATUS),
    oneOf("purchase_orders_verdict", t.custbodyContractVerdict, CONTRACT_VERDICTS),
  ],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: id(),
    poId: integer()
      .notNull()
      .references(() => purchaseOrders.id),
    line: integer().notNull(),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    quantityBase: integer().notNull(),
    /** Price per unit, micro-dollars. */
    rateUsdc: integer().notNull(),
    amountUsdc: integer().notNull(),
    quantityReceivedBase: integer().notNull().default(0),
    quantityBilledBase: integer().notNull().default(0),
  },
  (t) => [unique().on(t.poId, t.line)],
);

export const INVENTORY_STATUS = ["quarantine", "good", "rejected"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUS)[number];

export const itemReceipts = sqliteTable("item_receipts", {
  id: id(),
  tranId: text().notNull().unique(),
  /** Day One's receipt reference (RCV-PO-1042). */
  externalId: text().notNull().unique(),
  poId: integer()
    .notNull()
    .references(() => purchaseOrders.id),
  locationId: integer()
    .notNull()
    .references(() => locations.id),
  tranDate: text().notNull(),
  memo: text(),
  journalId: integer().references((): AnySQLiteColumn => journalEntries.id),
  createdByUserId: integer()
    .notNull()
    .references(() => users.id),
  createdAt: text().notNull(),
});

export const itemReceiptLines = sqliteTable(
  "item_receipt_lines",
  {
    id: id(),
    receiptId: integer()
      .notNull()
      .references(() => itemReceipts.id),
    line: integer().notNull(),
    poLineId: integer()
      .notNull()
      .references(() => purchaseOrderLines.id),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    quantityBase: integer().notNull(),
    rateUsdc: integer().notNull(),
    amountUsdc: integer().notNull(),
    /** Day One's lot code (the "receipt inventory number"). */
    lotNumber: text().notNull(),
    inventoryStatus: text({ enum: INVENTORY_STATUS }).notNull(),
  },
  (t) => [
    unique().on(t.receiptId, t.line),
    oneOf("item_receipt_lines_status", t.inventoryStatus, INVENTORY_STATUS),
  ],
);

// ---------------------------------------------------------------- Inventory

export const ADJUSTMENT_REASONS = ["opening", "production", "waste", "count", "return"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const inventoryAdjustments = sqliteTable(
  "inventory_adjustments",
  {
    id: id(),
    tranId: text().notNull().unique(),
    /** Day One's key for the movement, e.g. lot event seq or batch number. */
    externalId: text().notNull().unique(),
    locationId: integer()
      .notNull()
      .references(() => locations.id),
    tranDate: text().notNull(),
    reason: text({ enum: ADJUSTMENT_REASONS }).notNull(),
    /** The offset account (WIP, waste, opening equity …). */
    accountId: integer()
      .notNull()
      .references(() => accounts.id),
    memo: text(),
    journalId: integer().references((): AnySQLiteColumn => journalEntries.id),
    createdByUserId: integer()
      .notNull()
      .references(() => users.id),
    createdAt: text().notNull(),
  },
  (t) => [oneOf("inventory_adjustments_reason", t.reason, ADJUSTMENT_REASONS)],
);

export const inventoryAdjustmentLines = sqliteTable(
  "inventory_adjustment_lines",
  {
    id: id(),
    adjustmentId: integer()
      .notNull()
      .references(() => inventoryAdjustments.id),
    line: integer().notNull(),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    lotNumber: text().notNull(),
    inventoryStatus: text({ enum: INVENTORY_STATUS }).notNull(),
    /** Signed: positive adds stock, negative issues it. */
    adjustQtyBase: integer().notNull(),
    /** Unit cost used (standard cost in, average cost out), micro-dollars per unit. */
    unitCostUsdc: integer().notNull(),
    /** Signed value of the line. */
    amountUsdc: integer().notNull(),
  },
  (t) => [
    unique().on(t.adjustmentId, t.line),
    oneOf("inventory_adjustment_lines_status", t.inventoryStatus, INVENTORY_STATUS),
  ],
);

export const inventoryTransfers = sqliteTable("inventory_transfers", {
  id: id(),
  tranId: text().notNull().unique(),
  /** Day One's transfer number. */
  externalId: text().notNull().unique(),
  fromLocationId: integer()
    .notNull()
    .references(() => locations.id),
  toLocationId: integer()
    .notNull()
    .references(() => locations.id),
  tranDate: text().notNull(),
  memo: text(),
  createdByUserId: integer()
    .notNull()
    .references(() => users.id),
  createdAt: text().notNull(),
});

export const inventoryTransferLines = sqliteTable(
  "inventory_transfer_lines",
  {
    id: id(),
    transferId: integer()
      .notNull()
      .references(() => inventoryTransfers.id),
    line: integer().notNull(),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    lotNumber: text().notNull(),
    inventoryStatus: text({ enum: INVENTORY_STATUS }).notNull(),
    quantityBase: integer().notNull(),
    amountUsdc: integer().notNull(),
  },
  (t) => [
    unique().on(t.transferId, t.line),
    oneOf("inventory_transfer_lines_status", t.inventoryStatus, INVENTORY_STATUS),
  ],
);

export const inventoryStatusChanges = sqliteTable("inventory_status_changes", {
  id: id(),
  tranId: text().notNull().unique(),
  /** Day One's QC decision reference, e.g. QC-ASC-261116-01. */
  externalId: text().notNull().unique(),
  locationId: integer()
    .notNull()
    .references(() => locations.id),
  tranDate: text().notNull(),
  memo: text(),
  createdByUserId: integer()
    .notNull()
    .references(() => users.id),
  createdAt: text().notNull(),
});

export const inventoryStatusChangeLines = sqliteTable(
  "inventory_status_change_lines",
  {
    id: id(),
    changeId: integer()
      .notNull()
      .references(() => inventoryStatusChanges.id),
    line: integer().notNull(),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    lotNumber: text().notNull(),
    quantityBase: integer().notNull(),
    previousStatus: text({ enum: INVENTORY_STATUS }).notNull(),
    revisedStatus: text({ enum: INVENTORY_STATUS }).notNull(),
  },
  (t) => [
    unique().on(t.changeId, t.line),
    oneOf("inventory_status_change_lines_from", t.previousStatus, INVENTORY_STATUS),
    oneOf("inventory_status_change_lines_to", t.revisedStatus, INVENTORY_STATUS),
  ],
);

export const MOVEMENT_SOURCES = [
  "itemReceipt",
  "inventoryAdjustment",
  "inventoryTransfer",
  "inventoryStatusChange",
] as const;

/**
 * The one inventory ledger. Every stock-affecting record posts here and nowhere else;
 * `inventory_balances` sums it. Triggers block UPDATE and DELETE (migration 0000).
 */
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: id(),
    sourceType: text({ enum: MOVEMENT_SOURCES }).notNull(),
    sourceId: integer().notNull(),
    sourceLine: integer().notNull(),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    locationId: integer()
      .notNull()
      .references(() => locations.id),
    inventoryStatus: text({ enum: INVENTORY_STATUS }).notNull(),
    lotNumber: text().notNull(),
    quantityDeltaBase: integer().notNull(),
    valueDeltaUsdc: integer().notNull(),
    postedAt: text().notNull(),
  },
  (t) => [
    oneOf("inventory_movements_source", t.sourceType, MOVEMENT_SOURCES),
    oneOf("inventory_movements_status", t.inventoryStatus, INVENTORY_STATUS),
  ],
);

/** Quantity and value per item, location and status: the sum of movements (migration 0000). */
export const inventoryBalances = sqliteView("inventory_balances", {
  itemId: integer().notNull(),
  locationId: integer().notNull(),
  inventoryStatus: text().notNull(),
  quantityOnHandBase: integer().notNull(),
  valueUsdc: integer().notNull(),
}).existing();

// ---------------------------------------------------------------- Accounts payable

export const MATCH_STATUS = ["matched", "exception", "duplicate"] as const;
export type MatchStatus = (typeof MATCH_STATUS)[number];
export const BILL_STATUS = ["open", "paidInFull", "rejected"] as const;

export const vendorBills = sqliteTable(
  "vendor_bills",
  {
    id: id(),
    /** The vendor's invoice number, as printed. */
    tranId: text().notNull(),
    /** Upper-case alphanumerics with a reissue suffix removed: the duplicate key. */
    normalizedTranId: text().notNull(),
    externalId: text().unique(),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    poId: integer().references(() => purchaseOrders.id),
    tranDate: text().notNull(),
    dueDate: text(),
    terms: text({ enum: TERMS }).notNull(),
    freightUsdc: integer().notNull().default(0),
    totalUsdc: integer().notNull(),
    memo: text(),
    matchStatus: text({ enum: MATCH_STATUS }).notNull(),
    /** JSON array of exceptions: code, line, billed, ordered, received, tolerance, message. */
    matchExceptionsJson: text().notNull().default("[]"),
    approvalStatus: text({ enum: APPROVAL_STATUS }).notNull(),
    approvedByUserId: integer().references(() => users.id),
    approvalNote: text(),
    duplicateOfId: integer().references((): AnySQLiteColumn => vendorBills.id),
    /** JSON note when a line's price is over the drift threshold against the last bill. */
    priceDriftJson: text(),
    status: text({ enum: BILL_STATUS }).notNull(),
    amountPaidUsdc: integer().notNull().default(0),
    journalId: integer().references((): AnySQLiteColumn => journalEntries.id),
    createdByUserId: integer()
      .notNull()
      .references(() => users.id),
    createdAt: text().notNull(),
  },
  (t) => [
    oneOf("vendor_bills_terms", t.terms, TERMS),
    oneOf("vendor_bills_match", t.matchStatus, MATCH_STATUS),
    oneOf("vendor_bills_approval", t.approvalStatus, APPROVAL_STATUS),
    oneOf("vendor_bills_status", t.status, BILL_STATUS),
  ],
);

export const vendorBillLines = sqliteTable(
  "vendor_bill_lines",
  {
    id: id(),
    billId: integer()
      .notNull()
      .references(() => vendorBills.id),
    line: integer().notNull(),
    poLineId: integer().references(() => purchaseOrderLines.id),
    itemId: integer()
      .notNull()
      .references(() => items.id),
    description: text(),
    quantityBase: integer().notNull(),
    rateUsdc: integer().notNull(),
    amountUsdc: integer().notNull(),
  },
  (t) => [unique().on(t.billId, t.line)],
);

export const PAYMENT_METHODS = ["escrowRelease", "check"] as const;

export const vendorPayments = sqliteTable(
  "vendor_payments",
  {
    id: id(),
    tranId: text().notNull().unique(),
    /** The settlement reference: the NEAR transaction hash or the check number. */
    externalId: text().notNull().unique(),
    vendorId: integer()
      .notNull()
      .references(() => vendors.id),
    tranDate: text().notNull(),
    /** The account the payment came from (escrow clearing or cash). */
    accountId: integer()
      .notNull()
      .references(() => accounts.id),
    amountUsdc: integer().notNull(),
    paymentMethod: text({ enum: PAYMENT_METHODS }).notNull(),
    /** Null = a prepayment on account (the bill was not approved when the money moved). */
    appliedBillId: integer().references(() => vendorBills.id),
    custbodyNearTx: text(),
    custbodyNearExplorerUrl: text(),
    memo: text(),
    journalId: integer().references((): AnySQLiteColumn => journalEntries.id),
    createdByUserId: integer()
      .notNull()
      .references(() => users.id),
    createdAt: text().notNull(),
  },
  (t) => [oneOf("vendor_payments_method", t.paymentMethod, PAYMENT_METHODS)],
);

// ---------------------------------------------------------------- General ledger and audit

export const JOURNAL_SOURCES = [
  "itemReceipt",
  "inventoryAdjustment",
  "vendorBill",
  "vendorPayment",
  "manual",
] as const;

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: id(),
    tranId: text().notNull().unique(),
    tranDate: text().notNull(),
    memo: text().notNull(),
    sourceType: text({ enum: JOURNAL_SOURCES }).notNull(),
    sourceId: integer(),
    createdByUserId: integer()
      .notNull()
      .references(() => users.id),
    createdAt: text().notNull(),
  },
  (t) => [oneOf("journal_entries_source", t.sourceType, JOURNAL_SOURCES)],
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: id(),
    journalId: integer()
      .notNull()
      .references(() => journalEntries.id),
    line: integer().notNull(),
    accountId: integer()
      .notNull()
      .references(() => accounts.id),
    debitUsdc: integer().notNull().default(0),
    creditUsdc: integer().notNull().default(0),
    memo: text(),
    locationId: integer().references(() => locations.id),
    vendorId: integer().references(() => vendors.id),
  },
  (t) => [
    unique().on(t.journalId, t.line),
    check("journal_lines_one_side", sql`(${t.debitUsdc} = 0) <> (${t.creditUsdc} = 0)` as SQL),
    check("journal_lines_positive", sql`${t.debitUsdc} >= 0 and ${t.creditUsdc} >= 0` as SQL),
  ],
);

export const AUDIT_ACTIONS = ["create", "update", "approve", "reject", "post", "login"] as const;

export const auditTrail = sqliteTable(
  "audit_trail",
  {
    id: id(),
    at: text().notNull(),
    userId: integer()
      .notNull()
      .references(() => users.id),
    action: text({ enum: AUDIT_ACTIONS }).notNull(),
    recordType: text().notNull(),
    recordId: integer(),
    tranId: text(),
    detail: text().notNull(),
  },
  (t) => [oneOf("audit_trail_action", t.action, AUDIT_ACTIONS)],
);
