import { beforeAll, describe, expect, it } from "vitest";
import { HISTORY_BATCHES } from "../seed/history.ts";
import { seedLedger } from "../seed/index.ts";
import { type Ledger, openLedger } from "./db.ts";
import {
  historySeries,
  productionSeries,
  qcSeries,
  reorderSeries,
  spendSeries,
  stockedMaterials,
  stockSeries,
} from "./series.ts";

let db: Ledger;
beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

const KG = 1_000_000;

describe("the charts' series (docs/VISION.md §6.7)", () => {
  it("lists every confirmed batch oldest first, with its yield, waste and what it issued", () => {
    const batches = productionSeries(db);
    expect(batches).toHaveLength(78);
    expect(batches.map((b) => b.date)).toEqual([...batches.map((b) => b.date)].sort());
    const br1038 = batches.find((b) => b.batchNo === "BR-B-1038");
    // FICTIONAL_DATA §15: Hollow Pine balances; 842.5 kg issued, 83.75 kg written waste.
    expect(br1038).toMatchObject({
      facility: "B",
      product: "P-CMD",
      date: "2026-10-19",
      units: 450_000,
      yieldBp: 9_000,
      wasteBase: 83.75 * KG,
      issuedBase: 842.5 * KG,
    });
    for (const no of HISTORY_BATCHES.map((b) => b.batchNo)) {
      expect(
        batches.some((b) => b.batchNo === no),
        no,
      ).toBe(true);
    }
  });

  it("walks ascorbic acid at Hollow Pine to 722.350 kg before BR-B-1045", () => {
    const s = stockSeries(db, { facility: "B", material: "ASC" });
    expect(s?.reorderPointBase).toBe(500 * KG);
    expect(s?.points.at(-1)?.onHandBase).toBe(722.35 * KG);
    expect(s?.points.at(-1)?.kind).toBe("transfer_in");
    // Every point is the running sum of the changes before it.
    let sum = 0;
    for (const p of s?.points ?? []) {
      sum += p.deltaBase;
      expect(p.onHandBase).toBe(sum);
    }
    expect(stockSeries(db, { facility: "B", material: "NOPE" })).toBeNull();
    expect(stockedMaterials(db, "B")).toContain("PSY");
    expect(stockedMaterials(db, "B")).not.toContain("MBG");
  });

  it("books spend in the month the goods arrived, per plant and category", () => {
    const { months, committed } = spendSeries(db);
    const total = months.reduce((s, m) => s + m.totalUsdc, 0);
    // The plant's earlier POs and the pack's six: every received PO in the seed.
    expect(total).toBe(185_710_850_000);
    expect(months.reduce((s, m) => s + m.pos, 0)).toBe(34);
    expect(new Set(months.map((m) => m.month))).toEqual(new Set(["2026-08", "2026-09", "2026-10"]));
    expect(committed).toEqual([]);
  });

  it("counts QC decisions per month and plant, the rejected CCS lot among them", () => {
    const qc = qcSeries(db);
    const oct = qc.find((m) => m.month === "2026-10" && m.facility === "B");
    expect(oct?.rejected).toBe(1);
    expect(qc.reduce((s, m) => s + m.released + m.rejected, 0)).toBeGreaterThan(200);
    expect(historySeries(db).qc).toEqual(qc);
  });

  it("counts, week by week, the materials each plant held below their reorder point", () => {
    const weeks = reorderSeries(db);
    expect(weeks[0]?.week).toBe("2026-07-06");
    expect(new Set(weeks.map((w) => w.week.length))).toEqual(new Set([10]));
    // The week of the demo clock (Nov 9): Hollow Pine's bottles and caps, its acetonitrile and
    // buffer… as the brief and the three-plant view say; ascorbic acid is still above 500 kg.
    const last = weeks.filter((w) => w.facility === "B").at(-1);
    expect(last?.week).toBe("2026-11-02");
    expect(last?.below).toBeGreaterThan(0);
    for (const w of weeks) expect(["A", "B", "C"]).toContain(w.facility);
  });
});
