// Accounts payable: vendor bills with the 3-way match and the duplicate check, the AP manager's
// decision on exceptions, and vendor payments. A bill posts to the ledger only once it is
// approved; a duplicate never posts and can never be paid. A payment that arrives before its
// bill is approved (the escrow pays on QC release, whatever the paperwork says) is held as a
// prepayment on the vendor's account until Marcy resolves the bill.

import { and, desc, eq, ne } from "drizzle-orm";
import { type Decision, evaluateVendorBill } from "../approval.ts";
import type { ErpDb } from "../db.ts";
import { type MatchException, type MatchPo, normalizeInvoiceNo, threeWayMatch } from "../match.ts";
import { extend, formatUsd, quantity } from "../money.ts";
import {
  itemReceiptLines,
  itemReceipts,
  items,
  purchaseOrderLines,
  purchaseOrders,
  settings,
  users,
  vendorBillLines,
  vendorBills,
  vendorPayments,
  type vendors,
} from "../schema.ts";
import { SETTINGS } from "../seed/data.ts";
import { audit } from "./audit.ts";
import { accountIdByNumber, nextTranId, postJournal } from "./journal.ts";
import { ErpRefusal, itemByCode, poByTranId, poLinesOf, vendorByCode } from "./purchasing.ts";

function setting(db: ErpDb, key: keyof typeof SETTINGS) {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? SETTINGS[key];
}

export function tolerancesFor(db: ErpDb, vendor: typeof vendors.$inferSelect) {
  return {
    poQtyBp: vendor.vbPoQtyToleranceBp ?? Number(setting(db, "vbPoQtyToleranceBp")),
    poAmtBp: vendor.vbPoAmtToleranceBp ?? Number(setting(db, "vbPoAmtToleranceBp")),
    irQtyDifferenceBase:
      vendor.vbIrQtyDifferenceBase ?? Number(setting(db, "vbIrQtyDifferenceBase")),
  };
}

/** The PO as the matcher sees it: lines with received (not rejected) and already billed quantities. */
export function matchPoOf(db: ErpDb, poId: number): MatchPo {
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).get();
  if (!po) throw new ErpRefusal("PO_NOT_FOUND", `No purchase order ${poId}.`);
  return {
    tranId: po.tranId,
    vendorId: po.vendorId,
    status: po.status,
    freightUsdc: po.freightUsdc,
    totalUsdc: po.totalUsdc,
    lines: poLinesOf(db, poId).map(({ line, item }) => ({
      line: line.line,
      itemId: item.id,
      itemCode: item.itemId,
      quantityBase: line.quantityBase,
      rateUsdc: line.rateUsdc,
      amountUsdc: line.amountUsdc,
      receivedBase: line.quantityReceivedBase,
      billedBase: line.quantityBilledBase,
    })),
  };
}

export interface BillLineInput {
  itemCode: string;
  description?: string | null;
  quantityBase: number;
  rateUsdc: number;
  amountUsdc?: number;
  poLine?: number | null;
}

export interface BillInput {
  /** The vendor's invoice number as printed. */
  tranId: string;
  externalId?: string | null;
  vendorCode: string;
  poTranId: string | null;
  tranDate: string;
  dueDate?: string | null;
  freightUsdc?: number;
  totalUsdc: number;
  memo?: string | null;
  lines: BillLineInput[];
  userId: number;
  at: string;
}

export interface PriceDrift {
  itemCode: string;
  rateUsdc: number;
  lastRateUsdc: number;
  lastInvoice: string;
  driftBp: number;
}

export interface BillResult {
  id: number;
  tranId: string;
  created: boolean;
  matchStatus: "matched" | "exception" | "duplicate";
  exceptions: MatchException[];
  approvalStatus: Decision["approvalStatus"];
  decision: Decision;
  duplicateOf: string | null;
  priceDrift: PriceDrift[];
  status: (typeof vendorBills.$inferSelect)["status"];
}

export function billByTranId(db: ErpDb, vendorId: number, tranId: string) {
  return db
    .select()
    .from(vendorBills)
    .where(and(eq(vendorBills.vendorId, vendorId), eq(vendorBills.tranId, tranId)))
    .get();
}

function daysBetween(a: string, b: string) {
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000;
}

/** The earlier bill this one duplicates, if any (docs/ERP.md §3.4). */
export function findDuplicate(
  db: ErpDb,
  input: {
    vendorId: number;
    tranId: string;
    poId: number | null;
    totalUsdc: number;
    tranDate: string;
  },
) {
  const normalized = normalizeInvoiceNo(input.tranId);
  const window = Number(setting(db, "duplicateWindowDays"));
  const candidates = db
    .select()
    .from(vendorBills)
    .where(and(eq(vendorBills.vendorId, input.vendorId), ne(vendorBills.matchStatus, "duplicate")))
    .all();
  const byNumber = candidates.find((b) => b.normalizedTranId === normalized);
  if (byNumber) return { bill: byNumber, why: `same invoice number as ${byNumber.tranId}` };
  if (input.poId !== null) {
    const byAmount = candidates.find(
      (b) =>
        b.poId === input.poId &&
        b.totalUsdc === input.totalUsdc &&
        daysBetween(b.tranDate, input.tranDate) <= window,
    );
    if (byAmount) {
      return {
        bill: byAmount,
        why: `same purchase order and amount as ${byAmount.tranId} (${formatUsd(byAmount.totalUsdc)}) within ${window} days`,
      };
    }
  }
  return null;
}

function priceDriftOf(
  db: ErpDb,
  vendorId: number,
  lines: { itemCode: string; itemId: number; rateUsdc: number }[],
) {
  const driftBp = Number(setting(db, "priceDriftBp"));
  const drift: PriceDrift[] = [];
  for (const l of lines) {
    const last = db
      .select({ rate: vendorBillLines.rateUsdc, invoice: vendorBills.tranId })
      .from(vendorBillLines)
      .innerJoin(vendorBills, eq(vendorBills.id, vendorBillLines.billId))
      .where(
        and(
          eq(vendorBills.vendorId, vendorId),
          eq(vendorBillLines.itemId, l.itemId),
          eq(vendorBills.approvalStatus, "approved"),
        ),
      )
      .orderBy(desc(vendorBills.tranDate), desc(vendorBills.id))
      .get();
    if (!last || last.rate <= 0) continue;
    const bp = Math.round(((l.rateUsdc - last.rate) * 10_000) / last.rate);
    if (bp > driftBp) {
      drift.push({
        itemCode: l.itemCode,
        rateUsdc: l.rateUsdc,
        lastRateUsdc: last.rate,
        lastInvoice: last.invoice,
        driftBp: bp,
      });
    }
  }
  return drift;
}

function postBillJournal(db: ErpDb, billId: number, userId: number, at: string) {
  const bill = db.select().from(vendorBills).where(eq(vendorBills.id, billId)).get();
  if (!bill || bill.journalId) return;
  const lines = db
    .select({ l: vendorBillLines, item: items })
    .from(vendorBillLines)
    .innerJoin(items, eq(items.id, vendorBillLines.itemId))
    .where(eq(vendorBillLines.billId, billId))
    .all();
  const journal: { account: string; debitUsdc: number; memo: string }[] = lines.map(
    ({ l, item }) => ({
      account: SETTINGS.accruedPurchasesAccount,
      debitUsdc: l.amountUsdc,
      memo: `${bill.tranId} line ${l.line} ${item.itemId}`,
    }),
  );
  if (bill.freightUsdc)
    journal.push({
      account: SETTINGS.freightAccount,
      debitUsdc: bill.freightUsdc,
      memo: `${bill.tranId} freight`,
    });
  const journalId = postJournal(db, {
    tranDate: bill.tranDate,
    memo: `Vendor bill ${bill.tranId}`,
    sourceType: "vendorBill",
    sourceId: bill.id,
    lines: [
      ...journal.map((j) => ({ ...j, vendorId: bill.vendorId })),
      {
        account: SETTINGS.accountsPayableAccount,
        creditUsdc: bill.totalUsdc,
        memo: bill.tranId,
        vendorId: bill.vendorId,
      },
    ],
    userId,
    at,
  });
  db.update(vendorBills).set({ journalId }).where(eq(vendorBills.id, billId)).run();
  // The PO's billed quantities move only when the bill is approved.
  for (const { l } of lines) {
    if (l.poLineId === null) continue;
    const poLine = db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, l.poLineId))
      .get();
    if (poLine) {
      db.update(purchaseOrderLines)
        .set({ quantityBilledBase: poLine.quantityBilledBase + l.quantityBase })
        .where(eq(purchaseOrderLines.id, poLine.id))
        .run();
    }
  }
  if (bill.poId !== null) {
    const poLines = db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.poId, bill.poId))
      .all();
    if (poLines.every((p) => p.quantityBilledBase >= p.quantityBase)) {
      db.update(purchaseOrders)
        .set({ status: "fullyBilled" })
        .where(eq(purchaseOrders.id, bill.poId))
        .run();
    }
  }
}

/** Saves a bill, runs the duplicate check and the 3-way match, and applies the approval matrix. */
export function createVendorBill(db: ErpDb, input: BillInput): BillResult {
  const vendor = vendorByCode(db, input.vendorCode);
  const existing = billByTranId(db, vendor.id, input.tranId);
  if (existing) return loadBillResult(db, existing.id, false);
  if (vendor.status === "blocked") {
    throw new ErpRefusal(
      "VENDOR_BLOCKED",
      `${vendor.companyName} is blocked; the ERP accepts no bills from it.`,
    );
  }
  const po = input.poTranId ? poByTranId(db, input.poTranId) : null;
  const freightUsdc = input.freightUsdc ?? 0;
  const lines = input.lines.map((l, i) => {
    const item = itemByCode(db, l.itemCode);
    return {
      line: i + 1,
      item,
      description: l.description ?? null,
      quantityBase: l.quantityBase,
      rateUsdc: l.rateUsdc,
      amountUsdc: l.amountUsdc ?? extend(l.quantityBase, l.rateUsdc, item.baseUnitsPerUnit),
      poLine: l.poLine ?? null,
    };
  });

  const duplicate = findDuplicate(db, {
    vendorId: vendor.id,
    tranId: input.tranId,
    poId: po?.id ?? null,
    totalUsdc: input.totalUsdc,
    tranDate: input.tranDate,
  });
  let matchStatus: BillResult["matchStatus"];
  let exceptions: MatchException[] = [];
  let pairs: { billLine: number; poLine: number | null }[] = lines.map((l) => ({
    billLine: l.line,
    poLine: l.poLine,
  }));
  if (duplicate) {
    matchStatus = "duplicate";
    exceptions = [
      {
        code: "DUPLICATE_INVOICE",
        line: null,
        message: `Duplicate of ${duplicate.bill.tranId}: ${duplicate.why}. ${duplicate.bill.tranId} is ${duplicate.bill.status === "paidInFull" ? "already paid" : duplicate.bill.approvalStatus}.`,
      },
    ];
  } else {
    const matchPo = po ? matchPoOf(db, po.id) : null;
    const result = threeWayMatch(
      {
        vendorId: vendor.id,
        freightUsdc,
        totalUsdc: input.totalUsdc,
        lines: lines.map((l) => ({
          line: l.line,
          itemId: l.item.id,
          itemCode: l.item.itemId,
          quantityBase: l.quantityBase,
          rateUsdc: l.rateUsdc,
          amountUsdc: l.amountUsdc,
          poLine: l.poLine,
        })),
      },
      matchPo,
      tolerancesFor(db, vendor),
      {
        qty: (base, itemId) => {
          const item = db.select().from(items).where(eq(items.id, itemId)).get();
          return item ? `${quantity(base, item.baseUnitsPerUnit)} ${item.unitsType}` : String(base);
        },
        usd: formatUsd,
      },
    );
    matchStatus = result.status;
    exceptions = result.exceptions;
    pairs = result.pairs;
  }
  const decision = evaluateVendorBill(db, { totalUsdc: input.totalUsdc, matchStatus });
  const priceDrift = duplicate
    ? []
    : priceDriftOf(
        db,
        vendor.id,
        lines.map((l) => ({ itemCode: l.item.itemId, itemId: l.item.id, rateUsdc: l.rateUsdc })),
      );
  const status = decision.approvalStatus === "rejected" ? "rejected" : "open";

  const row = db
    .insert(vendorBills)
    .values({
      tranId: input.tranId,
      normalizedTranId: normalizeInvoiceNo(input.tranId),
      externalId: input.externalId ?? null,
      vendorId: vendor.id,
      poId: po?.id ?? null,
      tranDate: input.tranDate,
      dueDate: input.dueDate ?? null,
      terms: vendor.terms,
      freightUsdc,
      totalUsdc: input.totalUsdc,
      memo: input.memo ?? null,
      matchStatus,
      matchExceptionsJson: JSON.stringify(exceptions),
      approvalStatus: decision.approvalStatus,
      approvalNote: `Rule ${decision.ruleNo}: ${decision.note}`,
      duplicateOfId: duplicate?.bill.id ?? null,
      priceDriftJson: priceDrift.length ? JSON.stringify(priceDrift) : null,
      status,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  const poLineIds = po ? poLinesOf(db, po.id) : [];
  db.insert(vendorBillLines)
    .values(
      lines.map((l) => {
        const pair = pairs.find((p) => p.billLine === l.line)?.poLine ?? null;
        const poLine =
          pair === null ? null : (poLineIds.find((p) => p.line.line === pair)?.line.id ?? null);
        return {
          billId: row.id,
          line: l.line,
          poLineId: poLine,
          itemId: l.item.id,
          description: l.description,
          quantityBase: l.quantityBase,
          rateUsdc: l.rateUsdc,
          amountUsdc: l.amountUsdc,
        };
      }),
    )
    .run();
  if (decision.approvalStatus === "approved") postBillJournal(db, row.id, input.userId, input.at);
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "vendorBill",
    recordId: row.id,
    tranId: input.tranId,
    detail: `${vendor.companyName} ${formatUsd(input.totalUsdc)}${po ? ` against ${po.tranId}` : ""}: ${matchStatus}${exceptions.length ? ` (${exceptions.map((e) => e.code).join(", ")})` : ""}; ${decision.approvalStatus}`,
  });
  return loadBillResult(db, row.id, true);
}

export function loadBillResult(db: ErpDb, billId: number, created: boolean): BillResult {
  const bill = db.select().from(vendorBills).where(eq(vendorBills.id, billId)).get();
  if (!bill) throw new ErpRefusal("BILL_NOT_FOUND", `No bill ${billId}.`);
  const duplicateOf = bill.duplicateOfId
    ? (db.select().from(vendorBills).where(eq(vendorBills.id, bill.duplicateOfId)).get()?.tranId ??
      null)
    : null;
  const note = bill.approvalNote ?? "";
  const ruleNo = Number(/^Rule (\d+)/.exec(note)?.[1] ?? 0);
  return {
    id: bill.id,
    tranId: bill.tranId,
    created,
    matchStatus: bill.matchStatus,
    exceptions: JSON.parse(bill.matchExceptionsJson) as MatchException[],
    approvalStatus: bill.approvalStatus,
    decision: {
      approvalStatus: bill.approvalStatus,
      ruleNo,
      rule: note.replace(/^Rule \d+: /, ""),
      requiredRole: bill.approvalStatus === "pendingApproval" ? "apManager" : null,
      note: note.replace(/^Rule \d+: /, ""),
    },
    duplicateOf,
    priceDrift: bill.priceDriftJson ? (JSON.parse(bill.priceDriftJson) as PriceDrift[]) : [],
    status: bill.status,
  };
}

/** The AP manager approves or rejects a bill the matrix held, with a reason. */
export function decideVendorBill(
  db: ErpDb,
  input: {
    billId: number;
    decision: "approve" | "reject";
    note: string;
    userId: number;
    at: string;
  },
) {
  const bill = db.select().from(vendorBills).where(eq(vendorBills.id, input.billId)).get();
  if (!bill) throw new ErpRefusal("BILL_NOT_FOUND", `No bill ${input.billId}.`);
  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (!user || (user.role !== "apManager" && user.role !== "controller")) {
    throw new ErpRefusal("FORBIDDEN", "Only the AP manager or the controller decides a held bill.");
  }
  if (!input.note.trim())
    throw new ErpRefusal("REASON_REQUIRED", "A decision on a held bill needs a reason.");
  if (bill.matchStatus === "duplicate")
    throw new ErpRefusal(
      "DUPLICATE_INVOICE",
      `${bill.tranId} is a duplicate; it cannot be approved.`,
    );
  if (bill.approvalStatus !== "pendingApproval")
    throw new ErpRefusal("NOT_PENDING", `${bill.tranId} is ${bill.approvalStatus}.`);
  const decision =
    input.decision === "approve"
      ? evaluateVendorBill(db, {
          totalUsdc: bill.totalUsdc,
          matchStatus: bill.matchStatus,
          signedByRole: "apManager",
        })
      : ({
          approvalStatus: "rejected",
          ruleNo: 0,
          rule: "rejected by the AP manager",
          requiredRole: null,
          note: input.note,
        } satisfies Decision);
  db.update(vendorBills)
    .set({
      approvalStatus: decision.approvalStatus,
      approvedByUserId: user.id,
      approvalNote: `${user.fullName}: ${input.note}`,
      status: decision.approvalStatus === "rejected" ? "rejected" : "open",
    })
    .where(eq(vendorBills.id, bill.id))
    .run();
  if (decision.approvalStatus === "approved") postBillJournal(db, bill.id, user.id, input.at);
  audit(db, {
    at: input.at,
    userId: user.id,
    action: decision.approvalStatus === "approved" ? "approve" : "reject",
    recordType: "vendorBill",
    recordId: bill.id,
    tranId: bill.tranId,
    detail: input.note,
  });
  return loadBillResult(db, bill.id, false);
}

// ---------------------------------------------------------------- vendorPayment

export interface PaymentInput {
  /** The settlement reference: the NEAR transaction hash, or the check number. */
  externalId: string;
  vendorCode: string;
  tranDate: string;
  amountUsdc: number;
  paymentMethod: "escrowRelease" | "check";
  /** The bill to apply it to, by invoice number or by PO number. */
  applyTo: { billTranId: string } | { poTranId: string } | null;
  nearTx?: string | null;
  explorerUrl?: string | null;
  memo?: string | null;
  userId: number;
  at: string;
}

export interface PaymentResult {
  id: number;
  tranId: string;
  created: boolean;
  /** The bill it paid, or null when held as a prepayment on account. */
  appliedTo: string | null;
  prepayment: boolean;
  /** Why it was not applied, when it was not. */
  reason: string | null;
}

export function createVendorPayment(db: ErpDb, input: PaymentInput): PaymentResult {
  const existing = db
    .select()
    .from(vendorPayments)
    .where(eq(vendorPayments.externalId, input.externalId))
    .get();
  if (existing) {
    const applied = existing.appliedBillId
      ? db.select().from(vendorBills).where(eq(vendorBills.id, existing.appliedBillId)).get()
      : null;
    return {
      id: existing.id,
      tranId: existing.tranId,
      created: false,
      appliedTo: applied?.tranId ?? null,
      prepayment: !applied,
      reason: null,
    };
  }
  const vendor = vendorByCode(db, input.vendorCode);
  let bill: typeof vendorBills.$inferSelect | undefined;
  let reason: string | null = null;
  if (input.applyTo && "billTranId" in input.applyTo) {
    bill = billByTranId(db, vendor.id, input.applyTo.billTranId);
    if (!bill) reason = `no bill ${input.applyTo.billTranId} from ${vendor.companyName}`;
  } else if (input.applyTo && "poTranId" in input.applyTo) {
    const po = poByTranId(db, input.applyTo.poTranId);
    bill = po
      ? db
          .select()
          .from(vendorBills)
          .where(and(eq(vendorBills.poId, po.id), ne(vendorBills.matchStatus, "duplicate")))
          .orderBy(desc(vendorBills.id))
          .get()
      : undefined;
    if (!bill) reason = `no bill against ${input.applyTo.poTranId} yet`;
  } else {
    reason = "no bill named";
  }
  if (bill && bill.approvalStatus !== "approved") {
    reason = `${bill.tranId} is ${bill.approvalStatus}${bill.matchStatus === "exception" ? " (match exception)" : ""}`;
    bill = undefined;
  } else if (bill && bill.status === "paidInFull") {
    reason = `${bill.tranId} is already paid in full`;
    bill = undefined;
  } else if (bill && bill.totalUsdc - bill.amountPaidUsdc < input.amountUsdc) {
    reason = `${bill.tranId} has ${formatUsd(bill.totalUsdc - bill.amountPaidUsdc)} open, less than ${formatUsd(input.amountUsdc)}`;
    bill = undefined;
  }

  const fromAccount =
    input.paymentMethod === "escrowRelease" ? SETTINGS.escrowClearingAccount : SETTINGS.cashAccount;
  const tranId = nextTranId(db, vendorPayments, "VP");
  const row = db
    .insert(vendorPayments)
    .values({
      tranId,
      externalId: input.externalId,
      vendorId: vendor.id,
      tranDate: input.tranDate,
      accountId: accountIdOf(db, fromAccount),
      amountUsdc: input.amountUsdc,
      paymentMethod: input.paymentMethod,
      appliedBillId: bill?.id ?? null,
      custbodyNearTx: input.nearTx ?? null,
      custbodyNearExplorerUrl: input.explorerUrl ?? null,
      memo: input.memo ?? (bill ? `Payment of ${bill.tranId}` : `Prepayment on account: ${reason}`),
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  const journalId = postJournal(db, {
    tranDate: input.tranDate,
    memo: bill
      ? `${tranId} pays ${bill.tranId}`
      : `${tranId} prepayment to ${vendor.companyName} (${reason})`,
    sourceType: "vendorPayment",
    sourceId: row.id,
    lines: [
      {
        account: SETTINGS.accountsPayableAccount,
        debitUsdc: input.amountUsdc,
        memo: bill?.tranId ?? "on account",
        vendorId: vendor.id,
      },
      {
        account: fromAccount,
        creditUsdc: input.amountUsdc,
        memo: input.externalId,
        vendorId: vendor.id,
      },
    ],
    userId: input.userId,
    at: input.at,
  });
  db.update(vendorPayments).set({ journalId }).where(eq(vendorPayments.id, row.id)).run();
  if (bill) {
    const paid = bill.amountPaidUsdc + input.amountUsdc;
    db.update(vendorBills)
      .set({ amountPaidUsdc: paid, status: paid >= bill.totalUsdc ? "paidInFull" : "open" })
      .where(eq(vendorBills.id, bill.id))
      .run();
  }
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "vendorPayment",
    recordId: row.id,
    tranId,
    detail: `${formatUsd(input.amountUsdc)} to ${vendor.companyName} by ${input.paymentMethod} (${input.externalId})${bill ? `, applied to ${bill.tranId}` : `, held on account: ${reason}`}`,
  });
  return {
    id: row.id,
    tranId,
    created: true,
    appliedTo: bill?.tranId ?? null,
    prepayment: !bill,
    reason: bill ? null : reason,
  };
}

function accountIdOf(db: ErpDb, number: string) {
  return accountIdByNumber(db, number);
}

/** Which bill, if any, is approved and open for a PO: what Kevin asks before a release. */
export function approvedBillFor(db: ErpDb, poTranId: string) {
  const po = poByTranId(db, poTranId);
  if (!po) return null;
  const bill = db
    .select()
    .from(vendorBills)
    .where(
      and(
        eq(vendorBills.poId, po.id),
        eq(vendorBills.approvalStatus, "approved"),
        eq(vendorBills.status, "open"),
      ),
    )
    .get();
  return bill ?? null;
}

/** Receipt lines for a PO, for the API's receipts column on a bill. */
export function receiptsFor(db: ErpDb, poId: number) {
  return db
    .select({ receipt: itemReceipts, line: itemReceiptLines })
    .from(itemReceiptLines)
    .innerJoin(itemReceipts, eq(itemReceipts.id, itemReceiptLines.receiptId))
    .where(eq(itemReceipts.poId, poId))
    .all();
}
