// The worlds' events for the sim clock: nothing anchored, nothing inside the recorded run's
// window, every plant and every kind, split by month with an index that adds up.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Anchors } from "./anchors.ts";
import { WORLDS } from "./config.ts";
import { type WorldEventIndex, worldEventFiles, worldEvents } from "./events.ts";
import { generateWorlds, type World } from "./index.ts";

const load = (slug: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../data/world/${slug}.anchors.json`, import.meta.url), "utf8"),
  ) as Anchors;
const worlds = Object.values(
  generateWorlds(WORLDS, { B: load("hollow-pine"), A: load("riverside"), C: load("lakeview") }),
) as World[];
const events = worldEvents(worlds);

describe("world events", () => {
  it("leave the anchors and the recorded run's window to the data the clock already has", () => {
    const from = Date.parse("2026-11-09T00:00:00.000Z");
    const to = Date.parse("2026-11-17T00:00:00.000Z");
    expect(events.filter((e) => e.at >= from && e.at < to)).toEqual([]);
    const anchored = new Set(
      worlds.flatMap((w) =>
        w.batches.filter((b) => b.era === "anchor").map((b) => `batch:${b.batchNo}`),
      ),
    );
    expect(events.some((e) => anchored.has(e.id))).toBe(false);
    for (let i = 1; i < events.length; i++)
      expect(events[i]?.at).toBeGreaterThanOrEqual(events[i - 1]?.at ?? 0);
  });

  it("carry every plant and kind, and the incidents", () => {
    expect(new Set(events.map((e) => e.facility))).toEqual(new Set(["A", "B", "C"]));
    expect(new Set(events.map((e) => e.kind))).toEqual(
      new Set(["batch", "received", "paid", "qc", "shipment", "transfer", "incident"]),
    );
    const ids = events.filter((e) => e.kind === "incident").map((e) => e.id);
    for (const id of ["INC-01", "INC-02", "INC-04", "INC-05", "INC-08"])
      expect(ids.some((x) => x.startsWith(`incident:${id}:`))).toBe(true);
  });

  it("split by month, the index counting each file", () => {
    const files = worldEventFiles(worlds);
    const [name, index] = files[0] as [string, WorldEventIndex];
    expect(name).toBe("index.json");
    expect(index.months.map((m) => m.file)).toEqual(files.slice(1).map(([f]) => f));
    expect(index.months.reduce((t, m) => t + m.events, 0)).toBe(events.length);
    expect(index.months[0]?.month).toBe("2025-12");
    expect(index.months.at(-1)?.month).toBe("2026-12");
  });
});
