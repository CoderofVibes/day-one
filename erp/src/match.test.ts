import { describe, expect, it } from "vitest";
import {
  type MatchBill,
  type MatchPo,
  normalizeInvoiceNo,
  threeWayMatch,
  withinBp,
} from "./match.ts";
import { formatUsd, usd } from "./money.ts";

const KG = 1_000_000;
const fmt = {
  qty: (base: number) => `${base / KG} kg`,
  usd: (units: number) => formatUsd(units),
};
const TOL = { poQtyBp: 200, poAmtBp: 100, irQtyDifferenceBase: 0 };

/** PO-1042 as the ERP holds it after Tommy's receipt: 700 kg ascorbic acid at $7.10 + $180 freight. */
const po: MatchPo = {
  tranId: "PO-1042",
  vendorId: 1,
  status: "pendingBilling",
  freightUsdc: usd(180),
  totalUsdc: usd(5150),
  lines: [
    {
      line: 1,
      itemId: 10,
      itemCode: "ASC",
      quantityBase: 700 * KG,
      rateUsdc: usd(7.1),
      amountUsdc: usd(4970),
      receivedBase: 700 * KG,
      billedBase: 0,
    },
  ],
};

const bill = (
  over: Partial<MatchBill["lines"][number]> = {},
  head: Partial<MatchBill> = {},
): MatchBill => {
  const line = {
    line: 1,
    itemId: 10,
    itemCode: "ASC",
    quantityBase: 700 * KG,
    rateUsdc: usd(7.1),
    amountUsdc: usd(4970),
    poLine: null,
    ...over,
  };
  const freightUsdc = head.freightUsdc ?? usd(180);
  return {
    vendorId: 1,
    freightUsdc,
    totalUsdc: head.totalUsdc ?? line.amountUsdc + freightUsdc,
    lines: [line],
    ...head,
  };
};

describe("the 3-way match", () => {
  it("matches Northgate's genuine invoice exactly", () => {
    const r = threeWayMatch(bill(), po, TOL, fmt);
    expect(r.status).toBe("matched");
    expect(r.exceptions).toEqual([]);
    expect(r.pairs).toEqual([{ billLine: 1, poLine: 1 }]);
  });

  it("flags the inflated invoice: $7.95 per kg is 12% over the agreed amount", () => {
    const r = threeWayMatch(bill({ rateUsdc: usd(7.95), amountUsdc: usd(5565) }), po, TOL, fmt);
    expect(r.status).toBe("exception");
    expect(r.exceptions.map((e) => e.code)).toEqual(["AMT_VS_PO"]);
    expect(r.exceptions[0]?.message).toContain("$5,565.00");
    expect(r.exceptions[0]?.message).toContain("$4,970.00");
    expect(r.exceptions[0]?.tolerance).toBe("1%");
  });

  it("lets an amount inside the 1% tolerance through, and not one just outside", () => {
    // 1% of $4,970.00 is $49.70.
    expect(threeWayMatch(bill({ amountUsdc: usd(4970) + usd(49.7) }), po, TOL, fmt).status).toBe(
      "matched",
    );
    expect(threeWayMatch(bill({ amountUsdc: usd(4970) + usd(49.71) }), po, TOL, fmt).status).toBe(
      "exception",
    );
    expect(threeWayMatch(bill({ amountUsdc: usd(4970) - usd(49.7) }), po, TOL, fmt).status).toBe(
      "matched",
    );
  });

  it("applies the quantity tolerance against the PO and the difference limit against the receipt", () => {
    // 2% of 700 kg is 14 kg, but nothing over the 700 kg received may be billed (limit 0).
    const over = threeWayMatch(
      bill({ quantityBase: 710 * KG, amountUsdc: usd(5041) }),
      po,
      TOL,
      fmt,
    );
    expect(over.exceptions.map((e) => e.code)).toEqual(["AMT_VS_PO", "QTY_OVER_RECEIPT"]);
    const limit = threeWayMatch(
      bill({ quantityBase: 710 * KG, amountUsdc: usd(5041) }),
      po,
      { ...TOL, poAmtBp: 200, irQtyDifferenceBase: 10 * KG },
      fmt,
    );
    expect(limit.status).toBe("matched");
    const under = threeWayMatch(
      bill({ quantityBase: 675 * KG, amountUsdc: usd(4792.5) }),
      po,
      TOL,
      fmt,
    );
    expect(under.exceptions.map((e) => e.code)).toEqual(["QTY_VS_PO", "AMT_VS_PO"]);
    expect(under.exceptions[0]).toMatchObject({
      billed: 675 * KG,
      ordered: 700 * KG,
      received: 700 * KG,
    });
  });

  it("refuses a bill for goods not received, and a second bill for the same goods", () => {
    const unreceived = {
      ...po,
      lines: [{ ...(po.lines[0] as MatchPo["lines"][number]), receivedBase: 0 }],
    };
    expect(threeWayMatch(bill(), unreceived, TOL, fmt).exceptions.map((e) => e.code)).toEqual([
      "NOT_RECEIVED",
    ]);
    const billed = {
      ...po,
      lines: [{ ...(po.lines[0] as MatchPo["lines"][number]), billedBase: 700 * KG }],
    };
    expect(threeWayMatch(bill(), billed, TOL, fmt).exceptions.map((e) => e.code)).toEqual([
      "QTY_OVER_RECEIPT",
    ]);
  });

  it("checks freight exactly, the total's arithmetic, the vendor and the PO's existence", () => {
    expect(
      threeWayMatch(
        bill({}, { freightUsdc: usd(200), totalUsdc: usd(5170) }),
        po,
        TOL,
        fmt,
      ).exceptions.map((e) => e.code),
    ).toEqual(["FREIGHT_VS_PO"]);
    expect(
      threeWayMatch(bill({}, { totalUsdc: usd(5200) }), po, TOL, fmt).exceptions.map((e) => e.code),
    ).toEqual(["TOTAL_ARITHMETIC"]);
    expect(
      threeWayMatch(bill({}, { vendorId: 2 }), po, TOL, fmt).exceptions.map((e) => e.code),
    ).toEqual(["VENDOR_MISMATCH"]);
    expect(threeWayMatch(bill(), null, TOL, fmt).exceptions.map((e) => e.code)).toEqual([
      "PO_NOT_FOUND",
    ]);
    expect(
      threeWayMatch(bill({ itemId: 99, itemCode: "MGS" }), po, TOL, fmt).exceptions.map(
        (e) => e.code,
      ),
    ).toEqual(["LINE_NOT_ON_PO"]);
    expect(
      threeWayMatch(bill(), { ...po, status: "closed" }, TOL, fmt).exceptions.map((e) => e.code),
    ).toEqual(["PO_CLOSED"]);
  });

  it("works in integers", () => {
    expect(withinBp(10_300, 10_000, 300)).toBe(true);
    expect(withinBp(10_301, 10_000, 300)).toBe(false);
    expect(withinBp(0, 0, 0)).toBe(true);
  });
});

describe("invoice number normalization", () => {
  it("folds case, punctuation and reissue suffixes", () => {
    expect(normalizeInvoiceNo("OFH-3317")).toBe("OFH3317");
    expect(normalizeInvoiceNo("OFH-3317-R")).toBe("OFH3317");
    expect(normalizeInvoiceNo("ofh 3317 (reissued)")).toBe("OFH3317");
    expect(normalizeInvoiceNo("NG-INV-24190-R")).toBe("NGINV24190");
    expect(normalizeInvoiceNo("NG-INV-24190 COPY")).toBe("NGINV24190");
    expect(normalizeInvoiceNo("PEC-55388")).toBe("PEC55388");
  });
  it("leaves a number that merely ends in R alone", () => {
    expect(normalizeInvoiceNo("SUPPLIER")).toBe("SUPPLIER");
    expect(normalizeInvoiceNo("A-R")).toBe("AR");
  });
});
