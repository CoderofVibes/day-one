// Lots at demo start (docs/FICTIONAL_DATA.md §6, §8, §10), written as lot events with fixed
// timestamps so every seeded run produces the same hash chain. The demo clock starts at
// 2026-11-09T13:00:00Z (DEMO_SCRIPT.md); every event here is earlier.
//
// Lots received before 2026-10-01 are opening stock. Lots received from Oct 1 come from the six
// history POs (history.ts) or, at Plant A, from Acme's own buying. Batch draws are not listed
// here: history.ts books them first-in, first-out from released lots.

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
}

export interface LotSpec {
  code: string;
  material: string;
  vendor: string;
  facility: FacilityCode;
  /** The history PO this lot was received on (history.ts). */
  po?: string;
  steps: Step[];
}

export interface TransferSpec {
  transferNo: string;
  lot: string;
  from: FacilityCode;
  to: FacilityCode;
  shipped: number;
  received: number;
  shippedAt: string;
  receivedAt: string;
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

export const t = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

/** Received, sampled into quarantine, released by QC two days later. */
function receivedAndReleased(qty: number, date: string): Step[] {
  return [
    { kind: "received", qty, at: t(date, "14:00") },
    { kind: "quarantined", at: t(date, "14:30") },
    { kind: "released", at: t(plusDays(date, 2), "16:00") },
  ];
}

/** A lot received on the date in its code and released. */
function stocked(
  code: string,
  vendor: string,
  facility: FacilityCode,
  qty: number,
  extra: { po?: string; steps?: Step[] } = {},
): LotSpec {
  const material = code.split("-")[0] ?? "";
  return {
    code,
    material,
    vendor,
    facility,
    ...(extra.po ? { po: extra.po } : {}),
    steps: [...receivedAndReleased(qty, receiptDate(code)), ...(extra.steps ?? [])],
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
    shippedAt: t("2026-11-02", "10:00"),
    receivedAt: t("2026-11-03", "15:00"),
  },
  // §10: four packaging transfers from Plant C, received in full.
  ...(
    [
      ["TR-C-B-261009", "BTL-260905-01", "B", 24_000, "2026-10-09"],
      ["TR-C-B-261010", "CAP-260905-01", "B", 24_000, "2026-10-10"],
      ["TR-C-A-261012", "LCM-260907-01", "A", 15_000, "2026-10-12"],
      ["TR-C-B-261020", "LVC-260907-01", "B", 20_000, "2026-10-20"],
    ] as const
  ).map(([transferNo, lot, to, qty, date]) => ({
    transferNo,
    lot,
    from: "C" as const,
    to,
    shipped: qty,
    received: qty,
    shippedAt: t(date, "07:00"),
    receivedAt: t(date, "13:00"),
  })),
];

export const LOTS: readonly LotSpec[] = [
  // Ascorbic acid at Plant B: 187.450 + 534.900 = 722.350 kg on hand before BR-B-1045 (§6).
  // BR-B-1033 and BR-B-1036 use up ASC-260828-01; BR-B-1036 takes its last 165.100 kg from
  // ASC-260921-02 (history.ts).
  stocked("ASC-260828-01", "NGI", "B", 658.9),
  stocked("ASC-260921-02", "RWA", "B", 700),
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
      // Transferred to Plant B on Nov 2–3 (TR-A-B-261102), then staged for BR-B-1045.
      { kind: "issued", at: t("2026-11-06", "08:00"), facility: "B" },
    ],
  },

  // Plant B actives and excipients. Opening stock, then the history POs.
  stocked("CTA-260901-01", "NGI", "B", 1_320),
  stocked("KCT-260918-01", "NGI", "B", 550),
  stocked("CAC-261014-01", "SMS", "B", 1_500, { po: "PO-1039" }),
  stocked("MGO-261014-01", "SMS", "B", 250, { po: "PO-1039" }),
  stocked("VD3-260920-01", "DDN", "B", 10),
  stocked("SBC-260918-01", "SMS", "B", 1_140),
  stocked("NAC-260918-01", "SMS", "B", 48),
  stocked("SOR-260901-01", "FPO", "B", 1_600),
  stocked("SOR-261004-01", "FPO", "B", 1_000, { po: "PO-1036" }),
  stocked("MAN-260918-01", "FPO", "B", 918),
  stocked("MCC-260901-01", "PEC", "B", 500),
  stocked("MCC-261001-01", "PEC", "B", 500, { po: "PO-1035" }),
  stocked("CCS-260915-01", "PEC", "B", 75),
  {
    // §10: the past QC rejection. Loss on drying out of limits; the lot went back to Pacific.
    code: "CCS-261023-01",
    material: "CCS",
    vendor: "PEC",
    facility: "B",
    steps: [
      { kind: "received", qty: 50, at: t("2026-10-23", "14:00") },
      { kind: "quarantined", at: t("2026-10-23", "14:30") },
      { kind: "rejected", at: t("2026-10-24", "11:00"), reason: "Loss on drying above limit" },
      {
        kind: "wasted",
        qty: -50,
        at: t("2026-10-26", "10:00"),
        reason: "Returned to vendor after QC rejection",
      },
    ],
  },
  stocked("STA-260915-01", "PEC", "B", 55),
  stocked("MGS-260901-01", "PEC", "B", 40),
  stocked("MGS-261001-01", "PEC", "B", 50, { po: "PO-1035" }),
  stocked("MGS-261021-01", "PEC", "B", 50, { po: "PO-1040" }),
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
  stocked("SIO-260901-01", "PEC", "B", 42.8),
  stocked("PEG-260918-01", "PEC", "B", 114),
  stocked("FOR-260901-01", "OFH", "B", 60),
  stocked("FOR-261011-01", "OFH", "B", 25, { po: "PO-1038" }),
  stocked("FLL-260918-01", "OFH", "B", 66),
  stocked("SUC-260901-01", "OFH", "B", 25),
  {
    // §6: one VD3 lot on order from Delta D, the conditional vendor.
    code: "VD3-261123-01",
    material: "VD3",
    vendor: "DDN",
    facility: "B",
    steps: [{ kind: "ordered", at: t("2026-11-06", "10:00") }],
  },

  // Plant A, for its P-CMD batches. Calcium carbonate runs low, so more is on the way.
  stocked("CAC-260925-01", "SMS", "A", 1_500),
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
  stocked("MCC-260925-01", "PEC", "A", 600),
  stocked("MGO-260925-01", "SMS", "A", 300),
  stocked("CCS-260925-01", "PEC", "A", 50),
  stocked("STA-260925-01", "PEC", "A", 40),
  stocked("MGS-260925-01", "PEC", "A", 40),
  stocked("VD3-260920-02", "DDN", "A", 8),

  // Packaging is stocked at Plant C (§4) and transferred to A and B.
  stocked("BTL-260905-01", "LOW", "C", 60_000),
  stocked("BTL-261007-01", "LOW", "C", 100_000, { po: "PO-1037" }),
  stocked("CAP-260905-01", "LOW", "C", 120_000),
  stocked("DES-260905-01", "LOW", "C", 120_000),
  stocked("TUB-260905-01", "LOW", "C", 45_000),
  stocked("TDC-260905-01", "LOW", "C", 45_000),
  stocked("LVC-260907-01", "CPL", "C", 60_000),
  stocked("LCM-260907-01", "CPL", "C", 60_000),
  stocked("LEX-260907-01", "CPL", "C", 45_000),
  stocked("SHC-260908-01", "HBX", "C", 6_000),

  // QC lab chemicals at Plant B; acetonitrile and buffer are low, which PO-1041 restocks.
  stocked("ACN-260915-01", "BLS", "B", 1),
  stocked("MEO-260915-01", "BLS", "B", 4),
  stocked("PHA-260915-01", "BLS", "B", 2),
  stocked("BUF-260915-01", "BLS", "B", 2),
  stocked("RSA-260915-01", "BLS", "B", 2),
];
