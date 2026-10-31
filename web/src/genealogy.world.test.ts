// The recall drill on the shipped genealogy (npm run web:data): the ledger's lots with the
// twelve-month worlds' (data/world/), so a trace runs raw lot → batches at two plants → finished
// goods → shipments → customers, and the drill's lot is the world's Ridgeway lot (INC-08).

import { describe, expect, it } from "vitest";
import snapshot from "./data/genealogy.json";
import { drillLot, type Genealogy, GOLDEN_LOT, runDrill, trace } from "./genealogy.ts";

const g = (snapshot as unknown as { genealogy: Genealogy }).genealogy;
const PLANTS: Record<string, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine",
  C: "Acme Lakeview",
};

describe("the recall drill over the twelve-month worlds", () => {
  it("picks the Ridgeway lot used at two plants, never the recorded run's lot", () => {
    const lot = drillLot(g);
    expect(lot?.code).toBe("ASC-260209-01");
    expect(lot?.code).not.toBe(GOLDEN_LOT);
    expect(lot?.vendor).toBe("RWA");
    expect(g.has).toEqual({ fgLots: true, shipments: true });
  });

  it("traces it to batches at both plants, finished goods, shipments and customers", () => {
    const lot = drillLot(g);
    const report = runDrill(
      g,
      lot?.vendorLot ?? "",
      (c) => PLANTS[c] ?? c,
      () => 0,
    );
    expect(report?.plants).toEqual(["Acme Riverside", "Hollow Pine"]);
    const tr = report?.trace;
    expect(tr?.fgLots.length).toBe(tr?.batches.length);
    expect(tr?.shipments.length).toBeGreaterThan(10);
    expect(tr?.customers.length).toBeGreaterThan(3);
    // Brute force: every shipment of every finished-goods lot those batches made.
    const fg = (tr?.batches ?? []).flatMap((b) => g.batches[b]?.outputs ?? []);
    const shipments = new Set(
      Object.values(g.shipments)
        .filter((s) => s.lots.some((l) => fg.includes(l.lot)))
        .map((s) => s.shipmentNo),
    );
    expect(new Set(tr?.shipments)).toEqual(shipments);
    // Fast enough on the full index.
    const t = performance.now();
    trace(g, { kind: "lot", id: lot?.code ?? "" });
    expect(performance.now() - t).toBeLessThan(1_500);
  });
});
