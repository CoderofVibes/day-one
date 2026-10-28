// General ledger postings. One function writes a journal entry: it refuses an entry that does
// not balance, numbers it, and records who posted it. Nothing else inserts journal lines.

import { eq, sql } from "drizzle-orm";
import type { ErpDb } from "../db.ts";
import { accounts, auditTrail, journalEntries, journalLines } from "../schema.ts";

export class PostingError extends Error {
  override name = "PostingError";
}

export interface JournalLineInput {
  /** The account number (1400), never an id, so postings read like the chart. */
  account: string;
  debitUsdc?: number;
  creditUsdc?: number;
  memo?: string;
  locationId?: number | null;
  vendorId?: number | null;
}

export interface JournalInput {
  tranDate: string;
  memo: string;
  sourceType: (typeof journalEntries.$inferInsert)["sourceType"];
  sourceId: number | null;
  lines: JournalLineInput[];
  userId: number;
  at: string;
}

export function accountIdByNumber(db: ErpDb, number: string): number {
  const row = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.acctNumber, number))
    .get();
  if (!row) throw new PostingError(`no account ${number} in the chart`);
  return row.id;
}

/** "JE-7": the next number for a transaction type. */
export function nextTranId(
  db: ErpDb,
  table: { tranId: typeof journalEntries.tranId },
  prefix: string,
) {
  const row = db.select({ n: sql<number>`count(*)` }).from(table.tranId.table).get() as
    | { n: number }
    | undefined;
  return `${prefix}-${(row?.n ?? 0) + 1}`;
}

/** Posts a balanced journal entry and its audit row; returns the entry id. */
export function postJournal(db: ErpDb, input: JournalInput): number {
  const lines = input.lines.filter((l) => (l.debitUsdc ?? 0) !== 0 || (l.creditUsdc ?? 0) !== 0);
  if (!lines.length) throw new PostingError(`journal "${input.memo}" has no lines`);
  const debits = lines.reduce((s, l) => s + (l.debitUsdc ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (l.creditUsdc ?? 0), 0);
  if (debits !== credits) {
    throw new PostingError(`journal "${input.memo}" does not balance: ${debits} vs ${credits}`);
  }
  for (const l of lines) {
    if ((l.debitUsdc ?? 0) < 0 || (l.creditUsdc ?? 0) < 0) {
      throw new PostingError(`journal "${input.memo}" has a negative line`);
    }
    if ((l.debitUsdc ?? 0) !== 0 && (l.creditUsdc ?? 0) !== 0) {
      throw new PostingError(`journal "${input.memo}" has a line with both sides`);
    }
  }
  const tranId = nextTranId(db, journalEntries, "JE");
  const entry = db
    .insert(journalEntries)
    .values({
      tranId,
      tranDate: input.tranDate,
      memo: input.memo,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdByUserId: input.userId,
      createdAt: input.at,
    })
    .returning()
    .get();
  db.insert(journalLines)
    .values(
      lines.map((l, i) => ({
        journalId: entry.id,
        line: i + 1,
        accountId: accountIdByNumber(db, l.account),
        debitUsdc: l.debitUsdc ?? 0,
        creditUsdc: l.creditUsdc ?? 0,
        memo: l.memo ?? null,
        locationId: l.locationId ?? null,
        vendorId: l.vendorId ?? null,
      })),
    )
    .run();
  db.insert(auditTrail)
    .values({
      at: input.at,
      userId: input.userId,
      action: "post",
      recordType: "journalEntry",
      recordId: entry.id,
      tranId,
      detail: `${input.memo} (${lines.length} lines)`,
    })
    .run();
  return entry.id;
}

/** Debits and credits per account; `balanced` is the invariant every test asserts. */
export function trialBalance(db: ErpDb) {
  const rows = db
    .select({
      acctNumber: accounts.acctNumber,
      acctName: accounts.acctName,
      acctType: accounts.acctType,
      debitUsdc: sql<number>`coalesce(sum(${journalLines.debitUsdc}), 0)`,
      creditUsdc: sql<number>`coalesce(sum(${journalLines.creditUsdc}), 0)`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(accounts.acctNumber)
    .all();
  const totalDebits = rows.reduce((s, r) => s + r.debitUsdc, 0);
  const totalCredits = rows.reduce((s, r) => s + r.creditUsdc, 0);
  return {
    rows: rows.map((r) => ({ ...r, balanceUsdc: r.debitUsdc - r.creditUsdc })),
    totalDebits,
    totalCredits,
    balanced: totalDebits === totalCredits,
  };
}
