// The connector interface: what Day One promises to an acquirer's ERP and what it needs back.
// This is the real deliverable of the ERP work (docs/ERP.md). `mock-netsuite.ts` implements it
// against the NetSuite-shaped mock in erp/; a NetSuite adapter would implement the same
// interface against the real record service. Every record crosses by ID (PO number, Day One
// lot code, batch number, transaction hash); neither side stores the other's records.
//
// Money is integer micro-dollars and quantities are integers in Day One's base units (mg,
// each), as everywhere in the repo; the adapter converts to whatever the ERP shows.

export type ErpVendorStatus = "approved" | "onHold" | "blocked";

export interface ErpVendor {
  /** The vendor code shared with Day One (NGI). */
  code: string;
  name: string;
  status: ErpVendorStatus;
  /** The verified account the escrow may pay; null = the ERP pays this vendor by check. */
  payoutAccount: string | null;
  payoutVerifiedAt: string | null;
  terms: string;
}

export type PayeeCheckCode =
  | "OK"
  | "VENDOR_NOT_IN_MASTER"
  | "VENDOR_NOT_APPROVED"
  | "NO_PAYOUT_ACCOUNT"
  | "PAYOUT_ACCOUNT_MISMATCH";

/** Whether Kevin may send a PO that the contract would pay to `account`. */
export interface PayeeCheck {
  ok: boolean;
  code: PayeeCheckCode;
  /** One plain sentence for the staff line. */
  message: string;
  vendor: ErpVendor | null;
}

/** What the contract said about a PO, as recorded on the ERP's mirror of it. */
export type ContractVerdict =
  | "funded"
  | "awaitingApproval"
  | "refused"
  | "cancelled"
  | "refunded"
  | "paid";

export interface PoMirror {
  poNo: string;
  vendorCode: string;
  facilityCode: string;
  date: string;
  category: string;
  poHash: string | null;
  freightUsdc: number;
  totalUsdc: number;
  lines: { materialCode: string; qtyBase: number; unitPriceUsdc: number; extendedUsdc: number }[];
  verdict: ContractVerdict;
  /** The contract's refusal text, when it refused. */
  reason?: string | null;
  fundingTx?: string | null;
  approvalTx?: string | null;
  approvedBy?: string | null;
  memo?: string | null;
}

export interface ErpRef {
  id: string;
  /** The ERP's document number (PO-1042, IR-3, VP-1 …). */
  tranId: string;
  /** False when the ERP already had this record (posts are idempotent on the Day One key). */
  created: boolean;
  status?: string | undefined;
  approvalStatus?: string | undefined;
  note?: string | undefined;
}

export interface ReceiptPost {
  poNo: string;
  /** Day One's receipt reference, e.g. RCV-PO-1042. */
  ref: string;
  date: string;
  lines: { poLine: number; qtyBase: number; lotCode: string }[];
  memo?: string | null;
}

export interface QcPost {
  /** Day One's reference for the decision, e.g. QC-ASC-261116-01. */
  ref: string;
  /** The PO the lot was received on; null for a lot that came without one (opening stock). */
  poNo: string | null;
  lotCode: string;
  materialCode: string;
  facilityCode: string;
  decision: "release" | "reject";
  reason?: string | null;
  date: string;
}

export type MovementPost =
  | {
      kind: "opening" | "production" | "waste" | "count" | "return";
      ref: string;
      facilityCode: string;
      date: string;
      memo?: string | null;
      lines: {
        materialCode: string;
        lotCode: string;
        /** Signed base units; negative issues stock. */
        qtyBase: number;
        status?: "quarantine" | "good" | "rejected";
        /** For stock coming in without a PO price; the ERP's standard cost otherwise. */
        unitCostUsdc?: number;
      }[];
    }
  | {
      kind: "transfer";
      ref: string;
      fromFacilityCode: string;
      toFacilityCode: string;
      date: string;
      memo?: string | null;
      lines: {
        materialCode: string;
        lotCode: string;
        qtyBase: number;
        status?: "quarantine" | "good" | "rejected";
      }[];
    };

export interface BillPost {
  invoiceNo: string;
  vendorCode: string;
  poNo: string | null;
  date: string;
  dueDate?: string | null;
  freightUsdc: number;
  totalUsdc: number;
  lines: {
    materialCode: string;
    description?: string | null;
    qtyBase: number;
    unitPriceUsdc: number;
    extendedUsdc?: number;
    poLine?: number | null;
  }[];
  memo?: string | null;
}

export interface BillException {
  code: string;
  line: number | null;
  message: string;
}

export interface BillResult {
  id: string;
  invoiceNo: string;
  created: boolean;
  matchStatus: "matched" | "exception" | "duplicate";
  exceptions: BillException[];
  approvalStatus: "approved" | "pendingApproval" | "rejected";
  note: string;
  duplicateOf: string | null;
  priceDrift: {
    itemCode: string;
    rateUsdc: number;
    lastRateUsdc: number;
    lastInvoice: string;
    driftBp: number;
  }[];
  status: "open" | "paidInFull" | "rejected";
  totalUsdc: number;
  amountPaidUsdc: number;
}

export interface PaymentPost {
  /** The settlement reference: the transaction hash, or a check number. */
  ref: string;
  vendorCode: string;
  /** Apply to the approved bill for this PO (or name the invoice). */
  poNo?: string | null;
  invoiceNo?: string | null;
  date: string;
  amountUsdc: number;
  method: "escrowRelease" | "check";
  txHash?: string | null;
  explorerUrl?: string | null;
  memo?: string | null;
}

export interface PaymentResult {
  id: string;
  tranId: string;
  created: boolean;
  /** The invoice it paid, or null when the ERP held it on account. */
  appliedTo: string | null;
  onAccount: boolean;
  /** Why it was held, when it was. */
  reason: string | null;
}

export interface InventoryBalance {
  materialCode: string;
  facilityCode: string;
  status: "quarantine" | "good" | "rejected";
  qtyBase: number;
  valueUsdc: number;
}

/** A refusal or failure from the ERP, with the ERP's own code. */
export class ErpConnectorError extends Error {
  override name = "ErpConnectorError";
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ErpConnector {
  /** "mock-netsuite", "netsuite" … */
  readonly system: string;

  // Vendor master (the ERP's).
  getVendor(code: string): Promise<ErpVendor | null>;
  listVendors(filter?: { status?: ErpVendorStatus }): Promise<ErpVendor[]>;
  /** Approved vendor whose verified payout account is the one the contract would pay. */
  verifyPayee(input: { vendorCode: string; account: string | null }): Promise<PayeeCheck>;

  // Purchasing (Day One's PO, mirrored by number with the contract's verdict).
  pushPurchaseOrder(po: PoMirror): Promise<ErpRef>;
  recordContractVerdict(
    poNo: string,
    verdict: Pick<PoMirror, "verdict" | "reason" | "fundingTx" | "approvalTx" | "approvedBy">,
  ): Promise<ErpRef>;

  // Inventory (Day One's lots; the ERP's item-level balances derive from these posts).
  postItemReceipt(receipt: ReceiptPost): Promise<ErpRef>;
  postQcDecision(decision: QcPost): Promise<ErpRef>;
  postInventoryMovement(movement: MovementPost): Promise<ErpRef>;

  // Accounts payable (the ERP's bills; Day One hands the document over and reads the verdict).
  postVendorBill(bill: BillPost): Promise<BillResult>;
  getBillForPo(poNo: string): Promise<BillResult | null>;
  recordPayment(payment: PaymentPost): Promise<PaymentResult>;

  // Derived reads.
  getInventory(filter?: {
    facilityCode?: string;
    materialCode?: string;
  }): Promise<InventoryBalance[]>;
}
