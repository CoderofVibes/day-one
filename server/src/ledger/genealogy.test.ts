import { describe, expect, it } from "vitest";
import { buildGenealogy, type GenealogyTables } from "./genealogy.ts";

// A small invented ledger with what the seed does not hold yet: a batch that makes a
// finished-goods lot, and shipments of it to two customers.
const lot = (code: string, material: string, producedBy: string | null = null) => ({
  code,
  material,
  materialName: material,
  category: "active",
  dimension: "mass",
  vendor: producedBy ? null : "RWA",
  vendorName: producedBy ? null : "Ridgeway Ascorbics",
  vendorLot: producedBy ? null : `RWA-${code}`,
  state: "released",
  facility: "B",
  onHandBase: 1_000_000,
  producedBy,
});
const tables: GenealogyTables = {
  lots: [lot("ASC-1", "ASC"), lot("ASC-2", "ASC"), lot("FG-1", "VC500")],
  received: [
    { lot: "ASC-1", qtyBase: 5_000_000, at: "2026-09-01T14:00:00.000Z", po: "PO-1" },
    { lot: "ASC-2", qtyBase: 5_000_000, at: "2026-09-02T14:00:00.000Z", po: null },
  ],
  receipts: [{ po: "PO-1", receivedAt: "2026-09-01T14:00:00.000Z", by: "Tommy Reyes" }],
  qc: [{ lot: "ASC-1", decision: "released", decidedAt: "2026-09-03T16:00:00.000Z", by: null }],
  poLines: [{ po: "PO-1", material: "ASC", unitPriceUsdc: 7_100_000, basePerUnit: 1_000_000 }],
  batches: [
    {
      batchNo: "BR-2",
      facility: "B",
      product: "VC500",
      productName: "Vitamin C",
      completedAt: "2026-09-12T15:00:00.000Z",
      units: 10,
    },
    {
      batchNo: "BR-1",
      facility: "B",
      product: "VC500",
      productName: "Vitamin C",
      completedAt: "2026-09-10T15:00:00.000Z",
      units: 10,
    },
  ],
  inputs: [
    { batch: "BR-2", lot: "ASC-1", qtyBase: 1 },
    { batch: "BR-1", lot: "ASC-1", qtyBase: 2 },
    { batch: "BR-1", lot: "ASC-1", qtyBase: 3 },
    { batch: "BR-1", lot: "ASC-2", qtyBase: 4 },
  ],
  outputs: [{ batch: "BR-1", lot: "FG-1" }],
  shipments: [
    {
      shipmentNo: "SH-1",
      customer: "Example Pharmacy",
      facility: "B",
      shippedAt: "2026-09-20T10:00:00.000Z",
      lot: "FG-1",
      qtyBase: 5,
    },
    {
      shipmentNo: "SH-2",
      customer: "Sample Grocers",
      facility: "B",
      shippedAt: "2026-09-21T10:00:00.000Z",
      lot: "FG-1",
      qtyBase: 5,
    },
  ],
};

describe("buildGenealogy", () => {
  const g = buildGenealogy(tables);

  it("links lots to batches both ways and merges repeated draws", () => {
    expect(g.lots["ASC-1"]?.usedIn).toEqual(["BR-2", "BR-1"]);
    expect(g.batches["BR-1"]?.inputs).toEqual([
      { lot: "ASC-1", qtyBase: 5 },
      { lot: "ASC-2", qtyBase: 4 },
    ]);
    expect(g.batches["BR-1"]?.outputs).toEqual(["FG-1"]);
    expect(g.lots["FG-1"]?.producedBy).toBe("BR-1");
  });

  it("links finished-goods lots to shipments and their customers", () => {
    expect(g.lots["FG-1"]?.shippedIn).toEqual(["SH-1", "SH-2"]);
    expect(g.shipments["SH-2"]?.customer).toBe("Sample Grocers");
    expect(g.has).toEqual({ fgLots: true, shipments: true });
  });

  it("carries the PO, receipt and price, and prices a lot without its own PO at the average", () => {
    const a = g.lots["ASC-1"];
    expect(a?.po).toBe("PO-1");
    expect(a?.receipt).toEqual({ receivedAt: "2026-09-01T14:00:00.000Z", by: "Tommy Reyes" });
    expect(a?.price).toEqual({ unitPriceUsdc: 7_100_000, basePerUnit: 1_000_000, from: "po" });
    expect(g.lots["ASC-2"]?.price?.from).toBe("average");
    expect(g.lots["FG-1"]?.price).toBeNull();
  });

  it("is pure: the same rows give the same index", () => {
    expect(JSON.stringify(buildGenealogy(tables))).toBe(JSON.stringify(g));
  });
});
