// Kevin reads a batch record (DEMO_SCRIPT steps 1 and 2). The vision model only transcribes
// (server/src/extraction/schema.ts); everything after that is code: quantities are parsed and
// converted with the units table, each material is checked against the active formula, each lot
// against the ledger, and anything Kevin is not sure of becomes a flag for the purchaser. A
// record posts to the ledger only when the purchaser confirms it and no blocking flag is left.

import {
  BATCH_RECORD_SCHEMA,
  type BatchRecordExtraction,
  EXTRACTION_PROMPT,
  EXTRACTION_SYSTEM,
  type ExtractedLine,
  type Read,
} from "@day-one/server/extraction/schema";
import type { Ledger } from "@day-one/server/ledger/db";
import { appendLotEvent, type LedgerDb } from "@day-one/server/ledger/events";
import {
  batchInputs,
  batchRecords,
  extractionFlags,
  type FLAG_KINDS,
  facilities,
  formulaLines,
  formulas,
  lotBalances,
  lots,
  materials,
  products,
  staff,
  units,
} from "@day-one/server/ledger/schema";
import type { LlmClient, LlmImage } from "@day-one/server/llm/types";
import type { AnchorItem } from "@day-one/server/records/anchors";
import { fingerprint } from "@day-one/server/records/anchors";
import { and, eq, inArray } from "drizzle-orm";

export type FlagKind = (typeof FLAG_KINDS)[number];

/** Flags the purchaser must resolve before the record posts. The others are for the record. */
const BLOCKING: readonly FlagKind[] = [
  "low_confidence",
  "unknown_lot",
  "unit_mismatch",
  "out_of_tolerance",
];

/** A yield this far under the product's expected yield is flagged (BR-B-1044: 3.8 points). */
export const YIELD_VARIANCE_BP = 200;

/** Lot states a batch can draw from, and that count as usable stock. */
const USABLE = ["released", "in_use"] as const;

export class ExtractionError extends Error {
  override name = "ExtractionError";
}

export interface Flag {
  fieldPath: string;
  kind: FlagKind;
  message: string;
  blocking: boolean;
}

export interface ReviewedMaterial {
  code: string;
  materialId: number;
  expectedBase: number;
  /** Null when a line for this material could not be read. */
  actualBase: number | null;
  deviationBp: number | null;
}

export interface Draw {
  lineNo: number;
  lotId: number;
  materialId: number;
  actualBase: number;
}

export interface BatchReview {
  batchNo: string;
  productId: number;
  productCode: string;
  formulaId: number;
  facilityId: number;
  facilityCode: string;
  /** ISO date of manufacture, or null when unreadable. */
  date: string | null;
  theoreticalTablets: number;
  actualTablets: number | null;
  yieldBp: number | null;
  wasteBase: number | null;
  materials: ReviewedMaterial[];
  /** Lines Kevin could tie to a lot with a readable quantity. */
  draws: Draw[];
  flags: Flag[];
  sentence: string;
}

/** Asks the vision route to transcribe one page. The model never does arithmetic. */
export async function transcribeBatchRecord(llm: LlmClient, image: LlmImage) {
  const result = await llm.complete("vision", {
    system: EXTRACTION_SYSTEM,
    prompt: EXTRACTION_PROMPT,
    images: [image],
    schema: BATCH_RECORD_SCHEMA,
  });
  const extraction = result.json as BatchRecordExtraction;
  // A page with neither a batch number nor a material line is not a batch record, whatever the
  // model called it (GLM labels the PO-1042 packing slip a batch record and leaves it blank).
  const blank =
    !extraction?.batch_number?.raw?.trim() && (extraction?.materials?.length ?? 0) === 0;
  if (extraction?.document_type !== "batch_record" || blank) {
    throw new ExtractionError("this page is not a batch record");
  }
  return { extraction, model: `${result.provider}:${result.model}` };
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const code = (s: string) => clean(s).toUpperCase();

/** "625,115" → 625115, "723,200 tablets" → 723200 with "tablets", "" → null. */
export function readNumber(raw: string): { value: number; suffix: string } | null {
  const m = clean(raw).match(/^(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([A-Za-z%.]*)$/);
  if (!m?.[1]) return null;
  const value = Number(m[1].replaceAll(",", ""));
  return Number.isFinite(value) ? { value, suffix: (m[2] ?? "").replace(/\.$/, "") } : null;
}

/** "MM/DD/YY" → "20YY-MM-DD". */
function isoDate(raw: string) {
  const m = clean(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3]?.length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
}

const kgText = (base: number) => `${(Math.round(base / 100_000) / 10).toFixed(1)} kg`;
const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;

interface UnitRow {
  code: string;
  dimension: string;
  toBaseNum: number;
  toBaseDen: number;
}

function unitTable(db: Ledger) {
  const rows = db.select().from(units).all() as UnitRow[];
  return (raw: string) => {
    const want = clean(raw).toLowerCase().replace(/^lbs$/, "lb");
    return rows.find((u) => u.code.toLowerCase() === want) ?? null;
  };
}

const toBase = (value: number, unit: UnitRow) =>
  Math.round((value * unit.toBaseNum) / unit.toBaseDen);

/** The first name of the plant's purchaser, who confirms extractions ("Ray"). */
function purchaserName(db: Ledger, facilityId: number) {
  const row = db
    .select({ name: staff.name })
    .from(staff)
    .where(and(eq(staff.facilityId, facilityId), eq(staff.role, "purchaser")))
    .get();
  return row?.name.split(" ")[0] ?? "the purchaser";
}

function facilityOf(db: Ledger, x: BatchRecordExtraction) {
  const all = db.select().from(facilities).all();
  const written = clean(x.facility.raw).toLowerCase();
  const byName = all.find((f) => written !== "" && written.startsWith(f.name.toLowerCase()));
  if (byName) return byName;
  // Batch numbers carry the plant letter: BR-B-1045.
  const letter = code(x.batch_number.raw).match(/^BR-([A-Z])-/)?.[1];
  const byLetter = all.find((f) => f.code === letter);
  if (byLetter) return byLetter;
  throw new ExtractionError(`cannot tell which plant "${x.facility.raw}" is`);
}

export interface ReviewOptions {
  /** Field paths the purchaser has acknowledged, e.g. a material outside tolerance. */
  acknowledged?: ReadonlySet<string>;
  /** The draft being re-checked on confirm, so its own batch number is not a duplicate. */
  batchId?: number;
}

/** Checks a transcription against the ledger. Writes nothing. */
export function reviewBatchRecord(
  db: Ledger,
  x: BatchRecordExtraction,
  options: ReviewOptions = {},
): BatchReview {
  if (x.document_type !== "batch_record") {
    throw new ExtractionError("this page is not a batch record");
  }
  const batchNo = code(x.batch_number.raw);
  if (!/^BR-[A-Z]-\d+$/.test(batchNo)) {
    throw new ExtractionError(`cannot read the batch number ("${x.batch_number.raw}")`);
  }
  const existing = db.select().from(batchRecords).where(eq(batchRecords.batchNo, batchNo)).get();
  if (existing && existing.id !== options.batchId) {
    throw new ExtractionError(`${batchNo} is already in the ledger (${existing.status})`);
  }
  const productCode = code(x.product_code.raw);
  const product = db.select().from(products).where(eq(products.code, productCode)).get();
  if (!product) throw new ExtractionError(`unknown product "${x.product_code.raw}"`);
  const formula = db
    .select()
    .from(formulas)
    .where(and(eq(formulas.productId, product.id), eq(formulas.status, "active")))
    .get();
  if (!formula) throw new ExtractionError(`${productCode} has no active formula`);
  const facility = facilityOf(db, x);
  const unit = unitTable(db);
  const asker = purchaserName(db, facility.id);
  const acknowledged = options.acknowledged ?? new Set<string>();

  const flags: Flag[] = [];
  const flag = (fieldPath: string, kind: FlagKind, message: string) =>
    flags.push({
      fieldPath,
      kind,
      message,
      blocking: BLOCKING.includes(kind) && !acknowledged.has(fieldPath),
    });

  const theoretical =
    readNumber(x.theoretical_yield.raw)?.value ?? readNumber(x.batch_size.raw)?.value;
  if (!theoretical) throw new ExtractionError(`cannot read the batch size of ${batchNo}`);
  const actualTablets = readNumber(x.actual_yield.raw)?.value ?? null;
  if (actualTablets === null || x.actual_yield.legibility !== "clear") {
    flag(
      "actual_yield",
      "low_confidence",
      `The tablet count is hard to read; ${asker}, please confirm it.`,
    );
  }
  const yieldBp =
    actualTablets === null ? null : Math.round((actualTablets * 10_000) / theoretical);
  if (yieldBp !== null && product.expectedYieldBp - yieldBp > YIELD_VARIANCE_BP) {
    const notes = x.margin_notes.map((n) => clean(n.text)).filter((t) => t !== "");
    flag(
      "yield_percent",
      "yield_variance",
      `Yield ${pct(yieldBp)} is ${((product.expectedYieldBp - yieldBp) / 100).toFixed(1)} points under the expected ${pct(product.expectedYieldBp)}.` +
        (notes.length ? ` Margin note: "${notes.join(" ")}"` : ""),
    );
  }

  let wasteBase: number | null = null;
  const waste = readNumber(x.waste_qty.raw);
  if (waste) {
    const wasteUnit = unit(x.waste_unit.raw || waste.suffix);
    if (wasteUnit?.dimension === "mass") wasteBase = toBase(waste.value, wasteUnit);
    else flag("waste_unit", "unit_mismatch", `The waste unit "${x.waste_unit.raw}" is not a mass.`);
  }

  // Lines: lot, unit and quantity, each checked on its own.
  const lineReads = new Map<string, { base: number | null }[]>();
  const draws: Draw[] = [];
  x.materials.forEach((line: ExtractedLine, i) => {
    const at = `materials[${i}]`;
    const matCode = code(line.material_code.raw);
    const label = `Line ${line.line_no || i + 1} (${matCode || "?"})`;
    const material = db.select().from(materials).where(eq(materials.code, matCode)).get();
    if (!material) {
      flag(`${at}.material_code`, "unknown_lot", `${label}: unknown material.`);
      return;
    }
    const reads = lineReads.get(matCode) ?? [];
    lineReads.set(matCode, reads);
    const entry: { base: number | null } = { base: null };
    reads.push(entry);

    if (line.correction.present) {
      flag(
        `${at}.actual_qty`,
        "correction_detected",
        `${label}: ${line.correction.struck_value} struck through and corrected to ${line.actual_qty.raw} ${line.unit.raw}` +
          `${line.correction.initials ? `, initialed ${clean(line.correction.initials)}` : ""}. I used ${line.actual_qty.raw}.`,
      );
    }

    const lineUnit = unit(line.unit.raw);
    if (!lineUnit || lineUnit.dimension !== material.dimension) {
      flag(
        `${at}.unit`,
        "unit_mismatch",
        `${label}: "${line.unit.raw}" is not a unit of ${material.dimension} for ${material.name.toLowerCase()}.`,
      );
    }
    const qty = readNumber(line.actual_qty.raw);
    if (!qty || line.actual_qty.legibility !== "clear") {
      const guess = qty ? ` It looks like ${line.actual_qty.raw} ${line.unit.raw}.` : "";
      flag(
        `${at}.actual_qty`,
        "low_confidence",
        `${label}: the quantity is hard to read.${guess} ${asker}, please confirm it.`,
      );
    } else if (lineUnit && lineUnit.dimension === material.dimension) {
      entry.base = toBase(qty.value, lineUnit);
    }

    const lotCode = code(line.internal_lot.raw);
    const lot = db.select().from(lots).where(eq(lots.lotCode, lotCode)).get();
    if (!lot || line.internal_lot.legibility !== "clear") {
      flag(
        `${at}.internal_lot`,
        lot ? "low_confidence" : "unknown_lot",
        lot
          ? `${label}: lot ${lotCode} is hard to read; ${asker}, please confirm it.`
          : `${label}: lot "${line.internal_lot.raw}" is not in the ledger.`,
      );
      return;
    }
    if (lot.materialId !== material.id) {
      flag(`${at}.internal_lot`, "unknown_lot", `${label}: lot ${lotCode} is not ${matCode}.`);
      return;
    }
    const supplierLot = code(line.supplier_lot.raw);
    if (supplierLot !== "" && lot.vendorLotCode && supplierLot !== code(lot.vendorLotCode)) {
      flag(
        `${at}.supplier_lot`,
        "unknown_lot",
        `${label}: supplier lot ${supplierLot} does not match ${lot.vendorLotCode} on lot ${lotCode}.`,
      );
    }
    if (!USABLE.includes(lot.state as (typeof USABLE)[number])) {
      flag(`${at}.internal_lot`, "unknown_lot", `${label}: lot ${lotCode} is ${lot.state}.`);
      return;
    }
    if (entry.base !== null) {
      draws.push({ lineNo: i, lotId: lot.id, materialId: material.id, actualBase: entry.base });
    }
  });

  // A lot drawn on two lines must hold both draws at this plant.
  const byLot = new Map<number, number>();
  for (const d of draws) byLot.set(d.lotId, (byLot.get(d.lotId) ?? 0) + d.actualBase);
  for (const [lotId, drawn] of byLot) {
    const onHand =
      db
        .select({ base: lotBalances.onHandBase })
        .from(lotBalances)
        .where(and(eq(lotBalances.lotId, lotId), eq(lotBalances.facilityId, facility.id)))
        .get()?.base ?? 0;
    if (drawn > onHand) {
      const lot = db.select().from(lots).where(eq(lots.id, lotId)).get();
      const first = draws.findIndex((d) => d.lotId === lotId);
      flag(
        `materials[${draws[first]?.lineNo}].internal_lot`,
        "unknown_lot",
        `Lot ${lot?.lotCode} draws ${kgText(drawn)} but ${facility.name} holds ${kgText(onHand)}.`,
      );
    }
  }

  // Each formula material, summed across its lots, against the formula scaled to the batch.
  const scale = theoretical / product.standardBatchTablets;
  const lines = db
    .select({ materialId: formulaLines.materialId, code: materials.code, ...formulaCols })
    .from(formulaLines)
    .innerJoin(materials, eq(materials.id, formulaLines.materialId))
    .where(eq(formulaLines.formulaId, formula.id))
    .all();
  const reviewed: ReviewedMaterial[] = lines.map((f) => {
    const expectedBase = Math.round(f.qtyPerBatchBase * scale);
    const reads = lineReads.get(f.code) ?? [];
    const path = `formula.${f.code}`;
    if (reads.length === 0) {
      flag(path, "out_of_tolerance", `${f.code} is in the formula but not on the record.`);
      return {
        code: f.code,
        materialId: f.materialId,
        expectedBase,
        actualBase: 0,
        deviationBp: 10_000,
      };
    }
    if (reads.some((r) => r.base === null)) {
      return {
        code: f.code,
        materialId: f.materialId,
        expectedBase,
        actualBase: null,
        deviationBp: null,
      };
    }
    const actualBase = reads.reduce((s, r) => s + (r.base ?? 0), 0);
    const deviationBp = Math.round((Math.abs(actualBase - expectedBase) * 10_000) / expectedBase);
    if (deviationBp > f.toleranceBp) {
      flag(
        path,
        "out_of_tolerance",
        `${f.code}: ${kgText(actualBase)} against ${kgText(expectedBase)} in the formula, ${pct(deviationBp)} off (limit ±${pct(f.toleranceBp)}).`,
      );
    }
    return { code: f.code, materialId: f.materialId, expectedBase, actualBase, deviationBp };
  });
  for (const matCode of lineReads.keys()) {
    if (!lines.some((f) => f.code === matCode)) {
      flag(
        `formula.${matCode}`,
        "out_of_tolerance",
        `${matCode} is not in the ${productCode} formula.`,
      );
    }
  }

  const outside = reviewed.filter(
    (m) => m.deviationBp !== null && flags.some((f) => f.fieldPath === `formula.${m.code}`),
  ).length;
  const unchecked = reviewed.filter((m) => m.deviationBp === null).length;
  const tolerance =
    outside === 0 && unchecked === 0
      ? "all within tolerance"
      : [outside && `${outside} outside tolerance`, unchecked && `${unchecked} not checked`]
          .filter(Boolean)
          .join(", ");
  const head =
    `Kevin read ${batchNo} (${productCode.replace(/^P-/, "")}, ${theoretical.toLocaleString("en-US")} tablets). ` +
    `${lineReads.size} materials, ${tolerance}.` +
    (yieldBp === null ? "" : ` Yield ${pct(yieldBp)}.`);
  const detail = flags
    .filter((f) => f.kind !== "out_of_tolerance" || !f.fieldPath.startsWith("formula."))
    .filter((f) => f.kind !== "yield_variance")
    .map((f) => f.message);
  const variance = flags.filter((f) => f.kind === "yield_variance").map((f) => f.message);
  const tol = flags
    .filter((f) => f.kind === "out_of_tolerance" && f.fieldPath.startsWith("formula."))
    .map((f) => f.message);

  return {
    batchNo,
    productId: product.id,
    productCode,
    formulaId: formula.id,
    facilityId: facility.id,
    facilityCode: facility.code,
    date: isoDate(x.manufacture_date.raw),
    theoreticalTablets: theoretical,
    actualTablets,
    yieldBp,
    wasteBase,
    materials: reviewed,
    draws,
    flags,
    sentence: [head, ...tol, ...variance, ...detail].join(" "),
  };
}

const formulaCols = {
  qtyPerBatchBase: formulaLines.qtyPerBatchBase,
  toleranceBp: formulaLines.toleranceBp,
};

export interface DraftSource {
  file: string;
  sha256: string;
  model: string;
}

/** Step 1: stores the transcription as a draft batch record with its flags. */
export function saveBatchDraft(
  db: Ledger,
  extraction: BatchRecordExtraction,
  source: DraftSource,
): { batchId: number; review: BatchReview } {
  const review = reviewBatchRecord(db, extraction);
  return db.transaction((tx) => {
    const row = tx
      .insert(batchRecords)
      .values({
        ...recordColumns(review),
        sourceFile: source.file,
        sourceSha256: source.sha256,
        extractionJson: JSON.stringify(extraction),
        extractionModel: source.model,
        status: "draft",
      })
      .returning()
      .get();
    if (review.flags.length) {
      tx.insert(extractionFlags)
        .values(
          review.flags.map((f) => ({
            batchId: row.id,
            fieldPath: f.fieldPath,
            kind: f.kind,
            message: f.message,
          })),
        )
        .run();
    }
    return { batchId: row.id, review };
  });
}

function recordColumns(review: BatchReview) {
  const day = review.date ?? null;
  return {
    batchNo: review.batchNo,
    productId: review.productId,
    formulaId: review.formulaId,
    facilityId: review.facilityId,
    startedAt: day && `${day}T06:00:00.000Z`,
    completedAt: day && `${day}T18:00:00.000Z`,
    theoreticalTablets: review.theoreticalTablets,
    actualTablets: review.actualTablets,
    yieldBp: review.yieldBp,
    wasteBase: review.wasteBase,
  };
}

/** Sets a field the purchaser corrected, e.g. "materials[5].actual_qty" → "83.040". */
function applyResolution(x: BatchRecordExtraction, path: string, value: string) {
  const m = path.match(/^materials\[(\d+)\]\.(\w+)$/);
  const target: Record<string, unknown> | undefined = m
    ? (x.materials[Number(m[1])] as unknown as Record<string, unknown>)
    : (x as unknown as Record<string, unknown>);
  const key = m ? m[2] : path;
  const field = key && target ? target[key] : undefined;
  if (!key || !target || typeof field !== "object" || field === null || !("raw" in field)) {
    return false;
  }
  target[key] = { raw: value, legibility: "clear" } satisfies Read;
  return true;
}

export interface ConfirmInput {
  staffId: number;
  /** The demo clock. */
  now: string;
  /** Salt for the record fingerprint (research 09); stored with the record. */
  salt: string;
  /** Purchaser answers by field path: a value for a field, anything for an acknowledgement. */
  resolutions?: Record<string, string>;
}

export interface Confirmation {
  review: BatchReview;
  recordHash: string;
  /** Usable stock of each material at the plant, before and after. */
  stock: {
    code: string;
    name: string;
    beforeBase: number;
    afterBase: number;
    reorderPointBase: number | null;
  }[];
  sentence: string;
}

/** Step 2: the purchaser confirms; the draws post as lot events with backward genealogy. */
export function confirmBatchRecord(db: Ledger, batchId: number, input: ConfirmInput): Confirmation {
  const row = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
  if (!row?.extractionJson) throw new ExtractionError(`batch ${batchId} has no draft`);
  if (row.status !== "draft") throw new ExtractionError(`${row.batchNo} is already ${row.status}`);
  const extraction = JSON.parse(row.extractionJson) as BatchRecordExtraction;
  const resolutions = input.resolutions ?? {};
  const acknowledged = new Set<string>();
  for (const [path, value] of Object.entries(resolutions)) {
    if (!applyResolution(extraction, path, value)) acknowledged.add(path);
  }
  const review = reviewBatchRecord(db, extraction, { acknowledged, batchId });
  const open = review.flags.filter((f) => f.blocking);
  if (open.length) {
    throw new ExtractionError(
      `${review.batchNo} needs answers first: ${open.map((f) => f.message).join(" ")}`,
    );
  }

  const materialIds = [...new Set(review.draws.map((d) => d.materialId))];
  const before = usableStock(db, review.facilityId, materialIds);

  const recordHash = db.transaction((tx) => {
    // One issue, one consumption and, if the lot is not empty, one return per lot.
    const perLot = new Map<number, Draw[]>();
    for (const d of review.draws) perLot.set(d.lotId, [...(perLot.get(d.lotId) ?? []), d]);
    const base = {
      facilityId: review.facilityId,
      refType: "batch" as const,
      refId: batchId,
      actorType: "staff" as const,
      actorId: input.staffId,
      occurredAt: input.now,
    };
    for (const [lotId, ds] of perLot) {
      const lot = tx.select().from(lots).where(eq(lots.id, lotId)).get();
      if (lot?.state === "released")
        appendLotEvent(tx, { ...base, lotId, kind: "issued", qtyDeltaBase: 0 });
      const qty = ds.reduce((s, d) => s + d.actualBase, 0);
      const consumed = appendLotEvent(tx, { ...base, lotId, kind: "consumed", qtyDeltaBase: -qty });
      tx.insert(batchInputs)
        .values(
          ds.map((d) => ({
            batchId,
            lotId,
            materialId: d.materialId,
            expectedBase: null,
            actualBase: d.actualBase,
            issueEventId: consumed.id,
          })),
        )
        .run();
      if (consumed.toState === "in_use")
        appendLotEvent(tx, { ...base, lotId, kind: "returned", qtyDeltaBase: 0 });
    }
    // The expected quantity is per material; it goes on the first input row of each.
    for (const m of review.materials) {
      const first = tx
        .select({ id: batchInputs.id })
        .from(batchInputs)
        .where(and(eq(batchInputs.batchId, batchId), eq(batchInputs.materialId, m.materialId)))
        .orderBy(batchInputs.id)
        .get();
      if (first)
        tx.update(batchInputs)
          .set({ expectedBase: m.expectedBase })
          .where(eq(batchInputs.id, first.id))
          .run();
    }
    for (const [path, value] of Object.entries(resolutions)) {
      tx.update(extractionFlags)
        .set({ resolvedBy: input.staffId, resolvedValue: value })
        .where(and(eq(extractionFlags.batchId, batchId), eq(extractionFlags.fieldPath, path)))
        .run();
    }
    tx.update(batchRecords)
      .set({
        ...recordColumns(review),
        extractionJson: JSON.stringify(extraction),
        status: "confirmed",
        confirmedBy: input.staffId,
        confirmedAt: input.now,
        salt: input.salt,
      })
      .where(eq(batchRecords.id, batchId))
      .run();
    const hash = fingerprint(batchRecordContent(tx, batchId), input.salt);
    tx.update(batchRecords).set({ recordHash: hash }).where(eq(batchRecords.id, batchId)).run();
    return hash;
  });

  const after = usableStock(db, review.facilityId, materialIds);
  const facility = db.select().from(facilities).where(eq(facilities.id, review.facilityId)).get();
  const plant = facility?.role === "hq" ? facility.name : `Plant ${review.facilityCode}`;
  const stock = materialIds.map((id) => {
    const m = db.select().from(materials).where(eq(materials.id, id)).get();
    return {
      code: m?.code ?? "",
      name: m?.name ?? "",
      beforeBase: before.get(id) ?? 0,
      afterBase: after.get(id) ?? 0,
      reorderPointBase: m?.reorderPointBase ?? null,
    };
  });
  const low = stock.filter((s) => s.reorderPointBase !== null && s.afterBase < s.reorderPointBase);
  const sentence = [
    "Inventory updated.",
    ...low.map(
      (s) =>
        `${s.name} at ${plant}: ${kgText(s.beforeBase)} → ${kgText(s.afterBase)} (reorder point ${Math.round((s.reorderPointBase ?? 0) / 1_000_000).toLocaleString("en-US")} kg).`,
    ),
  ].join(" ");
  return { review, recordHash, stock, sentence };
}

function usableStock(db: Ledger, facilityId: number, materialIds: number[]) {
  const rows = db
    .select({ materialId: lots.materialId, base: lotBalances.onHandBase })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .where(
      and(
        eq(lotBalances.facilityId, facilityId),
        inArray(lots.materialId, materialIds),
        inArray(lots.state, [...USABLE]),
      ),
    )
    .all();
  const sum = new Map<number, number>();
  for (const r of rows) sum.set(r.materialId, (sum.get(r.materialId) ?? 0) + r.base);
  return sum;
}

/**
 * What the batch-record fingerprint covers: the record as confirmed and posted, read back from
 * the ledger rows, so the same record can be rebuilt any time for `npm run verify`.
 */
export function batchRecordContent(db: LedgerDb, batchId: number) {
  const row = db
    .select({ batch: batchRecords, product: products.code, facility: facilities.code })
    .from(batchRecords)
    .innerJoin(products, eq(products.id, batchRecords.productId))
    .innerJoin(facilities, eq(facilities.id, batchRecords.facilityId))
    .where(eq(batchRecords.id, batchId))
    .get();
  if (!row) throw new ExtractionError(`batch ${batchId} does not exist`);
  const confirmer = row.batch.confirmedBy
    ? db.select({ name: staff.name }).from(staff).where(eq(staff.id, row.batch.confirmedBy)).get()
    : undefined;
  const inputs = db
    .select({ lot: lots.lotCode, material: materials.code, actual_mg: batchInputs.actualBase })
    .from(batchInputs)
    .innerJoin(lots, eq(lots.id, batchInputs.lotId))
    .innerJoin(materials, eq(materials.id, batchInputs.materialId))
    .where(eq(batchInputs.batchId, batchId))
    .orderBy(batchInputs.id)
    .all();
  return {
    batch_no: row.batch.batchNo,
    product: row.product,
    facility: row.facility,
    date: row.batch.startedAt?.slice(0, 10) ?? null,
    theoretical_tablets: row.batch.theoreticalTablets,
    actual_tablets: row.batch.actualTablets,
    waste_mg: row.batch.wasteBase,
    inputs,
    source_sha256: row.batch.sourceSha256,
    confirmed_by: confirmer?.name ?? null,
  };
}

/** The file a judge re-hashes with `npm run verify` (DEMO_SCRIPT §3 step 3). */
export function batchRecordProof(db: Ledger, batchId: number) {
  const row = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
  if (row?.status !== "confirmed" || !row.salt || !row.recordHash) {
    throw new ExtractionError(`batch ${batchId} is not a confirmed record`);
  }
  return {
    kind: "batch_record" as const,
    ref_id: row.batchNo,
    salt: row.salt,
    record: batchRecordContent(db, batchId),
    hash: row.recordHash,
  };
}

/** The anchor for step 2: `anchor_batch` stores the confirmed record's fingerprint. */
export function batchRecordAnchorItem(db: Ledger, batchId: number): AnchorItem {
  const proof = batchRecordProof(db, batchId);
  return {
    kind: "batch_record",
    refId: proof.ref_id,
    hash: proof.hash,
    prev: null,
    ledger: { refId: batchId },
  };
}
