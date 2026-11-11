// The watched batch-record folder (research 24 §1). A scan dropped in the plant's inbox goes
// through the same pipeline as an upload (extraction.ts): transcribed, checked against the
// formula and the ledger, flagged. It then waits in the review queue for the plant's purchaser.
// Nothing posts on its own: a record reaches the ledger only when a person confirms it, with
// the same check and the same posting as a confirmed upload.

import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { ChainClient } from "@day-one/server/chain/client";
import type { BatchRecordExtraction } from "@day-one/server/extraction/schema";
import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchRecordInbox,
  batchRecords,
  facilities,
  lots,
  staff,
} from "@day-one/server/ledger/schema";
import type { LlmClient } from "@day-one/server/llm/types";
import { anchorBatch } from "@day-one/server/records/anchors";
import { and, asc, eq, inArray } from "drizzle-orm";
import { chainLine } from "./demo.ts";
import { checkTransfers } from "./discrepancies.ts";
import type { KevinErp } from "./erp.ts";
import {
  batchRecordAnchorItem,
  type Confirmation,
  type ConfirmInput,
  confirmBatchRecord,
  ExtractionError,
  type Flag,
  reviewBatchRecord,
  saveBatchDraft,
  transcribeBatchRecord,
} from "./extraction.ts";

/** Files Kevin reads: photos and scans saved as JPEG, the format the vision route takes. */
export const INBOX_EXTENSIONS = [".jpg", ".jpeg"] as const;

export const NOT_A_RECORD = "This isn't a batch record. Kevin left it out of the ledger.";

export type InboxStatus = (typeof batchRecordInbox.$inferSelect)["status"];

export interface InboxFlag extends Flag {
  /**
   * What answers a blocking flag: "value" when the purchaser types the right value (Kevin's
   * reading is the suggestion), "check" when he only confirms he looked. Null when nothing is due.
   */
  answer: "value" | "check" | null;
  suggestion: string | null;
}

export interface InboxItem {
  id: number;
  file: string;
  sha256: string;
  status: InboxStatus;
  batchNo: string | null;
  facility: string | null;
  /** Who the record waits for: the plant's purchaser. */
  waitingFor: string | null;
  summary: string;
  /** Why a read failed, for the log; staff see the summary. */
  error: string | null;
  flags: InboxFlag[];
  reading: BatchRecordExtraction | null;
  postedReading: BatchRecordExtraction | null;
  /** Blocking flags: what the purchaser must answer before the record can post. */
  questions: number;
  receivedAt: string;
  outcome: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface InboxRead {
  item: InboxItem;
  /** The same scan was already in the queue; nothing was read again. */
  duplicate: boolean;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function rowBySha(db: Ledger, hash: string) {
  return db.select().from(batchRecordInbox).where(eq(batchRecordInbox.fileSha256, hash)).get();
}

/**
 * Reads one dropped file into the queue. The same bytes dropped twice are one item; a page that
 * is not a batch record, or one Kevin cannot take (already in the ledger, unknown product), is
 * set aside with the reason in plain words. Writes only the queue row. A read that failed (the
 * model did not answer) is kept as failed and read again when the file is dropped again.
 */
export async function readInboxFile(
  db: Ledger,
  llm: LlmClient,
  file: { path: string; bytes: Buffer },
  now: string,
): Promise<InboxRead> {
  const hash = sha256(file.bytes);
  const known = rowBySha(db, hash);
  if (known && known.status !== "failed") return { item: itemView(db, known), duplicate: true };

  const row = await readFile(db, llm, file, hash, now);
  // A second copy may have landed while the model was reading this one.
  const landed = rowBySha(db, hash);
  if (landed && landed.status !== "failed") return { item: itemView(db, landed), duplicate: true };
  const saved = landed
    ? db
        .update(batchRecordInbox)
        .set(row)
        .where(eq(batchRecordInbox.id, landed.id))
        .returning()
        .get()
    : db.insert(batchRecordInbox).values(row).returning().get();
  return { item: itemView(db, saved), duplicate: false };
}

async function readFile(
  db: Ledger,
  llm: LlmClient,
  file: { path: string; bytes: Buffer },
  hash: string,
  now: string,
): Promise<typeof batchRecordInbox.$inferInsert> {
  const base = { fileSha256: hash, sourceFile: file.path, receivedAt: now, flagsJson: "[]" };
  const ext = extname(file.path).toLowerCase();
  if (!(INBOX_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ...base,
      status: "set_aside",
      summary: `Kevin reads scans saved as JPEG; this file is ${ext || "not a photo"}. Kevin left it out of the ledger.`,
    };
  }
  let extraction: BatchRecordExtraction;
  let model: string;
  try {
    ({ extraction, model } = await transcribeBatchRecord(llm, {
      mediaType: "image/jpeg",
      base64: file.bytes.toString("base64"),
    }));
  } catch (error) {
    if (error instanceof ExtractionError) {
      return { ...base, status: "set_aside", summary: NOT_A_RECORD };
    }
    return {
      ...base,
      status: "failed",
      summary: "Kevin could not read this file yet. Drop it in again to retry.",
      error: (error as Error).message,
    };
  }
  const read = { ...base, extractionJson: JSON.stringify(extraction), extractionModel: model };
  try {
    const review = reviewBatchRecord(db, extraction);
    return {
      ...read,
      status: "waiting",
      batchNo: review.batchNo,
      facilityId: review.facilityId,
      summary: review.sentence,
      flagsJson: JSON.stringify(review.flags),
    };
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    return {
      ...read,
      status: "set_aside",
      batchNo: extraction.batch_number.raw.trim().toUpperCase() || null,
      summary: `Kevin could not take this record: ${error.message}.`,
    };
  }
}

/** One line per file as it lands, for the API's log and npm run inbox. */
export function inboxLine({ item, duplicate }: InboxRead): string {
  const name = item.file.split("/").at(-1) ?? item.file;
  if (duplicate) return `${name}: already in the queue (${item.batchNo ?? item.status}).`;
  switch (item.status) {
    case "waiting": {
      const asks = item.flags.filter((f) => f.blocking).map((f) => f.message);
      const who = item.waitingFor ?? "the purchaser";
      return asks.length
        ? `${name}: ${item.batchNo} waits for ${who}, ${asks.length} ${asks.length === 1 ? "question" : "questions"}. ${asks.join(" ")}`
        : `${name}: ${item.batchNo} waits for ${who}, nothing to ask.`;
    }
    case "failed":
      return `${name}: not read (${item.error ?? item.summary})`;
    default:
      return `${name}: set aside. ${item.summary}`;
  }
}

/** The queue, oldest first, with each waiting record checked against the ledger as it is now. */
export function inboxItems(db: Ledger): InboxItem[] {
  return db
    .select()
    .from(batchRecordInbox)
    .orderBy(asc(batchRecordInbox.id))
    .all()
    .map((row) => itemView(db, row.status === "waiting" ? recheck(db, row) : row));
}

/**
 * Another confirm can change what a waiting record finds (two batches drawing one lot), and an
 * upload of the same page can post it first. Kevin's line and flags follow the ledger.
 */
function recheck(db: Ledger, row: InboxRow): InboxRow {
  const posted = row.batchNo
    ? db.select().from(batchRecords).where(eq(batchRecords.batchNo, row.batchNo)).get()
    : undefined;
  if (posted?.status === "confirmed") {
    return db
      .update(batchRecordInbox)
      .set({
        status: "confirmed",
        batchId: posted.id,
        outcome: "Already in the ledger from an upload.",
        confirmedBy: posted.confirmedBy,
        confirmedAt: posted.confirmedAt,
      })
      .where(eq(batchRecordInbox.id, row.id))
      .returning()
      .get();
  }
  if (posted) return row;
  try {
    const review = reviewBatchRecord(db, inboxRead(row).extraction);
    const flagsJson = JSON.stringify(review.flags);
    if (review.sentence === row.summary && flagsJson === row.flagsJson) return row;
    return db
      .update(batchRecordInbox)
      .set({ summary: review.sentence, flagsJson })
      .where(eq(batchRecordInbox.id, row.id))
      .returning()
      .get();
  } catch (error) {
    if (error instanceof ExtractionError) return row;
    throw error;
  }
}

/** The waiting item for a batch number, if the queue holds one. */
export function waitingInboxItem(db: Ledger, batchNo: string) {
  return db
    .select()
    .from(batchRecordInbox)
    .where(and(eq(batchRecordInbox.batchNo, batchNo), eq(batchRecordInbox.status, "waiting")))
    .orderBy(asc(batchRecordInbox.id))
    .get();
}

export type InboxRow = typeof batchRecordInbox.$inferSelect;

/** The read stored with the item, for a confirm that posts exactly what the purchaser reviewed. */
export function inboxRead(row: InboxRow) {
  if (!row.extractionJson || !row.extractionModel) {
    throw new ExtractionError(`${row.sourceFile} has no reading to confirm`);
  }
  return {
    extraction: JSON.parse(row.extractionJson) as BatchRecordExtraction,
    model: row.extractionModel,
  };
}

/** Marks an item posted by another path (the demo run's own confirm) with Kevin's line. */
export function markInboxConfirmed(
  db: Ledger,
  itemId: number,
  done: { batchNo: string; staffId: number; now: string; outcome: string },
) {
  const batch = db.select().from(batchRecords).where(eq(batchRecords.batchNo, done.batchNo)).get();
  db.update(batchRecordInbox)
    .set({
      status: "confirmed",
      batchId: batch?.id ?? null,
      outcome: done.outcome,
      confirmedBy: done.staffId,
      confirmedAt: done.now,
    })
    .where(eq(batchRecordInbox.id, itemId))
    .run();
}

export interface InboxConfirmDeps {
  db: Ledger;
  /** Kevin anchors the confirmed record when given; absent in a replay that has no recording of it. */
  chain?: ChainClient;
  kevin: string;
  policyContract: string;
  erp?: KevinErp;
}

export interface InboxConfirmation {
  confirmation: Confirmation;
  batchId: number;
  /** Kevin's lines for staff: the inventory change and any transfer discrepancy it exposed. */
  staff: string[];
  /** Behind the curtain: the anchor, or why there is none. */
  chain: string[];
  erp: string[];
}

/**
 * The purchaser confirms a waiting record: the draft and the posting happen together, so a
 * record with an unanswered blocking flag leaves nothing behind. Then, as for an upload, Kevin
 * anchors the fingerprint, checks transfers and tells the ERP.
 */
export async function confirmInboxItem(
  deps: InboxConfirmDeps,
  itemId: number,
  input: ConfirmInput,
): Promise<InboxConfirmation> {
  const { db } = deps;
  const row = db.select().from(batchRecordInbox).where(eq(batchRecordInbox.id, itemId)).get();
  if (!row) throw new ExtractionError(`no inbox item ${itemId}`);
  if (row.status !== "waiting") {
    throw new ExtractionError(
      `${row.batchNo ?? row.sourceFile} is ${row.status.replace("_", " ")}`,
    );
  }
  const { extraction, model } = inboxRead(row);
  const { batchId, confirmation } = db.transaction(() => {
    const draft = saveBatchDraft(db, extraction, {
      file: row.sourceFile,
      sha256: row.fileSha256,
      model,
    });
    return {
      batchId: draft.batchId,
      confirmation: confirmBatchRecord(db, draft.batchId, input),
    };
  });
  const batchNo = confirmation.review.batchNo;
  const staffLines = [confirmation.sentence];
  // Echo what the purchaser typed, so the posted line says which value was taken.
  const typed = Object.entries(input.resolutions ?? {}).filter(([, v]) => v !== "checked");
  if (typed.length > 0) {
    const label = (path: string) => {
      const m = /^materials\[(\d+)\]\.actual_qty$/.exec(path);
      const line = m ? extraction.materials[Number(m[1])] : undefined;
      return line ? `line ${line.line_no || Number(m?.[1]) + 1}` : path;
    };
    staffLines.push(
      `Posted with your answer: ${typed.map(([p, v]) => `${label(p)} ${v}`).join("; ")}.`,
    );
  }
  // What Kevin does about a material the confirm just took under its reorder point, so the
  // person who confirmed is not left with the drop and no next step (first-use review, finding 24).
  const nowLow = confirmation.stock.filter(
    (s) => s.reorderPointBase !== null && s.afterBase < s.reorderPointBase,
  );
  if (nowLow.length > 0) {
    staffLines.push(
      `Kevin recommends an order for ${nowLow.length === 1 ? "it" : "each"} in Inventory's forecast and the next 5am brief; nothing is ordered until someone approves it.`,
    );
  }
  // Consuming a transferred lot is what exposes a transfer discrepancy (SPEC step 3).
  const drawn = [...new Set(confirmation.review.draws.map((d) => d.lotId))];
  for (const lot of db.select().from(lots).where(inArray(lots.id, drawn)).all()) {
    for (const found of checkTransfers(db, { now: input.now, lotCode: lot.lotCode })) {
      staffLines.push(found.sentence);
    }
  }

  const chain: string[] = [];
  if (deps.chain) {
    const anchor = await anchorBatch(db, deps.chain, [batchRecordAnchorItem(db, batchId)], {
      kevin: deps.kevin,
      policyContract: deps.policyContract,
      now: input.now,
    });
    chain.push(chainLine(`anchored ${batchNo} 0x${confirmation.recordHash.slice(0, 8)}…`, anchor));
  } else {
    chain.push(
      `chain: ${batchNo} 0x${confirmation.recordHash.slice(0, 8)}… kept with its salt, not anchored: the recorded run has no anchor for it (a live run anchors it)`,
    );
  }
  const erp = deps.erp ? [await deps.erp.batchConfirmed(db, batchId)] : [];

  markInboxConfirmed(db, itemId, {
    batchNo,
    staffId: input.staffId,
    now: input.now,
    outcome: staffLines.join(" "),
  });
  return { confirmation, batchId, staff: staffLines, chain, erp };
}

function itemView(db: Ledger, row: InboxRow): InboxItem {
  const flags = JSON.parse(row.flagsJson) as Flag[];
  const extraction = row.extractionJson
    ? (JSON.parse(row.extractionJson) as BatchRecordExtraction)
    : null;
  const posted =
    row.status === "confirmed" && row.batchNo
      ? db
          .select({ json: batchRecords.extractionJson })
          .from(batchRecords)
          .where(eq(batchRecords.batchNo, row.batchNo))
          .get()?.json
      : null;
  const facility = row.facilityId
    ? db.select().from(facilities).where(eq(facilities.id, row.facilityId)).get()
    : undefined;
  const purchaser = row.facilityId
    ? db
        .select({ name: staff.name })
        .from(staff)
        .where(and(eq(staff.facilityId, row.facilityId), eq(staff.role, "purchaser")))
        .get()
    : undefined;
  const confirmer = row.confirmedBy
    ? db.select({ name: staff.name }).from(staff).where(eq(staff.id, row.confirmedBy)).get()
    : undefined;
  const view: InboxFlag[] = flags.map((f) => {
    const value = extraction ? rawAt(extraction, f.fieldPath) : null;
    return {
      ...f,
      answer: !f.blocking ? null : value === null ? "check" : "value",
      suggestion: f.blocking ? value : null,
    };
  });
  return {
    id: row.id,
    file: row.sourceFile,
    sha256: row.fileSha256,
    status: row.status,
    batchNo: row.batchNo,
    facility: facility?.code ?? null,
    waitingFor: row.status === "waiting" ? (purchaser?.name ?? null) : null,
    summary: row.summary,
    error: row.error,
    flags: view,
    reading: extraction,
    postedReading: posted ? (JSON.parse(posted) as BatchRecordExtraction) : null,
    questions: view.filter((f) => f.blocking).length,
    receivedAt: row.receivedAt,
    outcome: row.outcome,
    confirmedBy: confirmer?.name ?? null,
    confirmedAt: row.confirmedAt,
  };
}

/**
 * The value Kevin read at a field path ("materials[2].actual_qty" → "83.040"), or null when the
 * path is not a single field (a formula total, a lot count) and the answer is a check instead.
 * Mirrors what confirmBatchRecord accepts as a corrected value.
 */
function rawAt(x: BatchRecordExtraction, path: string): string | null {
  const m = path.match(/^materials\[(\d+)\]\.(\w+)$/);
  const target = (m ? x.materials[Number(m[1])] : x) as unknown as Record<string, unknown>;
  const field = target?.[m ? (m[2] ?? "") : path];
  if (typeof field !== "object" || field === null || !("raw" in field)) return null;
  return String((field as { raw: unknown }).raw);
}
