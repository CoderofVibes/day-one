import { beforeAll, describe, expect, it } from "vitest";
import { seedLedger } from "../seed/index.ts";
import { catalog } from "./catalog.ts";
import { type Ledger, openLedger } from "./db.ts";

let db: Ledger;
beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the catalogue (docs/VISION.md §6.12.2)", () => {
  it("lists ten products with their formula, form and plants", () => {
    const { products } = catalog(db);
    expect(products).toHaveLength(10);
    const vc = products.find((p) => p.code === "P-VC500");
    expect(vc).toMatchObject({ form: "Tablets", plants: ["B"], batchUnits: 800_000 });
    expect(vc?.lines[0]).toMatchObject({ material: "ASC", qtyPerBatchBase: 412_000_000 });
    expect(products.find((p) => p.code === "P-PRO")?.form).toBe("Capsules");
    expect(products.find((p) => p.code === "P-FBR")?.form).toBe("Powder");
    // Cal-Mag is made at both plants; Riverside's from October (and BR-A-2213 planned).
    expect(products.find((p) => p.code === "P-CMD")?.plants).toEqual(["A", "B"]);
    for (const p of products) {
      const total = p.lines.reduce((s, l) => s + l.qtyPerBatchBase, 0);
      expect(total, p.code).toBe(p.unitWeightMg * p.batchUnits);
    }
  });

  it("lists every supplier with its standing and what it is approved to supply", () => {
    const { vendors } = catalog(db);
    expect(vendors).toHaveLength(18);
    const quick = vendors.find((v) => v.code === "QCD");
    expect(quick?.qualification).toBe("unqualified");
    expect(quick?.supplies.every((s) => !s.approved)).toBe(true);
    const northgate = vendors.find((v) => v.code === "NGI");
    expect(northgate?.account).toBe("northgate-ingredients.testnet");
    expect(northgate?.supplies.map((s) => s.material)).toContain("ASC");
  });
});
