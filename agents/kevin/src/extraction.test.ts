import { readFileSync } from "node:fs";
import type { BatchRecordExtraction } from "@day-one/server/extraction/schema";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { appendLotEvent, verifyChain } from "@day-one/server/ledger/events";
import {
  batchInputs,
  batchRecords,
  extractionFlags,
  facilities,
  lotEvents,
  lots,
  materials,
  staff,
  vendors,
} from "@day-one/server/ledger/schema";
import { fingerprint } from "@day-one/server/records/anchors";
import { seedLedger } from "@day-one/server/seed";
import { NEW_LOTS, recordLot } from "@day-one/server/seed/batchRecords";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  batchRecordAnchorItem,
  batchRecordProof,
  confirmBatchRecord,
  ExtractionError,
  readNumber,
  reviewBatchRecord,
  saveBatchDraft,
  transcribeBatchRecord,
} from "./extraction.ts";

const NOW = "2026-11-09T13:05:00.000Z";
const SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const KG = 1_000_000;

/** GLM 5.3 Flash's transcription of each rendered record, from the bake-off (research 13). */
const glm = (batchNo: string): BatchRecordExtraction =>
  JSON.parse(
    readFileSync(
      new URL(`../../../data/bakeoff/z-ai_glm-5.3-flash/${batchNo}.json`, import.meta.url),
      "utf8",
    ),
  ).answer;

const source = (batchNo: string) => ({
  file: `data/batch-records/${batchNo}.jpg`,
  sha256: "0".repeat(64),
  model: "nearai:z-ai/glm-5.3-flash",
});

let db: Ledger;
const idOf = <T extends { id: number }>(row: T | undefined) => {
  if (!row) throw new Error("missing row");
  return row.id;
};
const ray = () => idOf(db.select().from(staff).where(eq(staff.name, "Ray Delgado")).get());

/** The three lots the non-demo records draw that the demo seed does not hold (NEW_LOTS). */
function addNewLots() {
  for (const l of NEW_LOTS) {
    const facility = idOf(
      db.select().from(facilities).where(eq(facilities.code, l.facility)).get(),
    );
    const material = idOf(
      db
        .select()
        .from(materials)
        .where(eq(materials.code, l.code.split("-")[0] ?? ""))
        .get(),
    );
    const vendor = idOf(db.select().from(vendors).where(eq(vendors.code, l.vendor)).get());
    const lot = db
      .insert(lots)
      .values({
        lotCode: l.code,
        materialId: material,
        vendorId: vendor,
        vendorLotCode: recordLot(l.code).supplierLot,
      })
      .returning()
      .get();
    const base = {
      lotId: lot.id,
      facilityId: facility,
      actorType: "system" as const,
      occurredAt: NOW,
    };
    appendLotEvent(db, { ...base, kind: "received", qtyDeltaBase: Math.round(l.qty * KG) });
    appendLotEvent(db, { ...base, kind: "quarantined", qtyDeltaBase: 0 });
    appendLotEvent(db, { ...base, kind: "released", qtyDeltaBase: 0 });
  }
}

beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("readNumber", () => {
  it("reads US thousands separators and trailing units", () => {
    expect(readNumber("625,115")).toEqual({ value: 625_115, suffix: "" });
    expect(readNumber("723,200 tablets")).toEqual({ value: 723_200, suffix: "tablets" });
    expect(readNumber("55.8 lb")).toEqual({ value: 55.8, suffix: "lb" });
    expect(readNumber("90.4 %")).toEqual({ value: 90.4, suffix: "%" });
    expect(readNumber("")).toBeNull();
    expect(readNumber("8?.040")).toBeNull();
  });
});

describe("BR-B-1045, the demo upload (DEMO_SCRIPT steps 1 and 2)", () => {
  it("step 1: reads the record and finds nothing to ask", () => {
    const { batchId, review } = saveBatchDraft(db, glm("BR-B-1045"), source("BR-B-1045"));
    expect(review.sentence).toBe(
      "Kevin read BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.",
    );
    expect(review.flags).toEqual([]);
    const row = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
    expect(row).toMatchObject({
      status: "draft",
      yieldBp: 9080,
      wasteBase: 91_992_000,
      actualTablets: 726_400,
    });
    // Nothing moves until Ray confirms.
    expect(
      db
        .select()
        .from(lotEvents)
        .where(and(eq(lotEvents.refType, "batch"), eq(lotEvents.refId, batchId)))
        .all(),
    ).toEqual([]);
  });

  it("step 2: Ray confirms; ascorbic acid drops below the reorder point", () => {
    const { batchId } = saveBatchDraft(db, glm("BR-B-1045"), source("BR-B-1045"));
    const done = confirmBatchRecord(db, batchId, { staffId: ray(), now: NOW, salt: SALT });
    expect(done.sentence).toBe(
      "Inventory updated. Ascorbic acid at Plant B: 722.4 kg → 310.0 kg (reorder point 500 kg).",
    );
    const asc = done.stock.find((s) => s.code === "ASC");
    expect(asc).toMatchObject({ beforeBase: 722_350_000, afterBase: 310_000_000 });

    // Backward genealogy: nine lines, ascorbic acid from two lots.
    const inputs = db
      .select({ lot: lots.lotCode, mg: batchInputs.actualBase, expected: batchInputs.expectedBase })
      .from(batchInputs)
      .innerJoin(lots, eq(lots.id, batchInputs.lotId))
      .where(eq(batchInputs.batchId, batchId))
      .all();
    expect(inputs).toHaveLength(9);
    expect(inputs.filter((i) => i.lot.startsWith("ASC"))).toEqual([
      { lot: "ASC-261009-01", mg: 187_450_000, expected: 412_000_000 },
      { lot: "ASC-260921-02", mg: 224_900_000, expected: null },
    ]);
    // Plant B used up the transferred lot; the 12.550 kg Plant A still books keeps it open
    // (the §8 discrepancy). The other lot goes back on the shelf.
    const state = (code: string) =>
      db.select().from(lots).where(eq(lots.lotCode, code)).get()?.state;
    expect(state("ASC-261009-01")).toBe("released");
    expect(state("ASC-260921-02")).toBe("released");
    expect(verifyChain(db)).toEqual({ ok: true });

    const row = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
    expect(row).toMatchObject({ status: "confirmed", confirmedBy: ray(), salt: SALT });
  });

  it("anchors a fingerprint that the proof file reproduces", () => {
    const { batchId } = saveBatchDraft(db, glm("BR-B-1045"), source("BR-B-1045"));
    const done = confirmBatchRecord(db, batchId, { staffId: ray(), now: NOW, salt: SALT });
    const proof = batchRecordProof(db, batchId);
    expect(fingerprint(proof.record, proof.salt)).toBe(done.recordHash);
    expect(proof.record).toMatchObject({
      batch_no: "BR-B-1045",
      date: "2026-11-06",
      confirmed_by: "Ray Delgado",
    });
    expect(batchRecordAnchorItem(db, batchId)).toEqual({
      kind: "batch_record",
      refId: "BR-B-1045",
      hash: done.recordHash,
      prev: null,
      ledger: { refId: batchId },
    });
    // One gram more on one line changes the fingerprint (README step 4).
    const tampered = structuredClone(proof.record);
    const first = tampered.inputs[0];
    if (first) first.actual_mg += 1_000;
    expect(fingerprint(tampered, proof.salt)).not.toBe(done.recordHash);
  });

  it("refuses the same batch twice", () => {
    saveBatchDraft(db, glm("BR-B-1045"), source("BR-B-1045"));
    expect(() => saveBatchDraft(db, glm("BR-B-1045"), source("BR-B-1045"))).toThrow(
      ExtractionError,
    );
  });

  it("transcribes through the vision route and rejects a page that is not a batch record", async () => {
    const llm = (json: unknown) => ({
      complete: async () => ({
        provider: "nearai" as const,
        model: "z-ai/glm-5.3-flash",
        text: "",
        json,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    const image = { mediaType: "image/jpeg" as const, base64: "" };
    const got = await transcribeBatchRecord(llm(glm("BR-B-1045")), image);
    expect(got.model).toBe("nearai:z-ai/glm-5.3-flash");
    await expect(transcribeBatchRecord(llm({ document_type: "other" }), image)).rejects.toThrow(
      "not a batch record",
    );
    // The model called the packing slip a batch record and left every field blank.
    const blank = { ...glm("BR-B-1045"), batch_number: { raw: "", legibility: "clear" } };
    await expect(transcribeBatchRecord(llm({ ...blank, materials: [] }), image)).rejects.toThrow(
      "not a batch record",
    );
    // A record whose batch number is unreadable is still a record: the review says so.
    await expect(transcribeBatchRecord(llm(blank), image)).resolves.toBeTruthy();
  });
});

describe("the other six records (FICTIONAL_DATA §7), each against the demo-start ledger", () => {
  beforeEach(addNewLots);

  it.each(["BR-B-1041", "BR-B-1042", "BR-A-2207"])("%s reads clean", (no) => {
    const review = reviewBatchRecord(db, glm(no));
    expect(review.flags).toEqual([]);
    expect(review.sentence).toMatch(/all within tolerance/);
  });

  it("BR-B-1042: grams on the record become mg in the ledger", () => {
    const review = reviewBatchRecord(db, glm("BR-B-1042"));
    expect(review.materials.find((m) => m.code === "CAC")).toMatchObject({
      actualBase: 625_115_000,
      expectedBase: 625_000_000,
    });
  });

  it("BR-A-2207: pounds convert exactly, waste included", () => {
    const review = reviewBatchRecord(db, glm("BR-A-2207"));
    expect(review.facilityCode).toBe("A");
    expect(review.wasteBase).toBe(25_310_454);
    expect(review.materials.find((m) => m.code === "CAC")?.actualBase).toBe(625_004_927);
  });

  it("BR-B-1043: takes the corrected value and notes the correction", () => {
    const review = reviewBatchRecord(db, glm("BR-B-1043"));
    expect(review.flags.map((f) => [f.kind, f.blocking])).toEqual([["correction_detected", false]]);
    expect(review.materials.find((m) => m.code === "MCC")?.actualBase).toBe(120_100_000);
    expect(review.sentence).toContain("102.100 struck through and corrected to 120.100 kg");
  });

  it("BR-B-1043: the struck value would have been out of tolerance", () => {
    const x = glm("BR-B-1043");
    const mcc = x.materials.find((m) => m.material_code.raw === "MCC");
    if (mcc) mcc.actual_qty.raw = "102.100";
    const review = reviewBatchRecord(db, x);
    expect(review.flags.find((f) => f.kind === "out_of_tolerance")).toMatchObject({
      fieldPath: "formula.MCC",
      blocking: true,
    });
    expect(review.sentence).toContain("1 outside tolerance");
  });

  it("BR-B-1044: flags the yield variance with the margin note", () => {
    const review = reviewBatchRecord(db, glm("BR-B-1044"));
    expect(review.flags.map((f) => [f.kind, f.blocking])).toEqual([["yield_variance", false]]);
    expect(review.sentence).toContain("Yield 86.2% is 3.8 points under the expected 90.0%.");
    expect(review.sentence).toContain("Compression sticking");
  });

  it("BR-B-1046: asks Ray about the smudged quantity and posts nothing until he answers", () => {
    const { batchId, review } = saveBatchDraft(db, glm("BR-B-1046"), source("BR-B-1046"));
    expect(review.flags).toMatchObject([
      { kind: "low_confidence", fieldPath: "materials[2].actual_qty", blocking: true },
    ]);
    expect(review.sentence).toBe(
      "Kevin read BR-B-1046 (CMD, 500,000 tablets). 7 materials, 1 not checked. Yield 89.9%. " +
        "Line 3 (MGO): the quantity is hard to read. Ray, please confirm it.",
    );
    expect(() => confirmBatchRecord(db, batchId, { staffId: ray(), now: NOW, salt: SALT })).toThrow(
      "needs answers first",
    );
    expect(
      db
        .select()
        .from(lotEvents)
        .where(and(eq(lotEvents.refType, "batch"), eq(lotEvents.refId, batchId)))
        .all(),
    ).toEqual([]);

    confirmBatchRecord(db, batchId, {
      staffId: ray(),
      now: NOW,
      salt: SALT,
      resolutions: { "materials[2].actual_qty": "83.040" },
    });
    const flag = db
      .select()
      .from(extractionFlags)
      .where(and(eq(extractionFlags.batchId, batchId), eq(extractionFlags.kind, "low_confidence")))
      .get();
    expect(flag).toMatchObject({ resolvedBy: ray(), resolvedValue: "83.040" });
    const mgo = db
      .select({ mg: batchInputs.actualBase })
      .from(batchInputs)
      .innerJoin(lots, eq(lots.id, batchInputs.lotId))
      .where(and(eq(batchInputs.batchId, batchId), eq(lots.lotCode, "MGO-261014-01")))
      .get();
    expect(mgo?.mg).toBe(83_040_000);
  });

  it("flags a lot the ledger does not hold and a lot of the wrong material", () => {
    const x = glm("BR-B-1041");
    const [first, second] = x.materials;
    if (first) first.internal_lot.raw = "ASC-269999-01";
    if (second) second.internal_lot.raw = "MCC-260901-01";
    const review = reviewBatchRecord(db, x);
    expect(review.flags.map((f) => [f.kind, f.fieldPath])).toEqual([
      ["unknown_lot", "materials[0].internal_lot"],
      ["unknown_lot", "materials[1].internal_lot"],
    ]);
  });

  it("flags a unit that is not a mass", () => {
    const x = glm("BR-B-1041");
    const first = x.materials[0];
    if (first) first.unit.raw = "L";
    const review = reviewBatchRecord(db, x);
    expect(review.flags.map((f) => f.kind)).toEqual(["unit_mismatch"]);
    expect(review.sentence).toContain("1 not checked");
  });
});
