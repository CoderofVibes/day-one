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

export interface CalendarParams {
  start: string;
  spliceIn: string;
  t0: string;
  recordedEnd: string;
  end: string;
  holidays: readonly string[];
}

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
} as const satisfies CalendarParams;

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
  /**
   * Riverside's Vitamin C: Acme moves Vitamin C batches there only in the late-winter peak, to
   * balance load (as it moves BR-A-2210 in November, FICTIONAL_DATA.md §16).
   */
  lateWinterOnly: [0, 0, 1.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0],
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
  /** The day the product's line started at the plant: no demand before it. */
  startsOn?: string;
}

export interface PlantParams {
  /** The facility code in the ledger. */
  facility: "A" | "B" | "C";
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
  /** Legacy buying: a weekly stock review that ordered what looked short. */
  legacy: {
    reviewWeekday: number;
    /** Who signed legacy POs, and on what. */
    approver: string;
    rule: string;
    /** The stock count that hands the legacy books over to the anchors. */
    countLabel: string;
    /** Legacy orders were rounded up generously: over-ordering (§2.1.2). */
    overOrderFactor: number;
    /** Reorder point multipliers per material; ascorbic acid's was set for summer (INC-01). */
    reorderPointFactor: Readonly<Record<string, number>>;
    /**
     * Materials the paper sheet looked only one review week ahead for in these months (1 =
     * January), not over the lead time: fine in summer, short in winter.
     */
    weekAheadOnly: { materials: readonly string[]; months: readonly number[] };
    /** Orders for a material went to another supplier in these days (both included). */
    vendorOverride?: readonly { material: string; vendor: string; from: string; to: string }[];
  };
  /** Kevin's buying from T0: reviews every working day against the seed's reorder points. */
  kevin: {
    perPoLimitUsd: number;
    monthlyLimitUsd: number;
    approver: string;
    /** Kevin-era numbering: POs, receipts and payments ("IR-S-" + tag), RFQs. */
    poPrefix: string;
    firstPo: number;
    docTag: string;
    rfqPrefix: string;
  };
  /**
   * A packaging plant (Lakeview): it makes nothing and stages these materials for the batches of
   * the products listed at the other plants, two working days before each batch, as transfers.
   */
  packs?: {
    serves: Readonly<Partial<Record<ProductCode, readonly string[]>>>;
    leadDays: number;
  };
}

/** Hollow Pine, Plant B. */
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
    approver: "Ray Delgado",
    rule: "paper PO book",
    countLabel: "cutover count",
    overOrderFactor: 1.15,
    // INC-01: "a reorder point set 9 days too low for winter". The paper sheet kept ascorbic
    // acid's summer reorder point, about nine days of January use short.
    reorderPointFactor: { ASC: 0.3 },
    weekAheadOnly: { materials: ["ASC"], months: [12, 1, 2] },
    // After Northgate's New Year truck ran late (INC-01), Ray bought ascorbic acid from
    // Ridgeway until spring; one of those lots is the mock recall notice's (INC-08).
    vendorOverride: [{ material: "ASC", vendor: "RWA", from: "2026-01-19", to: "2026-03-31" }],
  },
  // FICTIONAL_DATA.md §9: the policy Acme set for Kevin at Plant B.
  kevin: {
    perPoLimitUsd: 2_500,
    monthlyLimitUsd: 60_000,
    approver: "Linda Park",
    poPrefix: "PO-",
    firstPo: 1048,
    docTag: "",
    rfqPrefix: "RFQ-",
  },
};

/**
 * Acme Riverside, Plant A: a tablet plant on Acme's systems since Jan 1 (seed/index.ts
 * ONLINE_SINCE), two thirds of Hollow Pine's size. The seed runs magnesium weekly, D3 and
 * B-complex every two weeks and Cal-Mag from October (production.ts); Vitamin C runs there only
 * at the late-winter peak. Its Kevin starts with Hollow Pine's (FICTIONAL_DATA.md §16: one Kevin
 * per plant, $2,500 per PO, approved by the plant's director, Dana Whitfield).
 */
export const RIVERSIDE: PlantParams = {
  facility: "A",
  name: "Acme Riverside",
  legacyPrefix: "RV",
  products: [
    { product: "P-MG100", batchesPerMonth: 4.3, profile: "flat", trendPerMonth: 0 },
    { product: "P-D3K", batchesPerMonth: 2.2, profile: "winter", trendPerMonth: 0 },
    { product: "P-BCX", batchesPerMonth: 2.2, profile: "flat", trendPerMonth: 0.005 },
    { product: "P-VC500", batchesPerMonth: 1.5, profile: "lateWinterOnly", trendPerMonth: 0 },
    {
      product: "P-CMD",
      batchesPerMonth: 2.0,
      profile: "flat",
      trendPerMonth: 0,
      startsOn: "2026-10-01",
    },
  ],
  buildAheadDays: 14,
  minGapDays: 4,
  legacy: {
    reviewWeekday: 2,
    approver: "Acme purchasing",
    rule: "Acme ERP approval",
    countLabel: "opening count for Day One",
    overOrderFactor: 1.05,
    // Riverside keeps no ascorbic acid of its own: its Vitamin C runs on stock sent over for them.
    reorderPointFactor: { ASC: 0 },
    weekAheadOnly: { materials: [], months: [] },
  },
  kevin: {
    perPoLimitUsd: 2_500,
    monthlyLimitUsd: 60_000,
    approver: "Dana Whitfield",
    poPrefix: "PO-R-",
    firstPo: 1001,
    docTag: "R-",
    rfqPrefix: "RFQ-R-",
  },
};

/**
 * Acme Lakeview, Plant C: packaging and distribution (FICTIONAL_DATA.md §1: "holds bulk
 * packaging stock for A and B"). No processing and no lab, so it makes nothing: it buys the
 * bottles, caps, desiccants, tubes, labels and shippers the seed stocks there and stages them
 * for the batches at Hollow Pine and Riverside whose packaging the other plants do not stock.
 * Its Kevin buys packaging only, approved by Omar Haddad (FICTIONAL_DATA.md §16).
 */
export const LAKEVIEW: PlantParams = {
  facility: "C",
  name: "Acme Lakeview",
  legacyPrefix: "LV",
  products: [],
  buildAheadDays: 0,
  minGapDays: 0,
  legacy: {
    reviewWeekday: 3,
    approver: "Acme purchasing",
    rule: "Acme ERP approval",
    countLabel: "opening count for Day One",
    overOrderFactor: 1.1,
    reorderPointFactor: {},
    weekAheadOnly: { materials: [], months: [] },
  },
  kevin: {
    perPoLimitUsd: 2_500,
    monthlyLimitUsd: 60_000,
    approver: "Omar Haddad",
    poPrefix: "PO-L-",
    firstPo: 1001,
    docTag: "L-",
    rfqPrefix: "RFQ-L-",
  },
  packs: {
    serves: {
      "P-VC500": ["BTL", "CAP", "DES", "LVC", "SHC"],
      "P-CMD": ["BTL", "CAP", "LCM", "SHC"],
      "P-ELX": ["TUB", "TDC", "LEX", "SHC"],
    },
    leadDays: 2,
  },
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
  // QuickChem only ever shipped two trial lots (INC-05).
  QCD: s(4, 0.5, 0.9, 0.5, 0.0, 0, "QC-", 1_001),
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
/**
 * Supplier scorecards (§2.2), computed by scorecard.ts from every plant's records:
 *   score = 100 × Σ weight·component / Σ weight, over the components the window has data for,
 * each component in 0–1: QC pass rate (released lots / tested lots), on-time rate (on-time
 * receipts / receipts), invoice accuracy (matched bills / bills), price competitiveness (the best
 * qualified supplier's average unit price for the material / this supplier's) and responsiveness
 * (quotes returned / RFQs invited). Two QC rejects in a row override the score: suspended.
 */
export const SCORECARD = {
  weights: {
    qc: 35,
    onTime: 30,
    invoiceAccuracy: 15,
    priceCompetitiveness: 10,
    responsiveness: 10,
  },
  trailingDays: 90,
  yearDays: 365,
  suspendAfterRejects: 2,
} as const;

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
    share: {
      "P-VC500": 0.405,
      "P-CMD": 0.3,
      "P-ZN50": 0.3,
      "P-MEL5": 0.35,
      "P-MG100": 0.3,
      "P-D3K": 0.35,
    },
  },
  {
    code: "PBX",
    name: "PillBox Pharmacy",
    termsDays: 30,
    share: {
      "P-VC500": 0.244,
      "P-CMD": 0.25,
      "P-PRO": 0.3,
      "P-MEL5": 0.25,
      "P-MG100": 0.25,
      "P-D3K": 0.25,
      "P-BCX": 0.3,
    },
  },
  {
    code: "BWG",
    name: "Brightway Grocers",
    termsDays: 30,
    share: { "P-VC500": 0.086, "P-ELX": 0.35, "P-FBR": 0.4, "P-BCX": 0.25 },
  },
  {
    code: "WEB",
    name: "Online store",
    termsDays: 0,
    share: { "P-VC500": 0.185, "P-PRO": 0.3, "P-FBR": 0.2, "P-ZN50": 0.2, "P-D3K": 0.2 },
  },
  {
    code: "EUD",
    name: "EU distributor",
    termsDays: 45,
    share: { "P-VC500": 0.08, "P-ZN50": 0.2, "P-D3K": 0.2 },
  },
  {
    code: "CLC",
    name: "Cedar Lane Pharmacy Co-op",
    termsDays: 30,
    share: {
      "P-CMD": 0.25,
      "P-PRO": 0.4,
      "P-MEL5": 0.4,
      "P-ZN50": 0.3,
      "P-MG100": 0.25,
      "P-BCX": 0.25,
    },
  },
  {
    code: "SHD",
    name: "Summit Health Distributors",
    termsDays: 45,
    share: { "P-CMD": 0.2, "P-ELX": 0.4, "P-FBR": 0.4, "P-MG100": 0.2 },
  },
  {
    code: "HNF",
    name: "Harborview Natural Foods",
    termsDays: 30,
    share: { "P-ELX": 0.25, "P-BCX": 0.2 },
  },
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
    }
  | {
      id: string;
      type: "late_delivery";
      title: string;
      /** The first PO for the material from the vendor ordered from `date` to `orderedBy` runs late. */
      date: string;
      orderedBy: string;
      vendor: string;
      material: string;
      extraDays: number;
      narrative: string;
    }
  | {
      id: string;
      type: "qc_reject";
      title: string;
      /** The first lot of the material from the vendor received on or after this day fails QC. */
      date: string;
      vendor: string;
      material: string;
      reason: string;
      narrative: string;
    }
  | {
      id: string;
      type: "supplier_trial";
      title: string;
      date: string;
      endsAt: string;
      vendor: string;
      material: string;
      /** Trial orders, kg, at the price quoted; every trial lot fails QC and goes back, unreplaced. */
      priceUsd: number;
      orders: readonly { date: string; kg: number }[];
      reason: string;
      narrative: string;
    }
  | {
      id: string;
      type: "price_change";
      title: string;
      date: string;
      material: string;
      vendors: readonly string[];
      fromUsd: number;
      toUsd: number;
      /** The anchored records that carry the new price. */
      evidence: readonly string[];
      narrative: string;
    }
  | {
      id: string;
      type: "mass_balance";
      title: string;
      date: string;
      endsAt: string;
      /** The anchored batches the gap is in, and the gap in mg (agents/kevin massBalance.ts on the seed). */
      batches: readonly string[];
      unaccountedBase: number;
      narrative: string;
    }
  | {
      id: string;
      type: "recall_candidate";
      title: string;
      /** A bulk order that becomes one lot, part of which goes to a sister plant. */
      date: string;
      vendor: string;
      material: string;
      kg: number;
      transfer: { transferNo: string; date: string; from: "B"; to: "A"; kg: number };
      narrative: string;
    };

const SURCHARGE: Incident = {
  id: "INC-09",
  type: "freight_surcharge",
  title: "Packaging freight surcharge",
  date: "2026-05-01",
  endsAt: "2026-07-31",
  category: "packaging",
  surchargeUsd: 85,
  narrative: "Packaging carriers added a fuel surcharge of $85 a delivery from May through July.",
};

const SHUTDOWNS: readonly Incident[] = [
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

/**
 * The mock recall notice's lot (§2.1.7 #8): a winter bulk buy of Ridgeway ascorbic acid at
 * Hollow Pine, part of which went to Riverside for its late-winter Vitamin C. The Lots & recall
 * page drills the bought-in ascorbic acid lot used in the most batches (web/src/genealogy.ts
 * drillLot): this one, never ASC-261116-01. Listed at both plants.
 */
const RECALL: Incident = {
  id: "INC-08",
  type: "recall_candidate",
  title: "Mock supplier recall candidate",
  date: "2026-02-02",
  vendor: "RWA",
  material: "ASC",
  kg: 2_500,
  transfer: { transferNo: "TR-B-A-260223", date: "2026-02-23", from: "B", to: "A", kg: 1_000 },
  narrative:
    "Hollow Pine bought 2,500 kg of ascorbic acid from Ridgeway in one winter order and sent " +
    "1,000 kg of the lot to Riverside for its late-winter Vitamin C. The lot went into Vitamin C " +
    "batches at both plants, so it is the one a mock supplier recall notice traces.",
};

/**
 * Hollow Pine's named incidents (§2.1.7). INC-06 sits in the anchor window: it names the
 * anchored records that carry the new price and changes nothing. INC-07 is Riverside's.
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
    id: "INC-02",
    type: "late_delivery",
    title: "Sierra Mineral Supply ships calcium carbonate late",
    date: "2026-02-16",
    orderedBy: "2026-03-20",
    vendor: "SMS",
    material: "CAC",
    extraDays: 9,
    narrative:
      "Sierra Mineral Supply's March calcium carbonate arrived nine days after its promised " +
      "day; the Cal-Mag schedule moved around it and Sierra's on-time rate fell.",
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
    id: "INC-04",
    type: "qc_reject",
    title: "Fennimore Polyols sorbitol fails QC",
    date: "2026-06-01",
    vendor: "FPO",
    material: "SOR",
    reason: "Moisture above specification",
    narrative:
      "A Fennimore Polyols sorbitol lot failed the moisture specification. QC rejected it, it " +
      "went back to Fennimore and a replacement followed a week later; Fennimore's QC pass " +
      "rate fell.",
  },
  {
    id: "INC-05",
    type: "supplier_trial",
    title: "QuickChem Direct fails two trial lots in a row",
    date: "2026-06-08",
    endsAt: "2026-06-26",
    vendor: "QCD",
    material: "ASC",
    // FICTIONAL_DATA.md (suppliers): QuickChem quotes ascorbic acid at $5.90/kg, the cheapest.
    priceUsd: 5.9,
    orders: [
      { date: "2026-06-08", kg: 100 },
      { date: "2026-06-22", kg: 100 },
    ],
    reason: "Assay below specification",
    narrative:
      "Hollow Pine trialled QuickChem Direct, the cheapest ascorbic acid on offer. Both trial " +
      "lots failed assay and went back: two QC rejects in a row, so QuickChem was never " +
      "qualified. It holds no supplier credential, and RFQ-2611-01 lists it as excluded, " +
      "vendor not qualified.",
  },
  {
    id: "INC-06",
    type: "price_change",
    title: "Ascorbic acid price hike",
    date: "2026-08-24",
    material: "ASC",
    vendors: ["NGI", "RWA"],
    fromUsd: 6.4,
    toUsd: 7.1,
    evidence: ["PO-1042", "RFQ-2611-01"],
    narrative:
      "Northgate and Ridgeway both moved ascorbic acid from $6.40 to $7.10/kg in late August: " +
      "the list price every order pays from Aug 24, and PO-1042's $7.10/kg.",
  },
  RECALL,
  SURCHARGE,
  ...SHUTDOWNS,
];

/** Riverside's incidents: the seed's mass-balance gap, and the recall lot's arrival. */
export const RIVERSIDE_INCIDENTS: readonly Incident[] = [
  {
    id: "INC-07",
    type: "mass_balance",
    title: "Mass-balance gap at Acme Riverside",
    date: "2026-10-13",
    endsAt: "2026-10-27",
    batches: ["BR-A-2201", "BR-A-2204"],
    unaccountedBase: 115_199_028,
    narrative:
      "Riverside writes 1,857.4 lb issued and 55.8 lb waste on every Cal-Mag batch, so 115.199 " +
      "kg over BR-A-2201 and BR-A-2204 is in neither the tablets nor the recorded waste.",
  },
  RECALL,
  SURCHARGE,
  ...SHUTDOWNS,
];

export const LAKEVIEW_INCIDENTS: readonly Incident[] = [SURCHARGE, ...SHUTDOWNS];

export interface WorldConfig {
  seed: string;
  calendar: CalendarParams;
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

export const RIVERSIDE_WORLD: WorldConfig = {
  ...WORLD,
  plant: RIVERSIDE,
  incidents: RIVERSIDE_INCIDENTS,
};

/** Lakeview's records in the seed start with its packaging stock on Sep 5 (seed/lots.ts). */
export const LAKEVIEW_WORLD: WorldConfig = {
  ...WORLD,
  calendar: { ...CALENDAR, spliceIn: "2026-09-05" },
  plant: LAKEVIEW,
  incidents: LAKEVIEW_INCIDENTS,
};

/** The three plants, in the order they are generated: Lakeview stages packaging for the other two. */
export const WORLDS: readonly WorldConfig[] = [WORLD, RIVERSIDE_WORLD, LAKEVIEW_WORLD];
