// The Suppliers page's reads over the committed snapshot (web/src/data/suppliers.json): the
// leaderboard at the clock's date, the credential chips, and "Why Kevin picks them".

import { describe, expect, it } from "vitest";
import pages from "./data/pages.json";
import raw from "./data/suppliers.json";
import type { SupplierStanding } from "./reads.ts";
import {
  COMPONENTS,
  cardAt,
  credentialOf,
  formulaText,
  gridIndex,
  leaderboard,
  recordsAt,
  rfqsFor,
  type SuppliersData,
  standingOf,
  whyLines,
} from "./suppliers.ts";

const data = raw as unknown as SuppliersData;
const standings = pages.recorded.credentials.suppliers as unknown as SupplierStanding[];
const names = data.view.names;
const nameOf = (v: string) => names[v]?.name ?? v;
const card = (vendor: string) => {
  const c = data.view.cards.find((x) => x.vendor === vendor && x.material === null);
  if (!c) throw new Error(`no card for ${vendor}`);
  return c;
};
const at = (vendor: string, date: string) =>
  cardAt(card(vendor), data.view.dates, gridIndex(data.view.dates, date));

describe("the leaderboard at the clock's date", () => {
  it("puts the recorded run's last day on the weekly grid", () => {
    expect(data.view.dates).toContain(data.asOf);
    expect(gridIndex(data.view.dates, "2025-01-01")).toBe(-1);
    expect(leaderboard(data, "2025-01-01", standings)).toEqual([]);
  });

  it("lists the suppliers in score order, unscored last", () => {
    for (const date of [data.asOf, "2026-02-15", "2026-07-01"]) {
      const rows = leaderboard(data, date, standings);
      expect(rows.length).toBeGreaterThan(5);
      const scores = rows.map((r) => (r.score === null ? -1 : r.score));
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("scores at the recorded run's end as the server's scorecards do", () => {
    const rows = leaderboard(data, data.asOf, standings);
    for (const s of raw.suppliers) {
      const row = rows.find((r) => r.vendor === s.vendor);
      expect(row?.score).toBe(s.override ? null : s.scoreTrailing);
      expect(row?.status).toBe(s.status);
    }
  });

  it("moves with the clock where the records do", () => {
    // Northgate's New Year truck ran ten days late (INC-01): its on-time rate fell, then recovered.
    const winter = at("NGI", "2026-02-01");
    const run = at("NGI", data.asOf);
    expect(winter?.onTime).toBeLessThan(1);
    expect(winter?.score).toBeLessThan(run?.score ?? 0);
    // QuickChem's two trial lots both failed (INC-05): the override from late June on.
    expect(at("QCD", "2026-06-15")?.override).toBeNull();
    expect(at("QCD", "2026-07-01")?.override).toBe("2 QC rejects in a row");
    expect(at("QCD", "2026-07-01")?.score).toBeNull();
    expect(at("QCD", "2026-05-01")).toBeNull();
  });
});

describe("credentials in staff words", () => {
  it("reads the contract's recorded standing first, the scorecard's status else", () => {
    const chip = (vendor: string, date = data.asOf) =>
      credentialOf(at(vendor, date)?.status ?? "", standingOf(vendor, names, standings));
    expect(chip("PEC")).toBe("suspended");
    expect(chip("FPO")).toBe("revoked");
    expect(chip("SMS")).toBe("expired");
    expect(chip("BLS")).toBe("active");
    expect(chip("NGI")).toBe("active");
    // QuickChem was never qualified and holds no credential.
    expect(standingOf("QCD", names, standings)).toBeUndefined();
    expect(chip("QCD")).toBe("not qualified");
  });
});

describe("Why Kevin picks them", () => {
  it("names the recorded winner of RFQ-2611-01, the runner-up and who was left out", () => {
    const rfq = data.recorded.rfqs.find((r) => r.rfqNo === "RFQ-2611-01");
    if (!rfq) throw new Error("RFQ-2611-01 not in the snapshot");
    const [first, second] = whyLines(rfq, nameOf, () => null);
    expect(first).toBe(
      "Northgate Ingredients selected: lowest landed cost of the qualified quotes, $5,150.00 for 700 kg ($7.10/kg + $180.00 freight), 7 days.",
    );
    expect(second).toBe(
      "Ridgeway Ascorbics runner-up at $5,310.00 ($7.35/kg, 5 days); QuickChem Direct excluded at $5.90/kg: not qualified.",
    );
  });

  it("names each RFQ's recorded winner first", () => {
    for (const rfq of [...data.recorded.rfqs, ...data.view.rfqs]) {
      const [first] = whyLines(rfq, nameOf, () => null);
      expect(first.startsWith(`${nameOf(rfq.winner)} selected`)).toBe(true);
    }
  });

  it("lists the recorded RFQ first among a supplier's latest on its day", () => {
    const rfqs = rfqsFor(data, "NGI", data.asOf);
    expect(rfqs[0]?.rfqNo).toBe("RFQ-2611-01");
    expect(rfqsFor(data, "NGI", "2026-11-08").map((r) => r.rfqNo)).not.toContain("RFQ-2611-01");
  });
});

describe("the detail view's records and the formula", () => {
  it("shows a QC result only once it was in", () => {
    const lots = data.view.records.QCD?.lots ?? [];
    const first = lots[0];
    expect(first?.[4]).toBe("rejected");
    const before = recordsAt(data, "QCD", first?.[1] ?? "");
    expect(before.lots[0]?.[4]).toBeNull();
    expect(recordsAt(data, "QCD", first?.[5] ?? "").lots[0]?.[4]).toBe("rejected");
  });

  it("writes the formula from the weights the scorecards used", () => {
    const text = formulaText(data.weights);
    for (const c of COMPONENTS) expect(text).toContain(`${data.weights[c.key]}·${c.label}`);
    const sum = Object.values(data.weights).reduce((s, w) => s + w, 0);
    expect(text.endsWith(`/ ${sum}`)).toBe(true);
  });
});
