// The 3-way match: a vendor bill against its purchase order and the item receipts for that
// order, with the vendor's tolerances (docs/ERP.md §3.4). Pure functions over plain inputs so
// the tolerance edges are tested without a database. Every exception says what was billed,
// ordered and received and which tolerance applied, so Marcy can decide from the line itself.

export interface MatchTolerances {
  /** Quantity billed vs ordered, basis points of the ordered quantity. */
  poQtyBp: number;
  /** Amount billed vs ordered, basis points of the ordered amount. */
  poAmtBp: number;
  /** Absolute quantity (base units) a bill may exceed what was received by. */
  irQtyDifferenceBase: number;
}

export interface MatchPoLine {
  line: number;
  itemId: number;
  itemCode: string;
  quantityBase: number;
  rateUsdc: number;
  amountUsdc: number;
  /** Received and not rejected, base units, across the PO's item receipts. */
  receivedBase: number;
  /** Already billed on earlier bills, base units. */
  billedBase: number;
}

export interface MatchPo {
  tranId: string;
  vendorId: number;
  status: string;
  freightUsdc: number;
  totalUsdc: number;
  lines: MatchPoLine[];
}

export interface MatchBillLine {
  line: number;
  itemId: number;
  itemCode: string;
  quantityBase: number;
  rateUsdc: number;
  amountUsdc: number;
  /** The PO line it bills; null = the matcher pairs it by item. */
  poLine: number | null;
}

export interface MatchBill {
  vendorId: number;
  freightUsdc: number;
  totalUsdc: number;
  lines: MatchBillLine[];
}

export type MatchExceptionCode =
  | "PO_NOT_FOUND"
  | "PO_CLOSED"
  | "VENDOR_MISMATCH"
  | "LINE_NOT_ON_PO"
  | "QTY_VS_PO"
  | "AMT_VS_PO"
  | "QTY_OVER_RECEIPT"
  | "NOT_RECEIVED"
  | "FREIGHT_VS_PO"
  | "TOTAL_ARITHMETIC";

export interface MatchException {
  code: MatchExceptionCode;
  line: number | null;
  message: string;
  billed?: number;
  ordered?: number;
  received?: number;
  tolerance?: string;
}

export interface MatchResult {
  status: "matched" | "exception";
  exceptions: MatchException[];
  /** Which PO line each bill line was matched to (by line number). */
  pairs: { billLine: number; poLine: number | null }[];
}

/** |a − b| ≤ b × bp ⁄ 10,000, in integers. */
export function withinBp(actual: number, expected: number, bp: number): boolean {
  const diff = Math.abs(actual - expected);
  return diff * 10_000 <= Math.abs(expected) * bp;
}

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

/**
 * Formats a base quantity for an exception message in the item's unit (the caller passes the
 * divisor) so the message reads "700 kg", not "700000000".
 */
export type QuantityFormatter = (base: number, itemId: number) => string;

export function threeWayMatch(
  bill: MatchBill,
  po: MatchPo | null,
  tol: MatchTolerances,
  fmt: { qty: QuantityFormatter; usd: (units: number) => string },
): MatchResult {
  const exceptions: MatchException[] = [];
  const pairs: { billLine: number; poLine: number | null }[] = [];

  const lineTotal = bill.lines.reduce((s, l) => s + l.amountUsdc, 0);
  if (lineTotal + bill.freightUsdc !== bill.totalUsdc) {
    exceptions.push({
      code: "TOTAL_ARITHMETIC",
      line: null,
      message: `The bill's total ${fmt.usd(bill.totalUsdc)} is not its lines ${fmt.usd(lineTotal)} plus freight ${fmt.usd(bill.freightUsdc)}.`,
      billed: bill.totalUsdc,
    });
  }

  if (!po) {
    exceptions.push({
      code: "PO_NOT_FOUND",
      line: null,
      message: "The bill names a purchase order the ERP does not have.",
    });
    return {
      status: "exception",
      exceptions,
      pairs: bill.lines.map((l) => ({ billLine: l.line, poLine: null })),
    };
  }
  if (po.vendorId !== bill.vendorId) {
    exceptions.push({
      code: "VENDOR_MISMATCH",
      line: null,
      message: `${po.tranId} is with a different vendor than the bill.`,
    });
  }
  if (po.status === "closed" || po.status === "rejected" || po.status === "fullyBilled") {
    exceptions.push({
      code: "PO_CLOSED",
      line: null,
      message: `${po.tranId} is ${po.status}; it accepts no further bills.`,
    });
  }
  if (bill.freightUsdc !== po.freightUsdc) {
    exceptions.push({
      code: "FREIGHT_VS_PO",
      line: null,
      message: `Freight billed ${fmt.usd(bill.freightUsdc)}; ${po.tranId} agreed ${fmt.usd(po.freightUsdc)}.`,
      billed: bill.freightUsdc,
      ordered: po.freightUsdc,
      tolerance: "exact",
    });
  }

  const used = new Set<number>();
  for (const b of bill.lines) {
    const target =
      b.poLine !== null
        ? po.lines.find((p) => p.line === b.poLine)
        : po.lines.find((p) => p.itemId === b.itemId && !used.has(p.line));
    if (!target) {
      pairs.push({ billLine: b.line, poLine: null });
      exceptions.push({
        code: "LINE_NOT_ON_PO",
        line: b.line,
        message: `Line ${b.line} bills ${b.itemCode}, which is not on ${po.tranId}.`,
        billed: b.quantityBase,
      });
      continue;
    }
    used.add(target.line);
    pairs.push({ billLine: b.line, poLine: target.line });
    const q = (base: number) => fmt.qty(base, target.itemId);

    if (!withinBp(b.quantityBase, target.quantityBase, tol.poQtyBp)) {
      exceptions.push({
        code: "QTY_VS_PO",
        line: b.line,
        message: `Line ${b.line} bills ${q(b.quantityBase)} ${b.itemCode}; ${po.tranId} ordered ${q(target.quantityBase)} (tolerance ${pct(tol.poQtyBp)}).`,
        billed: b.quantityBase,
        ordered: target.quantityBase,
        received: target.receivedBase,
        tolerance: pct(tol.poQtyBp),
      });
    }
    if (!withinBp(b.amountUsdc, target.amountUsdc, tol.poAmtBp)) {
      exceptions.push({
        code: "AMT_VS_PO",
        line: b.line,
        message: `Line ${b.line} bills ${fmt.usd(b.amountUsdc)} (${fmt.usd(b.rateUsdc)} per unit); ${po.tranId} agreed ${fmt.usd(target.amountUsdc)} (${fmt.usd(target.rateUsdc)} per unit, tolerance ${pct(tol.poAmtBp)}).`,
        billed: b.amountUsdc,
        ordered: target.amountUsdc,
        tolerance: pct(tol.poAmtBp),
      });
    }
    const unbilledReceived = target.receivedBase - target.billedBase;
    if (target.receivedBase === 0) {
      exceptions.push({
        code: "NOT_RECEIVED",
        line: b.line,
        message: `Line ${b.line}: nothing of ${b.itemCode} has been received against ${po.tranId}.`,
        billed: b.quantityBase,
        ordered: target.quantityBase,
        received: 0,
      });
    } else if (b.quantityBase > unbilledReceived + tol.irQtyDifferenceBase) {
      exceptions.push({
        code: "QTY_OVER_RECEIPT",
        line: b.line,
        message: `Line ${b.line} bills ${q(b.quantityBase)} ${b.itemCode}; ${q(unbilledReceived)} received and not yet billed (difference limit ${q(tol.irQtyDifferenceBase)}).`,
        billed: b.quantityBase,
        ordered: target.quantityBase,
        received: target.receivedBase,
        tolerance: q(tol.irQtyDifferenceBase),
      });
    }
  }

  return { status: exceptions.length ? "exception" : "matched", exceptions, pairs };
}

const REISSUE_SUFFIX = /(REISSUED|REISSUE|DUPLICATE|COPY|DUP|R)$/;

/**
 * The duplicate key for an invoice number: upper-case alphanumerics with a reissue suffix
 * removed, so "OFH-3317-R" and "ofh 3317" both become "OFH3317". The suffix is stripped only
 * when a digit precedes it, so an invoice number that simply ends in R is left alone.
 */
export function normalizeInvoiceNo(invoiceNo: string): string {
  const core = invoiceNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const stripped = core.replace(REISSUE_SUFFIX, "");
  return stripped.length >= 3 && /\d$/.test(stripped) ? stripped : core;
}
