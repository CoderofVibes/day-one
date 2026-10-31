// world.config: every parameter of the twelve-month world (docs/UPGRADE_BRIEF.md §2.1). Each
// generated number traces back to a rule here; change the world by changing this file and
// running `npm run world`. The reference data (materials, products, vendors, list prices) is the
// seed's own (server/src/seed/reference.ts) and is not repeated here.
//
// The timeline, as the data has it (not as the brief guessed it):
//   2025-12-01 ─ legacy, generated ─ 2026-07-05 │ 2026-07-06 ─ the seed (anchors) ─ 2026-11-16 │ simulated ─ 2026-12-28
// The seed already holds Hollow Pine's history from Jul 6 (server/src/seed/production.ts and
// the hand-written records), and the recorded run moves the clock from Nov 9 13:00 (T0, Kevin's
// first day) to Nov 16 16:05 (ASC-261116-01 released by QC). The generator writes the seven
// months before the seed and six weeks after the recorded run; the window between is anchored.

import type { ProductCode } from "./types.ts";

/** Change it and the whole world changes; the invariants still hold (world.test.ts). */
export const WORLD_SEED = "hollow-pine/2026-v1";

export const CALENDAR = {
  /** Twelve full months to Nov 30, 2026, the month the recorded run sits in. */
  start: "2025-12-01",
  /** The first day of the seed's own history (production.ts HISTORY_START): the anchor window opens. */
  spliceIn: "2026-07-06",
  /** Kevin's first day at Hollow Pine: the demo clock starts 2026-11-09T13:00Z (DEMO_CLOCK). */
  t0: "2026-11-09",
  /** The day of the recorded run's last event (ASC-261116-01 released, 16:05). */
  recordedEnd: "2026-11-16",
  /** Six weeks of simulated continuation after the recorded run. */
  end: "2026-12-28",
  /**
   * Plant holidays (fictional calendar): no batches, receipts or payments. The two late-December
   * days of each year are the holiday shutdown (incident INC-10).
   */
  holidays: [
    "2025-12-24",
    "2025-12-25",
    "2026-01-01",
    "2026-05-25",
    "2026-07-03",
    "2026-12-24",
    "2026-12-25",
  ],
} as const;

/**
 * Monthly demand multipliers, January first (§2.1.6). "winter" peaks ×1.45 in January against
 * the summer months; "newYear" is the January resolution bump that fades by March; "summer"
 * is hydration; "flat" is flat (a trend may still apply).
 */
export const PROFILES = {
  winter: [1.45, 1.4, 1.22, 1.08, 1.0, 1.0, 1.0, 1.0, 1.04, 1.18, 1.32, 1.42],
  newYear: [1.3, 1.12, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  summer: [0.85, 0.85, 0.92, 1.0, 1.1, 1.22, 1.3, 1.25, 1.08, 0.95, 0.9, 0.85],
  flat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
} as const;
export type ProfileName = keyof typeof PROFILES;

/** Weekly multiplicative demand noise: uniform in ±8%. */
export const WEEKLY_NOISE = 0.08;

export interface ProductParams {
  product: ProductCode;
  /**
   * Batches a month at a multiplier of 1, calibrated on the seed's own Jul–Oct runs (Vitamin C
   * every two weeks, electrolyte weekly, and so on), so the generated months meet the anchors.
   */
  batchesPerMonth: number;
  profile: ProfileName;
  /** Compound growth per month, e.g. 0.01 for the probiotic's +1%/month. */
  trendPerMonth: number;
}

export interface PlantParams {
  /** The facility code in the ledger. */
  facility: "B";
  name: string;
  /** Legacy document prefixes: the paper PO book and the receiving log before Day One. */
  legacyPrefix: string;
  products: readonly ProductParams[];
  /**
   * Production builds ahead of demand by this many days, so the Vitamin C peak in January
   * pulls ascorbic acid buying into Nov–Dec (§2.1.6).
   */
  buildAheadDays: number;
  /** A product is not run again within this many days of its last batch. */
  minGapDays: number;
  /** Legacy buying: Ray reviewed stock on Mondays and ordered what looked short. */
  legacy: {
    reviewWeekday: number;
    /** Legacy orders were rounded up generously: over-ordering (§2.1.2). */
    overOrderFactor: number;
    /** Reorder point multipliers per material; ascorbic acid's was set for summer (INC-01). */
    reorderPointFactor: Readonly<Record<string, number>>;
    /**
     * Materials the paper sheet looked only one review week ahead for in these months (1 =
     * January), not over the lead time: fine in summer, short in winter.
     */
    weekAheadOnly: { materials: readonly string[]; months: readonly number[] };
  };
  /** Kevin's buying from T0: reviews every working day against the seed's reorder points. */
  kevin: {
    perPoLimitUsd: number;
    monthlyLimitUsd: number;
    approver: string;
  };
}

/**
 * Hollow Pine, Plant B. Riverside and Lakeview are added in M3 with their own PlantParams; the
 * engine takes any of them.
 */
export const HOLLOW_PINE: PlantParams = {
  facility: "B",
  name: "Hollow Pine Tablet Co.",
  legacyPrefix: "HP",
  products: [
    // Vitamin C ran every two weeks Jul–Sep in the seed: two a month at summer demand.
    { product: "P-VC500", batchesPerMonth: 2.1, profile: "winter", trendPerMonth: 0 },
    { product: "P-CMD", batchesPerMonth: 1.1, profile: "flat", trendPerMonth: 0 },
    // Electrolyte ran weekly through summer in the seed (≈4.3 a month at ×1.3): 3.3 at ×1.
    { product: "P-ELX", batchesPerMonth: 3.3, profile: "summer", trendPerMonth: 0 },
    { product: "P-ZN50", batchesPerMonth: 1.0, profile: "winter", trendPerMonth: 0 },
    { product: "P-MEL5", batchesPerMonth: 1.0, profile: "flat", trendPerMonth: 0 },
    { product: "P-PRO", batchesPerMonth: 2.0, profile: "flat", trendPerMonth: 0.01 },
    { product: "P-FBR", batchesPerMonth: 2.0, profile: "newYear", trendPerMonth: 0 },
  ],
  buildAheadDays: 18,
  minGapDays: 4,
  legacy: {
    reviewWeekday: 1,
    overOrderFactor: 1.15,
    // INC-01: "a reorder point set 9 days too low for winter". The paper sheet kept ascorbic
    // acid's summer reorder point, about nine days of January use short.
    reorderPointFactor: { ASC: 0.3 },
    weekAheadOnly: { materials: ["ASC"], months: [12, 1, 2] },
  },
  // FICTIONAL_DATA.md §9: the policy Acme set for Kevin at Plant B.
  kevin: { perPoLimitUsd: 2_500, monthlyLimitUsd: 60_000, approver: "Linda Park" },
};

export interface SupplierParams {
  /** Days from order to delivery: mean and standard deviation. */
  leadDays: { mean: number; sd: number };
  /** Chance a delivery arrives on its promised day; late ones run 2–6 days over. */
  onTimeRate: number;
  /** Chance a received lot passes QC. */
  qcPassRate: number;
  /** Chance a delivery comes in two parts, 70% then the rest four days later. */
  partialRate: number;
  /** Freight charged per PO, dollars. */
  freightUsd: number;
  /** The supplier's invoice numbering, as their paper invoices show it. */
  invoicePrefix: string;
  invoiceStart: number;
}

/**
 * Supplier behaviour. Lead times follow the seed (a week for most, five days for Ridgeway's
 * quote on RFQ-2611-01); freight follows the recorded quotes ($180 Northgate, $165 Ridgeway).
 * Invoice numbers start below every number the ERP's history uses (erp/src/seed/history.ts).
 */
export const SUPPLIERS: Readonly<Record<string, SupplierParams>> = {
  NGI: s(7, 1.2, 0.93, 0.99, 0.08, 180, "NG-INV-", 23_100),
  RWA: s(5, 1.0, 0.95, 0.99, 0.05, 165, "RWA-", 7_100),
  SMS: s(8, 1.5, 0.88, 0.98, 0.1, 140, "SMS-", 9_200),
  PEC: s(6, 1.0, 0.92, 0.97, 0.06, 95, "PEC-", 54_100),
  FPO: s(7, 1.2, 0.92, 0.97, 0.06, 120, "FP-2026-", 101),
  OFH: s(6, 1.0, 0.95, 0.99, 0.02, 45, "OFH-", 2_900),
  DDN: s(10, 2.0, 0.85, 0.96, 0.05, 60, "DDN-", 600),
  LOW: s(9, 1.5, 0.9, 0.995, 0.12, 210, "LP-", 86_100),
  CPL: s(6, 1.0, 0.95, 0.995, 0.03, 40, "CPL-", 4_100),
  HBX: s(5, 1.0, 0.95, 0.995, 0.03, 75, "HBX-", 1_200),
  BLS: s(3, 0.5, 0.97, 0.995, 0.0, 0, "BLS-", 30_100),
  HFC: s(8, 1.5, 0.94, 0.99, 0.0, 35, "HFC-", 410),
  BWC: s(6, 1.0, 0.94, 0.97, 0.0, 120, "BWC-", 1_800),
  KCC: s(10, 2.0, 0.9, 0.99, 0.08, 110, "KCC-", 3_300),
  PFM: s(9, 1.5, 0.9, 0.98, 0.1, 260, "PFM-", 5_500),
  NFC: s(8, 1.5, 0.93, 0.995, 0.05, 70, "NFC-", 2_200),
  CNP: s(8, 1.5, 0.93, 0.99, 0.0, 60, "CNP-", 700),
};

function s(
  mean: number,
  sd: number,
  onTimeRate: number,
  qcPassRate: number,
  partialRate: number,
  freightUsd: number,
  invoicePrefix: string,
  invoiceStart: number,
): SupplierParams {
  return {
    leadDays: { mean, sd },
    onTimeRate,
    qcPassRate,
    partialRate,
    freightUsd,
    invoicePrefix,
    invoiceStart,
  };
}

export const PRICES = {
  /**
   * Legacy prices drift up to the seed's list price (reference.ts LIST_PRICE, what every PO from
   * Aug 24 on pays) by this much a year: a price on Dec 1 is about 2% under list.
   */
  annualDrift: 0.02,
  /**
   * Prices that are not list before the splice. Ascorbic acid was $6.40/kg until the price hike
   * of Aug–Sep (INC-06, inside the anchor window) took it to the $7.10 PO-1042 pays.
   */
  legacyOverride: { ASC: 6.4 } as Readonly<Record<string, number>>,
  /**
   * Price drift nobody caught (§2.1.2): steps a supplier put through on its invoices that the
   * paper process never questioned. Kevin's look-back finds them with the books' drift rule.
   */
  legacySteps: [
    { material: "SIO", vendor: "PEC", from: "2026-03-02", factor: 1.12 },
    { material: "SUC", vendor: "OFH", from: "2026-02-02", factor: 1.11 },
  ] as const,
  /**
   * Kevin's quotes: each invited supplier quotes its current price times a spread drawn in this
   * band. Northgate's and Ridgeway's spreads are the recorded RFQ-2611-01 ($7.10 and $7.35).
   */
  quoteSpread: { lo: 0.0, hi: 0.06 },
  recordedQuote: { NGI: 7.1, RWA: 7.35 } as Readonly<Record<string, number>>,
};

/** Batches: yields, consumption noise and how often a batch over-consumes (§2.1.6). */
export const PRODUCTION = {
  /** Each formula line is weighed out within this relative standard deviation. */
  weighNoiseSd: 0.002,
  /** Chance a batch over-issues one line by 3–6%: what Kevin's look-back flags as waste. */
  overConsumptionRate: 0.05,
  overConsumption: { lo: 0.03, hi: 0.06 },
  /** QC releases a received lot this many days after receipt, at 16:00 (production.ts). */
  releaseDays: 2,
  /** A rejected lot goes back to the supplier after this many days; a replacement follows. */
  returnDays: 2,
  replacementDays: 7,
};

/** Rush buying when a batch finds a material short (INC-01 shows it once). */
export const RUSH = {
  /** The alternate source by material; anything else rushes from its primary vendor. */
  alternate: { ASC: "RWA" } as Readonly<Record<string, string>>,
  /** Rush freight, dollars: a next-day truck. */
  freightUsd: 1_180,
  /** Rush lots are tested on arrival and released the same afternoon. */
  leadDays: 1,
};

/** Accounts payable: legacy bills arrive by mail, Kevin-era bills with the receipt. */
export const AP = {
  /** Days from receipt to the supplier's bill (legacy, uniform). */
  billLagDays: { lo: 1, hi: 5 },
  /** Net 30 for every supplier. */
  termsDays: 30,
  /** The ERP's duplicate window (erp/src/seed/data.ts SETTINGS.duplicateWindowDays). */
  duplicateWindowDays: 30,
  /** The ERP's match tolerances (erp/src/seed/data.ts SETTINGS). */
  tolerances: { poQtyBp: 200, poAmtBp: 100, irQtyDifferenceBase: 0 },
};

/**
 * Customers (§2.1.4). The first five are the ones on Ray's "Sales by customer" tab
 * (FICTIONAL_DATA.md §14); the last three are new, generic and fictional. `share` splits each
 * product's weekly demand; Vitamin C's shares are the tab's October tablets.
 */
export const CUSTOMERS: readonly {
  code: string;
  name: string;
  termsDays: number;
  share: Readonly<Partial<Record<ProductCode, number>>>;
}[] = [
  {
    code: "CMT",
    name: "Cardinal Mart",
    termsDays: 30,
    share: { "P-VC500": 0.405, "P-CMD": 0.3, "P-ZN50": 0.3, "P-MEL5": 0.35 },
  },
  {
    code: "PBX",
    name: "PillBox Pharmacy",
    termsDays: 30,
    share: { "P-VC500": 0.244, "P-CMD": 0.25, "P-PRO": 0.3, "P-MEL5": 0.25 },
  },
  {
    code: "BWG",
    name: "Brightway Grocers",
    termsDays: 30,
    share: { "P-VC500": 0.086, "P-ELX": 0.35, "P-FBR": 0.4 },
  },
  {
    code: "WEB",
    name: "Online store",
    termsDays: 0,
    share: { "P-VC500": 0.185, "P-PRO": 0.3, "P-FBR": 0.2, "P-ZN50": 0.2 },
  },
  { code: "EUD", name: "EU distributor", termsDays: 45, share: { "P-VC500": 0.08, "P-ZN50": 0.2 } },
  {
    code: "CLC",
    name: "Cedar Lane Pharmacy Co-op",
    termsDays: 30,
    share: { "P-CMD": 0.25, "P-PRO": 0.4, "P-MEL5": 0.4, "P-ZN50": 0.3 },
  },
  {
    code: "SHD",
    name: "Summit Health Distributors",
    termsDays: 45,
    share: { "P-CMD": 0.2, "P-ELX": 0.4, "P-FBR": 0.4 },
  },
  { code: "HNF", name: "Harborview Natural Foods", termsDays: 30, share: { "P-ELX": 0.25 } },
];

export const SALES = {
  /** Customers order weekly and the dock ships on this weekday (4 = Thursday). */
  shipWeekday: 4,
  /** Finished goods are released for shipping this many days after their batch. */
  fgReleaseDays: 2,
  /** Opening finished goods on the first day: this many weeks of demand per product. */
  openingWeeks: 2,
  /** Invoice price per thousand units (tablets, capsules or canisters), dollars; fictional. */
  pricePerThousand: {
    "P-VC500": 41,
    "P-CMD": 36,
    "P-ELX": 62,
    "P-ZN50": 28,
    "P-MEL5": 19,
    "P-PRO": 118,
    "P-FBR": 5_600,
    "P-BCX": 44,
    "P-MG100": 52,
    "P-D3K": 17,
  } as Readonly<Record<ProductCode, number>>,
  /** Customers pay up to this many days after the due date (uniform). */
  payLateDays: { lo: 0, hi: 9 },
};

export type Incident =
  | {
      id: string;
      type: "stockout";
      title: string;
      /** The day the batch finds the material short. */
      date: string;
      material: string;
      /** The reorder that ran late: the first one placed in this window is delayed. */
      lateOrder: { from: string; to: string; vendor: string; extraDays: number };
      narrative: string;
    }
  | {
      id: string;
      type: "duplicate_invoice";
      title: string;
      /** The first bill dated on or after this day is keyed in twice and paid twice. */
      date: string;
      vendor: string;
      /** The second copy's invoice number, as it was keyed from the paper. */
      reKeyedAs: (invoiceNo: string) => string;
      narrative: string;
    }
  | {
      id: string;
      type: "freight_surcharge";
      title: string;
      date: string;
      endsAt: string;
      category: "packaging";
      surchargeUsd: number;
      narrative: string;
    }
  | {
      id: string;
      type: "shutdown";
      title: string;
      date: string;
      endsAt: string;
      narrative: string;
    };

/**
 * Hollow Pine's named incidents in the generated months (§2.1.7 #1, #3, #9, #10). The others
 * sit in the anchor window (the price hike, QuickChem's suspension), belong to Riverside or
 * Lakeview (M3) or are on demand (the mock recall notice).
 */
export const INCIDENTS: readonly Incident[] = [
  {
    id: "INC-01",
    type: "stockout",
    title: "January ascorbic acid stockout",
    date: "2026-01-15",
    material: "ASC",
    lateOrder: { from: "2025-12-21", to: "2026-01-02", vendor: "NGI", extraDays: 10 },
    narrative:
      "Winter Vitamin C demand outran a reorder point set for summer, and Northgate's New Year " +
      "truck ran ten days late. A Vitamin C batch waited two days for a rush order from " +
      "Ridgeway Ascorbics with $1,180 of next-day freight.",
  },
  {
    id: "INC-03",
    type: "duplicate_invoice",
    title: "Duplicate invoice paid",
    date: "2026-04-13",
    vendor: "PEC",
    reKeyedAs: (no) => `${no.replace("-", " ")}.`,
    narrative:
      "A Pacific Excipient invoice was keyed in twice from paper, the second time with a space " +
      "and a stray full stop, and both copies were paid. The amount is recoverable.",
  },
  {
    id: "INC-09",
    type: "freight_surcharge",
    title: "Packaging freight surcharge",
    date: "2026-05-01",
    endsAt: "2026-07-31",
    category: "packaging",
    surchargeUsd: 85,
    narrative: "Packaging carriers added a fuel surcharge of $85 a delivery from May through July.",
  },
  {
    id: "INC-10",
    type: "shutdown",
    title: "Holiday shutdown",
    date: "2025-12-24",
    endsAt: "2025-12-25",
    narrative: "The plant closes for two days at the end of December: no batches, no trucks.",
  },
  {
    id: "INC-10-2026",
    type: "shutdown",
    title: "Holiday shutdown",
    date: "2026-12-24",
    endsAt: "2026-12-25",
    narrative: "The plant closes for two days at the end of December: no batches, no trucks.",
  },
];

export interface WorldConfig {
  seed: string;
  calendar: typeof CALENDAR;
  plant: PlantParams;
  suppliers: typeof SUPPLIERS;
  incidents: readonly Incident[];
}

export const WORLD: WorldConfig = {
  seed: WORLD_SEED,
  calendar: CALENDAR,
  plant: HOLLOW_PINE,
  suppliers: SUPPLIERS,
  incidents: INCIDENTS,
};
