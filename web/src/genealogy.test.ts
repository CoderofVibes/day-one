import { describe, expect, it } from "vitest";
import { type Genealogy, type GenealogyLot, runDrill, search, trace } from "./genealogy.ts";

const lot = (code: string, extra: Partial<GenealogyLot> = {}): GenealogyLot => ({
  code,
  material: "ASC",
  materialName: "Ascorbic acid",
  category: "active",
  dimension: "mass",
  vendor: "RWA",
  vendorName: "Ridgeway Ascorbics",
  vendorLot: `RWA-${code}`,
  state: "consumed",
  facility: "B",
  onHandBase: 0,
  receivedBase: 2_000_000,
  receivedAt: "2026-09-01T14:00:00.000Z",
  po: "PO-1",
  receipt: null,
  qc: null,
  price: { unitPriceUsdc: 7_000_000, basePerUnit: 1_000_000, from: "po" },
  producedBy: null,
  usedIn: [],
  shippedIn: [],
  ...extra,
});
const batch = (batchNo: string, inputs: string[], outputs: string[] = []) => ({
  batchNo,
  facility: batchNo.endsWith("A") ? "A" : "B",
  product: "VC500",
  productName: "Vitamin C 500 mg Chewable",
  completedAt: "2026-09-10T15:00:00.000Z",
  units: 100,
  inputs: inputs.map((l) => ({ lot: l, qtyBase: 1_000_000 })),
  outputs,
});

// One raw lot into two batches at two plants; one batch makes a finished-goods lot that ships
// to two customers. A second raw lot feeds only the first batch.
export const FIXTURE: Genealogy = {
  lots: {
    "ASC-1": lot("ASC-1", { usedIn: ["BR-1B", "BR-2A"], state: "in_use", onHandBase: 500_000 }),
    "CAC-1": lot("CAC-1", { material: "CAC", usedIn: ["BR-1B"] }),
    "FG-1": lot("FG-1", {
      material: "VC500",
      vendor: null,
      vendorName: null,
      vendorLot: null,
      producedBy: "BR-1B",
      shippedIn: ["SH-1", "SH-2"],
      price: null,
      state: "released",
    }),
  },
  batches: {
    "BR-1B": batch("BR-1B", ["ASC-1", "CAC-1"], ["FG-1"]),
    "BR-2A": batch("BR-2A", ["ASC-1"]),
  },
  shipments: {
    "SH-1": {
      shipmentNo: "SH-1",
      customer: "Example Pharmacy",
      facility: "B",
      shippedAt: "2026-09-20T10:00:00.000Z",
      lots: [{ lot: "FG-1", qtyBase: 50 }],
    },
    "SH-2": {
      shipmentNo: "SH-2",
      customer: "Sample Grocers",
      facility: "B",
      shippedAt: "2026-09-21T10:00:00.000Z",
      lots: [{ lot: "FG-1", qtyBase: 50 }],
    },
  },
  has: { fgLots: true, shipments: true },
};

describe("trace", () => {
  it("walks a raw lot forward to batches, finished goods, shipments and customers", () => {
    const t = trace(FIXTURE, { kind: "lot", id: "ASC-1" });
    expect(t.batches).toEqual(["BR-1B", "BR-2A"]);
    expect(t.fgLots).toEqual(["FG-1"]);
    expect(t.shipments).toEqual(["SH-1", "SH-2"]);
    expect(t.customers).toEqual(["Example Pharmacy", "Sample Grocers"]);
    // Not the sibling raw lot: it did not come from ASC-1.
    expect(t.rawLots).toEqual(["ASC-1"]);
    const col = Object.fromEntries(t.nodes.map((n) => [n.key, n.col]));
    expect(col).toMatchObject({
      "lot:ASC-1": 0,
      "batch:BR-1B": 1,
      "lot:FG-1": 2,
      "shipment:SH-1": 3,
      "customer:Example Pharmacy": 4,
    });
  });

  it("walks a shipment back to the raw lots and on to its customer", () => {
    const t = trace(FIXTURE, { kind: "shipment", id: "SH-1" });
    expect(t.rawLots).toEqual(["ASC-1", "CAC-1"]);
    expect(t.batches).toEqual(["BR-1B"]);
    expect(t.customers).toEqual(["Example Pharmacy"]);
    expect(t.edges).toContainEqual({ from: "lot:CAC-1", to: "batch:BR-1B" });
  });
});

describe("search", () => {
  it("finds by lot id, supplier lot, material, supplier, batch and date", () => {
    expect(search(FIXTURE, "asc-1")[0]?.id).toBe("ASC-1");
    expect(search(FIXTURE, "RWA-CAC-1").map((h) => h.id)).toEqual(["CAC-1"]);
    expect(search(FIXTURE, "ridgeway").length).toBe(2);
    expect(search(FIXTURE, "BR-2A").map((h) => h.id)).toEqual(["BR-2A"]);
    expect(search(FIXTURE, "sep 10").map((h) => h.id)).toEqual(["BR-1B", "BR-2A"]);
    expect(search(FIXTURE, "Sample Grocers").map((h) => h.id)).toEqual(["SH-2"]);
    expect(search(FIXTURE, "  ")).toEqual([]);
  });
});

describe("runDrill", () => {
  it("reports customers, units, holds and value from the trace", () => {
    let t = 0;
    const r = runDrill(
      FIXTURE,
      "RWA-ASC-1",
      (c) => `Plant ${c}`,
      () => (t += 2),
    );
    expect(r?.lot).toBe("ASC-1");
    expect(r?.plants).toEqual(["Plant A", "Plant B"]);
    expect(r?.trace.customers).toEqual(["Example Pharmacy", "Sample Grocers"]);
    expect(r?.unitsAffected).toBe(200);
    expect(r?.hold).toEqual([{ lot: "ASC-1", qtyBase: 500_000, dimension: "mass", facility: "B" }]);
    // Three draws of 1 kg at $7.00 into the batches, plus 0.5 kg on hand.
    expect(r?.valueAtRiskUsdc).toBe(24_500_000);
    expect(r?.steps.map((s) => s.ms)).toEqual([2, 4, 6, 8]);
    expect(r?.steps[2]?.text).toBe("1 finished-goods lot → 2 shipments to 2 customers");
  });

  it("returns nothing for a supplier lot the ledger does not hold", () => {
    expect(runDrill(FIXTURE, "RWA-NONE", (c) => c)).toBeNull();
  });
});
