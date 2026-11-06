import { describe, expect, it } from "vitest";
import { incidentMarkers, jumpsFor, worldJumps } from "./ClockBar.tsx";
import {
  type Clock,
  createClock,
  DEFAULT_SEED,
  modeAt,
  persisted,
  REACT_HZ,
  readout,
  readPersisted,
  SPEEDS,
  stepAt,
} from "./clock.ts";
import { plantsSnapshot } from "./plants.ts";
import { run } from "./run.ts";
import { WORLD_INDEX, WORLD_SPAN } from "./worldEvents.ts";

const make = (initial = {}): Clock =>
  createClock({ history: plantsSnapshot, steps: run.steps, frames: null, initial });

describe("the sim clock", () => {
  it("opens paused at 5:00 AM on the recorded run's day, on its first step", () => {
    const clock = make();
    const s = clock.get();
    expect(s.speed).toBe("paused");
    expect(s.seed).toBe(DEFAULT_SEED);
    expect(readout(s.simNow)).toBe("Mon Nov 9 · 5:00 AM");
    expect(s.mode).toBe("golden");
    expect(stepAt(s.simNow, clock.range)).toBe(0);
  });

  it("takes its range from the data: the seed's first day to the end of the run's last day", () => {
    const { range } = make();
    expect(readout(range.start)).toBe("Tue Jul 14 · 12:00 AM");
    expect(readout(range.end)).toBe("Mon Nov 16 · 11:59 PM");
    expect(modeAt(range.start, range)).toBe("history");
    expect(modeAt(range.golden.end, range)).toBe("golden");
    expect(modeAt(range.end, range)).toBe("live");
  });

  it("runs at a sim minute a second at 1×, ten at 10×, a hundred at 100×", () => {
    expect(SPEEDS).toEqual({ paused: 0, "1x": 60, "10x": 600, "100x": 6_000 });
    const clock = make();
    const t0 = clock.get().simNow;
    clock.setSpeed("1x");
    clock.advance(1_000);
    expect(clock.get().simNow - t0).toBe(60_000);
    clock.setSpeed("100x");
    clock.advance(1_000);
    expect(clock.get().simNow - t0).toBe(60_000 + 6_000_000);
    clock.pause();
    clock.advance(1_000);
    expect(clock.get().simNow - t0).toBe(60_000 + 6_000_000);
  });

  it("stops at the end of its range", () => {
    const clock = make();
    clock.setSpeed("100x");
    for (let i = 0; i < 1_000; i++) clock.advance(250);
    expect(clock.get().simNow).toBe(clock.range.end);
    expect(clock.get().speed).toBe("paused");
  });

  it("hands each step to subscribers once, in order, as time runs through the run", () => {
    const clock = make();
    const seen: string[] = [];
    clock.onEvents((events) => {
      for (const e of events) if (e.kind === "step") seen.push(e.title);
    });
    clock.setSpeed("100x");
    for (let i = 0; i < 4_000; i++) clock.advance(50);
    // Step 0 is where the clock started; every later step is crossed.
    expect(seen).toEqual(run.steps.slice(1).map((s) => s.title));
  });

  it("tells React at most REACT_HZ times a second while it runs, and at once on a seek", () => {
    const clock = make();
    let fast = 0;
    let slow = 0;
    clock.subscribe(() => fast++);
    clock.subscribeThrottled(() => slow++);
    clock.setSpeed("100x");
    const before = slow;
    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    expect(fast).toBeGreaterThanOrEqual(60);
    expect(slow - before).toBeLessThanOrEqual(REACT_HZ + 1);
    const n = slow;
    clock.seek(clock.range.golden.start);
    expect(slow).toBe(n + 1);
  });

  it("lands on each recorded step when seeked to its time", () => {
    const clock = make();
    clock.range.steps.forEach((t, i) => {
      clock.seek(t);
      expect(stepAt(clock.get().simNow, clock.range)).toBe(i);
      expect(clock.world().step).toBe(i);
    });
  });

  it("logs actions at the clock's time and clears them on Reset session", () => {
    const clock = make();
    clock.seek(clock.range.end);
    clock.act("Approve the transfer");
    expect(clock.get().log).toEqual([{ at: clock.range.end, label: "Approve the transfer" }]);
    expect(clock.world().actions).toBe(1);
    clock.seek(clock.range.golden.start);
    expect(clock.world().actions).toBe(0);
    clock.resetSession();
    clock.seek(clock.range.end);
    expect(clock.get().log).toEqual([]);
    expect(clock.world().actions).toBe(0);
  });

  it("offers the brief's Jump to presets that the recorded run holds, at their steps", () => {
    const jumps = jumpsFor(run.steps);
    expect(jumps.map((j) => [j.label, run.steps[j.step]?.title])).toEqual([
      ["Recorded run start", "Load seed"],
      ["PO-1042 refusal", "Big PO"],
      ["Linda's approval", "Linda texts"],
      ["QC release of ASC-261116-01", "QC release"],
    ]);
  });

  it("marks every incident of the worlds on the scrubber, inside the clock's range", () => {
    const clock = createClock({
      history: plantsSnapshot,
      steps: run.steps,
      span: WORLD_SPAN,
      frames: null,
    });
    const markers = incidentMarkers(WORLD_INDEX.incidents);
    // One marker per incident and date: INC-09 hit all three plants on one day.
    expect(markers.length).toBe(new Set(WORLD_INDEX.incidents.map((i) => `${i.id}|${i.at}`)).size);
    expect(markers.find((m) => m.id === "INC-09")?.plants).toHaveLength(3);
    for (const m of markers) {
      expect(m.at, m.id).toBeGreaterThanOrEqual(clock.range.start);
      expect(m.at, m.id).toBeLessThanOrEqual(clock.range.end);
    }
    expect(markers.map((m) => m.at)).toEqual([...markers.map((m) => m.at)].sort((a, b) => a - b));
  });

  it("offers the year's presets at their incidents, inside the clock's range", () => {
    const jumps = worldJumps(WORLD_INDEX.incidents);
    expect(jumps.map((j) => [j.label, new Date(j.at).toISOString().slice(0, 10)])).toEqual([
      ["Winter peak", "2026-01-15"],
      ["Price hike", "2026-08-24"],
      ["Failed QC lot", "2026-06-01"],
      ["Recall lot received", "2026-02-02"],
    ]);
    for (const j of jumps) {
      expect(j.at).toBeGreaterThanOrEqual(WORLD_SPAN.start);
      expect(j.at).toBeLessThanOrEqual(WORLD_SPAN.end);
    }
  });

  it("restores the time, speed and seed from the URL before storage, and the session from storage", () => {
    const clock = make();
    clock.seek(Date.parse("2026-11-13T09:00:00.000Z"));
    clock.setSpeed("10x");
    clock.act("Sign MSG-1");
    const { params, stored } = persisted(clock.get());
    expect(params.t).toBe("2026-11-13T09:00Z");
    // The session's actions stay out of the address bar (first-use review, finding 51).
    expect(params.log).toBeNull();
    const q = new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) => (v === null ? [] : [[k, v]])),
    );
    const fromUrl = readPersisted(`?${q}&seed=42`, null);
    expect(fromUrl).toEqual({
      simNow: Date.parse("2026-11-13T09:00:00.000Z"),
      speed: "10x",
      seed: 42,
    });
    expect(readPersisted("", stored)).toEqual({
      ...fromUrl,
      seed: DEFAULT_SEED,
      log: clock.get().log,
    });
    expect(readPersisted("?t=2026-11-10T13:00Z", stored).simNow).toBe(
      Date.parse("2026-11-10T13:00:00.000Z"),
    );
    expect(readPersisted("?t=nonsense&speed=9x", "{not json")).toEqual({});
    const restored = make(readPersisted("", stored));
    expect(restored.get().simNow).toBe(clock.get().simNow);
    expect(restored.world().actions).toBe(1);
  });
});
