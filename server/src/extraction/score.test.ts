import { describe, expect, it } from "vitest";
import { BATCH_RECORDS, type BatchRecordSpec, recordLot } from "../seed/batchRecords.ts";
import type { BatchRecordExtraction, Read } from "./schema.ts";
import { accuracy, scoreRecord } from "./score.ts";

const clear = (raw: string): Read => ({ raw, legibility: "clear" });

/** What a perfect model would return for a record. */
function perfect(r: BatchRecordSpec): BatchRecordExtraction {
  return {
    document_type: "batch_record",
    batch_number: clear(r.batchNo),
    product_code: clear(r.product),
    product_name: clear(""),
    batch_size: clear(r.theoreticalTablets),
    manufacture_date: clear(r.date),
    facility: clear(""),
    materials: r.lines.map((l, i) => ({
      line_no: i + 1,
      material_name: clear(""),
      material_code: clear(l.material),
      internal_lot: clear(l.lot),
      supplier_lot: clear(recordLot(l.lot).supplierLot),
      target_qty: clear(l.target),
      actual_qty: l.smudged ? { raw: "", legibility: "illegible" } : clear(l.actual),
      unit: clear(l.unit),
      correction: {
        present: Boolean(l.correction),
        struck_value: l.correction?.struck ?? "",
        initials: l.correction?.initials ?? "",
      },
      weighed_by: clear(l.weighedBy),
      verified_by: clear(l.verifiedBy),
    })),
    theoretical_yield: clear(r.theoreticalTablets),
    actual_yield: clear(r.actualTablets),
    yield_percent: clear(`${r.yieldPct}%`),
    waste_qty: clear(r.waste),
    waste_unit: clear(r.wasteUnit),
    signatures: [],
    margin_notes: [],
  };
}

describe("scoreRecord", () => {
  it.each(BATCH_RECORDS)("$batchNo: a perfect transcription scores every field", (r) => {
    const score = scoreRecord(r, perfect(r));
    expect(score.fields.filter((f) => !f.ok)).toEqual([]);
    expect(accuracy(score.fields, "typed").total).toBeGreaterThan(20);
  });

  it("accepts trailing zeros, thousands commas and unpadded dates", () => {
    const r = BATCH_RECORDS.find((x) => x.batchNo === "BR-B-1042");
    if (!r) throw new Error("BR-B-1042");
    const got = perfect(r);
    got.manufacture_date = clear("11/3/26");
    const first = got.materials[0];
    if (first) first.actual_qty = clear("625115");
    expect(scoreRecord(r, got).fields.filter((f) => !f.ok)).toEqual([]);
  });

  it("counts a misread quantity and a smudge read as clear", () => {
    const r = BATCH_RECORDS.find((x) => x.batchNo === "BR-B-1046");
    if (!r) throw new Error("BR-B-1046");
    const got = perfect(r);
    const [first, , smudged] = got.materials;
    if (first) first.actual_qty = clear("624.785");
    if (smudged) smudged.actual_qty = clear("83.040");
    const score = scoreRecord(r, got);
    expect(score.fields.filter((f) => !f.ok).map((f) => f.field)).toEqual(["line 1 CAC actual"]);
    expect(score.smudgeFlagged).toBe(false);
    expect(scoreRecord(r, perfect(r)).smudgeFlagged).toBe(true);
  });
});
