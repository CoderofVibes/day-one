import { describe, expect, it } from "vitest";
import pages from "./data/pages.json";
import plants from "./data/plants.json";
import series from "./data/series.json";
import { materialDecisions } from "./materialDecisions.ts";
import type { LotView } from "./reads.ts";
import type { MaterialForecast } from "./series.ts";

const decisions = (plant: "A" | "B" | "C") =>
  materialDecisions(
    plant,
    series.forecast[plant].materials as MaterialForecast[],
    pages.plant[plant].lots as LotView[],
    plants.transfers.suggestions,
  );

describe("Inventory's material decisions", () => {
  it("puts what the plan draws on first, then QC's wait, then other reorders", () => {
    expect(decisions("B").map((d) => `${d.id} ${d.pill.label}`)).toEqual([
      "order-ASC reorder",
      "qc-MGS-261106-01 10 days in QC",
      "order-BTL reorder",
      "order-CAP reorder",
    ]);
  });

  it("explains a reorder from the forecast's own numbers", () => {
    const asc = decisions("B")[0];
    expect(asc?.title).toBe("Order 700 kg ascorbic acid");
    expect(asc?.why).toBe(
      "1,010 kg on hand. Two planned batches need 824 kg in the next 10 days, which leaves 186 kg: under the reorder point of 500 kg.",
    );
    expect(asc?.who).toBe("Ray Delgado");
  });

  it("offers a move from another plant as the order it would save", () => {
    const btl = decisions("B").find((d) => d.material === "BTL");
    expect(btl?.subtitle).toBe("or move 16,000 from Acme Lakeview");
    expect(btl?.title).toBe("Order 100,000 × 150 cc HDPE bottle");
    expect(btl?.deciding).toContain("instead of ordering 100,000");
    expect(btl?.after).toContain("Approve the move on Three plants");
  });

  it("asks QC about a lot that has waited, naming who decides", () => {
    const qc = decisions("B").find((d) => d.kind === "qc");
    expect(qc).toMatchObject({ who: "Priya Natarajan", lot: "MGS-261106-01" });
    expect(qc?.pill.tone).toBe("stop");
  });

  it("covers the other plants with the roles where it has no names", () => {
    expect(decisions("A")[0]?.who).toBe("Purchasing");
  });
});
