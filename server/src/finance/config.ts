// The Money page's assumptions (docs/UPGRADE_BRIEF.md §2.4). Everything here is fictional and
// every figure the page derives from it is labeled on screen: overhead and opening cash are
// "modeled", Kevin's fee and the inference rate are "assumed". Change a number here and run
// `npm run web:data`; the formulas in money.ts take these as arguments, never as constants.

import type { BudgetTable, KevinCostConfig, Overhead } from "./money.ts";

/** Day One's first day at Hollow Pine (world CALENDAR.t0): savings count from here. */
export const T0 = "2026-11-09";

/**
 * Monthly overhead per plant, modeled (no payroll or utility records exist): labor, utilities
 * and rent, dollars a month. Hollow Pine's are sized so the year's cash flow is modestly positive
 * against the generated customer receipts; Riverside's and Lakeview's wait for their world data.
 */
export const OVERHEAD: Readonly<Record<string, Overhead>> = {
  B: { laborUsd: 148_000, utilitiesUsd: 19_500, rentUsd: 24_000 },
};

/** Cash in the bank on the world's first day, modeled: the page's "cash on hand" starts here. */
export const OPENING_CASH_USD: Readonly<Record<string, number>> = { B: 120_000 };

/**
 * Monthly purchasing budgets per plant and category, dollars (fictional). The categories are the
 * seed's material categories (server/src/seed/reference.ts) plus freight; flavors are excipients
 * there.
 */
export const BUDGETS: Readonly<Record<string, BudgetTable>> = {
  B: { active: 42_000, excipient: 30_000, packaging: 24_000, lab_chemical: 2_000, freight: 2_500 },
};

/** Kevin's cost (§2.4 item 8). The fee is an assumption; testnet gas is shown as ≈ $0. */
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
