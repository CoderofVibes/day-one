import { describe, expect, it } from "vitest";
import {
  coalesce,
  eventsToFeed,
  type FeedContext,
  type FeedItem,
  feedForPlant,
  filterFeed,
  IDLE_AFTER_MS,
  kevinStatus,
  pageForRecord,
  recordIds,
  timeLabel,
} from "./activity.ts";
import { createClock } from "./clock.ts";
import { buildEvents, hashEvents, MINUTE_MS, simDay, stepTimes } from "./engine.ts";
import { plantsSnapshot } from "./plants.ts";
import { run } from "./run.ts";

const events = buildEvents(plantsSnapshot, run.steps);
const ctx: FeedContext = { steps: run.steps, approvals: run.approvals };
const times = stepTimes(run.steps);
const end = times.at(-1) as number;
const feed = eventsToFeed(events, end, ctx);
const runItems = feed.filter((i) => i.step !== undefined);

/** Chain words staff must never read (src/run.test.ts keeps the same list for step cards). */
const CHAIN_WORDS = /\b(tx|hash|wallet|token|gas|DTUSD|USDC|testnet|anchor\w*|contract|escrow)\b/i;

describe("Kevin's activity feed", () => {
  it("is the same for the same events and range, and a prefix of a later range", () => {
    const again = eventsToFeed(buildEvents(plantsSnapshot, run.steps), end, ctx);
    expect(JSON.stringify(again)).toBe(JSON.stringify(feed));
    expect(hashEvents(events)).toBe(hashEvents(buildEvents(plantsSnapshot, run.steps)));
    const earlier = eventsToFeed(events, times[7] as number, ctx);
    expect(earlier.map((i) => i.id)).toEqual(feed.slice(0, earlier.length).map((i) => i.id));
    expect(earlier.at(-1)?.needs?.who).toBe("Linda Park");
  });

  it("links every item to at least one record and keeps ids unique", () => {
    expect(feed.length).toBeGreaterThan(100);
    for (const item of feed) expect(item.records.length, item.text).toBeGreaterThan(0);
    expect(new Set(feed.map((i) => i.id)).size).toBe(feed.length);
  });

  it("speaks plant language: no chain words in any line", () => {
    for (const item of feed) expect(item.text, item.text).not.toMatch(CHAIN_WORDS);
  });

  it("tells the recorded run with its own ids, amounts and order", () => {
    const lines = runItems.map((i) => `${i.type} | ${i.text}`);
    expect(lines).toEqual([
      "read_record | Read batch record BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.",
      "inventory_update | Ray confirmed BR-B-1045; I posted its consumption. Ascorbic acid at Plant B: 722.4 kg → 310.0 kg (reorder point 500 kg).",
      "anomaly | Plant A still shows 12.55 kg of lot ASC-261009-01, but Plant B weighed in 187.45 kg of the 200 kg sent. Proposed adjustment sent to Plant A for review.",
      "reorder_trigger | Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. Recommend ordering 700 kg.",
      "rfq_sent | Asked 3 suppliers for quotes, RFQ-2611-01",
      "quote_received | Quotes back on RFQ-2611-01: QuickChem Direct $5.90/kg excluded: vendor not qualified. Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up.",
      "escrow_funded | Sent PO-1041 to Bayfront Lab Supply, $612.00: approved automatically and funded.",
      "po_drafted | Drafted PO-1042, $5,150.00 to Northgate Ingredients",
      "po_refused | The spend policy refused PO-1042: $5,150.00 is over my $2,500.00 limit. Texted Linda.",
      "approval_requested | Waiting on Linda: YES 1042 or NO 1042",
      "approval_received | Linda Park approved PO-1042 by text (YES 1042)",
      "escrow_funded | Sent PO-1042 to Northgate Ingredients. Funds held until delivery passes QC.",
      "truck_arrived | Tommy photographed the packing slip. Matches PO-1042: 700 kg ascorbic acid, supplier lot NG-24-8812. Lot ASC-261116-01 is in quarantine.",
      "qc_released | Priya released lot ASC-261116-01.",
      "paid | Paid $5,150.00 for PO-1042. Invoice matched to PO and receipt.",
    ]);
    // Every number a recorded line carries is in Kevin's item, unchanged. Loading the seed is
    // Day One's setup, not Kevin's work, so it has no item.
    for (const step of run.steps.filter((s) => s.title !== "Load seed")) {
      const text = runItems
        .filter((i) => run.steps[i.step as number] === step)
        .map((i) => i.text)
        .join(" ");
      for (const n of step.staff.join(" ").match(/\$?[\d,]+(\.\d+)?/g) ?? [])
        expect(text, step.title).toContain(n);
    }
    // Each item sits at its recorded step's time on the clock.
    for (const i of runItems) expect(i.at).toBe(times[i.step as number]);
  });

  it("follows the plant picker: one plant's lines, or every plant's", () => {
    const at = (plant: "A" | "B" | "C") => feedForPlant(feed, plant);
    expect(feedForPlant(feed, "all")).toEqual(feed);
    // The recorded run is Hollow Pine's; Riverside sees none of it, only its own batches.
    for (const i of runItems) expect(i.plants).toEqual(["B"]);
    expect(at("B").length).toBeGreaterThan(runItems.length);
    expect(at("A").length).toBeGreaterThan(0);
    expect(at("A").some((i) => i.step !== undefined)).toBe(false);
    for (const plant of ["A", "B", "C"] as const)
      for (const i of at(plant)) expect(i.plants ?? [plant], i.text).toContain(plant);
    // Every line lands at some plant: the three views together cover the whole feed.
    const covered = new Set([...at("A"), ...at("B"), ...at("C")].map((i) => i.id));
    expect(covered.size).toBe(feed.length);
  });

  it("puts the run's chain lines behind the Chain filter, with the recorded transactions", () => {
    const chain = filterFeed(feed, "chain");
    const txs = chain.flatMap((i) => i.chain ?? []).flatMap((c) => (c.tx ? [c.tx] : []));
    const recorded = run.steps.flatMap((s) =>
      s.staff.length ? s.chain.flatMap((c) => (c.tx ? [c.tx] : [])) : [],
    );
    expect(txs).toEqual(recorded);
    expect(filterFeed(feed, "money").every((i) => i.groups.includes("money"))).toBe(true);
    expect(filterFeed(feed, "quality").some((i) => i.type === "qc_released")).toBe(true);
  });

  it("waits on the person whose turn is next, and only on the latest item", () => {
    const at = (step: number) => eventsToFeed(events, times[step] as number, ctx);
    expect(at(1).at(-1)?.needs).toEqual({ who: "Ray Delgado", role: "Purchaser" });
    expect(at(3).at(-1)?.needs).toBeUndefined();
    expect(at(11).at(-1)?.needs?.who).toBe("Priya Natarajan");
    expect(feed.filter((i) => i.needs)).toEqual([]);
    expect(at(7).filter((i) => i.needs)).toHaveLength(1);
    expect(filterFeed(at(7), "person")).toHaveLength(1);
    // A live source says who is next itself.
    const live = eventsToFeed(events, times[3] as number, {
      ...ctx,
      next: { who: "Ray Delgado", role: "Purchaser" },
    });
    expect(live.at(-1)?.needs?.who).toBe("Ray Delgado");
  });

  it("tells the seed's history from its events: batches, deliveries and payments", () => {
    const history = feed.filter((i) => i.step === undefined);
    const batches = plantsSnapshot.massBalance.batches.filter(
      (b) => b.completedAt && Date.parse(b.completedAt) < (times[0] as number),
    );
    expect(history.filter((i) => i.type === "inventory_update")).toHaveLength(batches.length);
    const po = plantsSnapshot.books.settled[0];
    expect(history).toContainEqual(
      expect.objectContaining({ type: "paid", text: "Paid $15,900.00 for PO-1007" }),
    );
    expect(po?.poNo).toBe("PO-1007");
    expect(history.every((i) => i.routine)).toBe(true);
  });

  it("reads the same events from the clock", () => {
    const clock = createClock({ history: plantsSnapshot, steps: run.steps, frames: null });
    expect(eventsToFeed(clock.events(), end, ctx)).toEqual(feed);
  });

  it("picks up a longer history through the same function: a synthetic year of batches", () => {
    const day = 86_400_000;
    const start = Date.parse("2025-11-09T20:00:00.000Z");
    const batches = Array.from({ length: 365 * 6 }, (_, i) => ({
      batchNo: `BR-B-${String(10_000 + i)}`,
      facility: "ABC"[i % 3] as string,
      completedAt: new Date(start + Math.floor(i / 6) * day + (i % 6) * 3_600_000).toISOString(),
      tablets: 500_000 + i,
    }));
    const year = buildEvents({ massBalance: { batches }, books: { settled: [] } }, run.steps);
    const t0 = performance.now();
    const items = eventsToFeed(year, end, ctx);
    const rows = coalesce(items);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(items.filter((i) => i.type === "inventory_update" && i.routine)).toHaveLength(
      batches.length,
    );
    // Six batches a day fold to one row a day.
    expect(rows.length).toBeLessThan(365 + runItems.length + 5);
    expect(items.at(-1)?.text).toBe(feed.at(-1)?.text);
  });

  it("opens each record on the page that lists it", () => {
    expect(pageForRecord("BR-B-1045")).toEqual({ page: "batches", plant: "B" });
    expect(pageForRecord("ASC-261116-01")).toEqual({ page: "inventory" });
    expect(pageForRecord("ASC")).toEqual({ page: "inventory" });
    expect(pageForRecord("NG-INV-24190")).toEqual({ page: "invoices" });
    expect(pageForRecord("PO-1042")).toEqual({ page: "purchasing" });
    expect(pageForRecord("RFQ-2611-01")).toEqual({ page: "purchasing" });
  });

  it("finds record ids in a line", () => {
    expect(
      recordIds("Matches PO-1042: lot ASC-261116-01, BR-B-1045, RFQ-2611-01, PO-G-2001"),
    ).toEqual(["PO-1042", "ASC-261116-01", "BR-B-1045", "RFQ-2611-01", "PO-G-2001"]);
    expect(recordIds("NG-INV-24190 and ADJ-515")).toEqual(["NG-INV-24190", "ADJ-515"]);
  });

  it("labels times on the clock's day plainly and other days with the date", () => {
    expect(timeLabel(times[0] as number, times[0] as number)).toBe("5:00 AM");
    expect(timeLabel(times[11] as number, times[0] as number)).toBe("Nov 16 · 6:20 AM");
  });
});

describe("coalescing routine items", () => {
  const item = (n: number, routine: boolean): FeedItem => ({
    id: `e${n}`,
    at: n * MINUTE_MS,
    type: routine ? "inventory_update" : "paid",
    text: `item ${n}`,
    records: [`PO-${n}`],
    groups: [],
    routine,
  });
  const items = [
    ...Array.from({ length: 14 }, (_, i) => item(i, true)),
    item(14, false),
    item(15, true),
  ];

  it("folds a run of routine items into one row, newest first", () => {
    const rows = coalesce(items);
    expect(rows.map((r) => (r.kind === "item" ? r.item.id : `+${r.items.length}`))).toEqual([
      "e15",
      "e14",
      "+14",
    ]);
  });

  it("keeps a folded run open once expanded, and short runs unfolded", () => {
    const folded = coalesce(items)[2];
    const open = new Set([folded?.kind === "routine" ? folded.id : ""]);
    expect(coalesce(items, 3, open)).toHaveLength(16);
    expect(coalesce(items.slice(12), 3)).toHaveLength(4);
  });

  it("folds the seed's history day by day", () => {
    const rows = coalesce(feed);
    const folded = rows.flatMap((r) => (r.kind === "routine" ? [r.items] : []));
    expect(folded.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(feed.length);
    for (const run of folded)
      expect(new Set(run.map((i) => simDay(i.at))).size, run[0]?.id).toBe(1);
  });
});

describe("Kevin's status", () => {
  const at = (step: number) => eventsToFeed(events, times[step] as number, ctx);
  const status = (step: number, later = 0) =>
    kevinStatus(at(step), (times[step] as number) + later).label;

  it("follows the latest item", () => {
    expect(kevinStatus([], times[0] as number).label).toBe("idle");
    expect(status(0)).toBe("idle");
    expect(status(1)).toBe("waiting on Ray");
    expect(status(3)).toBe("reading");
    expect(status(5)).toBe("drafting");
    expect(status(7)).toBe("waiting on Linda");
    expect(status(8)).toBe("signed");
    expect(status(9)).toBe("paying");
    expect(status(13)).toBe("paying");
  });

  it("goes idle a while after his last item, but keeps waiting on a person", () => {
    expect(status(13, IDLE_AFTER_MS)).toBe("idle");
    expect(status(7, 10 * IDLE_AFTER_MS)).toBe("waiting on Linda");
    expect(kevinStatus(at(9), times[9] as number).working).toBe(true);
    expect(kevinStatus(at(7), times[7] as number).working).toBe(false);
  });
});
