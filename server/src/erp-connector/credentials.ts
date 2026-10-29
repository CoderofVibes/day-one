// The supplier's on-chain credential next to the ERP's vendor master (CONTRACTS.md §3.1,
// docs/ERP.md §2). The contract decides who can be paid: `submit_po` refuses a supplier whose
// credential is missing, revoked, expired, suspended or outside the PO's category, whatever
// the ERP says. The connector reads the credential, tells staff "approved supplier" or "on
// hold", and reports where the ERP's status disagrees so Acme's AP team fixes the ERP. It
// never writes the contract, and an ERP approval never makes a supplier payable.

import type { ErpVendor, ErpVendorStatus } from "./types.ts";

/** `get_supplier_standing`'s verdict. */
export type ChainStanding =
  | "Approved"
  | "Conditional"
  | "Suspended"
  | "Expired"
  | "Revoked"
  | "NoCredential"
  | "NotListed";

/** The parts of `get_supplier_standing` the connector reads. */
export interface ContractStanding {
  supplier: string;
  standing: ChainStanding;
  may_be_paid: boolean;
  status: "Qualified" | "Conditional" | null;
  credential: {
    token: number;
    categories: string[];
    expires_at: string;
    revoked: { at: string; reason: string } | null;
    reputation: {
      released: number;
      rejected: number;
      consecutive_rejects: number;
      last_outcome: "Released" | "Rejected" | null;
      suspended_at: string | null;
    };
  } | null;
}

/** How a staff screen names the standing: two plain states, a reason for "on hold". */
export function standingLabel(s: ContractStanding): string {
  switch (s.standing) {
    case "Approved":
      return "approved supplier";
    case "Conditional":
      return "approved supplier, director signs every PO";
    case "Suspended":
      return `on hold: ${s.credential?.reputation.consecutive_rejects ?? 0} deliveries in a row failed QC`;
    case "Expired":
      return "on hold: approval expired";
    case "Revoked":
      return "on hold: approval withdrawn by HQ";
    case "NoCredential":
    case "NotListed":
      return "not an approved supplier";
  }
}

/** The categories the credential lets a supplier sell, in staff words. */
export function categoriesLabel(s: ContractStanding): string {
  return (s.credential?.categories ?? []).map((c) => c.replace(/_/g, " ")).join(", ") || "none";
}

export interface StandingComparison {
  vendorCode: string;
  account: string;
  erpStatus: ErpVendorStatus;
  chain: ChainStanding;
  /** False when the ERP and the contract say different things about this vendor. */
  agree: boolean;
  /** What Kevin works with: the stricter of the two; never more than the contract allows. */
  kevinTreats: "approved" | "onHold";
  line: string;
}

/**
 * The ERP is `approved` exactly when the contract would pay without conditions; `onHold` fits
 * a conditional, suspended, expired or uncredentialed supplier; `blocked` fits anyone the
 * contract will not pay. Anything else is a disagreement.
 */
export function compareStanding(vendor: ErpVendor, s: ContractStanding): StandingComparison {
  const chainApproved = s.standing === "Approved";
  const agree =
    (vendor.status === "approved") === chainApproved &&
    !(vendor.status === "blocked" && s.may_be_paid);
  const kevinTreats = chainApproved && vendor.status === "approved" ? "approved" : "onHold";
  const erpWords = vendor.status === "onHold" ? "on hold" : vendor.status;
  const label = standingLabel(s);
  let line: string;
  if (agree) {
    line = `${vendor.name}: ERP ${erpWords}, contract ${label}`;
  } else if (vendor.status === "approved") {
    const contract = s.may_be_paid
      ? "the contract needs the director on every PO"
      : "the contract refuses its POs";
    line = `${vendor.name}: ERP says approved but the contract says ${label}; Kevin treats it as on hold and ${contract}. Acme AP should put it on hold in the ERP.`;
  } else if (s.may_be_paid) {
    line = `${vendor.name}: ERP says ${erpWords} but the contract would still pay it (${label}); Kevin treats it as on hold. HQ should revoke the credential.`;
  } else {
    line = `${vendor.name}: ERP says ${erpWords}, contract says ${label}`;
  }
  return {
    vendorCode: vendor.code,
    account: s.supplier,
    erpStatus: vendor.status,
    chain: s.standing,
    agree,
    kevinTreats,
    line,
  };
}
