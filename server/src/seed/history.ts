// Pre-demo history (docs/FICTIONAL_DATA.md §10, §13, §15): the six received POs behind the
// bookkeeper-pack invoices and eight summarized batch records keyed in from paper. The rendered
// records of §7 are not here; they enter the ledger through extraction.

import type { FacilityCode } from "./reference.ts";

export interface PoSpec {
  poNo: string;
  vendor: string;
  shipTo: FacilityCode;
  category: "raw_material" | "packaging" | "lab_chemical";
  orderedAt: string;
  /** [material, qty in inventory UoM, unit price in dollars per inventory unit] */
  lines: readonly (readonly [string, number, number])[];
}

/** §13: totals $2,110.00, $2,150.00, $2,100.00, $1,150.00, $1,655.00, $467.50 = $9,632.50. */
export const HISTORY_POS: readonly PoSpec[] = [
  {
    poNo: "PO-1035",
    vendor: "PEC",
    shipTo: "B",
    category: "raw_material",
    orderedAt: "2026-09-24",
    lines: [
      ["MGS", 50, 8.2],
      ["MCC", 500, 3.4],
    ],
  },
  {
    poNo: "PO-1036",
    vendor: "FPO",
    shipTo: "B",
    category: "raw_material",
    orderedAt: "2026-09-28",
    lines: [["SOR", 1_000, 2.15]],
  },
  {
    poNo: "PO-1037",
    vendor: "LOW",
    shipTo: "C",
    category: "packaging",
    orderedAt: "2026-09-30",
    lines: [["BTL", 100_000, 0.021]],
  },
  {
    poNo: "PO-1038",
    vendor: "OFH",
    shipTo: "B",
    category: "raw_material",
    orderedAt: "2026-10-05",
    lines: [["FOR", 25, 46]],
  },
  {
    poNo: "PO-1039",
    vendor: "SMS",
    shipTo: "B",
    category: "raw_material",
    orderedAt: "2026-10-07",
    lines: [
      ["CAC", 1_500, 0.62],
      ["MGO", 250, 2.9],
    ],
  },
  {
    // §13 price drift: $9.35/kg against $8.20/kg on PO-1035.
    poNo: "PO-1040",
    vendor: "PEC",
    shipTo: "B",
    category: "raw_material",
    orderedAt: "2026-10-15",
    lines: [["MGS", 50, 9.35]],
  },
];

export interface BatchSpec {
  batchNo: string;
  product: string;
  facility: FacilityCode;
  date: string;
  tablets: number;
  /** Recorded waste in mg; by default the blend not in tablets or QC samples (it balances). */
  wasteMg?: number;
  /** Extra mg issued per material beyond the formula, e.g. Plant A's pound rounding. */
  extraMg?: Readonly<Record<string, number>>;
}

/** QC samples pulled from every batch (§15). */
export const QC_SAMPLE_MG = 500_000;

/**
 * §15: Plant A writes 1,857.4 lb issued and 55.8 lb waste on every P-CMD batch; that is
 * 842,502,468 mg issued and 25,310,454 mg waste, leaving 57,599,514 mg unaccounted.
 */
const PLANT_A_CMD = {
  product: "P-CMD",
  facility: "A",
  tablets: 450_500,
  wasteMg: 25_310_454,
  extraMg: { CAC: 2_468 },
} as const;

export const HISTORY_BATCHES: readonly BatchSpec[] = [
  { batchNo: "BR-B-1033", product: "P-VC500", facility: "B", date: "2026-09-14", tablets: 728_000 },
  // Finishes ASC-260828-01 and takes the 165.100 kg from ASC-260921-02 (§6).
  { batchNo: "BR-B-1036", product: "P-VC500", facility: "B", date: "2026-10-01", tablets: 720_800 },
  { batchNo: "BR-B-1037", product: "P-ELX", facility: "B", date: "2026-10-08", tablets: 271_500 },
  { batchNo: "BR-A-2201", date: "2026-10-13", ...PLANT_A_CMD },
  // §15: Hollow Pine balances; 83.750 kg written waste.
  { batchNo: "BR-B-1038", product: "P-CMD", facility: "B", date: "2026-10-19", tablets: 450_000 },
  { batchNo: "BR-B-1039", product: "P-ELX", facility: "B", date: "2026-10-22", tablets: 268_200 },
  { batchNo: "BR-A-2204", date: "2026-10-27", ...PLANT_A_CMD },
  { batchNo: "BR-B-1040", product: "P-ELX", facility: "B", date: "2026-10-29", tablets: 272_400 },
];

/**
 * The production plan after the demo clock (2026-11-09T13:00Z): the two VC500 batches that
 * Kevin's 10-day forecast finds after BR-B-1045 (§7, DEMO_SCRIPT step 4).
 */
export const PLANNED_BATCHES = [
  { batchNo: "BR-B-1047", product: "P-VC500", facility: "B", plannedFor: "2026-11-17" },
  { batchNo: "BR-B-1048", product: "P-VC500", facility: "B", plannedFor: "2026-11-19" },
] as const satisfies readonly {
  batchNo: string;
  product: string;
  facility: FacilityCode;
  plannedFor: string;
}[];
