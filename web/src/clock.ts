// The simulation clock (docs/UPGRADE_BRIEF.md §1.1): the one source of "now" for the screens.
// A small store outside React: the frame loop advances `simNow` at the chosen speed, the 3D twin
// reads it on its own frame loop, and React components subscribe through useClock, which hears
// at most REACT_HZ times a second while the clock runs. The recorded run is a stretch of time on
// it (engine.ts): its steps are events at the demo clock's times.

import { useSyncExternalStore } from "react";
import {
  actionEvents,
  buildEvents,
  dayStart,
  type HistorySource,
  MINUTE_MS,
  PLANT_UTC_OFFSET_MIN,
  type SessionAction,
  type SimEvent,
  simDay,
  sortEvents,
  stepTimes,
  Timeline,
  type World,
} from "./engine.ts";
import type { Step } from "./run.ts";

/** Sim seconds per real second for each speed: 1× is a sim minute a second. */
export const SPEEDS = { paused: 0, "1x": 60, "10x": 600, "100x": 6_000 } as const;
export type Speed = keyof typeof SPEEDS;
export const SPEED_LABELS: Record<Exclude<Speed, "paused">, string> = {
  "1x": "1×",
  "10x": "10×",
  "100x": "100×",
};

/** How often React hears the clock while it runs. */
export const REACT_HZ = 10;
export const DEFAULT_SEED = 20261109;

export type Mode = "history" | "golden" | "live";

export interface ClockState {
  simNow: number;
  speed: Speed;
  seed: number;
  mode: Mode;
  /** The session log: people's actions at the sim time they took them. */
  log: SessionAction[];
}

export interface Range {
  start: number;
  end: number;
  /** The recorded run: its first and last step. */
  golden: { start: number; end: number };
  /** Each recorded step's time. */
  steps: number[];
}

/** The clock's range from the data: the first day of history to the end of the run's last day. */
export function rangeOf(events: SimEvent[], steps: Step[]): Range {
  const times = stepTimes(steps);
  const goldenStart = times[0] ?? 0;
  const goldenEnd = times.at(-1) ?? goldenStart;
  const first = events[0]?.at ?? goldenStart;
  const last = events.at(-1)?.at ?? goldenEnd;
  return {
    start: dayStart(simDay(first)),
    end: dayStart(simDay(last) + 1) - MINUTE_MS,
    golden: { start: goldenStart, end: goldenEnd },
    steps: times,
  };
}

export function modeAt(t: number, range: Range): Mode {
  if (t < range.golden.start) return "history";
  return t <= range.golden.end ? "golden" : "live";
}

/** The recorded step on screen at `t`: the last one reached, the first before the run. */
export function stepAt(t: number, range: Range): number {
  let at = 0;
  range.steps.forEach((s, i) => {
    if (s <= t) at = i;
  });
  return at;
}

export interface Clock {
  readonly range: Range;
  get(): ClockState;
  /** The world at the clock's time, folded from the nearest daily snapshot. */
  world(): World;
  /** Every change, as often as the frame loop runs: for the 3D twin and other frame readers. */
  subscribe(listener: () => void): () => void;
  /** At most REACT_HZ times a second while running, at once on a seek, speed or log change. */
  subscribeThrottled(listener: () => void): () => void;
  /** The events crossed as time runs forward, in order. */
  onEvents(listener: (events: SimEvent[]) => void): () => void;
  seek(t: number): void;
  setSpeed(speed: Speed): void;
  play(): void;
  pause(): void;
  /** Moves the clock on by `realMs` of wall time at its speed; the frame loop calls this. */
  advance(realMs: number): void;
  /** Appends a person's action to the session log at the clock's time. */
  act(label: string): void;
  /** Clears the session log. */
  resetSession(): void;
}

/** What a clock starts from; the rest is the default. */
export type ClockInitial = Partial<Pick<ClockState, "simNow" | "speed" | "seed" | "log">>;

export interface ClockOptions {
  history: HistorySource;
  steps: Step[];
  initial?: ClockInitial;
  /** Drives the frame loop; the browser's by default, none in tests. */
  frames?: { request: (cb: (ms: number) => void) => number; cancel: (id: number) => void } | null;
}

export function createClock(options: ClockOptions): Clock {
  const base = buildEvents(options.history, options.steps);
  const range = rangeOf(base, options.steps);
  const clamp = (t: number) => Math.max(range.start, Math.min(range.end, t));
  let log = options.initial?.log ?? [];
  let timeline = new Timeline(sortEvents([...base, ...actionEvents(log)]));
  const simNow = clamp(options.initial?.simNow ?? range.golden.start);
  let state: ClockState = {
    simNow,
    speed: options.initial?.speed ?? "paused",
    seed: options.initial?.seed ?? DEFAULT_SEED,
    mode: modeAt(simNow, range),
    log,
  };
  let resume: Speed = state.speed === "paused" ? "10x" : state.speed;
  const fast = new Set<() => void>();
  const slow = new Set<() => void>();
  const crossing = new Set<(events: SimEvent[]) => void>();
  let lastSlow = 0;
  let realMs = 0;

  const frames =
    options.frames === undefined
      ? typeof requestAnimationFrame === "undefined"
        ? null
        : { request: requestAnimationFrame, cancel: cancelAnimationFrame }
      : options.frames;
  let frameId: number | null = null;
  let lastFrame: number | null = null;

  const emit = (urgent: boolean) => {
    for (const l of fast) l();
    if (urgent || realMs - lastSlow >= 1000 / REACT_HZ) {
      lastSlow = realMs;
      for (const l of slow) l();
    }
  };
  const set = (next: Partial<ClockState>, urgent: boolean) => {
    const simNow = next.simNow ?? state.simNow;
    state = { ...state, ...next, simNow, mode: modeAt(simNow, range) };
    emit(urgent);
  };

  const loop = (ms: number) => {
    frameId = null;
    if (state.speed === "paused" || !frames) return;
    if (lastFrame !== null) clock.advance(Math.min(ms - lastFrame, 250));
    lastFrame = ms;
    if (clock.get().speed !== "paused") frameId = frames.request(loop);
  };
  const startLoop = () => {
    if (!frames || frameId !== null || state.speed === "paused") return;
    lastFrame = null;
    frameId = frames.request(loop);
  };
  const stopLoop = () => {
    if (frames && frameId !== null) frames.cancel(frameId);
    frameId = null;
  };

  const clock: Clock = {
    range,
    get: () => state,
    world: () => timeline.stateAt(state.simNow),
    subscribe(listener) {
      fast.add(listener);
      return () => fast.delete(listener);
    },
    subscribeThrottled(listener) {
      slow.add(listener);
      return () => slow.delete(listener);
    },
    onEvents(listener) {
      crossing.add(listener);
      return () => crossing.delete(listener);
    },
    seek(t) {
      set({ simNow: clamp(t) }, true);
    },
    setSpeed(speed) {
      if (speed !== "paused") resume = speed;
      if (speed !== "paused" && state.simNow >= range.end) return;
      set({ speed }, true);
      if (speed === "paused") stopLoop();
      else startLoop();
    },
    play() {
      clock.setSpeed(resume);
    },
    pause() {
      clock.setSpeed("paused");
    },
    advance(ms) {
      if (state.speed === "paused") return;
      realMs += ms;
      const from = state.simNow;
      const to = clamp(from + ms * SPEEDS[state.speed]);
      const crossed = timeline.between(from, to);
      const ended = to >= range.end;
      set(ended ? { simNow: to, speed: "paused" } : { simNow: to }, ended);
      if (ended) stopLoop();
      if (crossed.length) for (const l of crossing) l(crossed);
    },
    act(label) {
      log = [...log, { at: state.simNow, label }];
      timeline = new Timeline(sortEvents([...base, ...actionEvents(log)]));
      set({ log }, true);
    },
    resetSession() {
      log = [];
      timeline = new Timeline(base);
      set({ log }, true);
    },
  };
  startLoop();
  return clock;
}

let shared: Clock | null = null;

/** The app's clock, for readers outside the React tree (the 3D twin's frame loop). */
export function sharedClock(): Clock | null {
  return shared;
}
export function shareClock(clock: Clock | null): void {
  shared = clock;
}

/**
 * A value read from the clock that re-renders only when it changes, at most REACT_HZ times a
 * second while the clock runs. `select` must return a primitive (a number or a string).
 */
export function useClock<T extends string | number | boolean>(
  clock: Clock,
  select: (state: ClockState) => T,
): T {
  return useSyncExternalStore(clock.subscribeThrottled, () => select(clock.get()));
}

// ------------------------------------------------------------------ formatting

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon Nov 9 · 6:42 AM" in plant time. */
export function readout(t: number): string {
  const d = new Date(t + PLANT_UTC_OFFSET_MIN * MINUTE_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const day = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${day} · ${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Nov 9" in plant time, for the scrubber's ends. */
export function shortDay(t: number): string {
  const d = new Date(t + PLANT_UTC_OFFSET_MIN * MINUTE_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ------------------------------------------------------------------ persistence

const STORE_KEY = "day-one-clock";

/** What a reload restores: from the URL first, then this browser's storage. */
export function readPersisted(search: string, stored: string | null): ClockInitial {
  const q = new URLSearchParams(search);
  let saved: { t?: string; speed?: string; seed?: number; log?: SessionAction[] } = {};
  try {
    saved = stored ? JSON.parse(stored) : {};
  } catch {
    saved = {};
  }
  const t = q.get("t") ?? saved.t;
  const speed = q.get("speed") ?? saved.speed;
  const seed = q.get("seed") ?? saved.seed;
  const logParam = q.get("log");
  let log = saved.log;
  if (logParam) {
    try {
      log = JSON.parse(logParam) as SessionAction[];
    } catch {
      log = undefined;
    }
  }
  const out: ClockInitial = {};
  const parsed = t ? Date.parse(t) : Number.NaN;
  if (Number.isFinite(parsed)) out.simNow = parsed;
  if (speed && speed in SPEEDS) out.speed = speed as Speed;
  if (seed !== undefined && Number.isFinite(Number(seed))) out.seed = Number(seed);
  if (
    Array.isArray(log) &&
    log.every((a) => typeof a?.at === "number" && typeof a?.label === "string")
  )
    out.log = log;
  return out;
}

/** The clock's part of the URL and the stored copy, from its state. */
export function persisted(state: ClockState): {
  params: Record<string, string | null>;
  stored: string;
} {
  const t = new Date(Math.floor(state.simNow / MINUTE_MS) * MINUTE_MS)
    .toISOString()
    .replace(":00.000Z", "Z");
  return {
    params: {
      t,
      speed: state.speed === "paused" ? null : state.speed,
      seed: state.seed === DEFAULT_SEED ? null : String(state.seed),
      log: state.log.length ? JSON.stringify(state.log) : null,
    },
    stored: JSON.stringify({ t, speed: state.speed, seed: state.seed, log: state.log }),
  };
}

/**
 * Keeps the URL and this browser's storage in step with the clock, at most once a second while
 * it runs; returns the unsubscribe. Storage can be refused (private windows): the URL still holds it.
 */
export function persist(clock: Clock): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    const { params, stored } = persisted(clock.get());
    if (stored === last) return;
    last = stored;
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    history.replaceState(history.state, "", `?${q.toString()}`);
    try {
      localStorage.setItem(STORE_KEY, stored);
    } catch {
      // The URL keeps the clock where storage is refused.
    }
  };
  const unsubscribe = clock.subscribeThrottled(() => {
    if (clock.get().speed === "paused") write();
    else timer ??= setTimeout(write, 1000);
  });
  write();
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

export function storedClock(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/** Forgets the stored clock, for "Reset to demo start". */
export function forgetClock(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing stored.
  }
}
