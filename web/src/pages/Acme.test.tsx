import { describe, expect, it } from "vitest";
import { parseErpLine } from "./Acme.tsx";

describe("parseErpLine", () => {
  it("breaks a mirrored PO into type, id and the contract's verdict", () => {
    const r = parseErpLine(
      "erp: purchaseOrder PO-1042 mirrored — contract verdict: refused pending the director's approval; ERP approval pendingApproval (matrix rule 4)",
      false,
    );
    expect(r).toMatchObject({ type: "purchaseOrder", id: "PO-1042" });
    expect(r.contract).toEqual({ label: "refused · needs Linda", tone: "waiting" });
    expect(r.verdict).toContain("matrix rule 4");
  });
  it("keeps the transaction only behind the curtain", () => {
    const line =
      "erp: purchaseOrder PO-1041 mirrored — contract verdict: funded (tx D28BgcP3…); ERP approval approved (matrix rule 4)";
    expect(parseErpLine(line, false).verdict).not.toContain("tx D28BgcP3");
    expect(parseErpLine(line, true).verdict).toContain("tx D28BgcP3");
    expect(parseErpLine(line, true).contract?.label).toBe("funded");
  });
  it("reads a bill, a payment and a vendor", () => {
    expect(
      parseErpLine(
        "erp: vendorBill NG-INV-24190 — $5,150.00 against PO-1042: 3-way match matched (bill = PO = receipt, within tolerance); approved for payment",
        false,
      ),
    ).toMatchObject({ type: "vendorBill", id: "NG-INV-24190", contract: null });
    const v = parseErpLine(
      "erp: vendor NGI Northgate Ingredients is approved; payout account matches the vendor master",
      false,
    );
    expect(v).toMatchObject({ type: "vendor", id: "NGI" });
    expect(v.verdict).toContain("Northgate Ingredients");
    expect(
      parseErpLine("erp: purchaseOrder PO-1042 — contract verdict recorded: paid", false).contract
        ?.label,
    ).toBe("paid");
  });
});
