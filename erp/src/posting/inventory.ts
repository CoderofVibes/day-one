// Inventory postings. Every stock-affecting record (receipt, adjustment, transfer, status
// change) writes its quantity and value through `postMovement` and nowhere else, so the
// `inventory_balances` view is the only balance there is. Value follows the lot: stock comes
// in at its receipt price (or the item's standard cost at cutover) and goes out carrying its
// share of that lot's remaining value, exact to the micro-dollar.

import { and, eq, sql } from "drizzle-orm";
import type { ErpDb } from "../db.ts";
import { extend, proRata } from "../money.ts";
import {
  accounts,
  type InventoryStatus,
  inventoryAdjustmentLines,
  inventoryAdjustments,
  inventoryMovements,
  inventoryStatusChangeLines,
  inventoryStatusChanges,
  inventoryTransferLines,
  inventoryTransfers,
  items,
  locations,
} from "../schema.ts";
import { ADJUSTMENT_ACCOUNT } from "../seed/data.ts";
import { audit } from "./audit.ts";
import { nextTranId, PostingError, postJournal } from "./journal.ts";

export interface MovementInput {
  sourceType: (typeof inventoryMovements.$inferInsert)["sourceType"];
  sourceId: number;
  sourceLine: number;
  itemId: number;
  locationId: number;
  inventoryStatus: InventoryStatus;
  lotNumber: string;
  quantityDeltaBase: number;
  valueDeltaUsdc: number;
  postedAt: string;
}

/** Quantity and value of one lot at one location and status. */
export function lotBalance(
  db: ErpDb,
  where: {
    itemId: number;
    locationId: number;
    inventoryStatus: InventoryStatus;
    lotNumber: string;
  },
) {
  const row = db
    .select({
      quantityBase: sql<number>`coalesce(sum(${inventoryMovements.quantityDeltaBase}), 0)`,
      valueUsdc: sql<number>`coalesce(sum(${inventoryMovements.valueDeltaUsdc}), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.itemId, where.itemId),
        eq(inventoryMovements.locationId, where.locationId),
        eq(inventoryMovements.inventoryStatus, where.inventoryStatus),
        eq(inventoryMovements.lotNumber, where.lotNumber),
      ),
    )
    .get();
  return { quantityBase: row?.quantityBase ?? 0, valueUsdc: row?.valueUsdc ?? 0 };
}

/** Posts one movement; refuses to take a lot below zero at a location and status. */
export function postMovement(db: ErpDb, m: MovementInput) {
  if (m.quantityDeltaBase < 0) {
    const have = lotBalance(db, m);
    if (have.quantityBase + m.quantityDeltaBase < 0) {
      throw new PostingError(
        `lot ${m.lotNumber} has ${have.quantityBase} base units in ${m.inventoryStatus} at location ${m.locationId}; cannot move ${-m.quantityDeltaBase}`,
      );
    }
  }
  return db.insert(inventoryMovements).values(m).returning().get();
}

/** The value a quantity leaving a lot carries: its share of what the lot holds there. */
export function valueOut(
  db: ErpDb,
  where: {
    itemId: number;
    locationId: number;
    inventoryStatus: InventoryStatus;
    lotNumber: string;
  },
  quantityBase: number,
) {
  const have = lotBalance(db, where);
  if (quantityBase >= have.quantityBase) return have.valueUsdc;
  return proRata(have.valueUsdc, quantityBase, have.quantityBase);
}

function itemById(db: ErpDb, id: number) {
  const item = db.select().from(items).where(eq(items.id, id)).get();
  if (!item) throw new PostingError(`no item ${id}`);
  return item;
}

function locationById(db: ErpDb, id: number) {
  const row = db.select().from(locations).where(eq(locations.id, id)).get();
  if (!row) throw new PostingError(`no location ${id}`);
  return row;
}

function accountNumber(db: ErpDb, id: number) {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!row) throw new PostingError(`no account ${id}`);
  return row.acctNumber;
}

// ---------------------------------------------------------------- inventoryAdjustment

export interface AdjustmentLineInput {
  itemId: number;
  lotNumber: string;
  inventoryStatus?: InventoryStatus;
  /** Signed quantity in base units; positive adds stock. */
  adjustQtyBase: number;
  /** For stock coming in: the unit cost (micro-dollars per unit). Default: the item's standard cost. */
  unitCostUsdc?: number;
}

export interface AdjustmentInput {
  externalId: string;
  locationId: number;
  tranDate: string;
  reason: (typeof inventoryAdjustments.$inferInsert)["reason"];
  memo?: string;
  lines: AdjustmentLineInput[];
  userId: number;
  at: string;
}

/**
 * An inventory adjustment: opening stock, an issue to production, waste, a count correction or
 * a return to the vendor. Stock in is valued at the given or standard cost; stock out carries
 * the lot's own value. The journal moves the value between the item's asset account and the
 * reason's offset account.
 */
export function postInventoryAdjustment(db: ErpDb, input: AdjustmentInput) {
  const existing = db
    .select()
    .from(inventoryAdjustments)
    .where(eq(inventoryAdjustments.externalId, input.externalId))
    .get();
  if (existing) return { id: existing.id, tranId: existing.tranId, created: false as const };
  if (!input.lines.length) throw new PostingError(`adjustment ${input.externalId} has no lines`);

  const offset = ADJUSTMENT_ACCOUNT[input.reason];
  const tranId = nextTranId(db, inventoryAdjustments, "ADJ");
  const accountId = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.acctNumber, offset))
    .get();
  if (!accountId) throw new PostingError(`no account ${offset}`);
  const header = db
    .insert(inventoryAdjustments)
    .values({
      tranId,
      externalId: input.externalId,
      locationId: input.locationId,
      tranDate: input.tranDate,
      reason: input.reason,
      accountId: accountId.id,
      memo: input.memo ?? null,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();

  const journalLines: { account: string; debitUsdc?: number; creditUsdc?: number; memo: string }[] =
    [];
  input.lines.forEach((l, i) => {
    const item = itemById(db, l.itemId);
    const status = l.inventoryStatus ?? "good";
    const where = {
      itemId: item.id,
      locationId: input.locationId,
      inventoryStatus: status,
      lotNumber: l.lotNumber,
    };
    let amountUsdc: number;
    let unitCostUsdc: number;
    if (l.adjustQtyBase >= 0) {
      unitCostUsdc = l.unitCostUsdc ?? item.costUsdc;
      amountUsdc = extend(l.adjustQtyBase, unitCostUsdc, item.baseUnitsPerUnit);
    } else {
      amountUsdc = -valueOut(db, where, -l.adjustQtyBase);
      unitCostUsdc =
        l.adjustQtyBase === 0 ? 0 : extend(item.baseUnitsPerUnit, -amountUsdc, -l.adjustQtyBase);
    }
    db.insert(inventoryAdjustmentLines)
      .values({
        adjustmentId: header.id,
        line: i + 1,
        itemId: item.id,
        lotNumber: l.lotNumber,
        inventoryStatus: status,
        adjustQtyBase: l.adjustQtyBase,
        unitCostUsdc,
        amountUsdc,
      })
      .run();
    postMovement(db, {
      sourceType: "inventoryAdjustment",
      sourceId: header.id,
      sourceLine: i + 1,
      ...where,
      quantityDeltaBase: l.adjustQtyBase,
      valueDeltaUsdc: amountUsdc,
      postedAt: input.at,
    });
    const asset = accountNumber(db, item.assetAccountId);
    const memo = `${item.itemId} lot ${l.lotNumber}`;
    if (amountUsdc > 0) {
      journalLines.push({ account: asset, debitUsdc: amountUsdc, memo });
      journalLines.push({ account: offset, creditUsdc: amountUsdc, memo });
    } else if (amountUsdc < 0) {
      journalLines.push({ account: offset, debitUsdc: -amountUsdc, memo });
      journalLines.push({ account: asset, creditUsdc: -amountUsdc, memo });
    }
  });

  let journalId: number | null = null;
  if (journalLines.length) {
    journalId = postJournal(db, {
      tranDate: input.tranDate,
      memo: `${tranId} ${input.reason}${input.memo ? `: ${input.memo}` : ""}`,
      sourceType: "inventoryAdjustment",
      sourceId: header.id,
      lines: journalLines.map((l) => ({ ...l, locationId: input.locationId })),
      userId: input.userId,
      at: input.at,
    });
    db.update(inventoryAdjustments)
      .set({ journalId })
      .where(eq(inventoryAdjustments.id, header.id))
      .run();
  }
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "inventoryAdjustment",
    recordId: header.id,
    tranId,
    detail: `${input.reason} at ${locationById(db, input.locationId).name}: ${input.lines.length} lines${input.memo ? ` (${input.memo})` : ""}`,
  });
  return { id: header.id, tranId, created: true as const, journalId };
}

// ---------------------------------------------------------------- inventoryTransfer

export interface TransferInput {
  externalId: string;
  fromLocationId: number;
  toLocationId: number;
  tranDate: string;
  memo?: string;
  lines: {
    itemId: number;
    lotNumber: string;
    inventoryStatus?: InventoryStatus;
    quantityBase: number;
  }[];
  userId: number;
  at: string;
}

/** Moves quantity and its value between locations; no journal (same asset account). */
export function postInventoryTransfer(db: ErpDb, input: TransferInput) {
  const existing = db
    .select()
    .from(inventoryTransfers)
    .where(eq(inventoryTransfers.externalId, input.externalId))
    .get();
  if (existing) return { id: existing.id, tranId: existing.tranId, created: false as const };
  const tranId = nextTranId(db, inventoryTransfers, "TRF");
  const header = db
    .insert(inventoryTransfers)
    .values({
      tranId,
      externalId: input.externalId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      tranDate: input.tranDate,
      memo: input.memo ?? null,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  input.lines.forEach((l, i) => {
    const status = l.inventoryStatus ?? "good";
    const from = {
      itemId: l.itemId,
      locationId: input.fromLocationId,
      inventoryStatus: status,
      lotNumber: l.lotNumber,
    };
    const value = valueOut(db, from, l.quantityBase);
    db.insert(inventoryTransferLines)
      .values({
        transferId: header.id,
        line: i + 1,
        itemId: l.itemId,
        lotNumber: l.lotNumber,
        inventoryStatus: status,
        quantityBase: l.quantityBase,
        amountUsdc: value,
      })
      .run();
    const base = {
      sourceType: "inventoryTransfer" as const,
      sourceId: header.id,
      sourceLine: i + 1,
      postedAt: input.at,
    };
    postMovement(db, {
      ...base,
      ...from,
      quantityDeltaBase: -l.quantityBase,
      valueDeltaUsdc: -value,
    });
    postMovement(db, {
      ...base,
      ...from,
      locationId: input.toLocationId,
      quantityDeltaBase: l.quantityBase,
      valueDeltaUsdc: value,
    });
  });
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "inventoryTransfer",
    recordId: header.id,
    tranId,
    detail: `${locationById(db, input.fromLocationId).name} → ${locationById(db, input.toLocationId).name}: ${input.lines.length} lines`,
  });
  return { id: header.id, tranId, created: true as const };
}

// ---------------------------------------------------------------- inventoryStatusChange

export interface StatusChangeInput {
  externalId: string;
  locationId: number;
  tranDate: string;
  memo?: string;
  lines: {
    itemId: number;
    lotNumber: string;
    previousStatus: InventoryStatus;
    revisedStatus: InventoryStatus;
    /** Default: everything the lot holds in the previous status. */
    quantityBase?: number;
  }[];
  userId: number;
  at: string;
}

/** QC release (quarantine → good) or rejection (quarantine → rejected); value moves with the stock. */
export function postInventoryStatusChange(db: ErpDb, input: StatusChangeInput) {
  const existing = db
    .select()
    .from(inventoryStatusChanges)
    .where(eq(inventoryStatusChanges.externalId, input.externalId))
    .get();
  if (existing) return { id: existing.id, tranId: existing.tranId, created: false as const };
  const tranId = nextTranId(db, inventoryStatusChanges, "ISC");
  const header = db
    .insert(inventoryStatusChanges)
    .values({
      tranId,
      externalId: input.externalId,
      locationId: input.locationId,
      tranDate: input.tranDate,
      memo: input.memo ?? null,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  input.lines.forEach((l, i) => {
    const from = {
      itemId: l.itemId,
      locationId: input.locationId,
      inventoryStatus: l.previousStatus,
      lotNumber: l.lotNumber,
    };
    const have = lotBalance(db, from);
    const qty = l.quantityBase ?? have.quantityBase;
    const value = valueOut(db, from, qty);
    db.insert(inventoryStatusChangeLines)
      .values({
        changeId: header.id,
        line: i + 1,
        itemId: l.itemId,
        lotNumber: l.lotNumber,
        quantityBase: qty,
        previousStatus: l.previousStatus,
        revisedStatus: l.revisedStatus,
      })
      .run();
    const base = {
      sourceType: "inventoryStatusChange" as const,
      sourceId: header.id,
      sourceLine: i + 1,
      postedAt: input.at,
    };
    postMovement(db, { ...base, ...from, quantityDeltaBase: -qty, valueDeltaUsdc: -value });
    postMovement(db, {
      ...base,
      ...from,
      inventoryStatus: l.revisedStatus,
      quantityDeltaBase: qty,
      valueDeltaUsdc: value,
    });
  });
  audit(db, {
    at: input.at,
    userId: input.userId,
    action: "create",
    recordType: "inventoryStatusChange",
    recordId: header.id,
    tranId,
    detail: input.lines
      .map((l) => `lot ${l.lotNumber} ${l.previousStatus} → ${l.revisedStatus}`)
      .join("; "),
  });
  return { id: header.id, tranId, created: true as const };
}
