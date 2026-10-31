// The three plants' twelve-month worlds on the sim clock (docs/UPGRADE_BRIEF.md §2.1.10): the
// index ships with the page (a few KB: the months and the incidents); each month's events are
// their own chunk, loaded the month the clock shows first and then the rest, one at a time, so
// the first load stays small. Written by npm run web:data (server/src/world/events.ts).

import type { Clock } from "./clock.ts";
import worldIndex from "./data/world/index.json";
import type { SimEvent } from "./engine.ts";

export interface WorldIndex {
  start: string;
  end: string;
  months: { month: string; file: string; events: number }[];
  incidents: { id: string; facility: string; at: string; title: string }[];
}

export const WORLD_INDEX = worldIndex as WorldIndex;

/** The clock's range once every month has loaded. */
export const WORLD_SPAN = {
  start: Date.parse(WORLD_INDEX.start),
  end: Date.parse(WORLD_INDEX.end),
};

const MONTHS = import.meta.glob<SimEvent[]>(["./data/world/*.json", "!./data/world/index.json"], {
  import: "default",
});

/** One month's events, from its own chunk. */
export async function loadMonth(month: string): Promise<SimEvent[]> {
  const load = MONTHS[`./data/world/${month}.json`];
  return load ? await load() : [];
}

/** The months in the order to load them: the one at `t` first, then outward from it. */
export function loadOrder(
  t: number,
  months: readonly string[] = WORLD_INDEX.months.map((m) => m.month),
) {
  const here = new Date(t).toISOString().slice(0, 7);
  const at = Math.max(0, months.indexOf(here));
  return [...months].sort(
    (a, b) =>
      Math.abs(months.indexOf(a) - at) - Math.abs(months.indexOf(b) - at) || (a < b ? -1 : 1),
  );
}

/**
 * Loads every month onto the clock, the one it shows first; returns a stop for unmounting. The
 * events land as they arrive, so the scrubber and the feed fill in while the page is already up.
 */
export function attachWorld(clock: Clock): () => void {
  let stopped = false;
  void (async () => {
    for (const month of loadOrder(clock.get().simNow)) {
      const events = await loadMonth(month);
      if (stopped) return;
      clock.addEvents(events);
    }
  })();
  return () => {
    stopped = true;
  };
}
