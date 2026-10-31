// The event engine under the simulation clock (docs/UPGRADE_BRIEF.md §1.1): every change to the
// world is an event at a sim timestamp, and the world at any instant is a pure fold of the events
// up to it, `state' = reduce(state, event)`. A daily snapshot keeps a seek to at most one day of
// events. Today's events come from the data the app ships: the seed's history (batches made,
// purchase orders received and paid, from src/data/plants.json), the recorded run's steps at the
// demo clock's times, and the actions people take in this session.

import type { Step } from "./run.ts";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** The plant's clock: Pacific standard time, so the demo clock's 13:00 UTC reads 5:00 AM. */
export const PLANT_UTC_OFFSET_MIN = -8 * 60;

/** The plant-local day an instant falls on, as a day number (days since 1970-01-01 local). */
export function simDay(t: number): number {
  return Math.floor((t + PLANT_UTC_OFFSET_MIN * MINUTE_MS) / DAY_MS);
}

/** The instant a plant-local day starts. */
export function dayStart(day: number): number {
  return day * DAY_MS - PLANT_UTC_OFFSET_MIN * MINUTE_MS;
}

/**
 * The demo clock the recorded run was made on (agents/kevin/src/demo.ts DEMO_CLOCK, checked
 * equal by engine.test.ts): the browser cannot import the agent, so the times are copied here.
 */
export const RECORDED_CLOCK = {
  start: "2026-11-09T13:00:00.000Z",
  confirm: "2026-11-09T13:05:00.000Z",
  purchase: "2026-11-09T13:10:00.000Z",
  approve: "2026-11-09T13:25:00.000Z",
  ship: "2026-11-13T09:00:00.000Z",
  receive: "2026-11-16T14:20:00.000Z",
  release: "2026-11-16T16:05:00.000Z",
} as const;

/** Which demo-clock time the runner had set when it wrote a step, by the step's title. */
export function phaseOf(title: string): keyof typeof RECORDED_CLOCK {
  if (title === "Load seed" || title.startsWith("Upload ")) return "start";
  if (title.endsWith(" confirms") || title === "Discrepancy") return "confirm";
  if (["Forecast", "Quotes", "Small PO", "Big PO"].includes(title)) return "purchase";
  if (title.endsWith(" texts") || title === "Kevin retries") return "approve";
  if (title === "Supplier ships") return "ship";
  if (title === "Delivery") return "receive";
  return "release";
}

/**
 * Each step's sim time: the demo clock's time for its phase, plus one minute for each earlier
 * step that shares it, so every step is its own instant on the clock and stepping lands on it.
 */
export function stepTimes(steps: Pick<Step, "title">[]): number[] {
  const out: number[] = [];
  for (const step of steps) {
    const base = Date.parse(RECORDED_CLOCK[phaseOf(step.title)]);
    const prev = out.at(-1);
    out.push(prev !== undefined && prev >= base ? prev + MINUTE_MS : base);
  }
  return out;
}

// ------------------------------------------------------------------ events

export type SimEvent =
  | { kind: "batch"; at: number; id: string; facility: string; units: number }
  | { kind: "received"; at: number; id: string; usdc: number }
  | { kind: "paid"; at: number; id: string; usdc: number }
  | { kind: "step"; at: number; id: string; step: number; title: string; txs: string[] }
  | { kind: "action"; at: number; id: string; label: string };

/** A person's action in this session, kept in the session log and replayed as an event. */
export interface SessionAction {
  at: number;
  label: string;
}

/** The world as the events have left it. */
export interface World {
  /** The recorded run's step reached, -1 before the run begins. */
  step: number;
  /** Batches finished, by plant. */
  batches: Record<string, number>;
  units: number;
  received: number;
  paid: number;
  /** Paid out, in USDC base units (6 decimals). */
  paidUsdc: number;
  /** The recorded transactions the run has sent so far, in order. */
  txs: string[];
  actions: number;
  /** The id of the last event folded in. */
  last: string | null;
}

export const EMPTY_WORLD: World = {
  step: -1,
  batches: {},
  units: 0,
  received: 0,
  paid: 0,
  paidUsdc: 0,
  txs: [],
  actions: 0,
  last: null,
};

/** One event applied to the world; never mutates `w`. */
export function reduce(w: World, e: SimEvent): World {
  switch (e.kind) {
    case "batch":
      return {
        ...w,
        batches: { ...w.batches, [e.facility]: (w.batches[e.facility] ?? 0) + 1 },
        units: w.units + e.units,
        last: e.id,
      };
    case "received":
      return { ...w, received: w.received + 1, last: e.id };
    case "paid":
      return { ...w, paid: w.paid + 1, paidUsdc: w.paidUsdc + e.usdc, last: e.id };
    case "step":
      return { ...w, step: e.step, txs: [...w.txs, ...e.txs], last: e.id };
    case "action":
      return { ...w, actions: w.actions + 1, last: e.id };
  }
}

/** The shape of the shipped snapshot the history comes from (src/data/plants.json). */
export interface HistorySource {
  massBalance: { batches: HistoryBatch[] };
  books: { settled: HistoryPo[] };
}
export interface HistoryBatch {
  batchNo: string;
  facility: string;
  completedAt: string | null;
  tablets: number;
}
export interface HistoryPo {
  poNo: string;
  receivedOn: string | null;
  releasedOn: string | null;
  totalUsdc: number;
}

/** A date-only field read as noon at the plant, so it lands on its own day. */
function noonOn(date: string): number {
  return dayStart(simDay(Date.parse(`${date}T12:00:00.000Z`))) + 12 * 60 * MINUTE_MS;
}

/**
 * The seed's history before the run starts, and the run's steps at their times, in order. Records
 * the run itself made (BR-B-1045, PO-1041, PO-1042) are in the snapshot too; they come from the
 * steps, so history stops where the run begins.
 */
export function buildEvents(history: HistorySource, steps: Step[]): SimEvent[] {
  const times = stepTimes(steps);
  const runStart = times[0] ?? Number.POSITIVE_INFINITY;
  const events: SimEvent[] = [];
  for (const b of history.massBalance.batches) {
    if (!b.completedAt) continue;
    events.push({
      kind: "batch",
      at: Date.parse(b.completedAt),
      id: `batch:${b.batchNo}`,
      facility: b.facility,
      units: b.tablets,
    });
  }
  for (const po of history.books.settled) {
    const usdc = po.totalUsdc;
    if (po.receivedOn)
      events.push({ kind: "received", at: noonOn(po.receivedOn), id: `received:${po.poNo}`, usdc });
    if (po.releasedOn)
      events.push({
        kind: "paid",
        at: noonOn(po.releasedOn) + MINUTE_MS,
        id: `paid:${po.poNo}`,
        usdc,
      });
  }
  const before = events.filter((e) => e.at < runStart);
  const run: SimEvent[] = steps.map((s, i) => ({
    kind: "step",
    at: times[i] as number,
    id: `step:${i}`,
    step: i,
    title: s.title,
    txs: s.chain.flatMap((c) => (c.tx ? [c.tx] : [])),
  }));
  return sortEvents([...before, ...run]);
}

/** In time order; ties keep their order, so the same input always folds the same way. */
export function sortEvents(events: SimEvent[]): SimEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map((x) => x.e);
}

/** The session log as events, after whatever the data holds at the same instant. */
export function actionEvents(log: SessionAction[]): SimEvent[] {
  return log.map((a, i) => ({ kind: "action", at: a.at, id: `action:${i}`, label: a.label }));
}

// ------------------------------------------------------------------ timeline

/** Events in order with a snapshot of the world at the start of every day they span. */
export class Timeline {
  readonly events: SimEvent[];
  readonly firstDay: number;
  readonly lastDay: number;
  /** For each day from firstDay: the world at its start and the index of its first event. */
  private readonly days: { world: World; index: number }[] = [];

  constructor(events: SimEvent[]) {
    this.events = events;
    this.firstDay = simDay(events[0]?.at ?? 0);
    this.lastDay = simDay(events.at(-1)?.at ?? 0);
    let world = EMPTY_WORLD;
    let i = 0;
    for (let day = this.firstDay; day <= this.lastDay; day++) {
      const start = dayStart(day);
      while (i < events.length && (events[i] as SimEvent).at < start) {
        world = reduce(world, events[i] as SimEvent);
        i++;
      }
      this.days.push({ world, index: i });
    }
  }

  /** The world at `t`, every event at or before it applied: one day's events at most. */
  stateAt(t: number): World {
    const day = simDay(t);
    if (day < this.firstDay) return EMPTY_WORLD;
    const snap = this.days[Math.min(day, this.lastDay) - this.firstDay] as {
      world: World;
      index: number;
    };
    let world = snap.world;
    for (let i = snap.index; i < this.events.length; i++) {
      const e = this.events[i] as SimEvent;
      if (e.at > t) break;
      world = reduce(world, e);
    }
    return world;
  }

  /** The same, folded from the very first event: the reference the snapshots must agree with. */
  stateFromStart(t: number): World {
    let world = EMPTY_WORLD;
    for (const e of this.events) {
      if (e.at > t) break;
      world = reduce(world, e);
    }
    return world;
  }

  /** The events after `from` up to and including `to`, in order, for subscribers as time runs. */
  between(from: number, to: number): SimEvent[] {
    const out: SimEvent[] = [];
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.events[mid] as SimEvent).at <= from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.events.length; i++) {
      const e = this.events[i] as SimEvent;
      if (e.at > to) break;
      out.push(e);
    }
    return out;
  }
}

// ------------------------------------------------------------------ determinism

/** FNV-1a over a string, as 8 hex digits: a stable fingerprint for event streams. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function hashEvents(events: SimEvent[]): string {
  return fnv1a(JSON.stringify(events));
}

/**
 * A number in [0, 1) fixed by (seed, simDay, entityId): what anything random after the recorded
 * run draws from, never Math.random(), so the same seed gives the same world on every machine.
 */
export function seededRandom(seed: number, day: number, entityId: string): number {
  let a = Number.parseInt(fnv1a(`${seed}|${day}|${entityId}`), 16);
  // mulberry32, one round
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
