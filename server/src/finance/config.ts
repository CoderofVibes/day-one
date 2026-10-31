// The Money page's assumptions (docs/UPGRADE_BRIEF.md §2.4). Everything here is fictional and
// every figure the page derives from it is labeled on screen: overhead and opening cash are
// "modeled", Kevin's fee and the inference rate are "assumed". Change a number here and run
// `npm run web:data`; the formulas in money.ts take these as arguments, never as constants.

import type { BudgetTable, KevinCostConfig, Overhead } from "./money.ts";

/** Day One's first day at Hollow Pine (world CALENDAR.t0): savings count from here. */
export const T0 = "2026-11-09";

/**
 * Monthly overhead per plant, modeled (no payroll or utility records exist): labor, utilities
 * and rent, dollars a month. Hollow Pine's and Riverside's are sized so the year's cash flow is
 * modestly positive against their generated customer receipts (about $263,000 and $145,000 a
 * month in, $62,000 and $26,000 a month to vendors). Lakeview sells nothing: it stages packaging
 * for A and B, and Acme carries its staff and building on the group's books, so only its vendor
 * payments run through its cash and its overhead here is zero by design.
 */
export const OVERHEAD: Readonly<Record<string, Overhead>> = {
  B: { laborUsd: 148_000, utilitiesUsd: 19_500, rentUsd: 24_000 },
  A: { laborUsd: 86_000, utilitiesUsd: 12_000, rentUsd: 14_000 },
  C: { laborUsd: 0, utilitiesUsd: 0, rentUsd: 0 },
};

/**
 * Cash in the bank on the world's first day, modeled: the page's "cash on hand" starts here.
 * Lakeview's covers its year of packaging payments (about $7,200 a month), so it ends near zero.
 */
export const OPENING_CASH_USD: Readonly<Record<string, number>> = {
  B: 120_000,
  A: 90_000,
  C: 100_000,
};

/**
 * Monthly purchasing budgets per plant and category, dollars (fictional). The categories are the
 * seed's material categories (server/src/seed/reference.ts) plus freight; flavors are excipients
 * there. Each is about 1.4 times the plant's average monthly spend in its world, so a peak month
 * shows against it; Lakeview buys only packaging.
 */
export const BUDGETS: Readonly<Record<string, BudgetTable>> = {
  B: { active: 55_000, excipient: 24_000, packaging: 22_000, lab_chemical: 2_000, freight: 3_000 },
  A: { active: 30_000, excipient: 4_500, packaging: 2_000, lab_chemical: 500, freight: 1_600 },
  C: { packaging: 9_500, freight: 600 },
};

/**
 * Kevin's cost (§2.4 item 8). The fee is assumed and fictional: a monthly subscription per plant,
 * charged at the start of each month from T0 (money.ts monthsStarted). Testnet gas is ≈ $0.
 */
export const KEVIN_COST: KevinCostConfig = {
  feeUsdPerMonth: 450,
  // NEAR AI Cloud's price for the model is not recorded in the repo: an assumed rate per million
  // tokens, applied to the token counts each recorded answer carries.
  inputUsdPerMTok: 0.4,
  outputUsdPerMTok: 1.6,
  // For an answer recorded without token counts.
  usdPerAnswer: 0.004,
};

/** An inter-plant move's freight, assumed: a pallet on the Acme shuttle truck. */
export const TRANSFER_FREIGHT_USD = 25;

/** A material with stock and no consumption for this many days is dead stock. */
export const DEAD_STOCK_DAYS = 120;

/** The per-PO limit and monthly commitment Acme set for Kevin (FICTIONAL_DATA §9; on chain). */
export const KEVIN_POLICY = { perPoLimitUsd: 2_500, monthlyLimitUsd: 60_000 };
