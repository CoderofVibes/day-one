// The approval matrix (docs/ERP.md §3.5): rows in `approval_rules`, evaluated in order within a
// scope; the first rule whose conditions hold decides. For purchase orders the matrix sits on
// top of the contract: it never checks a spending limit, a monthly cap or the supplier list.
// Those are the contract's, and the PO carries the contract's verdict as evidence.

import { asc, eq } from "drizzle-orm";
import type { ErpDb } from "./db.ts";
import { type UserRole, type VendorStatus, approvalRules } from "./schema.ts";

export type ContractVerdict =
  | "funded"
  | "awaitingApproval"
  | "refused"
  | "cancelled"
  | "refunded"
  | "paid";

export interface PoApprovalInput {
  totalUsdc: number;
  vendorStatus: VendorStatus;
  verdict: ContractVerdict;
  reason?: string | null;
  fundingTx?: string | null;
  approvalTx?: string | null;
  approvedBy?: string | null;
  /** A role that has already signed in the ERP (e.g. the controller), if any. */
  signedByRole?: UserRole | null;
}

export interface BillApprovalInput {
  totalUsdc: number;
  matchStatus: "matched" | "exception" | "duplicate";
  signedByRole?: UserRole | null;
}

export interface Decision {
  approvalStatus: "approved" | "pendingApproval" | "rejected";
  ruleNo: number;
  rule: string;
  requiredRole: UserRole | null;
  note: string;
}

type Rule = typeof approvalRules.$inferSelect;

function rulesFor(db: ErpDb, scope: Rule["scope"]) {
  return db
    .select()
    .from(approvalRules)
    .where(eq(approvalRules.scope, scope))
    .orderBy(asc(approvalRules.ruleNo))
    .all();
}

function applies(rule: Rule, totalUsdc: number, vendorStatus?: VendorStatus, matchStatus?: string) {
  if (rule.minTotalUsdc !== null && totalUsdc < rule.minTotalUsdc) return false;
  if (rule.maxTotalUsdc !== null && totalUsdc > rule.maxTotalUsdc) return false;
  if (rule.vendorStatus !== null && rule.vendorStatus !== vendorStatus) return false;
  if (rule.matchStatus !== null && rule.matchStatus !== matchStatus) return false;
  return true;
}

/** What the contract's verdict means for the ERP's approval status. */
function verdictDecision(input: PoApprovalInput, rule: Rule): Decision {
  const base = { ruleNo: rule.ruleNo, rule: rule.description, requiredRole: null };
  switch (input.verdict) {
    case "funded":
    case "paid":
    case "cancelled":
    case "refunded":
      return {
        ...base,
        approvalStatus: "approved",
        note: input.approvalTx
          ? `Approved on chain by ${input.approvedBy ?? "the director"} (tx ${input.approvalTx}); funded in tx ${input.fundingTx ?? "?"}.`
          : `Within the agent's limits; funded by the contract in tx ${input.fundingTx ?? "?"}.`,
      };
    case "awaitingApproval":
      return {
        ...base,
        approvalStatus: "pendingApproval",
        note: `Waiting for the director's on-chain approval: ${input.reason ?? "the contract refused it"}`,
      };
    case "refused":
      return {
        ...base,
        approvalStatus: "rejected",
        note: `Refused by the contract: ${input.reason ?? "no reason given"}`,
      };
  }
}

export function evaluatePurchaseOrder(db: ErpDb, input: PoApprovalInput): Decision {
  for (const rule of rulesFor(db, "purchaseOrder")) {
    if (!applies(rule, input.totalUsdc, input.vendorStatus)) continue;
    const base = { ruleNo: rule.ruleNo, rule: rule.description };
    switch (rule.requires) {
      case "reject":
        return { ...base, approvalStatus: "rejected", requiredRole: null, note: rule.description };
      case "controller":
      case "apManager": {
        const role = rule.approverRole ?? "controller";
        const contract = verdictDecision(input, rule);
        if (contract.approvalStatus !== "approved")
          return { ...contract, ...base, requiredRole: role };
        if (input.signedByRole === role) {
          return {
            ...base,
            approvalStatus: "approved",
            requiredRole: role,
            note: `${contract.note} Signed by the ${role}.`,
          };
        }
        return {
          ...base,
          approvalStatus: "pendingApproval",
          requiredRole: role,
          note: `${contract.note} Needs the ${role === "controller" ? "HQ controller" : role}'s signature as well.`,
        };
      }
      case "contractVerdict":
        return verdictDecision(input, rule);
      case "auto":
        return { ...base, approvalStatus: "approved", requiredRole: null, note: rule.description };
    }
  }
  return {
    approvalStatus: "pendingApproval",
    ruleNo: 0,
    rule: "no rule applies",
    requiredRole: "controller",
    note: "No approval rule applies; held for the HQ controller.",
  };
}

export function evaluateVendorBill(db: ErpDb, input: BillApprovalInput): Decision {
  for (const rule of rulesFor(db, "vendorBill")) {
    if (!applies(rule, input.totalUsdc, undefined, input.matchStatus)) continue;
    const base = { ruleNo: rule.ruleNo, rule: rule.description };
    switch (rule.requires) {
      case "reject":
        return { ...base, approvalStatus: "rejected", requiredRole: null, note: rule.description };
      case "auto":
        return { ...base, approvalStatus: "approved", requiredRole: null, note: rule.description };
      case "apManager":
      case "controller": {
        const role = rule.approverRole ?? rule.requires;
        if (input.signedByRole === role) {
          return {
            ...base,
            approvalStatus: "approved",
            requiredRole: role,
            note: `${rule.description} Signed.`,
          };
        }
        return {
          ...base,
          approvalStatus: "pendingApproval",
          requiredRole: role,
          note: rule.description,
        };
      }
      case "contractVerdict":
        return {
          ...base,
          approvalStatus: "pendingApproval",
          requiredRole: null,
          note: rule.description,
        };
    }
  }
  return {
    approvalStatus: "pendingApproval",
    ruleNo: 0,
    rule: "no rule applies",
    requiredRole: "apManager",
    note: "No approval rule applies; held for the AP manager.",
  };
}
