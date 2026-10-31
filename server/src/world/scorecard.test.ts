// Supplier scorecards (docs/UPGRADE_BRIEF.md §2.2) over the committed seed's three worlds: the
// numbers are recomputable from the raw records with the documented formula, and the incidents
// show where they should.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Anchors } from "./anchors.ts";
import { addDays } from "./calendar.ts";
import { SCORECARD, WORLDS } from "./config.ts";
import { generateWorlds, type World } from "./index.ts";
import { type Card, type Metrics, score, scorecards } from "./scorecard.ts";

const load = (slug: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../data/world/${slug}.anchors.json`, import.meta.url), "utf8"),
  ) as Anchors;
const all = generateWorlds(WORLDS, {
  B: load("hollow-pine"),
  A: load("riverside"),
  C: load("lakeview"),
});
const worlds = Object.values(all) as World[];
const AS_OF = "2026-11-16";
const cards = scorecards(worlds, AS_OF);
const supplier = (vendor: string) => {
  const s = cards.suppliers.find((x) => x.vendor === vendor);
  if (!s) throw new Error(`no card for ${vendor}`);
  return s;
};
const forMaterial = (vendor: string, material: string) =>
  supplier(vendor).materials.find((m) => m.material === material) as Card;

describe("supplier scorecards", () => {
  it("are reproducible from the raw records with the documented formula", () => {
    // Northgate's ascorbic acid over the year, counted by hand from the worlds.
    const from = addDays(AS_OF, -(SCORECARD.yearDays - 1));
    const card = forMaterial("NGI", "ASC");
    let receipts = 0;
    let onTime = 0;
    let tested = 0;
    let released = 0;
    for (const w of worlds) {
      const vendorOf = new Map(w.pos.map((p) => [p.poNo, p.vendor]));
      for (const r of w.receipts) {
        const d = r.receivedAt.slice(0, 10);
        if (vendorOf.get(r.poNo) !== "NGI" || d < from || d > AS_OF) continue;
        if (!r.lines.some((l) => l.material === "ASC")) continue;
        receipts++;
        if (r.daysLate === 0) onTime++;
      }
      for (const l of w.lots) {
        const d = l.qc?.at.slice(0, 10) ?? "";
        if (l.vendor !== "NGI" || l.material !== "ASC" || !l.qc || l.transferNo) continue;
        if (d < from || d > AS_OF) continue;
        tested++;
        if (l.qc.result === "released") released++;
      }
    }
    expect(card.year.receipts).toBe(receipts);
    expect(card.year.onTimeRate).toBeCloseTo(onTime / receipts, 4);
    expect(card.year.tested).toBe(tested);
    expect(card.year.qcPassRate).toBeCloseTo(released / tested, 4);
    // The score is the weighted mean of the components, rescaled to the weights it has.
    const m = card.year;
    const w = SCORECARD.weights;
    const parts: [number, number | null][] = [
      [w.qc, m.qcPassRate],
      [w.onTime, m.onTimeRate],
      [w.invoiceAccuracy, m.invoiceAccuracy],
      [w.priceCompetitiveness, m.priceCompetitiveness],
      [w.responsiveness, m.responsiveness],
    ];
    const have = parts.filter(([, v]) => v !== null) as [number, number][];
    expect(card.scoreYear).toBe(
      Math.round(
        (100 * have.reduce((s, [k, v]) => s + k * v, 0)) / have.reduce((s, [k]) => s + k, 0),
      ),
    );
    for (const s of cards.suppliers) {
      for (const c of [s, ...s.materials]) {
        for (const v of [c.scoreYear, c.scoreTrailing])
          if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
        if (c.scoreYear !== null) expect(c.scoreYear).toBeLessThanOrEqual(100);
      }
    }
    expect(scorecards(worlds, AS_OF)).toEqual(cards);
  });

  it("scores a perfect record 100 and drops components with no records", () => {
    const perfect: Metrics = {
      receipts: 1,
      onTimeRate: 1,
      avgDaysLate: null,
      tested: 1,
      qcPassRate: 1,
      consecutiveRejects: 0,
      avgUnitPriceUsdc: 1,
      priceCompetitiveness: 1,
      bills: 1,
      invoiceAccuracy: 1,
      invited: 0,
      responsiveness: null,
    };
    expect(score(perfect)).toBe(100);
    expect(score({ ...perfect, qcPassRate: 0 })).toBe(Math.round((100 * 55) / 90));
    expect(
      score({
        ...perfect,
        qcPassRate: null,
        onTimeRate: null,
        invoiceAccuracy: null,
        priceCompetitiveness: null,
      }),
    ).toBeNull();
  });

  it("shows the incidents: QuickChem's two rejects, Fennimore's failed lot, Sierra's late truck", () => {
    const qcd = supplier("QCD");
    expect(qcd.year.consecutiveRejects).toBe(2);
    expect(qcd.year.qcPassRate).toBe(0);
    expect(qcd.override).toBe("2 QC rejects in a row");
    // QuickChem never qualified, so it stays unqualified rather than suspended (RFQ-2611-01).
    expect(qcd.status).toBe("unqualified");
    expect(forMaterial("FPO", "SOR").year.qcPassRate).toBeLessThan(1);
    const sms = forMaterial("SMS", "CAC").year;
    expect(sms.onTimeRate).toBeLessThan(1);
    expect(sms.avgDaysLate).toBeGreaterThanOrEqual(5);
    // The price history carries the ascorbic acid hike: $6.40 before, $7.10 after.
    const ngi = cards.priceHistory.find((p) => p.vendor === "NGI" && p.material === "ASC");
    const prices = new Map(ngi?.months);
    expect(ngi?.months[0]?.[1]).toBe(6_400_000);
    expect(prices.get("2026-11")).toBe(7_100_000);
    expect(cards.priceHistory.find((p) => p.vendor === "QCD")?.months.map(([, v]) => v)).toEqual([
      5_900_000,
    ]);
    // QuickChem is the cheapest ascorbic acid but never counts as the best qualified price.
    expect(forMaterial("NGI", "ASC").year.priceCompetitiveness).toBeGreaterThan(0.9);
  });

  it("suspends a qualified supplier after two rejects in a row", () => {
    const twice = scorecards(
      worlds.map((w) => ({
        ...w,
        lots: w.lots.map((l) =>
          l.vendor === "PEC" && l.qc && l.qc.at.slice(0, 10) >= "2026-11-01"
            ? { ...l, qc: { ...l.qc, result: "rejected" as const } }
            : l,
        ),
      })),
      "2026-12-28",
    );
    const pec = twice.suppliers.find((s) => s.vendor === "PEC");
    if ((pec?.year.consecutiveRejects ?? 0) >= 2) expect(pec?.status).toBe("suspended");
    expect(supplier("NGI").status).toBe("qualified");
    expect(supplier("NGI").override).toBeNull();
  });
});
