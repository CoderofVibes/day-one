import { DEMO_CLOCK } from "@day-one/kevin/demo";
import { describe, expect, it } from "vitest";
import {
  actionEvents,
  buildEvents,
  DAY_MS,
  dayStart,
  EMPTY_WORLD,
  hashEvents,
  RECORDED_CLOCK,
  reduce,
  type SimEvent,
  seededRandom,
  simDay,
  sortEvents,
  stepTimes,
  Timeline,
} from "./engine.ts";
import { plantsSnapshot } from "./plants.ts";
import { run } from "./run.ts";

const events = buildEvents(plantsSnapshot, run.steps);
const timeline = new Timeline(events);

describe("the event engine", () => {
  it("runs on the demo clock the run was recorded with", () => {
    expect(RECORDED_CLOCK).toEqual(DEMO_CLOCK);
  });

  it("puts each recorded step at its own instant, in order, from 5:00 AM plant time", () => {
    const times = stepTimes(run.steps);
    expect(times[0]).toBe(Date.parse("2026-11-09T13:00:00.000Z"));
    expect(new Date((times[0] as number) - 8 * 3_600_000).toISOString()).toBe(
      "2026-11-09T05:00:00.000Z",
    );
    for (let i = 1; i < times.length; i++)
      expect(times[i] as number).toBeGreaterThan(times[i - 1] as number);
    const at = (title: string) => times[run.steps.findIndex((s) => s.title === title)];
    expect(at("Supplier ships")).toBe(Date.parse(DEMO_CLOCK.ship));
    expect(at("Delivery")).toBe(Date.parse(DEMO_CLOCK.receive));
    expect(at("QC release")).toBe(Date.parse(DEMO_CLOCK.release));
  });

  it("gives the same event stream every time (determinism)", () => {
    const again = buildEvents(structuredClone(plantsSnapshot), structuredClone(run.steps));
    expect(hashEvents(again)).toBe(hashEvents(events));
    // Pinned: a change to the seed history, the recording or the engine shows here.
    expect(hashEvents(events.slice(0, 100))).toMatchInlineSnapshot(`"150f757a"`);
    expect(events.length).toMatchInlineSnapshot(`162`);
  });

  it("orders events in time and keeps ties in the order given", () => {
    for (let i = 1; i < events.length; i++)
      expect((events[i] as SimEvent).at).toBeGreaterThanOrEqual((events[i - 1] as SimEvent).at);
    const a: SimEvent = { kind: "action", at: 5, id: "a", label: "first" };
    const b: SimEvent = { kind: "action", at: 5, id: "b", label: "second" };
    expect(sortEvents([b, a]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("stops the seed's history where the recorded run begins", () => {
    const start = stepTimes(run.steps)[0] as number;
    const history = events.filter((e) => e.kind !== "step");
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((e) => e.at < start)).toBe(true);
  });

  it("replays the recorded steps in order with the recorded transactions", () => {
    const steps = events.filter((e) => e.kind === "step");
    expect(steps.map((e) => (e.kind === "step" ? e.title : ""))).toEqual(
      run.steps.map((s) => s.title),
    );
    const end = timeline.stateAt(stepTimes(run.steps).at(-1) as number);
    expect(end.step).toBe(run.steps.length - 1);
    const recordedTxs = run.steps.flatMap((s) => s.chain.flatMap((c) => (c.tx ? [c.tx] : [])));
    expect(end.txs).toEqual(recordedTxs);
    expect(new Set(end.txs).size).toBe(run.summary.transactions);
    for (const tx of end.txs) expect(run.transactions.some((t) => t.tx === tx)).toBe(true);
  });

  it("folds from a daily snapshot to the same world as folding from the start", () => {
    const first = events[0]?.at as number;
    const last = events.at(-1)?.at as number;
    // Every event instant, a minute either side of it, and noon of every day in range.
    const probes = events.flatMap((e) => [e.at - 60_000, e.at, e.at + 60_000]);
    for (let day = simDay(first) - 1; day <= simDay(last) + 1; day++)
      probes.push(dayStart(day) + DAY_MS / 2);
    for (const t of probes) expect(timeline.stateAt(t)).toEqual(timeline.stateFromStart(t));
  });

  it("seeks fast: a fold touches at most one day of events", () => {
    const first = events[0]?.at as number;
    const span = (events.at(-1)?.at as number) - first;
    const t0 = performance.now();
    for (let i = 0; i < 1_000; i++) timeline.stateAt(first + ((i * 7919) % 1000) * (span / 1000));
    expect((performance.now() - t0) / 1_000).toBeLessThan(150);
  });

  it("never changes the world it is given", () => {
    const frozen = Object.freeze({ ...EMPTY_WORLD, batches: Object.freeze({}) });
    for (const e of events.slice(0, 50)) reduce(frozen, e);
    expect(frozen).toEqual(EMPTY_WORLD);
  });

  it("folds the session's actions in after the data at the same instant", () => {
    const at = stepTimes(run.steps)[3] as number;
    const t = new Timeline(sortEvents([...events, ...actionEvents([{ at, label: "Approve" }])]));
    const w = t.stateAt(at);
    expect(w.actions).toBe(1);
    expect(w.step).toBe(3);
    expect(w.last).toBe("action:0");
    expect(timeline.stateAt(at).actions).toBe(0);
  });

  it("draws the same random numbers for the same (seed, day, entity)", () => {
    const r = seededRandom(7, 20_000, "ASC");
    expect(seededRandom(7, 20_000, "ASC")).toBe(r);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    expect(seededRandom(8, 20_000, "ASC")).not.toBe(r);
    expect(seededRandom(7, 20_001, "ASC")).not.toBe(r);
    expect(seededRandom(7, 20_000, "CAC")).not.toBe(r);
  });
});
