// Lots at demo start (docs/FICTIONAL_DATA.md §6 and §8), written as lot events with fixed
// timestamps so every seeded run produces the same hash chain. The demo clock starts at
// 2026-11-09T13:00:00Z (DEMO_SCRIPT.md); every event here is earlier.

import type { LotEventKind } from "../ledger/schema.ts";
import type { FacilityCode } from "./reference.ts";

export interface Step {
  kind: LotEventKind;
  /** Signed quantity in the material's inventory UoM (kg or ea); omitted means zero. */
  qty?: number;
  at: string;
  /** Defaults to the lot's home facility. */
  facility?: FacilityCode;
  reason?: string;
  transfer?: string;
}

export interface LotSpec {
  code: string;
  material: string;
  vendor: string;
  facility: FacilityCode;
  steps: Step[];
}

export interface TransferSpec {
  transferNo: string;
  lot: string;
  from: FacilityCode;
  to: FacilityCode;
  shipped: number;
  received: number;
}

/** "ASC-261009-01" → "2026-10-09" (the lot code carries the receipt date). */
function receiptDate(code: string) {
  const yymmdd = code.split("-")[1] ?? "";
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function plusDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const t = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

/** Received, sampled into quarantine, released by QC two days later. */
function receivedAndReleased(qty: number, date: string): Step[] {
  return [
    { kind: "received", qty, at: t(date, "14:00") },
    { kind: "quarantined", at: t(date, "14:30") },
    { kind: "released", at: t(plusDays(date, 2), "16:00") },
  ];
}

/** A lot received on the date in its code and released, holding `qty` at `facility`. */
function stocked(
  code: string,
  vendor: string,
  facility: FacilityCode,
  qty: number,
  extra: Step[] = [],
): LotSpec {
  const material = code.split("-")[0] ?? "";
  return {
    code,
    material,
    vendor,
    facility,
    steps: [...receivedAndReleased(qty, receiptDate(code)), ...extra],
  };
}

export const TRANSFERS: readonly TransferSpec[] = [
  // §8: Plant A's paperwork says 8 bags × 25 kg; Plant B weighed in 187.450 kg. Plant A's book
  // keeps 12.550 kg of phantom stock that Kevin finds when BR-B-1045 consumes the lot.
  {
    transferNo: "TR-A-B-261102",
    lot: "ASC-261009-01",
    from: "A",
    to: "B",
    shipped: 200,
    received: 187.45,
  },
];

export const LOTS: readonly LotSpec[] = [
  // Ascorbic acid at Plant B: 187.450 + 534.900 = 722.350 kg on hand before BR-B-1045 (§6).
  {
    code: "ASC-261009-01",
    material: "ASC",
    vendor: "NGI",
    facility: "A",
    steps: [
      ...receivedAndReleased(225, "2026-10-09"), // 9 bags × 25 kg at Plant A
      { kind: "issued", at: t("2026-10-20", "09:00") },
      {
        kind: "consumed",
        qty: -12.45,
        at: t("2026-10-20", "09:30"),
        reason: "Plant A weigh & dispense draw",
      },
      { kind: "returned", at: t("2026-10-20", "11:00") },
      { kind: "transfer_out", qty: -200, at: t("2026-11-02", "10:00"), transfer: "TR-A-B-261102" },
      {
        kind: "transfer_in",
        qty: 187.45,
        at: t("2026-11-03", "15:00"),
        facility: "B",
        transfer: "TR-A-B-261102",
      },
      { kind: "issued", at: t("2026-11-06", "08:00"), facility: "B" },
    ],
  },
  stocked("ASC-260921-02", "RWA", "B", 700, [
    { kind: "issued", at: t("2026-10-01", "08:00") },
    { kind: "consumed", qty: -165.1, at: t("2026-10-01", "10:00") },
    { kind: "returned", at: t("2026-10-01", "15:00") },
  ]),

  // Other actives and excipients, stocked above their reorder points.
  stocked("CTA-261015-01", "NGI", "B", 650),
  stocked("KCT-261015-01", "NGI", "B", 280),
  stocked("CAC-261020-01", "SMS", "B", 1_600),
  stocked("CAC-261022-01", "SMS", "A", 1_200),
  {
    // §6: one CAC lot en route from Sierra to Plant A.
    code: "CAC-261111-01",
    material: "CAC",
    vendor: "SMS",
    facility: "A",
    steps: [
      { kind: "ordered", at: t("2026-11-02", "11:00") },
      { kind: "shipped", at: t("2026-11-08", "17:00") },
    ],
  },
  stocked("MGO-261020-01", "SMS", "B", 300),
  stocked("VD3-261001-01", "DDN", "B", 8),
  {
    // §6: one VD3 lot on order from Delta D, the conditional vendor.
    code: "VD3-261123-01",
    material: "VD3",
    vendor: "DDN",
    facility: "B",
    steps: [{ kind: "ordered", at: t("2026-11-06", "10:00") }],
  },
  stocked("SBC-261020-01", "SMS", "B", 600),
  stocked("NAC-261020-01", "SMS", "B", 30),
  stocked("SOR-261012-01", "FPO", "B", 1_200),
  stocked("MAN-261012-01", "FPO", "B", 450),
  stocked("MCC-261016-01", "PEC", "B", 600),
  stocked("MCC-261016-02", "PEC", "A", 400),
  stocked("CCS-261016-01", "PEC", "B", 60),
  stocked("STA-261016-01", "PEC", "B", 45),
  stocked("MGS-261016-01", "PEC", "B", 40),
  {
    // §6: one MGS lot at Plant B waiting for QC.
    code: "MGS-261106-01",
    material: "MGS",
    vendor: "PEC",
    facility: "B",
    steps: [
      { kind: "received", qty: 50, at: t("2026-11-06", "14:00") },
      { kind: "quarantined", at: t("2026-11-06", "14:30") },
    ],
  },
  stocked("SIO-261016-01", "PEC", "B", 30),
  stocked("PEG-261016-01", "PEC", "B", 60),
  stocked("FOR-261019-01", "OFH", "B", 30),
  stocked("FLL-261019-01", "OFH", "B", 30),
  stocked("SUC-261019-01", "OFH", "B", 12),

  // Packaging is stocked at Plant C (§4).
  stocked("BTL-261005-01", "LOW", "C", 120_000),
  stocked("CAP-261005-01", "LOW", "C", 120_000),
  stocked("DES-261005-01", "LOW", "C", 120_000),
  stocked("TUB-261005-01", "LOW", "C", 45_000),
  stocked("TDC-261005-01", "LOW", "C", 45_000),
  stocked("LVC-261007-01", "CPL", "C", 60_000),
  stocked("LCM-261007-01", "CPL", "C", 60_000),
  stocked("LEX-261007-01", "CPL", "C", 45_000),
  stocked("SHC-261008-01", "HBX", "C", 6_000),

  // QC lab chemicals at Plant B; acetonitrile and buffer are low, which PO-1041 restocks.
  stocked("ACN-260915-01", "BLS", "B", 1),
  stocked("MEO-260915-01", "BLS", "B", 4),
  stocked("PHA-260915-01", "BLS", "B", 2),
  stocked("BUF-260915-01", "BLS", "B", 2),
  stocked("RSA-260915-01", "BLS", "B", 2),
];
