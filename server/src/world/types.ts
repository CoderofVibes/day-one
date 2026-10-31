// The world's records (docs/UPGRADE_BRIEF.md §2.1.4), ERP-shaped and named after the ledger's
// own columns where one exists. Quantities are base units (mg or each) and money is USDC base
// units (6 decimals), as in the ledger, so every balance below is exact integer arithmetic.

import type { PRODUCTS } from "../seed/reference.ts";

export type ProductCode = (typeof PRODUCTS)[number]["code"];

/** Where a record comes from: generated before the splice, the seed and the recorded run, or simulated after it. */
export type Era = "legacy" | "anchor" | "simulated";

export interface WorldPoLine {
  material: string;
  qtyBase: number;
  unitPriceUsdc: number;
  extendedUsdc: number;
}

export interface WorldPo {
  poNo: string;
  era: Era;
  vendor: string;
  category: "raw_material" | "packaging" | "lab_chemical";
  orderedAt: string;
  lines: WorldPoLine[];
  freightUsdc: number;
  totalUsdc: number;
  approval: {
    path: "legacy_paper" | "auto" | "director_text";
    approver: string | null;
    at: string;
    rule: string;
  } | null;
  /** The PO's state at the end of the world. */
  status: string;
  rfq: string | null;
  /** Bought next-day because a batch found the material short. */
  rush: boolean;
  /** Incidents that shaped it: rush freight, the surcharge. */
  incidents: string[];
}

export interface WorldReceipt {
  receiptNo: string;
  era: Era;
  poNo: string;
  receivedAt: string;
  lines: { material: string; qtyBase: number; lot: string }[];
  daysLate: number;
  partial: boolean;
}

export interface WorldLot {
  lot: string;
  era: Era;
  material: string;
  vendor: string;
  poNo: string | null;
  receivedAt: string;
  qtyBase: number;
  qc: { result: "released" | "rejected"; at: string } | null;
  /** Sent over from a sister plant on this transfer; the plant that bought it lists its QC. */
  transferNo?: string;
}

/** One signed change to a lot's quantity at the plant. Its sum per lot is the lot's balance. */
export type MovementKind =
  | "received"
  | "consumed"
  | "wasted"
  | "transfer_in"
  | "transfer_out"
  | "adjusted";
export type Movement = [at: string, lot: string, kind: MovementKind, qtyBase: number, ref: string];

export interface WorldBatch {
  batchNo: string;
  era: Era;
  product: ProductCode;
  date: string;
  /** The day the plan had it, when a shortage moved it. */
  plannedFor: string | null;
  theoreticalUnits: number;
  actualUnits: number;
  yieldBp: number;
  wasteBase: number;
  consumption: { lot: string; material: string; stdBase: number; actualBase: number }[];
  /** Materials issued 3–6% over the formula (Kevin's waste flag). */
  overIssued: string[];
}

export interface WorldBill {
  billNo: string;
  era: Era;
  vendor: string;
  poNo: string;
  receiptNo: string;
  billDate: string;
  dueDate: string;
  lines: { material: string; qtyBase: number; rateUsdc: number; amountUsdc: number }[];
  freightUsdc: number;
  amountUsdc: number;
  /** What the process of the time recorded: the paper process matched everything it keyed. */
  match: "matched" | "price_variance" | "qty_variance" | "duplicate" | "unmatched";
  status: "open" | "paid";
}

export interface WorldPayment {
  paymentNo: string;
  era: Era;
  bills: string[];
  amountUsdc: number;
  paidAt: string;
  rail: "erp_ach_mock" | "escrow_release";
  /** Simulated escrow releases carry this label and no transaction hash. */
  chain: "Simulated · would anchor" | null;
}

export interface WorldAdjustment {
  adjNo: string;
  era: Era;
  at: string;
  reason: "count";
  label: string;
  lines: { lot: string; material: string; qtyBase: number }[];
  /** Per material: what the books held and what the count found (the anchored opening lots). */
  counted: { material: string; bookBase: number; countedBase: number }[];
}

export interface WorldRfq {
  rfqNo: string;
  material: string;
  qtyBase: number;
  at: string;
  quotes: {
    vendor: string;
    unitPriceUsdc: number;
    freightUsdc: number;
    leadDays: number;
    status: "accepted" | "declined" | "excluded";
    reason: string | null;
  }[];
  winner: string;
}

/** Chain activity the simulated era would cause: never a hash, always the label. */
export interface SimulatedChainEvent {
  at: string;
  method: "submit_po" | "approve_po" | "confirm_receipt" | "qc_release" | "anchor_batch";
  ref: string;
  label: "Simulated · would anchor";
}
