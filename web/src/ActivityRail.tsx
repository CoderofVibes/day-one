// Kevin's activity feed as a right rail on the Overview (docs/UPGRADE_BRIEF.md §1.2): his status
// at the top, filter chips, then what he did, newest first, from activity.ts over the clock's
// events. On wide screens (≥1440 px; Astra's first pass gives a laptop's width to the desk) the rail is a column beside the page that collapses to a
// strip with an unread count; with the curtain on, the feed sits above the curtain in the same
// column, so turning the curtain on reveals the chain without hiding what Kevin is doing.
// Narrower, the feed is a drawer opened from the step player (FeedButton).

import "./activity.css";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  coalesce,
  eventsToFeed,
  type FeedContext,
  type FeedFilter,
  type FeedItem,
  type FeedRow,
  feedForPlant,
  filterFeed,
  type KevinStatus,
  kevinStatus,
  PLANT_NAMES,
  pageForRecord,
  TYPE_LOOK,
  timeLabel,
} from "./activity.ts";
import { type Clock, useClock } from "./clock.ts";
import type { SimEvent } from "./engine.ts";
import type { PageId, PlantCode } from "./shell.tsx";

// ------------------------------------------------------------------ the rail's own state

const STORE_KEY = "day-one-feed";
const WIDE = "(min-width: 1440px)";

interface RailState {
  collapsed: boolean;
  drawer: boolean;
  /** The newest item time the reader has seen with the feed open. */
  seenAt: number;
  unread: number;
}

function load(): RailState {
  const base = { collapsed: false, drawer: false, seenAt: 0, unread: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return {
      ...base,
      collapsed: saved.collapsed === true,
      seenAt: typeof saved.seenAt === "number" ? saved.seenAt : 0,
    };
  } catch {
    return base;
  }
}

let rail: RailState | null = null;
const listeners = new Set<() => void>();
function railState(): RailState {
  rail ??= load();
  return rail;
}
function setRail(next: Partial<RailState>) {
  const now = railState();
  if (Object.entries(next).every(([k, v]) => now[k as keyof RailState] === v)) return;
  rail = { ...now, ...next };
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ collapsed: rail.collapsed, seenAt: rail.seenAt }),
    );
  } catch {
    // The rail opens expanded where storage is refused.
  }
  for (const l of listeners) l();
}
function subscribeRail(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function useRail(): RailState {
  return useSyncExternalStore(subscribeRail, railState, railState);
}

/** Opens the feed: the drawer below 1440 px, the rail expanded wider. The header's Kevin chip calls it. */
export function openFeed(): void {
  const wide = typeof matchMedia === "undefined" || matchMedia(WIDE).matches;
  setRail(wide ? { collapsed: false } : { drawer: true });
}

function useWide(): boolean {
  const query = typeof matchMedia === "undefined" ? null : matchMedia(WIDE);
  return useSyncExternalStore(
    (l) => {
      query?.addEventListener("change", l);
      return () => query?.removeEventListener("change", l);
    },
    () => query?.matches ?? true,
    () => true,
  );
}

// ------------------------------------------------------------------ reading the clock

/** The feed at the clock's time; folded again only when an event is crossed or the log changes. */
export function useFeed(clock: Clock, context: FeedContext): { items: FeedItem[]; now: number } {
  const now = useClock(clock, (s) => s.simNow);
  const logged = useClock(clock, (s) => s.log.length + s.loaded);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the clock rebuilds its events when the log changes or a month of the world loads
  const events = useMemo(() => clock.events(), [clock, logged]);
  const count = countThrough(events, now);
  const items = useMemo(
    () => eventsToFeed(events, events[count - 1]?.at ?? Number.NEGATIVE_INFINITY, context),
    [events, count, context],
  );
  return { items, now };
}

/** Kevin's status at the clock's time, for the header's chip (activity.ts kevinStatus). */
export function useKevinStatus(clock: Clock, context: FeedContext): KevinStatus {
  const { items, now } = useFeed(clock, context);
  return kevinStatus(items, now);
}

function countThrough(events: readonly SimEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid] as SimEvent).at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ------------------------------------------------------------------ the frame

/**
 * The page with the feed beside it on the Overview. `rail` is the curtain panel: below the feed
 * when the curtain is on (wide), or in its usual column (narrower) with the feed in a drawer.
 */
export function ActivityFrame({
  curtain,
  rail: curtainPanel,
  feed: props,
  children,
}: {
  curtain: boolean;
  rail: React.ReactNode;
  feed: FeedProps;
  children: React.ReactNode;
}) {
  const wide = useWide();
  const { collapsed, drawer } = useRail();
  const visible = wide ? !collapsed : drawer;
  const feed = visible ? <ActivityRail {...props} curtain={curtain} /> : null;
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRail({ drawer: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  // With the curtain on, Kevin's activity and the evidence behind it are two tabs of one panel,
  // not one long column above another (Astra's first pass, A2); turning the curtain on shows the
  // evidence.
  const [tab, setTab] = useState<"activity" | "evidence">("evidence");
  useEffect(() => {
    if (curtain) setTab("evidence");
  }, [curtain]);
  const watcher = <Unread clock={props.clock} context={props.context} visible={visible} />;
  if (wide) {
    return (
      <div className={collapsed ? "with-feed collapsed" : "with-feed"}>
        {watcher}
        <div className="page-wrap">{children}</div>
        <aside className={curtain ? "feed-col curtain-on" : "feed-col"}>
          {collapsed ? (
            <FeedStrip />
          ) : curtain ? (
            <>
              <fieldset className="seg feed-tabs" aria-label="Show">
                {(["activity", "evidence"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={tab === k}
                    className={tab === k ? "on" : undefined}
                    onClick={() => setTab(k)}
                  >
                    {k === "activity" ? "Kevin's activity" : "Evidence"}
                  </button>
                ))}
              </fieldset>
              {tab === "activity" ? feed : <div className="feed-curtain">{curtainPanel}</div>}
            </>
          ) : (
            feed
          )}
        </aside>
      </div>
    );
  }
  return (
    <div className={curtain ? "with-rail" : undefined}>
      {watcher}
      <div className="page-wrap">{children}</div>
      {curtain && <aside className="rail-v2">{curtainPanel}</aside>}
      {drawer && (
        <button
          type="button"
          className="feed-scrim"
          aria-label="Close Kevin's activity"
          onClick={() => setRail({ drawer: false })}
        />
      )}
      <aside
        className={drawer ? "feed-drawer open" : "feed-drawer"}
        aria-label="Kevin's activity"
        aria-hidden={!drawer}
        inert={!drawer}
      >
        {feed}
      </aside>
    </div>
  );
}

/**
 * Counts what arrives while the feed is out of sight (collapsed, or the drawer shut) and marks
 * it seen while it is on screen. Renders nothing.
 */
function Unread({
  clock,
  context,
  visible,
}: {
  clock: Clock;
  context: FeedContext;
  visible: boolean;
}) {
  const { items } = useFeed(clock, context);
  const { seenAt } = useRail();
  const newest = items.at(-1)?.at ?? 0;
  // A first visit counts from now: the months of history before it are not "new" (first-use
  // review, finding 50: "99+ new" on minute one).
  const firstVisit = seenAt === 0;
  let unread = 0;
  if (!visible && !firstVisit)
    for (let i = items.length - 1; i >= 0 && (items[i] as FeedItem).at > seenAt; i--) unread++;
  useEffect(() => {
    if (visible || (firstVisit && newest > 0)) setRail({ seenAt: newest, unread: 0 });
    else setRail({ unread });
  }, [visible, newest, unread, firstVisit]);
  return null;
}

function FeedStrip() {
  const { unread } = useRail();
  return (
    <button
      type="button"
      className="feed-strip"
      onClick={() => setRail({ collapsed: false })}
      aria-label={`Show Kevin's activity${unread ? `, ${unread} new` : ""}`}
    >
      <span className="avatar kevin" aria-hidden="true">
        K
      </span>
      {unread > 0 && (
        <span className="feed-unread" title={`${unread} new entries`}>
          {unread > 99 ? "99+ new" : `${unread} new`}
        </span>
      )}
      <span className="feed-strip-label">Kevin's activity</span>
    </button>
  );
}

/** "Kevin's activity" with the unread count, for the step player below 1440 px. */
export function FeedButton() {
  const wide = useWide();
  const { unread } = useRail();
  if (wide) return null;
  return (
    <button type="button" className="btn feed-open" onClick={openFeed}>
      Kevin's activity
      {unread > 0 && (
        <span className="feed-unread" title={`${unread} new entries`}>
          {unread > 99 ? "99+ new" : `${unread} new`}
        </span>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ the feed

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "person", label: "Needs a person" },
  { id: "money", label: "Money" },
  { id: "quality", label: "Quality" },
  { id: "chain", label: "Chain" },
];

/** Rows on screen at once: the list is windowed so any length of history stays ~200 elements. */
export const WINDOW = 20;

export interface FeedProps {
  clock: Clock;
  context: FeedContext;
  /** What the page offers the person Kevin waits on, on the item that waits for them. */
  actions: React.ReactNode;
  go: (next: { page: PageId; plant?: PlantCode }) => void;
  /** The header's plant: the feed shows its lines unless "All plants" is on. */
  plant: PlantCode;
}

export function ActivityRail({
  clock,
  context,
  curtain,
  actions,
  go,
  plant,
}: FeedProps & { curtain: boolean }) {
  const { items: everywhere, now } = useFeed(clock, context);
  const [allPlants, setAllPlants] = useState(false);
  const items = useMemo(
    () => feedForPlant(everywhere, allPlants ? "all" : plant),
    [everywhere, allPlants, plant],
  );
  const wide = useWide();
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(0);
  const shownFilter = filter === "chain" && !curtain ? "all" : filter;
  // Kevin's status reads every plant, as the header's chip does (one source).
  const status = kevinStatus(everywhere, now);
  const newest = items.at(-1)?.at ?? 0;

  // Items newer than the first paint (or the last step back in time) slide in; the rest do not.
  const baseline = useRef<number | null>(null);
  if (baseline.current === null || newest < baseline.current) baseline.current = newest;
  // A new item lands at the top: show it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: back to the newest page on each new item
  useEffect(() => setPage(0), [newest]);

  const rows = useMemo(
    () => coalesce(filterFeed(items, shownFilter), 3, open),
    [items, shownFilter, open],
  );
  const pages = Math.max(1, Math.ceil(rows.length / WINDOW));
  const at = Math.min(page, pages - 1);
  const windowed = rows.slice(at * WINDOW, (at + 1) * WINDOW);
  const openRecord = (id: string) => {
    go(pageForRecord(id));
    setRail({ drawer: false });
  };

  return (
    <section className="feed-rail" aria-label="Kevin's activity">
      <header className="feed-top">
        <span className={status.working ? "feed-dot working" : "feed-dot"} aria-hidden="true" />
        <span className="feed-who">
          <b>Kevin</b> · <span className={`feed-state ${status.state}`}>{status.label}</span>
        </span>
        {wide ? (
          <button
            type="button"
            className="feed-icon-btn"
            onClick={() => setRail({ collapsed: true })}
            aria-label="Collapse Kevin's activity"
            title="Collapse"
          >
            ›
          </button>
        ) : (
          <button
            type="button"
            className="feed-icon-btn"
            onClick={() => setRail({ drawer: false })}
            aria-label="Close Kevin's activity"
            title="Close"
          >
            ×
          </button>
        )}
      </header>
      <fieldset className="feed-chips" aria-label="Plant">
        {[false, true].map((all) => (
          <button
            key={String(all)}
            type="button"
            className={allPlants === all ? "feed-chip on" : "feed-chip"}
            aria-pressed={allPlants === all}
            onClick={() => {
              setAllPlants(all);
              setPage(0);
            }}
          >
            {all ? "All plants" : (PLANT_NAMES[plant] ?? plant)}
          </button>
        ))}
      </fieldset>
      <fieldset className="feed-chips" aria-label="Show">
        {FILTERS.filter((f) => f.id !== "chain" || curtain).map((f) => (
          <button
            key={f.id}
            type="button"
            className={shownFilter === f.id ? "feed-chip on" : "feed-chip"}
            aria-pressed={shownFilter === f.id}
            onClick={() => {
              setFilter(f.id);
              setPage(0);
            }}
          >
            {f.label}
          </button>
        ))}
      </fieldset>
      <ol className="feed-list">
        {windowed.length === 0 && (
          <li className="feed-empty muted small">
            {items.length === 0
              ? "Nothing yet on the clock. Press play or step forward."
              : "Nothing under this filter yet."}
          </li>
        )}
        {windowed.map((row) =>
          row.kind === "routine" ? (
            <RoutineRow
              key={row.id}
              row={row}
              now={now}
              onOpen={() => setOpen(new Set([...open, row.id]))}
            />
          ) : (
            <Item
              key={row.item.id}
              item={row.item}
              now={now}
              fresh={row.item.at > (baseline.current ?? 0)}
              curtain={curtain}
              actions={row.item.needs ? actions : null}
              onRecord={openRecord}
            />
          ),
        )}
      </ol>
      {pages > 1 && (
        <div className="feed-pager small">
          <button type="button" className="btn" disabled={at === 0} onClick={() => setPage(at - 1)}>
            ← Newer
          </button>
          <span className="muted">
            {at + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn"
            disabled={at >= pages - 1}
            onClick={() => setPage(at + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </section>
  );
}

function RoutineRow({
  row,
  now,
  onOpen,
}: {
  row: Extract<FeedRow, { kind: "routine" }>;
  now: number;
  onOpen: () => void;
}) {
  const newest = row.items[0] as FeedItem;
  return (
    <li className="feed-item routine">
      <time className="feed-time">{timeLabel(newest.at, now)}</time>
      <button type="button" className="feed-more" onClick={onOpen} aria-expanded={false}>
        +{row.items.length} routine updates
      </button>
    </li>
  );
}

function Item({
  item,
  now,
  fresh,
  curtain,
  actions,
  onRecord,
}: {
  item: FeedItem;
  now: number;
  fresh: boolean;
  curtain: boolean;
  actions: React.ReactNode;
  onRecord: (id: string) => void;
}) {
  const look = TYPE_LOOK[item.type];
  const className = ["feed-item", look.tone, fresh ? "fresh" : "", item.needs ? "needs" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={className}>
      <Icon name={look.icon} />
      <div className="feed-body">
        <p>
          <time className="feed-time">{timeLabel(item.at, now)}</time>{" "}
          <Linked text={item.text} records={item.records} onRecord={onRecord} />
        </p>
        {item.needs && actions && <div className="feed-actions actions">{actions}</div>}
        {curtain && item.chain && (
          <ul className="feed-chain">
            {item.chain.map((c) => (
              <li key={c.line}>{chainLine(c.line)}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** "chain: submit_po PO-1042 ✓ (tx 3sUEp63g…)": the recorded line with its hash shortened. */
function chainLine(line: string): string {
  return line
    .replace(/^chain:\s*/, "")
    .replace(/\b([1-9A-HJ-NP-Za-km-z]{8})[1-9A-HJ-NP-Za-km-z]{24,}\b/g, "$1…");
}

/** The line with each record id it names as a link; ids the line does not name follow it. */
function Linked({
  text,
  records,
  onRecord,
}: {
  text: string;
  records: string[];
  onRecord: (id: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  const named = records.filter((r) => text.includes(r));
  const pattern = named.length
    ? new RegExp(`(${named.map((r) => r.replace(/[-]/g, "\\-")).join("|")})`, "g")
    : null;
  const pieces = pattern ? text.split(pattern) : [text];
  pieces.forEach((piece, i) => {
    const key = `${i}-${piece}`;
    // Plain text stays a text node, so a windowed page of items stays under ~200 elements.
    parts.push(
      named.includes(piece) ? <RecordLink key={key} id={piece} onRecord={onRecord} /> : piece,
    );
  });
  const extra = records.filter((r) => !named.includes(r));
  return (
    <>
      {parts}
      {extra.map((id) => (
        <Fragment key={id}>
          {" · "}
          <RecordLink id={id} onRecord={onRecord} />
        </Fragment>
      ))}
    </>
  );
}

function RecordLink({ id, onRecord }: { id: string; onRecord: (id: string) => void }) {
  return (
    <button type="button" className="feed-record" onClick={() => onRecord(id)}>
      {id}
    </button>
  );
}

// ------------------------------------------------------------------ icons

const PATHS: Record<string, string> = {
  doc: "M4 2h6l3 3v9H4z M10 2v3h3 M6 8h5 M6 11h5",
  box: "M2 5l6-3 6 3v7l-6 3-6-3z M2 5l6 3 6-3 M8 8v7",
  bell: "M4 11V7a4 4 0 0 1 8 0v4l1 1H3z M7 14h2",
  send: "M2 8l12-6-4 12-2-5z",
  inbox: "M2 9l2-6h8l2 6v4H2z M2 9h4l1 2h2l1-2h4",
  cart: "M1 2h2l2 8h8l1-6H4 M6 14h1 M12 14h1",
  shield: "M8 1l6 2v5c0 3-3 6-6 7-3-1-6-4-6-7V3z M6 6l4 4 M10 6l-4 4",
  phone: "M5 1h6v14H5z M7 12h2",
  check: "M2 8l4 4 8-8",
  lock: "M3 7h10v8H3z M5 7V5a3 3 0 0 1 6 0v2",
  truck: "M1 4h9v7H1z M10 7h3l2 2v2h-5 M4 13h1 M12 13h1",
  flask: "M6 1h4 M7 1v5l-4 8h10l-4-8V1 M5 10h6",
  coin: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2 M8 5v6 M6 6.5h3a1 1 0 0 1 0 2H7a1 1 0 0 0 0 2h3",
  alert: "M8 2l7 12H1z M8 6v4 M8 12v1",
  trend: "M1 12l5-5 3 3 6-6 M11 4h4v4",
  arrows: "M2 5h11l-3-3 M14 11H3l3 3",
  badge: "M8 1l2 2h3v3l2 2-2 2v3h-3l-2 2-2-2H3v-3L1 8l2-2V3h3z",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 1 0 0-6 M8 1v2 M8 13v2 M1 8h2 M13 8h2",
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="feed-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
