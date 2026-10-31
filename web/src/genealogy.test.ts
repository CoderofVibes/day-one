import { describe, expect, it } from "vitest";
import { FIXTURE } from "./genealogy.fixture.ts";
import { runDrill, search, trace } from "./genealogy.ts";

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
