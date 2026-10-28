// Scores a model's transcription of a rendered batch record against its ground truth
// (server/src/seed/batchRecords.ts), for the vision bake-off (research 13, "Bake-off"). Fields
// split into typed and handwritten, because the pass bars differ: ≥ 95% typed, ≥ 85% handwritten,
// and the smudged BR-B-1046 quantity must not come back as "clear".

import { type BatchRecordSpec, recordLot } from "../seed/batchRecords.ts";
import type { BatchRecordExtraction, ExtractedLine } from "./schema.ts";

export interface FieldResult {
  field: string;
  kind: "typed" | "handwritten";
  expected: string;
  got: string | null;
  ok: boolean;
}

export interface RecordScore {
  batchNo: string;
  fields: FieldResult[];
  /** Only set for a record with a smudged line: did the model flag it as not clear? */
  smudgeFlagged?: boolean;
}

const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();

/** "412.35" and "412.350" match; "625,115" and "625115" match. */
function sameValue(expected: string, got: string | null | undefined) {
  const a = text(expected).replaceAll(",", "");
  const b = text(got)
    .replaceAll(",", "")
    .replace(/[%A-Z]+$/, "");
  if (a === "" || b === "") return a === b;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : a === b;
}

/** Dates as MM/DD/YY; "11/6/26" and "11/06/26" match. */
function sameDate(expected: string, got: string | null | undefined) {
  const norm = (s: string) =>
    s
      .split("/")
      .map((p) => String(Number(p)))
      .join("/");
  return norm(text(expected)) === norm(text(got));
}

function pickLine(lines: ExtractedLine[], index: number, lot: string) {
  return lines.find((l) => text(l.internal_lot.raw) === text(lot)) ?? lines[index];
}

export function scoreRecord(truth: BatchRecordSpec, got: BatchRecordExtraction): RecordScore {
  const fields: FieldResult[] = [];
  const add = (
    field: string,
    kind: FieldResult["kind"],
    expected: string,
    value: string | null | undefined,
    ok: boolean,
  ) => fields.push({ field, kind, expected, got: value ?? null, ok });
  const value = (field: string, kind: FieldResult["kind"], expected: string, v?: string | null) =>
    add(field, kind, expected, v, sameValue(expected, v));
  const exact = (field: string, kind: FieldResult["kind"], expected: string, v?: string | null) =>
    add(field, kind, expected, v, text(expected) === text(v));

  exact("batch_number", "typed", truth.batchNo, got.batch_number?.raw);
  exact("product_code", "typed", truth.product, got.product_code?.raw);
  value("theoretical_yield", "typed", truth.theoreticalTablets, got.theoretical_yield?.raw);
  add(
    "date",
    "handwritten",
    truth.date,
    got.manufacture_date?.raw,
    sameDate(truth.date, got.manufacture_date?.raw),
  );
  value("actual_yield", "handwritten", truth.actualTablets, got.actual_yield?.raw);
  value("yield_percent", "handwritten", truth.yieldPct, got.yield_percent?.raw);
  value("waste", "handwritten", truth.waste, got.waste_qty?.raw);

  let smudgeFlagged: boolean | undefined;
  const lines = got.materials ?? [];
  truth.lines.forEach((t, i) => {
    const g = pickLine(lines, i, t.lot);
    const at = `line ${i + 1} ${t.material}`;
    exact(`${at} code`, "typed", t.material, g?.material_code.raw);
    exact(`${at} internal lot`, "typed", t.lot, g?.internal_lot.raw);
    exact(`${at} supplier lot`, "typed", recordLot(t.lot).supplierLot, g?.supplier_lot.raw);
    if (t.target) value(`${at} target`, "typed", t.target, g?.target_qty.raw);
    exact(`${at} unit`, "typed", t.unit, g?.unit.raw);
    // The smudged quantity is scored on whether it is flagged, not on the digits read.
    if (!t.smudged) value(`${at} actual`, "handwritten", t.actual, g?.actual_qty.raw);
    exact(`${at} weighed by`, "handwritten", t.weighedBy, g?.weighed_by.raw);
    exact(`${at} verified by`, "handwritten", t.verifiedBy, g?.verified_by.raw);
    if (t.correction) {
      value(`${at} struck value`, "handwritten", t.correction.struck, g?.correction.struck_value);
    }
    if (t.smudged) smudgeFlagged = g ? g.actual_qty.legibility !== "clear" : true;
  });
  return {
    batchNo: truth.batchNo,
    fields,
    ...(smudgeFlagged === undefined ? {} : { smudgeFlagged }),
  };
}

export function accuracy(fields: FieldResult[], kind: FieldResult["kind"]) {
  const of = fields.filter((f) => f.kind === kind);
  return { correct: of.filter((f) => f.ok).length, total: of.length };
}
