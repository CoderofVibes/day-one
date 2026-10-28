// The seven rendered batch records and the PO-1042 packing slip (docs/FICTIONAL_DATA.md §7,
// §11, §15), as written on paper. This is the ground truth: tools/render draws each record from
// it, and the extraction bake-off scores a model's transcription against it. Quantities stay
// strings exactly as printed; the helpers below turn them into numbers.
//
// Only BR-B-1045 posts to the demo ledger (DEMO_SCRIPT step 1). Each of the other six is checked
// on its own against the demo-start ledger plus NEW_LOTS, not as a sequence.

import { LOTS, vendorLotCode } from "./lots.ts";
import type { FacilityCode } from "./reference.ts";

export type RecordUnit = "kg" | "g" | "lb";

export interface RecordLine {
  material: string;
  lot: string;
  /** Printed target and handwritten actual, in `unit`, exactly as on the page. */
  target: string;
  actual: string;
  unit: RecordUnit;
  weighedBy: string;
  verifiedBy: string;
  /** BR-B-1043: the actual was struck through and rewritten; `actual` is the corrected value. */
  correction?: { struck: string; initials: string };
  /** BR-B-1046: the actual is smudged on the page. */
  smudged?: boolean;
}

export interface Signature {
  role: "production" | "qa_review";
  name: string;
  initials: string;
  /** MM/DD/YY as written. */
  date: string;
}

export interface BatchRecordSpec {
  batchNo: string;
  product: string;
  facility: Exclude<FacilityCode, "ACME" | "C">;
  /** MM/DD/YY as written, and the same day in ISO form. */
  date: string;
  isoDate: string;
  room: string;
  equipment: readonly (readonly [label: string, id: string])[];
  lines: readonly RecordLine[];
  theoreticalTablets: string;
  actualTablets: string;
  yieldPct: string;
  waste: string;
  wasteUnit: RecordUnit;
  marginNotes: readonly string[];
  signatures: readonly Signature[];
  /** Why the record exists (§7), for the bake-off report. */
  purpose: string;
}

/**
 * Lots the six non-demo records draw that the demo seed does not hold yet (PLAN.md, Nov 3).
 * BR-B-1041 and BR-B-1043 get their own ASC lots so Plant B still reads 722.350 kg before
 * BR-B-1045; Plant A needs more calcium carbonate than CAC-260925-01 holds for BR-A-2207.
 */
export const NEW_LOTS = [
  { code: "ASC-261026-01", vendor: "NGI", facility: "B", qty: 412.18 },
  { code: "ASC-261030-01", vendor: "NGI", facility: "B", qty: 412.24 },
  { code: "CAC-261030-01", vendor: "SMS", facility: "A", qty: 650 },
] as const;

/** Signers on the records. Operators initial each line; two different people per line. */
export const RECORD_SIGNERS = {
  JM: "Jesse Morales",
  DW: "Dana Whitfield",
  KO: "Kofi Osei",
  AR: "Ana Ruiz",
  BL: "Brett Laszlo",
  ST: "Sun Tran",
  LP: "Linda Park",
  PN: "Priya Natarajan",
  OB: "Owen Brandt",
  MC: "Mei Cho",
} as const;

const PLANT_B_ROOM = "Rm 104 Weigh & Dispense";

const line = (
  material: string,
  lot: string,
  target: string,
  actual: string,
  unit: RecordUnit,
  initials: readonly [string, string],
  extra: Pick<RecordLine, "correction" | "smudged"> = {},
): RecordLine => ({
  material,
  lot,
  target,
  actual,
  unit,
  weighedBy: initials[0],
  verifiedBy: initials[1],
  ...extra,
});

function plantBSignatures(date: string, qaDate: string): Signature[] {
  return [
    { role: "production", name: "Linda Park", initials: "LP", date },
    { role: "qa_review", name: "Priya Natarajan", initials: "PN", date: qaDate },
  ];
}

const JM_DW = ["JM", "DW"] as const;
const KO_AR = ["KO", "AR"] as const;
const BL_ST = ["BL", "ST"] as const;

export const BATCH_RECORDS: readonly BatchRecordSpec[] = [
  {
    batchNo: "BR-B-1041",
    product: "P-VC500",
    facility: "B",
    date: "11/02/26",
    isoDate: "2026-11-02",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-02"],
      ["Tablet press", "TP-B-03"],
    ],
    lines: [
      line("ASC", "ASC-261026-01", "412.000", "412.180", "kg", JM_DW),
      line("SOR", "SOR-260901-01", "416.000", "415.700", "kg", JM_DW),
      line("MCC", "MCC-260901-01", "120.000", "120.300", "kg", JM_DW),
      line("CTA", "CTA-260901-01", "20.000", "19.960", "kg", JM_DW),
      line("FOR", "FOR-260901-01", "12.000", "12.020", "kg", JM_DW),
      line("MGS", "MGS-261001-01", "12.000", "11.970", "kg", JM_DW),
      line("SIO", "SIO-260901-01", "6.400", "6.390", "kg", JM_DW),
      line("SUC", "SUC-260901-01", "1.600", "1.598", "kg", JM_DW),
    ],
    theoreticalTablets: "800,000",
    actualTablets: "729,600",
    yieldPct: "91.2",
    waste: "87.618",
    wasteUnit: "kg",
    marginNotes: [],
    signatures: plantBSignatures("11/02/26", "11/03/26"),
    purpose: "Clean baseline, fully typed",
  },
  {
    batchNo: "BR-B-1042",
    product: "P-CMD",
    facility: "B",
    date: "11/03/26",
    isoDate: "2026-11-03",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-02"],
      ["Tablet press", "TP-B-03"],
    ],
    lines: [
      line("CAC", "CAC-261014-01", "625,000", "625,115", "g", KO_AR),
      line("MCC", "MCC-261001-01", "100,000", "99,870", "g", KO_AR),
      line("MGO", "MGO-261014-01", "83,000", "83,040", "g", KO_AR),
      line("CCS", "CCS-260915-01", "15,000", "14,990", "g", KO_AR),
      line("STA", "STA-260915-01", "10,000", "10,010", "g", KO_AR),
      line("MGS", "MGS-261001-01", "7,500", "7,480", "g", KO_AR),
      line("VD3", "VD3-260920-01", "2,000", "1,995", "g", KO_AR),
    ],
    theoreticalTablets: "500,000",
    actualTablets: "447,500",
    yieldPct: "89.5",
    waste: "87.962",
    wasteUnit: "kg",
    marginNotes: [],
    signatures: plantBSignatures("11/03/26", "11/04/26"),
    purpose: "Clean baseline; quantities in g on the record, kg in inventory",
  },
  {
    batchNo: "BR-B-1043",
    product: "P-VC500",
    facility: "B",
    date: "11/04/26",
    isoDate: "2026-11-04",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-02"],
      ["Tablet press", "TP-B-03"],
    ],
    lines: [
      line("ASC", "ASC-261030-01", "412.000", "412.240", "kg", ["DW", "JM"]),
      line("SOR", "SOR-260901-01", "416.000", "416.060", "kg", ["DW", "JM"]),
      line("MCC", "MCC-260901-01", "120.000", "120.100", "kg", ["DW", "JM"], {
        correction: { struck: "102.100", initials: "DW" },
      }),
      line("CTA", "CTA-260901-01", "20.000", "20.030", "kg", ["DW", "JM"]),
      line("FOR", "FOR-260901-01", "12.000", "11.990", "kg", ["DW", "JM"]),
      line("MGS", "MGS-261001-01", "12.000", "12.010", "kg", ["DW", "JM"]),
      line("SIO", "SIO-260901-01", "6.400", "6.400", "kg", ["DW", "JM"]),
      line("SUC", "SUC-260901-01", "1.600", "1.601", "kg", ["DW", "JM"]),
    ],
    theoreticalTablets: "800,000",
    actualTablets: "723,200",
    yieldPct: "90.4",
    waste: "95.931",
    wasteUnit: "kg",
    marginNotes: [],
    signatures: plantBSignatures("11/04/26", "11/05/26"),
    purpose: "Handwritten correction: one quantity struck through and initialed",
  },
  {
    batchNo: "BR-B-1044",
    product: "P-ELX",
    facility: "B",
    date: "11/05/26",
    isoDate: "2026-11-05",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-01"],
      ["Tablet press", "TP-B-01"],
    ],
    lines: [
      line("CTA", "CTA-260901-01", "210.000", "210.300", "kg", KO_AR),
      line("SBC", "SBC-260918-01", "180.000", "180.150", "kg", KO_AR),
      line("MAN", "MAN-260918-01", "156.000", "155.900", "kg", KO_AR),
      line("KCT", "KCT-260918-01", "90.000", "90.200", "kg", KO_AR),
      line("PEG", "PEG-260918-01", "18.000", "18.050", "kg", KO_AR),
      line("FLL", "FLL-260918-01", "12.000", "11.980", "kg", KO_AR),
      line("NAC", "NAC-260918-01", "6.000", "6.010", "kg", KO_AR),
      line("SUC", "SUC-260901-01", "3.000", "3.010", "kg", KO_AR),
    ],
    theoreticalTablets: "300,000",
    actualTablets: "258,600",
    yieldPct: "86.2",
    waste: "93.250",
    wasteUnit: "kg",
    marginNotes: ["Compression sticking, stn 3. Punches cleaned 2x. -KO"],
    signatures: plantBSignatures("11/05/26", "11/06/26"),
    purpose: "High waste (13.8%) with compression sticking noted in the margin",
  },
  {
    batchNo: "BR-B-1045",
    product: "P-VC500",
    facility: "B",
    date: "11/06/26",
    isoDate: "2026-11-06",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-02"],
      ["Tablet press", "TP-B-03"],
    ],
    lines: [
      line("ASC", "ASC-261009-01", "412.000", "187.450", "kg", JM_DW),
      line("ASC", "ASC-260921-02", "", "224.900", "kg", JM_DW),
      line("SOR", "SOR-260901-01", "416.000", "416.200", "kg", JM_DW),
      line("MCC", "MCC-260901-01", "120.000", "119.880", "kg", JM_DW),
      line("CTA", "CTA-260901-01", "20.000", "20.040", "kg", JM_DW),
      line("FOR", "FOR-260901-01", "12.000", "11.980", "kg", JM_DW),
      line("MGS", "MGS-261001-01", "12.000", "12.030", "kg", JM_DW),
      line("SIO", "SIO-260901-01", "6.400", "6.410", "kg", JM_DW),
      line("SUC", "SUC-260901-01", "1.600", "1.602", "kg", JM_DW),
    ],
    theoreticalTablets: "800,000",
    actualTablets: "726,400",
    yieldPct: "90.8",
    waste: "91.992",
    wasteUnit: "kg",
    marginNotes: [],
    signatures: plantBSignatures("11/06/26", "11/07/26"),
    purpose: "The live demo upload; pushes ascorbic acid below the reorder point",
  },
  {
    batchNo: "BR-B-1046",
    product: "P-CMD",
    facility: "B",
    date: "11/07/26",
    isoDate: "2026-11-07",
    room: PLANT_B_ROOM,
    equipment: [
      ["V-blender", "BLD-B-02"],
      ["Tablet press", "TP-B-03"],
    ],
    lines: [
      line("CAC", "CAC-261014-01", "625.000", "624.786", "kg", KO_AR),
      line("MCC", "MCC-261001-01", "100.000", "100.150", "kg", KO_AR),
      line("MGO", "MGO-261014-01", "83.000", "83.040", "kg", KO_AR, { smudged: true }),
      line("CCS", "CCS-260915-01", "15.000", "15.020", "kg", KO_AR),
      line("STA", "STA-260915-01", "10.000", "9.990", "kg", KO_AR),
      line("MGS", "MGS-261001-01", "7.500", "7.510", "kg", KO_AR),
      line("VD3", "VD3-260920-01", "2.000", "2.004", "kg", KO_AR),
    ],
    theoreticalTablets: "500,000",
    actualTablets: "449,500",
    yieldPct: "89.9",
    waste: "84.592",
    wasteUnit: "kg",
    marginNotes: [],
    signatures: plantBSignatures("11/07/26", "11/08/26"),
    purpose: "One smudged quantity; Kevin reports low confidence and asks Ray",
  },
  {
    batchNo: "BR-A-2207",
    product: "P-CMD",
    facility: "A",
    date: "11/05/26",
    isoDate: "2026-11-05",
    room: "Dispensing Rm 2",
    equipment: [
      ["Ribbon blender", "BLD-A-01"],
      ["Tablet press", "TP-A-02"],
    ],
    // §15: Plant A writes pounds, target equal to actual, 1,857.4 lb issued and 55.8 lb waste.
    lines: [
      line("CAC", "CAC-261030-01", "1,377.9", "1,377.9", "lb", BL_ST),
      line("MCC", "MCC-260925-01", "220.5", "220.5", "lb", BL_ST),
      line("MGO", "MGO-260925-01", "183.0", "183.0", "lb", BL_ST),
      line("CCS", "CCS-260925-01", "33.1", "33.1", "lb", BL_ST),
      line("STA", "STA-260925-01", "22.0", "22.0", "lb", BL_ST),
      line("MGS", "MGS-260925-01", "16.5", "16.5", "lb", BL_ST),
      line("VD3", "VD3-260920-02", "4.4", "4.4", "lb", BL_ST),
    ],
    theoreticalTablets: "500,000",
    actualTablets: "450,500",
    yieldPct: "90.1",
    waste: "55.8",
    wasteUnit: "lb",
    marginNotes: [],
    signatures: [
      { role: "production", name: "Owen Brandt", initials: "OB", date: "11/05/26" },
      { role: "qa_review", name: "Mei Cho", initials: "MC", date: "11/06/26" },
    ],
    purpose: "Plant A record in pounds; its waste is under-recorded (§15)",
  },
];

/** mg per unit; 1 lb = 453,592.37 mg exactly. */
const MG_PER_UNIT: Record<RecordUnit, number> = { kg: 1_000_000, g: 1_000, lb: 453_592.37 };

/** "625,115" → 625115. US records: a comma is a thousands separator. */
export function parseQty(raw: string) {
  return Number(raw.replaceAll(",", ""));
}

/** A printed quantity in mg, rounded to the mg. */
export function toMg(raw: string, unit: RecordUnit) {
  return Math.round(parseQty(raw) * MG_PER_UNIT[unit]);
}

/** The vendor and supplier lot of a lot a record draws, from the seed or NEW_LOTS. */
export function recordLot(code: string) {
  const lot = LOTS.find((l) => l.code === code) ?? NEW_LOTS.find((l) => l.code === code);
  if (!lot) throw new Error(`batch records: unknown lot ${code}`);
  return { vendor: lot.vendor, supplierLot: vendorLotCode(lot.vendor, code) };
}

/** §11. Packing slips carry no prices. `-X` is the short-shipment variant for tests only. */
export interface PackingSlipSpec {
  slipNo: string;
  shipFrom: readonly string[];
  poNo: string;
  salesOrder: string;
  shipDate: string;
  shipVia: string;
  fob: string;
  shipTo: readonly string[];
  billTo: readonly string[];
  item: string;
  description: string;
  ordered: string;
  shipped: string;
  backOrdered: string;
  packaging: string;
  supplierLot: string;
  mfgRetest: string;
  netWeight: string;
  grossWeight: string;
  receivedNote: string;
}

const SLIP: PackingSlipSpec = {
  slipNo: "NG-PS-60417",
  shipFrom: ["Northgate Ingredients", "410 Mill Race Road", "Northgate"],
  poNo: "PO-1042",
  salesOrder: "NG-SO-24190",
  shipDate: "11/13/26",
  shipVia: "Ridgeline Freight LTL, PRO # 7720-4418-03",
  fob: "Origin",
  shipTo: ["Hollow Pine Tablet Co.", "Receiving Dock 2", "18 Quarry Lane", "Hollow Pine"],
  billTo: ["Acme Holdings", "Accounts Payable", "(Hollow Pine Tablet Co.)"],
  item: "NG-ASC-FG",
  description: "Ascorbic acid, fine granular",
  ordered: "700 kg",
  shipped: "700 kg",
  backOrdered: "0",
  packaging: "28 bags × 25 kg, 1 pallet",
  supplierLot: "NG-24-8812",
  mfgRetest: "09/2026 / 09/2028",
  netWeight: "700.0 kg",
  grossWeight: "734.2 kg",
  receivedNote: "Rec'd 28 bags / 1 plt. Seals OK. T.R. 11/16",
};

export const PACKING_SLIPS: readonly PackingSlipSpec[] = [
  SLIP,
  {
    ...SLIP,
    slipNo: "NG-PS-60417-X",
    shipped: "675 kg",
    backOrdered: "25 kg",
    packaging: "27 bags × 25 kg, 1 pallet",
    netWeight: "675.0 kg",
    grossWeight: "709.1 kg",
    receivedNote: "Rec'd 27 bags / 1 plt. Seals OK. T.R. 11/16",
  },
];
