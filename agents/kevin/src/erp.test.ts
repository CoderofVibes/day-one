import { describe, expect, it } from "vitest";
import { pairInvoiceLines } from "./erp.ts";

const PO = [
  { code: "ASC", name: "Ascorbic acid" },
  { code: "MGS", name: "Magnesium stearate" },
];

describe("pairInvoiceLines", () => {
  it("matches lines listed in another order to the materials they name", () => {
    expect(
      pairInvoiceLines(["Magnesium stearate NF", "Ascorbic acid, USP fine powder"], PO),
    ).toEqual([1, 0]);
  });

  it("takes a material code as the strongest match", () => {
    expect(pairInvoiceLines(["MGS 25 kg bags", "ASC lot NG-2610"], PO)).toEqual([1, 0]);
  });

  it("falls back to the position for a line that names nothing, if that PO line is free", () => {
    expect(pairInvoiceLines(["Item 1", "Magnesium stearate"], PO)).toEqual([0, 1]);
    expect(pairInvoiceLines(["Ascorbic acid"], [{ code: "ASC", name: "Ascorbic acid" }])).toEqual([
      0,
    ]);
  });

  it("leaves a line that bills nothing on the PO unpaired", () => {
    expect(pairInvoiceLines(["Ascorbic acid", "Ascorbic acid again", "Freight"], PO)).toEqual([
      0,
      null,
      null,
    ]);
  });
});
