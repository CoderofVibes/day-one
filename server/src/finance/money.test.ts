// Each formula against a small book worked out by hand (docs/UPGRADE_BRIEF.md §2.4 acceptance).

import { describe, expect, it } from "vitest";
import {
  agingBucket,
  answerCostUsdc,
  apAging,
  cashFlow,
  cashOnHand,
  cogs,
  daysOnHand,
  deadStock,
  doubleCounted,
  escrowAt,
  inventoryTurns,
  inventoryValue,
  kevinCostAt,
  kevinHeadroom,
  kevinTally,
  landedCosts,
  type MoneyBook,
  overheadFor,
  paidForHimself,
  poSizeHistogram,
  type SavingEntry,
  savingsAt,
  spendVsBudget,
  trailing,
} from "./money.ts";

const $ = (n: number) => Math.round(n * 1_000_000);
const kg = (n: number) => n * 1_000_000;

/**
 * Two lots: 100 kg of ASC at $7.10 + $10 freight on a 100 kg PO ($7.20/kg landed) and 1,000
 * bottles at $0.02. One batch on Mar 10 draws 40 kg ASC and 500 bottles and makes 1,000 units.
 */
function book(): MoneyBook {
  return {
    plant: "B",
    name: "Test plant",
    calendar: {
      start: "2026-01-01",
      spliceIn: "2026-03-01",
      t0: "2026-04-01",
      recordedEnd: "2026-04-10",
      end: "2026-05-31",
    },
    bills: [
      {
        billNo: "X-1",
        era: "legacy",
        vendor: "NGI",
        poNo: "P1",
        billDate: "2026-01-05",
        dueDate: "2026-02-04",
        amountUsdc: $(720),
        paidAt: "2026-02-20T10:00:00.000Z",
        held: false,
      },
      {
        billNo: "X-2",
        era: "legacy",
        vendor: "LOW",
        poNo: "P2",
        billDate: "2026-01-10",
        dueDate: "2026-02-09",
        amountUsdc: $(20),
        paidAt: null,
        held: false,
      },
      {
        billNo: "X-2 dup",
        era: "legacy",
        vendor: "LOW",
        poNo: "P2",
        billDate: "2026-01-11",
        dueDate: "2026-02-10",
        amountUsdc: $(20),
        paidAt: null,
        held: true,
      },
    ],
    payments: [
      {
        paymentNo: "PAY-1",
        era: "legacy",
        amountUsdc: $(720),
        paidAt: "2026-02-20T10:00:00.000Z",
        bills: ["X-1"],
        rail: "erp_ach_mock",
      },
    ],
    invoices: [
      {
        invoiceNo: "INV-1",
        customer: "CMT",
        invoiceDate: "2026-01-02",
        dueDate: "2026-02-01",
        amountUsdc: $(1_000),
        paidAt: "2026-02-03T12:00:00.000Z",
      },
      {
        invoiceNo: "INV-2",
        customer: "CMT",
        invoiceDate: "2026-02-15",
        dueDate: "2026-03-17",
        amountUsdc: $(500),
        paidAt: null,
      },
    ],
    lots: [
      { lot: "ASC-1", material: "ASC", category: "active", costPerBase: 7.2, costFrom: "po" },
      {
        lot: "BTL-1",
        material: "BTL",
        category: "packaging",
        costPerBase: 20_000,
        costFrom: "po",
      },
    ],
    movements: [
      ["2026-01-08T14:00:00.000Z", "ASC-1", "received", kg(100)],
      ["2026-01-12T14:00:00.000Z", "BTL-1", "received", 1_000],
      ["2026-03-10T06:30:00.000Z", "ASC-1", "consumed", -kg(40)],
      ["2026-03-10T06:30:00.000Z", "BTL-1", "consumed", -500],
    ],
    batches: [
      {
        batchNo: "BR-1",
        era: "anchor",
        date: "2026-03-10",
        product: "P-VC500",
        actualUnits: 1_000,
        consumed: [
          ["ASC-1", kg(40)],
          ["BTL-1", 500],
        ],
        fgLot: "FG-1",
      },
    ],
    fgLots: [{ fgLot: "FG-1", product: "P-VC500", batchNo: "BR-1" }],
    fgMovements: [
      ["2026-03-10T18:00:00.000Z", "FG-1", 1_000],
      ["2026-03-20T15:00:00.000Z", "FG-1", -600],
    ],
    pos: [
      {
        poNo: "P1",
        era: "legacy",
        vendor: "NGI",
        orderedAt: "2026-01-02T10:00:00.000Z",
        totalUsdc: $(720),
        freightUsdc: $(10),
        byCategory: { active: $(710) },
        kevin: false,
      },
      {
        poNo: "P3",
        era: "anchor",
        vendor: "NGI",
        orderedAt: "2026-04-02T10:00:00.000Z",
        totalUsdc: $(5_150),
        freightUsdc: $(180),
        byCategory: { active: $(4_970) },
        kevin: true,
      },
      {
        poNo: "P4",
        era: "anchor",
        vendor: "BLS",
        orderedAt: "2026-04-02T10:00:00.000Z",
        totalUsdc: $(612),
        freightUsdc: 0,
        byCategory: { lab_chemical: $(612) },
        kevin: true,
      },
    ],
    escrow: [
      { at: "2026-04-02T10:10:00.000Z", poNo: "P4", deltaUsdc: $(612), source: "recorded" },
      { at: "2026-04-02T10:25:00.000Z", poNo: "P3", deltaUsdc: $(5_150), source: "recorded" },
      { at: "2026-04-09T16:05:00.000Z", poNo: "P3", deltaUsdc: -$(5_150), source: "recorded" },
      { at: "2026-04-12T16:00:00.000Z", poNo: "P4", deltaUsdc: -$(612), source: "simulated" },
    ],
  };
}

const overhead = { laborUsd: 3_100, utilitiesUsd: 310, rentUsd: 0 };

describe("cash flow", () => {
  it("prorates overhead by the days of the month in the window", () => {
    // January has 31 days: 10 of them is 10/31 of $3,410.
    expect(overheadFor(overhead, "2026-01", 10)).toEqual({
      labor: $(1_000),
      utilities: $(100),
      rent: 0,
      total: $(1_100),
    });
  });

  it("is vendor payments plus overhead out, receipts in, with a running total", () => {
    const flow = cashFlow(book(), { from: "2026-01-01", to: "2026-02-28T23:59:59.999Z" }, overhead);
    expect(flow.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
    // January: nothing paid, nothing received, overhead $3,410.
    expect(flow[0]).toMatchObject({ vendorPaymentsUsdc: 0, receiptsUsdc: 0, netUsdc: -$(3_410) });
    // February: $720 paid, $1,000 received, overhead $3,410: net −$3,130; cumulative −$6,540.
    expect(flow[1]).toMatchObject({
      vendorPaymentsUsdc: $(720),
      receiptsUsdc: $(1_000),
      cashOutUsdc: $(4_130),
      netUsdc: -$(3_130),
      cumulativeUsdc: -$(6_540),
    });
    // The page's reconciliation: cash out = Σ vendor payments + modeled overhead.
    for (const m of flow) expect(m.cashOutUsdc).toBe(m.vendorPaymentsUsdc + m.overheadUsdc);
  });

  it("puts cash on hand at opening cash plus the running net", () => {
    expect(cashOnHand(book(), "2026-02-28", 10_000, overhead)).toBe($(10_000 - 6_540));
  });
});

describe("AP aging", () => {
  it("buckets by days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      "Current",
      "1–30",
      "1–30",
      "31–60",
      "31–60",
      "61–90",
      "61–90",
      "90+",
    ]);
  });

  it("holds open bills at the date and leaves held duplicates out", () => {
    // Feb 15: X-1 is 11 days past due and still open; X-2 is 6 days past due; the duplicate is held.
    const a = apAging(book(), "2026-02-15");
    expect(a.totalUsdc).toBe($(740));
    expect(a.buckets.find((b) => b.bucket === "1–30")?.bills.map((b) => b.billNo)).toEqual([
      "X-1",
      "X-2",
    ]);
    expect(a.held.map((b) => b.billNo)).toEqual(["X-2 dup"]);
    // Feb 21: X-1 was paid on Feb 20, 16 days after its due date.
    const after = apAging(book(), "2026-02-21");
    expect(after.totalUsdc).toBe($(20));
    expect(after.paidLate).toEqual({ count: 1, avgDaysLate: 16 });
  });
});

describe("inventory value", () => {
  it("lands freight onto lines by value", () => {
    // $710 + $290 of lines and $100 freight: 71% and 29% of it.
    expect(
      landedCosts(
        [
          { material: "A", qtyBase: 100, extendedUsdc: $(710) },
          { material: "B", qtyBase: 10, extendedUsdc: $(290) },
        ],
        $(100),
      ),
    ).toEqual([$(7.81), $(31.9)]);
  });

  it("values on-hand stock, WIP and finished goods at the date", () => {
    // Mar 9: 100 kg × $7.20 = $720 raw; 1,000 bottles × $0.02 = $20 packaging.
    expect(inventoryValue(book(), "2026-03-09").byClass).toEqual({
      raw: $(720),
      packaging: $(20),
      lab: 0,
      wip: 0,
      finished: 0,
    });
    // Mar 10 at noon: the batch drew 40 kg ($288) and 500 bottles ($10) and has not made its FG.
    const noon = inventoryValue(book(), "2026-03-10T12:00:00.000Z");
    expect(noon.byClass).toMatchObject({ raw: $(432), packaging: $(10), wip: $(298), finished: 0 });
    expect(noon.wipBatches).toEqual(["BR-1"]);
    // Mar 21: 400 finished units left at $0.298 each.
    const later = inventoryValue(book(), "2026-03-21");
    expect(later.byClass).toMatchObject({ wip: 0, finished: $(119.2) });
    expect(later.totalUsdc).toBe($(432 + 10 + 119.2));
  });
});

describe("turns, days on hand and dead stock", () => {
  it("counts the draw cost of batches made in the window as COGS", () => {
    expect(cogs(book(), { from: "2026-03-01", to: "2026-03-31T23:59:59.999Z" }).usdc).toBe($(298));
    expect(cogs(book(), { from: "2026-04-01", to: "2026-04-30T23:59:59.999Z" }).usdc).toBe(0);
  });

  it("annualizes turns over the days in the window", () => {
    // Jan 1–Mar 31 is 90 days; weekly samples average the materials value; COGS $298.
    const t = inventoryTurns(book(), "2026-03-31");
    expect(t.windowDays).toBe(90);
    expect(t.cogsUsdc).toBe($(298));
    const expected = ((298 / (t.avgInventoryUsdc / 1e6)) * 365) / 90;
    expect(t.turns).toBe(Math.round(expected * 10) / 10);
  });

  it("puts days on hand at materials value over the 90-day daily COGS", () => {
    // Mar 31: $442 on hand; $298 over 90 days is $3.311/day: 133 days.
    const d = daysOnHand(book(), "2026-03-31");
    expect(d.valueUsdc).toBe($(442));
    expect(d.days).toBe(Math.round(442 / (298 / 90)));
  });

  it("flags stock with no draw for the given days", () => {
    expect(deadStock(book(), "2026-05-31", 120)).toEqual([]);
    // 120 days after Mar 10 is Jul 8: both materials have gone quiet by Jul 9.
    const dead = deadStock(book(), "2026-07-09", 120);
    expect(dead.map((d) => d.material)).toEqual(["ASC", "BTL"]);
    expect(dead[0]?.valueUsdc).toBe($(432));
  });
});

describe("escrow", () => {
  it("is funded − released at the date, by PO", () => {
    expect(escrowAt(book(), "2026-04-02").heldUsdc).toBe($(5_762));
    const after = escrowAt(book(), "2026-04-10");
    expect(after.heldUsdc).toBe($(612));
    expect(after.byPo).toEqual([{ poNo: "P4", heldUsdc: $(612), source: "recorded" }]);
    expect(escrowAt(book(), "2026-04-13").heldUsdc).toBe(0);
  });
});

describe("spend vs budget, headroom and PO sizes", () => {
  it("adds PO lines by category and freight on its own", () => {
    const cells = spendVsBudget(
      book(),
      { from: "2026-04-01", to: "2026-04-30T23:59:59.999Z" },
      { active: 10_000, lab_chemical: 500, freight: 100 },
    );
    const of = (c: string) => cells.find((x) => x.category === c);
    expect(of("active")).toMatchObject({ spendUsdc: $(4_970), ofBudgetBp: 4_970 });
    expect(of("lab_chemical")).toMatchObject({ spendUsdc: $(612), ofBudgetBp: 12_240 });
    expect(of("freight")).toMatchObject({ spendUsdc: $(180), ofBudgetBp: 18_000 });
  });

  it("counts Kevin's POs this month against his limit", () => {
    expect(kevinHeadroom(book(), "2026-04-30", 60_000)).toMatchObject({
      committedUsdc: $(5_762),
      headroomUsdc: $(54_238),
      pos: ["P3", "P4"],
    });
  });

  it("bins PO totals and lists the ones over the per-PO limit", () => {
    const h = poSizeHistogram(
      book(),
      { from: "2026-01-01", to: "2026-05-31T23:59:59.999Z" },
      500,
      2_500,
    );
    expect(h.overLimit).toEqual(["P3"]);
    expect(h.bins[1]).toMatchObject({ fromUsd: 500, legacy: 1, kevin: 1 });
    expect(h.bins.at(-1)?.pos).toEqual(["P3"]);
  });
});

const entry = (over: Partial<SavingEntry>): SavingEntry => ({
  id: "S",
  type: "duplicate_invoice",
  plant: "B",
  title: "",
  amountUsdc: $(100),
  status: "realized",
  identifiedAt: "2026-04-02",
  realizedAt: "2026-04-02",
  evidence: [],
  formula: "",
  working: "",
  era: "anchor",
  ...over,
});

describe("savings and Kevin's cost", () => {
  const entries = [
    entry({ id: "a", evidence: ["X-2 dup"], realizedAt: "2026-04-02T12:00:00.000Z" }),
    entry({
      id: "b",
      evidence: ["P3"],
      amountUsdc: $(400),
      realizedAt: "2026-04-09T16:05:00.000Z",
    }),
    entry({
      id: "c",
      evidence: ["BR-1"],
      status: "identified",
      realizedAt: null,
      amountUsdc: $(50),
    }),
    entry({ id: "d", evidence: ["P1"], identifiedAt: "2026-01-20", realizedAt: "2026-01-20" }),
    entry({ id: "e", plant: "A", evidence: ["P9"] }),
  ];

  it("realizes a saving only from its date, and only since T0", () => {
    const early = savingsAt(entries, "2026-04-05", ["B"], "2026-04-01");
    expect(early.realizedUsdc).toBe($(100));
    expect(early.identifiedUsdc).toBe($(450));
    const late = savingsAt(entries, "2026-04-30", ["B"], "2026-04-01");
    expect(late.realizedUsdc).toBe($(500));
    expect(late.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("finds an evidence record backing two entries", () => {
    expect(doubleCounted(entries)).toEqual([]);
    expect(doubleCounted([...entries, entry({ id: "f", evidence: ["P3"] })])).toEqual(["P3"]);
  });

  it("prices an answer's tokens at the rate, or the flat rate without them", () => {
    const c = {
      feeUsdPerMonth: 365 / 12,
      inputUsdPerMTok: 1,
      outputUsdPerMTok: 2,
      usdPerAnswer: 0.01,
    };
    expect(answerCostUsdc({ file: "x", inputTokens: 1_000_000, outputTokens: 500_000 }, c)).toBe(
      $(2),
    );
    expect(answerCostUsdc({ file: "x", inputTokens: null, outputTokens: null }, c)).toBe($(0.01));
    // $365 a year is $1 a day: Apr 1–10 is ten days for two plants.
    const cost = kevinCostAt(
      "2026-04-10",
      "2026-04-01",
      2,
      [{ file: "x", inputTokens: 1_000_000, outputTokens: 0 }],
      c,
    );
    expect(cost).toMatchObject({ days: 10, feeUsdc: $(20), inferenceUsdc: $(1), totalUsdc: $(21) });
    expect(kevinCostAt("2026-03-31", "2026-04-01", 2, [], c).totalUsdc).toBe(0);
  });

  it("puts value over cost, realized only unless identified is asked for", () => {
    const s = savingsAt(entries, "2026-04-30", ["B"], "2026-04-01");
    const cost = {
      days: 30,
      plants: 1,
      feeUsdc: $(250),
      inferenceUsdc: 0,
      gasUsdc: 0 as const,
      totalUsdc: $(250),
      answers: 0,
      metered: 0,
    };
    const p = paidForHimself(s, cost, "2026-04-01", false);
    expect(p).toMatchObject({ valueUsdc: $(500), ratio: 2, breakEven: 1 });
    expect(p.timeline.map((x) => [x.id, x.runningUsdc])).toEqual([
      ["a", $(100)],
      ["b", $(500)],
    ]);
    expect(paidForHimself(s, cost, "2026-04-01", true).valueUsdc).toBe($(550));
  });

  it("starts the window at the book's first day", () => {
    expect(trailing(book().calendar, "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31T23:59:59.999Z",
    });
  });
});

describe("the counter", () => {
  const c = { feeUsdPerMonth: 365 / 12, inputUsdPerMTok: 1, outputUsdPerMTok: 0, usdPerAnswer: 0 };
  const entries = [
    entry({ id: "b1", plant: "B", evidence: ["x"], amountUsdc: $(40), realizedAt: "2026-04-03" }),
    entry({ id: "a1", plant: "A", evidence: ["y"], amountUsdc: $(10), realizedAt: "2026-04-05" }),
  ];
  const t = {
    t0: "2026-04-01",
    entries,
    answers: [{ file: "f", inputTokens: 1_000_000, outputTokens: 0 }],
    kevinCost: c,
    kevinPlants: ["A", "B"],
    answersPlant: "B",
  };

  it("charges one plant's fee and its own answers", () => {
    // Apr 1–10: $10 of fee + $1 of inference against $40 realized.
    const b = kevinTally(t, "2026-04-10", "B");
    expect(b.cost.totalUsdc).toBe($(11));
    expect(b.paid).toMatchObject({ valueUsdc: $(40), ratio: 3.6 });
    // Riverside: $10 of fee, no answers, $10 realized.
    expect(kevinTally(t, "2026-04-10", "A").paid).toMatchObject({ costUsdc: $(10), ratio: 1 });
  });

  it("adds every plant up for all", () => {
    const all = kevinTally(t, "2026-04-10", "all");
    expect(all.cost.totalUsdc).toBe($(21));
    expect(all.paid.valueUsdc).toBe($(50));
  });
});
