// The twelve-month worlds on the sim clock: the range becomes the worlds' year plus the
// simulated weeks, a seek stays fast with every month loaded, the recorded run's window replays
// exactly as before, and the feed speaks the new kinds without chain words.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventsToFeed, type FeedContext } from "./activity.ts";
import { createClock, stepAt } from "./clock.ts";
import { buildEvents, type SimEvent, stepTimes } from "./engine.ts";
import { plantsSnapshot } from "./plants.ts";
import { run } from "./run.ts";
import { loadOrder, WORLD_INDEX, WORLD_SPAN } from "./worldEvents.ts";

const month = (m: string) =>
  JSON.parse(
    readFileSync(new URL(`./data/world/${m}.json`, import.meta.url), "utf8"),
  ) as SimEvent[];
const worldEvents = WORLD_INDEX.months.flatMap((m) => month(m.month));
const ctx: FeedContext = { steps: run.steps, approvals: run.approvals };
const CHAIN_WORDS = /\b(tx|hash|wallet|token|gas|DTUSD|USDC|testnet|contract|escrow)\b/i;

const clockWith = (events: SimEvent[]) => {
  const clock = createClock({
    history: plantsSnapshot,
    steps: run.steps,
    span: WORLD_SPAN,
    frames: null,
  });
  clock.addEvents(events);
  return clock;
};

describe("the worlds on the clock", () => {
  it("spans the twelve months and the simulated weeks before a month has loaded", () => {
    const bare = clockWith([]);
    expect(new Date(bare.range.start).toISOString().slice(0, 7)).toBe("2025-12");
    expect(new Date(bare.range.end).toISOString().slice(0, 10) >= "2026-12-28").toBe(true);
    expect(bare.range.golden.start).toBe(stepTimes(run.steps)[0]);
    expect(bare.get().simNow).toBe(bare.range.golden.start);
    // The month the clock shows loads first, then outward from it.
    expect(loadOrder(Date.parse("2026-11-09T13:00:00.000Z")).slice(0, 3)).toEqual([
      "2026-11",
      "2026-10",
      "2026-12",
    ]);
  });

  it("replays the recorded run's window exactly, every month loaded", () => {
    const times = stepTimes(run.steps);
    const base = buildEvents(plantsSnapshot, run.steps);
    const full = clockWith(worldEvents);
    const within = (e: { at: number }) => e.at >= (times[0] ?? 0) && e.at <= (times.at(-1) ?? 0);
    expect(full.events().filter(within)).toEqual(base.filter(within));
    const before = eventsToFeed(base, times.at(-1) ?? 0, ctx).filter(within);
    const after = eventsToFeed(full.events(), times.at(-1) ?? 0, ctx).filter(within);
    expect(after).toEqual(before);
    for (const t of times) {
      full.seek(t);
      expect(stepAt(full.get().simNow, full.range)).toBe(times.indexOf(t));
      expect(full.world().step).toBe(times.indexOf(t));
    }
  });

  it("seeks anywhere in the year in well under 150 ms", () => {
    const clock = clockWith(worldEvents);
    const span = clock.range.end - clock.range.start;
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      clock.seek(clock.range.start + ((i * 7919) % 1000) * (span / 1000));
      clock.world();
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(150);
    // A January seek finds the year's batches folded in, at every plant.
    clock.seek(Date.parse("2026-02-01T00:00:00.000Z"));
    const w = clock.world();
    expect(Object.keys(w.batches).sort()).toEqual(["A", "B"]);
  });

  it("gives the feed a line for each new kind, in plant words", () => {
    const feed = eventsToFeed(worldEvents, Number.POSITIVE_INFINITY, ctx);
    const types = new Set(feed.map((i) => i.type));
    for (const t of [
      "shipped",
      "qc_released",
      "anomaly",
      "price_drift",
      "credential_event",
    ] as const)
      expect(types.has(t), t).toBe(true);
    expect(feed.some((i) => /^QC rejected ASC-\d{6}-\d{2} \(Ascorbic acid/.test(i.text))).toBe(
      true,
    );
    expect(feed.some((i) => i.text.startsWith("QuickChem Direct fails two trial lots"))).toBe(true);
    expect(
      feed.some((i) => /Acme Lakeview sent \d+ lots? of packaging to Hollow Pine/.test(i.text)),
    ).toBe(true);
    for (const i of feed) {
      expect(i.text, i.text).not.toMatch(CHAIN_WORDS);
      expect(i.records.length).toBeGreaterThan(0);
    }
  });
});
