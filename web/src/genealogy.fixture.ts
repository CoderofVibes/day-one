// A small invented genealogy with what the seed does not hold yet (finished-goods lots and
// shipments to customers), for the trace, search and drill tests and the page render test.

import type { Genealogy, GenealogyLot } from "./genealogy.ts";

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
