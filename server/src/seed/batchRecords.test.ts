import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import { facilities, lotBalances, lots } from "../ledger/schema.ts";
import {
  BATCH_RECORDS,
  type BatchRecordSpec,
  NEW_LOTS,
  PACKING_SLIPS,
  parseQty,
  RECORD_SIGNERS,
  recordLot,
  toMg,
} from "./batchRecords.ts";
import { QC_SAMPLE_MG } from "./history.ts";
import { seedLedger } from "./index.ts";
import { kg, PRODUCTS, TOLERANCE_BP } from "./reference.ts";

let db: Ledger;

beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

/** On hand at demo start, in mg, for a lot at a facility; NEW_LOTS count at their full size. */
function onHandMg(lotCode: string, facilityCode: string) {
  const added = NEW_LOTS.find((l) => l.code === lotCode);
  if (added) return kg(added.qty);
  const row = db
    .select({ mg: lotBalances.onHandBase })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(facilities, eq(facilities.id, lotBalances.facilityId))
    .where(and(eq(lots.lotCode, lotCode), eq(facilities.code, facilityCode)))
    .get();
  return row?.mg ?? 0;
}

const product = (r: BatchRecordSpec) => {
  const p = PRODUCTS.find((x) => x.code === r.product);
  if (!p) throw new Error(r.product);
  return p;
};

const issuedMg = (r: BatchRecordSpec) => r.lines.reduce((s, l) => s + toMg(l.actual, l.unit), 0);
const record = (no: string) => {
  const r = BATCH_RECORDS.find((x) => x.batchNo === no);
  if (!r) throw new Error(no);
  return r;
};

describe("batch records (FICTIONAL_DATA §7)", () => {
  it("lists the seven records with their product, plant and yield", () => {
    expect(BATCH_RECORDS.map((r) => [r.batchNo, r.product, r.facility, r.yieldPct])).toEqual([
      ["BR-B-1041", "P-VC500", "B", "91.2"],
      ["BR-B-1042", "P-CMD", "B", "89.5"],
      ["BR-B-1043", "P-VC500", "B", "90.4"],
      ["BR-B-1044", "P-ELX", "B", "86.2"],
      ["BR-B-1045", "P-VC500", "B", "90.8"],
      ["BR-B-1046", "P-CMD", "B", "89.9"],
      ["BR-A-2207", "P-CMD", "A", "90.1"],
    ]);
  });

  it.each(BATCH_RECORDS)("$batchNo: the written yield is actual over theoretical", (r) => {
    const p = product(r);
    expect(parseQty(r.theoreticalTablets)).toBe(p.batchTablets);
    const pct = (parseQty(r.actualTablets) / parseQty(r.theoreticalTablets)) * 100;
    expect(pct.toFixed(1)).toBe(r.yieldPct);
  });

  it.each(BATCH_RECORDS)("$batchNo: every material is within ±0.5% of the formula", (r) => {
    const p = product(r);
    for (const [material, kgPerBatch] of p.lines) {
      const drawn = r.lines
        .filter((l) => l.material === material)
        .reduce((s, l) => s + toMg(l.actual, l.unit), 0);
      const deviationBp = (Math.abs(drawn - kg(kgPerBatch)) / kg(kgPerBatch)) * 10_000;
      expect(deviationBp, material).toBeLessThanOrEqual(TOLERANCE_BP);
    }
    expect(new Set(r.lines.map((l) => l.material))).toEqual(new Set(p.lines.map(([m]) => m)));
  });

  it.each(BATCH_RECORDS)("$batchNo: each lot sits at the plant and holds the draw", (r) => {
    for (const l of r.lines) {
      expect(l.lot.startsWith(`${l.material}-`), l.lot).toBe(true);
      expect(recordLot(l.lot).supplierLot.length, l.lot).toBeGreaterThan(0);
      expect(toMg(l.actual, l.unit), l.lot).toBeLessThanOrEqual(onHandMg(l.lot, r.facility));
    }
  });

  it.each(BATCH_RECORDS)("$batchNo: two different, named people initial each line", (r) => {
    for (const l of r.lines) {
      expect(l.weighedBy).not.toBe(l.verifiedBy);
      expect(RECORD_SIGNERS).toHaveProperty(l.weighedBy);
      expect(RECORD_SIGNERS).toHaveProperty(l.verifiedBy);
    }
    expect(r.signatures.map((s) => s.role)).toEqual(["production", "qa_review"]);
  });

  it("Hollow Pine's written waste balances to the gram (§15)", () => {
    for (const r of BATCH_RECORDS.filter((x) => x.facility === "B")) {
      const outputMg = parseQty(r.actualTablets) * product(r).tabletWeightMg;
      const balanceMg = issuedMg(r) - outputMg - QC_SAMPLE_MG;
      expect(Math.abs(toMg(r.waste, r.wasteUnit) - balanceMg), r.batchNo).toBeLessThan(1_000);
    }
    expect(record("BR-B-1042").waste).toBe("87.962");
    expect(record("BR-B-1046").waste).toBe("84.592");
    expect(issuedMg(record("BR-B-1042"))).toBe(kg(842.5));
    expect(issuedMg(record("BR-B-1046"))).toBe(kg(842.5));
  });

  it("BR-B-1044 wastes 13.8% of its blend and notes why", () => {
    const r = record("BR-B-1044");
    expect(((toMg(r.waste, "kg") / issuedMg(r)) * 100).toFixed(1)).toBe("13.8");
    expect(r.marginNotes[0]).toMatch(/sticking/);
  });

  it("BR-B-1045 draws ascorbic acid from the transferred lot first (§7)", () => {
    const asc = record("BR-B-1045").lines.filter((l) => l.material === "ASC");
    expect(asc.map((l) => [l.lot, l.actual])).toEqual([
      ["ASC-261009-01", "187.450"],
      ["ASC-260921-02", "224.900"],
    ]);
    // The transferred lot is used up exactly; 722.350 → 310.000 kg at Plant B.
    expect(onHandMg("ASC-261009-01", "B")).toBe(kg(187.45));
    expect(onHandMg("ASC-261009-01", "B") + onHandMg("ASC-260921-02", "B")).toBe(kg(722.35));
    expect(kg(722.35) - asc.reduce((s, l) => s + toMg(l.actual, l.unit), 0)).toBe(kg(310));
  });

  it("BR-B-1043 keeps the corrected value and BR-B-1046 marks the smudge", () => {
    const corrected = record("BR-B-1043").lines.filter((l) => l.correction);
    expect(corrected.map((l) => [l.material, l.correction?.struck, l.actual])).toEqual([
      ["MCC", "102.100", "120.100"],
    ]);
    expect(
      record("BR-B-1046")
        .lines.filter((l) => l.smudged)
        .map((l) => l.material),
    ).toEqual(["MGO"]);
  });

  it("BR-A-2207 carries Plant A's §15 figures in pounds", () => {
    const r = record("BR-A-2207");
    expect(r.lines.every((l) => l.unit === "lb")).toBe(true);
    expect(issuedMg(r)).toBe(842_502_468);
    expect(toMg(r.waste, r.wasteUnit)).toBe(25_310_454);
  });

  it("BR-B-1041 and BR-B-1043 use up their own ascorbic acid lots", () => {
    for (const no of ["BR-B-1041", "BR-B-1043"]) {
      const asc = record(no).lines.filter((l) => l.material === "ASC");
      expect(asc).toHaveLength(1);
      const lot = asc[0];
      expect(lot && toMg(lot.actual, lot.unit)).toBe(lot && onHandMg(lot.lot, "B"));
    }
  });
});

describe("packing slip (FICTIONAL_DATA §11)", () => {
  it("matches PO-1042 and the short variant differs only in what shipped", () => {
    const [slip, short] = PACKING_SLIPS;
    expect(slip).toMatchObject({
      slipNo: "NG-PS-60417",
      poNo: "PO-1042",
      shipped: "700 kg",
      supplierLot: "NG-24-8812",
    });
    expect(short).toMatchObject({
      slipNo: "NG-PS-60417-X",
      shipped: "675 kg",
      backOrdered: "25 kg",
    });
    expect(short?.receivedNote).toMatch(/^Rec'd 27 bags/);
  });
});
