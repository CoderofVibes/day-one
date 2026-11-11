// The v2 program (docs/VISION.md §6): pages down the left side, the plant picker, and the trust
// marker that opens Behind the curtain beside any page. Overview holds whoever is up next (the
// Kevin panel), what just happened, the plant map and the plant's numbers; Three plants, Books
// and Spending limits hold the three-plant view, Marcy's books with the import wizard, and HQ's
// read of the contract. Staff pages show dollars, POs, approvals and people; the chain stays
// behind the curtain (src/run.test.ts).
//
// One UI, two sources: when the API (npm run api) answers, the pages run live and each button
// advances the run; otherwise the recorded run replays with Play, Back and Next, as on a static
// host (docs/HOSTING.md).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityFrame,
  FeedButton,
  type FeedProps,
  openFeed,
  useKevinStatus,
} from "./ActivityRail.tsx";
import {
  ApiError,
  BOOKS_EXPORT_URL,
  type Books,
  BRIEF_URL,
  getBooks,
  getInbox,
  getInventory,
  getMassBalance,
  getPolicy,
  getReview,
  getState,
  getTransferSuggestions,
  type InboxState,
  type LiveState,
  type MassBalance,
  type PlantInventory,
  type PolicyState,
  postImage,
  postInboxConfirm,
  postJson,
  postReview,
  postReviewSign,
  postTransferDecision,
  postTransferReceipt,
  postWasteProposals,
  probeApi,
  type ReviewState,
  type TransferSuggestions,
} from "./api.ts";
import { BatchReadingDialog } from "./BatchReading.tsx";
import {
  HeaderClock,
  HeaderClockLine,
  incidentMarkers,
  jumpsFor,
  worldJumps,
} from "./ClockBar.tsx";
import { Curtain } from "./Curtain.tsx";
import { nextTurn, PEOPLE } from "./chrome.ts";
import {
  type Clock,
  createClock,
  forgetClock,
  persist,
  readout,
  readPersisted,
  shareClock,
  stepAt,
  storedClock,
  useClock,
} from "./clock.ts";
import { friendlyAction, type Turn, turnFromLive, turnFromStep } from "./desk.ts";
import { stepTimes } from "./engine.ts";
import { FirstShiftGuide, FirstShiftIntro } from "./FirstShift.tsx";
import { initials, Pill, StaffFeed } from "./feed.tsx";
import { GlobalHeader, type Person } from "./Header.tsx";
import { ImportPane } from "./ImportPane.tsx";
import { InboxPane } from "./InboxPane.tsx";
import { postDecision, postDropScans } from "./journey.ts";
import { judgeStart } from "./judgeRoute.ts";
import { ReplayDeskActions, type Where } from "./KevinDesk.tsx";
import { type Action, actionsFor, actorOf, offInReplay, roleLabel } from "./live.ts";
import { REVIEW_READ_ONLY, reviewSnapshot } from "./mail.ts";
import ApproveApp from "./Phone.tsx";
import { ErpPage, ThreeSchedules } from "./pages/Acme.tsx";
import { ArenaPage } from "./pages/Arena.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { InvoicesPage, PurchasingPage, SpreadsheetsPage } from "./pages/Buying.tsx";
import { GroupPage, ReconciliationPage, SealedPage, SuppliersPage } from "./pages/Hq.tsx";
import { Integration } from "./pages/Integration.tsx";
import { BooksTiles, LimitTiles } from "./pages/Limits.tsx";
import { LotsPage } from "./pages/Lots.tsx";
import { MapPage, type MapPick } from "./pages/MapPage.tsx";
import { MoneyPage, MoneyTile } from "./pages/Money.tsx";
import { Overview } from "./pages/Overview.tsx";
import { BatchRecordsPage, BriefPage, InventoryPage, SchedulePage } from "./pages/Plant.tsx";
import { MaterialMatrix, PlantColumns } from "./pages/Plants.tsx";
import { BooksPane, HqPane, PlantsPane } from "./panes.tsx";
import { plantsSnapshot, STATIC_BOOKS_URL, STATIC_BRIEF_URL } from "./plants.ts";
import { RecordNav } from "./RecordNav.tsx";
import { ReviewPane } from "./ReviewPane.tsx";
import { recordedBatchReview } from "./recordedBatchReview.ts";
import {
  audienceOf,
  plainTitle,
  type RunData,
  run as recorded,
  type Step,
  type Tone,
} from "./run.ts";
import { SavedCounter } from "./SavedCounter.tsx";
import type { Source } from "./series.ts";
import { PageHeader, type PageId, type PlantCode, Shell, useRoute } from "./shell.tsx";
import { opensByItself, remember } from "./shiftScript.ts";
import { PlantView, type TwinFocus } from "./twin3d/PlantView.tsx";
import { attachWorld, WORLD_INDEX, WORLD_SPAN } from "./worldEvents.ts";

/** What the plant map takes: the map page's area picking, or the desk's place to fly to. */
type MapProps = Partial<MapPick> & { focus?: TwinFocus | null };

/** The video page (?video=1): the recorded run on the storyboard's clock (docs/RECORDING.md). */
const VideoApp = lazy(() => import("./VideoApp.tsx"));
const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const VIDEO = QUERY.get("video") === "1";
const RECORDED_FRAME = QUERY.get("recordedFrame") === "1";
/** Linda's phone on its own (?page=approve&po=1042), for a judge's phone: src/Phone.tsx. */
const APPROVE = QUERY.get("page") === "approve";
/** Judge mode (?judge=1, src/JudgeMode.tsx): recorded data only, so it always opens the replay. */
const JudgeMode = lazy(() => import("./JudgeMode.tsx"));
const JUDGE_AT = judgeStart(QUERY.toString());
/** Kevin's introduction on request (?intro=1, the Overview's front door and the menu). */
const INTRO_ASKED = QUERY.get("intro") === "1";
/** Kevin's introduction opens by itself on a bare first visit only (shiftScript.ts), or on request. */
const FIRST_OPEN =
  INTRO_ASKED ||
  (typeof location !== "undefined" &&
    opensByItself(
      location.search,
      location.hash,
      typeof localStorage === "undefined" ? null : localStorage,
    ));

/**
 * The product look (shift.css, OPEN_QUESTIONS #46) is for the staff and judge pages only: the
 * video keeps its frames and Linda's phone its own screen.
 */
if (!VIDEO && !APPROVE && typeof document !== "undefined") {
  document.documentElement.dataset.productUi = "shift";
}

export function App() {
  if (VIDEO) {
    return (
      <Suspense fallback={<div className="loading">Loading…</div>}>
        <VideoApp />
      </Suspense>
    );
  }
  if (APPROVE) return <ApproveApp />;
  if (RECORDED_FRAME) return <ReplayApp />;
  return <Screens />;
}

function Screens() {
  const [live, setLive] = useState<LiveState | null | undefined>(undefined);
  useEffect(() => {
    probeApi().then(setLive);
  }, []);
  // Judge mode and Kevin's introduction run on the recorded data, so both open the replay.
  if (JUDGE_AT !== null || INTRO_ASKED) return <ReplayApp />;
  if (live === undefined) return <div className="loading">Loading…</div>;
  return live ? <LiveApp initial={live} /> : <ReplayApp />;
}

/** The API marks the pages it serves (api/src/server.ts); a static host has no live desk. */
function servedByApi(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector('meta[name="day-one-api"]') !== null
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <footer className="foot">{children} All companies, people and numbers are fictional.</footer>
  );
}

/**
 * The page, with Behind the curtain as a dark rail beside it when the switch is on. The attack
 * arena keeps its own log in that place, so it opens without the run's rail.
 */
function WithRail({
  curtain,
  rail,
  feed,
  children,
}: {
  curtain: boolean;
  rail: React.ReactNode;
  /** Kevin's activity feed, on the Overview: it shares the right column with the curtain. */
  feed: FeedProps | null;
  children: React.ReactNode;
}) {
  if (feed) {
    return (
      <ActivityFrame curtain={curtain} rail={rail} feed={feed}>
        {children}
      </ActivityFrame>
    );
  }
  return (
    <div className={curtain ? "with-rail" : undefined}>
      <div className="page-wrap">{children}</div>
      {curtain && <aside className="rail-v2">{rail}</aside>}
    </div>
  );
}

/** Every page but the Overview: the header, then the page's content. */
function Page({
  label,
  title,
  sentence,
  note,
  className,
  children,
}: {
  label: string;
  title: string;
  /** What the page is for: shown behind the header's "About" button, not under the title. */
  sentence: string;
  /** Where the page's numbers come from, beside the title (a recorded snapshot, in the replay). */
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={className ? `page v2 ${className}` : "page v2"} aria-label={label}>
      <PageHeader title={title} help={sentence} {...(note ? { right: note } : {})} />
      {children}
    </main>
  );
}

/** Each page's header: where it sits, its title, and one plain sentence for its "About" button. */
const PAGE_TEXT: Record<
  Exclude<PageId, "integration" | "overview">,
  { group: "plant" | "money" | "acme" | "hq" | "proof"; title: string; sentence: string }
> = {
  map: {
    group: "plant",
    title: "Plant twin",
    sentence:
      "The three plants, the suppliers, the escrow and HQ, as the run moves through them. Click any area of any plant for what it holds, its equipment and what last happened there.",
  },
  brief: {
    group: "plant",
    title: "5am brief",
    sentence: "What moved since the last working day, what waits on a person, what to buy first.",
  },
  batches: {
    group: "plant",
    title: "Batch records",
    sentence:
      "Every batch with its yield and waste; this week's scans wait here until Ray checks them.",
  },
  inventory: {
    group: "plant",
    title: "Inventory & forecast",
    sentence: "What the plant holds, what the plan will draw, and every lot with its state.",
  },
  lots: {
    group: "plant",
    title: "Lots & recall",
    sentence: "Every lot to the batches it went into and back to its supplier, PO and receipt.",
  },
  schedule: {
    group: "plant",
    title: "Schedule",
    sentence: "The next four weeks of batches, what each one draws and what it leaves.",
  },
  purchasing: {
    group: "plant",
    title: "Purchasing",
    sentence:
      "Every order with its approval, receipt and QC decision, the quotes, and what each order changed.",
  },
  invoices: {
    group: "plant",
    title: "Invoices",
    sentence:
      "Every bill matched to its PO and receipt before it is paid; anything odd waits for Marcy.",
  },
  spreadsheets: {
    group: "plant",
    title: "Spreadsheets",
    sentence:
      "The sheets the plant brings in, what Kevin read in them and what he asked before posting.",
  },
  plants: {
    group: "acme",
    title: "Three plants",
    sentence:
      "One ledger for the three plants: stock, the moves Kevin proposes, and what does not add up.",
  },
  erp: {
    group: "acme",
    title: "ERP connection",
    sentence: "What Day One sends the acquirer's ERP, and the checks that say the two agree.",
  },
  hq: {
    group: "hq",
    title: "Spending limits",
    sentence:
      "Kevin's limits as the contract enforces them, the category caps and supplier standing.",
  },
  suppliers: {
    group: "hq",
    title: "Suppliers",
    sentence:
      "Who Kevin may buy from and the order may pay, and what happened when someone tried anyway.",
  },
  group: {
    group: "hq",
    title: "Group purchasing",
    sentence: "Plants that need the same material pool it into one order; each pays its own share.",
  },
  sealed: {
    group: "hq",
    title: "Sealed bids",
    sentence:
      "Quotes stay sealed until the deadline, so nobody, Kevin included, can peek or change one.",
  },
  money: {
    group: "money",
    title: "Money",
    sentence:
      "The plant's cash, stock, bills and escrow over twelve months, and what Kevin has saved against what he costs, each figure with its formula.",
  },
  export: {
    group: "money",
    title: "Bookkeeper export",
    sentence: "Settled purchase orders, one row per line, ready for the bookkeeper.",
  },
  reconciliation: {
    group: "hq",
    title: "Reconciliation",
    sentence:
      "Day One's ledger, the ERP and the contract, checked against each other line by line.",
  },
  arena: {
    group: "proof",
    title: "Attack arena",
    sentence:
      "Pick one of the twenty-one recorded attacks, fire it, and see what refused it and why.",
  },
  ask: {
    group: "proof",
    title: "Talk to Kevin",
    sentence: "Ask Kevin why he did something; he answers from the records and cites each one.",
  },
};

/** A page's short name, for the global header. */
function titleOf(page: PageId): string {
  if (page === "integration") return "Your integration";
  if (page === "overview") return "Overview";
  return PAGE_TEXT[page].title;
}

/** The pages both sources share; each source hands in its own panes and reads. */
function Pages({
  page,
  plant,
  clock,
  source,
  curtain,
  inventory,
  books,
  policy,
  inbox,
  links,
  map,
  kevin,
  activity,
  integration,
  plants,
  queue,
  wizard,
  exportPane,
  hq,
  goMap,
  go,
  moves,
  foot,
  run,
  at,
  onStep,
  turn,
  review,
  deskActions,
}: {
  page: PageId;
  plant: PlantCode;
  clock: Clock;
  source: Source;
  curtain: boolean;
  inventory: PlantInventory | null;
  books: Books | null;
  policy: PolicyState | null;
  inbox: InboxState | null;
  links: { brief: string | null; books: string };
  /** The plant map; on the map page it takes the area picking, on the Overview the desk's place. */
  map: (pick?: MapProps) => React.ReactNode;
  kevin: React.ReactNode;
  activity: React.ReactNode;
  integration: React.ReactNode;
  plants: React.ReactNode;
  /** Live: the scan queue on Batch records. */
  queue: React.ReactNode;
  /** Live: the import wizard on Spreadsheets. */
  wizard: React.ReactNode;
  exportPane: React.ReactNode;
  hq: React.ReactNode;
  /** Open the plant map on the group purchase. */
  goMap: () => void;
  /** Open another page (the order desk's "Show on the plant"). */
  go: (next: { page: PageId }) => void;
  /** Kevin's proposed moves between plants, for Inventory's material desk. */
  moves: TransferSuggestions | null;
  foot: React.ReactNode;
  /** The run on screen and its step, for the Overview's queue and timeline. */
  run: RunData;
  at: number;
  /** The replay's step control. */
  onStep?: (i: number) => void;
  /** Whose turn it is, the morning review and the decision's buttons, for the Overview's desk. */
  turn: Turn;
  review: ReviewState | null;
  deskActions: React.ReactNode;
}) {
  if (page === "integration")
    return (
      <>
        {integration}
        <div className="page v2 foot-wrap">{foot}</div>
      </>
    );
  if (page === "overview")
    return (
      <>
        <Overview
          plant={plant}
          source={source}
          inventory={inventory}
          map={(focus) => map(focus ? { focus } : undefined)}
          kevin={kevin}
          activity={activity}
          run={run}
          at={at}
          {...(onStep ? { onStep } : {})}
          saved={<MoneyTile clock={clock} plant={plant} />}
          turn={turn}
          review={review}
          inbox={inbox}
          deskActions={deskActions}
        />
        <div className="page v2 foot-wrap">{foot}</div>
      </>
    );
  const text = PAGE_TEXT[page];
  const props = { plant, source, curtain };
  const body = (() => {
    switch (page) {
      case "map":
        return <MapPage source={source} curtain={curtain} map={map} />;
      case "brief":
        return (
          <BriefPage {...props} printUrl={links.brief ? briefUrl(links.brief, plant) : null} />
        );
      case "batches":
        return <BatchRecordsPage {...props} inbox={inbox} queue={queue} />;
      case "inventory":
        return (
          <InventoryPage
            {...props}
            inventory={inventory}
            moves={moves?.suggestions ?? []}
            go={(page) => go({ page })}
            onShow={(where) => openOnTwin(where, go)}
          />
        );
      case "lots":
        return <LotsPage {...props} />;
      case "schedule":
        return <SchedulePage {...props} />;
      case "purchasing":
        return (
          <PurchasingPage
            {...props}
            policy={policy}
            desk={{
              run,
              at,
              turn,
              inventory,
              actions: deskActions,
              onShow: (where) => openOnTwin(where, go),
            }}
          />
        );
      case "invoices":
        return <InvoicesPage {...props} books={books} exportUrl={links.books} />;
      case "spreadsheets":
        return <SpreadsheetsPage {...props} wizard={wizard} />;
      case "plants":
        return (
          <>
            <PlantColumns source={source} run={run} at={at} inventory={inventory} />
            {plants}
            <MaterialMatrix inventory={inventory} />
            <ThreeSchedules source={source} />
          </>
        );
      case "erp":
        return <ErpPage source={source} curtain={curtain} />;
      case "hq":
        return (
          <>
            <LimitTiles source={source} />
            {hq}
          </>
        );
      case "suppliers":
        return <SuppliersPage source={source} curtain={curtain} />;
      case "group":
        return <GroupPage go={goMap} />;
      case "sealed":
        return <SealedPage source={source} curtain={curtain} />;
      case "money":
        return <MoneyPage {...props} clock={clock} />;
      case "export":
        return (
          <>
            <BooksTiles books={books} />
            {exportPane}
          </>
        );
      case "reconciliation":
        return <ReconciliationPage source={source} curtain={curtain} />;
      case "arena":
        return <ArenaPage />;
      case "ask":
        return <AskPage source={source} />;
    }
  })();
  return (
    <Page
      label={`${text.title} page`}
      title={text.title}
      sentence={text.sentence}
      {...(!source.live && SNAPSHOT_PAGES.has(page) ? { note: <SnapshotNote /> } : {})}
      {...(page === "map" ? { className: "twin-page" } : {})}
    >
      {body}
      {foot}
    </Page>
  );
}

/**
 * The replay's pages that read the ledger as it stood at the end of the recorded run
 * (web/src/data/pages.json and plants.json), not at the clock's time: each says so beside its title,
 * so nobody reads Monday 5:00 AM's screen as Monday's stock (Astra's first pass, A4.3).
 */
const SNAPSHOT_PAGES = new Set<PageId>([
  "batches",
  "inventory",
  "purchasing",
  "schedule",
  "invoices",
  "plants",
  "export",
  "brief",
  "erp",
  "reconciliation",
  "ask",
]);

function SnapshotNote({ header = false }: { header?: boolean }) {
  const when = new Date(plantsSnapshot.at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
  return (
    <span
      className="src-note"
      title="These figures are the plant's records as they stood at the end of the recorded run, not at the clock's time."
    >
      {header ? "End-of-week snapshot" : `End-of-week snapshot · ${when}`}
    </span>
  );
}

/** Drops ?inspect= from the address once the first shift no longer points the twin at a place. */
function clearInspect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("inspect")) return;
  q.delete("inspect");
  const search = q.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}

/** The plant twin opened on a place the order desk points at (the twin reads ?inspect= on open). */
function openOnTwin(where: Where, go: (next: { page: PageId }) => void) {
  const q = new URLSearchParams(location.search);
  q.set("inspect", where.focus);
  q.delete("run");
  history.replaceState(null, "", `?${q.toString()}`);
  go({ page: "map" });
}

/** The plant map opened on the recorded group purchase (the map reads ?run=group when it opens). */
function openGroupOnMap(go: (next: { page: PageId }) => void) {
  const q = new URLSearchParams(location.search);
  q.set("run", "group");
  history.replaceState(null, "", `?${q.toString()}`);
  go({ page: "map" });
}

/** The printable brief for a plant: the API takes ?plant=; the static host has Hollow Pine's. */
function briefUrl(base: string, plant: PlantCode) {
  if (base === STATIC_BRIEF_URL) return plant === "B" ? base : "";
  return `${base}?plant=${plant}`;
}

/** Things waiting on a person, per page: the sidebar's counts. */
function badgesOf(
  inventory: PlantInventory | null,
  moves: TransferSuggestions | null,
  books: Books | null,
  inbox: InboxState | null,
): Partial<Record<PageId, { count: number; tone: "attention" | "problem" }>> {
  const reviews = inventory?.discrepancies.filter((d) => d.status === "open").length ?? 0;
  const low = inventory?.materials.filter((m) => m.byPlant.B?.low).length ?? 0;
  return {
    plants: { count: reviews + (moves?.suggestions.length ?? 0), tone: "attention" },
    invoices: { count: books?.held.length ?? 0, tone: "problem" },
    inventory: { count: low, tone: "attention" },
    batches: {
      count: inbox?.items.filter((i) => i.status === "waiting").length ?? 0,
      tone: "attention",
    },
  };
}

// ------------------------------------------------------------------ replay (static)

const JUMPS = [...jumpsFor(recorded.steps), ...worldJumps(WORLD_INDEX.incidents)];
const MARKERS = incidentMarkers(WORLD_INDEX.incidents);
/** What the feed reads the recorded steps' words from. */
const REPLAY_FEED = { steps: recorded.steps, approvals: recorded.approvals };

function ReplayApp() {
  const data = recorded;
  const last = data.steps.length - 1;
  // The recorded run is a stretch of the sim clock: a step is on screen from its time until the
  // next one's, and stepping seeks the clock to the step's time.
  const [clock] = useState(() =>
    createClock({
      history: plantsSnapshot,
      span: WORLD_SPAN,
      steps: data.steps,
      initial: readPersisted(location.search, RECORDED_FRAME ? null : storedClock()),
    }),
  );
  useEffect(() => {
    shareClock(clock);
    const stop = RECORDED_FRAME ? () => undefined : persist(clock);
    // The twelve-month worlds load month by month onto the clock (worldEvents.ts).
    const unload = attachWorld(clock);
    return () => {
      stop();
      unload();
      shareClock(null);
    };
  }, [clock]);
  const at = useClock(clock, (s) => stepAt(s.simNow, clock.range));
  const [curtain, setCurtain] = useState(false);
  const route = useRoute();
  const [judge, setJudge] = useState<number | "summary" | null>(JUDGE_AT);
  // The first shift: Kevin's introduction, then the walkthrough (FirstShift.tsx).
  const [shift, setShift] = useState<"intro" | "guide" | null>(FIRST_OPEN ? "intro" : null);
  // Once the introduction is over, ?intro=1 leaves the address so a reload does not reopen it.
  useEffect(() => {
    if (shift !== null) return;
    const q = new URLSearchParams(location.search);
    if (!q.has("intro")) return;
    q.delete("intro");
    history.replaceState(null, "", q.toString() ? `?${q}` : location.pathname);
  }, [shift]);
  /** Where a replay opened from the menu started, to return there; null on a first visit. */
  const entry = useRef<{ page: PageId; plant: PlantCode; at: number; curtain: boolean } | null>(
    null,
  );
  /** The page the walkthrough last opened: any other page is the person choosing their own way. */
  const guidePage = useRef<PageId | null>(null);
  // A page or plant chosen from the sidebar ends the walkthrough there and honours the choice.
  useEffect(() => {
    if (shift !== "guide") return;
    if (route.page === guidePage.current && route.plant === "B") return;
    entry.current = null;
    clearInspect();
    setShift(null);
  }, [route.page, route.plant, shift]);

  const go = useCallback(
    (to: number) => clock.seek(clock.range.steps[Math.max(0, Math.min(last, to))] ?? 0),
    [clock, last],
  );
  const headerClock = (
    <HeaderClock
      clock={clock}
      jumps={JUMPS}
      markers={MARKERS}
      onPlay={() => {
        if (at === last) go(0);
        clock.play();
      }}
      onReset={() => {
        forgetClock();
        clock.pause();
        clock.resetSession();
        go(0);
      }}
    />
  );

  useEffect(() => {
    if (route.page !== "overview" && route.page !== "map") return;
    // While Kevin is showing Ray around, the arrows do not step the run.
    if (shift !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, route.page, shift]);

  const current = data.steps[at] as Step;
  const turn = turnFromStep(data.steps, at + 1);
  const deskActions =
    turn.kind === "confirm" && recordedBatchReview ? (
      <BatchReadingDialog
        label="Review BR-B-1045"
        scan={recordedBatchReview.scan}
        reading={recordedBatchReview.reading}
        note="Recorded reading. Confirming advances this replay to Ray’s recorded inventory posting."
        onConfirm={() => go(at + 1)}
      />
    ) : (
      <ReplayDeskActions
        turn={turn}
        data={data}
        at={at}
        onNext={() => go(at + 1)}
        onReplay={() => go(0)}
      />
    );
  // The header's chip reads the same status as the feed's top line (one source).
  const kevinNow = useKevinStatus(clock, REPLAY_FEED);
  const upNext = at < last ? audienceOf(data.steps[at + 1] as Step) : null;
  const links = { brief: STATIC_BRIEF_URL, books: STATIC_BOOKS_URL };
  const foot = (
    <Foot>Replay of a run recorded on {new Date(data.recordedAt).toISOString().slice(0, 10)}.</Foot>
  );
  const kevin =
    at === last ? (
      <Closing
        data={data}
        curtain={curtain}
        onReplay={() => go(0)}
        onPlants={() => route.go({ page: "plants" })}
      />
    ) : (
      <section className="panel next" aria-label="Replay steps">
        <div className="panel-head">
          <h2>Replay of the recorded week</h2>
          <span className="right small muted">
            Step {at + 1} of {last + 1}
          </span>
        </div>
        <p className="small muted">
          This desk replays what happened at Hollow Pine. Next steps through it; nothing you press
          here changes a record.
        </p>
        <div className="transport">
          <button type="button" className="btn" onClick={() => go(at - 1)} disabled={at === 0}>
            ← Back
          </button>
          <button type="button" className="btn" onClick={() => go(at + 1)} disabled={at === last}>
            Next →
          </button>
          <FeedButton />
          <span className="step-count">{plainTitle(current)}</span>
        </div>
      </section>
    );

  const person = upNext ?? { name: "Day One", role: "Run complete" };
  const people: Person[] = PEOPLE.map((p) => {
    const turn = nextTurn(data.steps, at, p.name);
    const when = turn === null ? undefined : clock.range.steps[turn];
    const title = turn === null ? null : (data.steps[turn] as Step).title;
    return {
      ...p,
      line:
        title === null
          ? "nothing waiting"
          : `next: ${title}${when === undefined ? "" : ` · ${readout(when)}`}`,
      current: upNext?.name === p.name,
      onPick: turn === null ? null : () => go(turn),
    };
  });
  const header = (
    <GlobalHeader
      title={titleOf(route.page)}
      plant={route.plant}
      onPlant={(plant) => route.go({ plant })}
      clock={SNAPSHOT_PAGES.has(route.page) ? <SnapshotNote header /> : headerClock}
      snapshot={SNAPSHOT_PAGES.has(route.page)}
      kevin={kevinNow}
      onKevin={() => {
        route.go({ page: "overview" });
        openFeed();
      }}
      curtain={curtain}
      setCurtain={setCurtain}
      people={people}
      upNext={person}
      saved={
        <SavedCounter
          clock={clock}
          plant={route.plant}
          onOpen={() => route.go({ page: "money" })}
        />
      }
      onJudge={() => {
        setShift(null);
        setJudge(0);
      }}
      onFirstShift={() => {
        // Opened by hand: remember where the person was, to put them back there after.
        entry.current = { page: route.page, plant: route.plant, at, curtain };
        setJudge(null);
        setShift("intro");
      }}
    />
  );
  /** Back to Ray's desk at the start of his morning, as the first shift leaves it. */
  const toDesk = () => {
    clearInspect();
    setCurtain(false);
    route.go({ page: "overview", plant: "B" });
    go(0);
  };
  /**
   * The first shift is over: a first visit lands on Ray's desk at 5:00 AM; a replay opened from
   * the menu puts the person back where they were (Astra's first pass, B4).
   */
  const leaveShift = () => {
    // Served by the API, the desk to work is the live one the front door opened: go back to it
    // rather than stay on the recorded replay the introduction plays on.
    if (servedByApi()) {
      location.assign(location.pathname);
      return;
    }
    const was = entry.current;
    entry.current = null;
    if (!was) return toDesk();
    clearInspect();
    setCurtain(was.curtain);
    route.go({ page: was.page, plant: was.plant });
    go(was.at);
  };

  return (
    <Shell
      page={route.page}
      plant={route.plant}
      go={route.go}
      curtain={curtain}
      setCurtain={setCurtain}
      header={header}
      badges={badgesOf(
        plantsSnapshot.inventory,
        plantsSnapshot.transfers,
        plantsSnapshot.books,
        null,
      )}
      person={person}
    >
      <WithRail
        curtain={curtain && route.page !== "arena"}
        rail={<Curtain data={data} upTo={at} page={route.page} />}
        feed={
          route.page === "overview"
            ? {
                clock,
                context: REPLAY_FEED,
                go: route.go,
                plant: route.plant,
                actions:
                  at < last ? (
                    <button type="button" className="primary" onClick={() => go(at + 1)}>
                      Next: {(data.steps[at + 1] as Step).title} →
                    </button>
                  ) : null,
              }
            : null
        }
      >
        <RecordNav run={data} at={at} page={route.page} curtain={curtain} go={route.go}>
          <Pages
            page={route.page}
            plant={route.plant}
            clock={clock}
            source={{ live: false, version: 0 }}
            run={data}
            at={at}
            onStep={go}
            turn={turn}
            review={reviewSnapshot}
            deskActions={deskActions}
            curtain={curtain}
            inventory={plantsSnapshot.inventory}
            books={plantsSnapshot.books}
            policy={null}
            inbox={null}
            links={links}
            queue={null}
            wizard={null}
            goMap={() => openGroupOnMap(route.go)}
            go={route.go}
            moves={plantsSnapshot.transfers}
            map={(pick) => (
              <PlantView
                run={data}
                at={at}
                curtain={curtain}
                onStep={go}
                onCurtain={setCurtain}
                onOpen={(page) => route.go({ page })}
                {...pick}
              />
            )}
            kevin={
              <>
                {kevin}
                <ReviewPane
                  review={reviewSnapshot}
                  busy={false}
                  curtain={curtain}
                  viewer="Ray Delgado"
                  open={at < last && audienceOf(current).name === "Ray Delgado"}
                  onSign={null}
                  readOnly={REVIEW_READ_ONLY}
                />
              </>
            }
            activity={<StaffFeed data={data} upTo={at} onPick={go} curtain={curtain} />}
            integration={
              <Integration
                source={{ live: false, version: 0 }}
                books={plantsSnapshot.books}
                policy={null}
                inbox={null}
                busy={false}
                go={(page) => route.go({ page })}
                curtain={curtain}
              />
            }
            plants={
              <PlantsPane
                error={null}
                inventory={plantsSnapshot.inventory}
                mass={plantsSnapshot.massBalance}
                policy={null}
                moves={plantsSnapshot.transfers}
                moveNote={[]}
                busy={false}
                snapshotAt={plantsSnapshot.at}
              />
            }
            exportPane={
              <BooksPane
                books={plantsSnapshot.books}
                error={null}
                links={links}
                run={data}
                curtain={curtain}
              />
            }
            hq={<HqPane policy={null} live={false} />}
            foot={foot}
          />
        </RecordNav>
      </WithRail>
      {shift === "intro" && (
        <FirstShiftIntro
          onTour={() => {
            remember("walked");
            guidePage.current = "overview";
            setCurtain(false);
            route.go({ page: "overview", plant: "B" });
            go(0);
            setShift("guide");
          }}
          onDesk={() => {
            remember("skipped");
            leaveShift();
            setShift(null);
          }}
        />
      )}
      {shift === "guide" && (
        <FirstShiftGuide
          go={(page, step) => {
            guidePage.current = page;
            route.go({ page, plant: "B" });
            go(step);
          }}
          setCurtain={setCurtain}
          onEnd={(finished) => {
            remember(finished ? "finished" : "walked");
            leaveShift();
            setShift(null);
          }}
          onProof={() => {
            remember("finished");
            setShift(null);
            setJudge(0);
          }}
        />
      )}
      {judge !== null && (
        <Suspense fallback={null}>
          <JudgeMode
            start={judge}
            go={(page, step) => {
              if (page !== route.page) route.go({ page, plant: "B" });
              go(step);
            }}
            setCurtain={setCurtain}
            onExit={() => setJudge(null)}
          />
        </Suspense>
      )}
    </Shell>
  );
}

/** The last step: what just happened, in one line, and where to look next. */
function Closing({
  data,
  curtain,
  onReplay,
  onPlants,
}: {
  data: RunData;
  curtain: boolean;
  onReplay: () => void;
  onPlants: () => void;
}) {
  const s = data.summary;
  return (
    <section className="panel next" aria-label="Demo steps">
      <div className="panel-head">
        <h2>Up next</h2>
        <span className="right">
          <Pill tone="paid">run complete</Pill>
        </span>
      </div>
      <p className="lead">
        That is the whole loop: a batch record read, stock reordered, a refusal over the limit, an
        approval by text, and the supplier paid the moment QC released the lot.
        {s && !curtain
          ? ` Switch on "Behind the curtain" for the ${s.transactions} testnet transactions behind it.`
          : ""}
      </p>
      <div className="transport">
        <button type="button" className="btn primary" onClick={onReplay}>
          Replay
        </button>
        <button type="button" className="btn" onClick={onPlants}>
          Open Plants
        </button>
        <span className="step-count">
          {data.steps.length} / {data.steps.length} · {data.steps.at(-1)?.title}
        </span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ live (behind the API)

function LiveApp({ initial }: { initial: LiveState }) {
  const [state, setState] = useState(initial);
  const [curtain, setCurtain] = useState(false);
  const route = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [inventory, setInventory] = useState<PlantInventory | null>(null);
  const [plantsError, setPlantsError] = useState<string | null>(null);
  /** Bumped by "Start over" so panes that keep their own state (the import wizard) restart. */
  const [runs, setRuns] = useState(0);
  const [mass, setMass] = useState<MassBalance | null>(null);
  const [books, setBooks] = useState<Books | null>(null);
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [moves, setMoves] = useState<TransferSuggestions | null>(null);
  // Kevin's line about the last approve, dismiss or receipt; the refresh below does not clear it.
  const [moveNote, setMoveNote] = useState<string[]>([]);
  const [inbox, setInbox] = useState<InboxState | null>(null);
  /** Kevin's morning review of Ray's mailbox; null until the API has answered. */
  const [mail, setMail] = useState<ReviewState | null>(null);
  /** Bumped by every action, so the program's stages read again after a decision. */
  const [acted, setActed] = useState(0);
  // The API moves the run and its clock; the sim clock follows the last step on the recorded
  // run's times and keeps what people did this session.
  const [clock] = useState(() =>
    createClock({
      history: plantsSnapshot,
      span: WORLD_SPAN,
      steps: recorded.steps,
      frames: null,
      initial: { log: readPersisted(location.search, storedClock()).log ?? [] },
    }),
  );
  useEffect(() => {
    shareClock(clock);
    const stop = persist(clock);
    // The twelve-month worlds load month by month onto the clock (worldEvents.ts).
    const unload = attachWorld(clock);
    return () => {
      stop();
      unload();
      shareClock(null);
    };
  }, [clock]);
  useEffect(() => {
    clock.seek(stepTimes(state.steps).at(-1) ?? clock.range.golden.start);
  }, [clock, state.steps]);

  // The review is read once per run and kept by the API; read again after every action so a
  // signature shows at once. A failed read keeps what is on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run moves or someone acts
  useEffect(() => {
    let stale = false;
    getReview().then(
      (next) => {
        if (!stale) setMail(next);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [state, acted]);

  // Scans land in the watched folder at any time: the queue is read again every few seconds
  // and after every action. A failed read keeps what is on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run (state) moves
  useEffect(() => {
    let stale = false;
    const load = () =>
      getInbox().then(
        (next) => {
          if (!stale) setInbox(next);
        },
        () => undefined,
      );
    load();
    const timer = setInterval(load, 3_000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [state]);

  // Every page reads the ledger and the contract when opened and whenever the run moves; the
  // figures stay on screen between reads. The Overview's numbers and the sidebar's counts need
  // stock, moves and books on every page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run (state) moves
  useEffect(() => {
    let stale = false;
    setPlantsError(null);
    const load = <T,>(get: () => Promise<T>, set: (value: T) => void) =>
      get().then(
        (value) => {
          if (!stale) set(value);
        },
        (e: unknown) => {
          if (!stale) setPlantsError(e instanceof Error ? e.message : String(e));
        },
      );
    load(getInventory, setInventory);
    load(getTransferSuggestions, setMoves);
    load(getBooks, setBooks);
    if (route.page === "plants") {
      load(getPolicy, setPolicy);
      load(getMassBalance, setMass);
    } else if (["hq", "integration", "purchasing"].includes(route.page)) {
      load(getPolicy, setPolicy);
    }
    return () => {
      stale = true;
    };
  }, [route.page, state]);

  // When the run moves to the next person, the page comes back to the Kevin panel so they see
  // their turn, however far down the last reader had scrolled.
  const turn = state.next.phase + state.next.who + state.steps.length;
  const seenTurn = useRef(turn);
  useEffect(() => {
    if (seenTurn.current === turn) return;
    seenTurn.current = turn;
    if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [turn]);

  const send = useCallback(
    async (label: string, call: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);
      try {
        await call();
        if (label !== "Start over") clock.act(label);
        setState(await getState());
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(e instanceof ApiError && e.hint ? { message, hint: e.hint } : { message });
        try {
          setState(await getState());
        } catch {
          // The state stays as it was; the error is already on screen.
        }
      } finally {
        setBusy(null);
        setActed((n) => n + 1);
      }
    },
    [clock],
  );

  const act = (a: Action) => send(a.label, () => postJson(a.path, a.body));
  const signDraft = (messageId: string) =>
    send(`Sign ${messageId}`, () => postReviewSign(messageId));
  const uploadFile = (file: File) =>
    send(`Upload ${file.name}`, () => postImage("api/batch-records", file, file.name));
  const confirmScan = (batchNo: string, resolutions: Record<string, string>) =>
    send(`Confirm ${batchNo}`, () => postInboxConfirm(batchNo, resolutions));

  const review = (id: number, decision: "apply" | "dismiss") =>
    send(decision === "apply" ? "Apply the adjustment" : "Dismiss", async () => {
      const result = await postReview(id, decision);
      setInventory(result.inventory);
      // An applied waste correction changes the mass balance too.
      setMass(await getMassBalance());
    });
  const proposeWaste = () =>
    send("Send the waste correction", async () => {
      const result = await postWasteProposals();
      setInventory(result.inventory);
      setMass(result.massBalance);
    });

  const moved = (label: string, call: () => Promise<TransferSuggestions>) =>
    send(label, async () => {
      const result = await call();
      setMoves(result);
      setMoveNote([
        ...(result.sentence ? [result.sentence] : []),
        ...(result.discrepancies ?? []).map((d) => d.sentence),
      ]);
      setInventory(await getInventory());
    });
  const decideMove = (key: string, decision: "approve" | "dismiss") =>
    moved(decision === "approve" ? "Approve the transfer" : "Dismiss", () =>
      postTransferDecision(key, decision),
    );
  const receiveMove = (transferNo: string) =>
    moved(`Receive ${transferNo}`, () => postTransferReceipt(transferNo));

  const reset = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Start the recorded run over? Everything done in this session is cleared.")
    )
      return;
    setMoveNote([]);
    setRuns((n) => n + 1);
    clock.resetSession();
    send("Start over", () => postJson("api/run/reset"));
  };

  const last = state.steps.length - 1;
  const queue = inbox?.folder && inbox.items.length > 0 ? inbox : null;
  const atUpload = state.next.phase === "upload";
  const waiting =
    inbox?.items.filter(
      (i) => i.status === "waiting" && (i.waitingFor === null || i.waitingFor === "Ray Delgado"),
    ).length ?? 0;
  const actor = actorOf(state.next);
  const deskTurn = turnFromLive(state.next);
  // The desk carries the decision's buttons; Up next keeps the upload, the queue and Start over.
  const onDesk = DESK_PHASES.has(state.next.phase);
  // At Ray's turn with scans in the folder, the queue itself is the desk's action.
  const deskButtons =
    atUpload && queue ? (
      <div className="desk-queue">
        <InboxPane
          inbox={queue}
          busy={busy !== null}
          viewer="Ray Delgado"
          onConfirm={confirmScan}
          embedded
        />
      </div>
    ) : state.next.phase === "confirm" && state.draftReading ? (
      <BatchReadingDialog
        label={`Review ${state.next.subject ?? "batch record"}`}
        scan="api/batch-records/draft/scan"
        reading={state.draftReading}
        note="Check the extracted values against the scan. Confirming posts the batch’s material usage to inventory."
        onConfirm={() => state.next.subject && confirmScan(state.next.subject, {})}
        disabled={busy !== null}
      />
    ) : onDesk ? (
      <DeskButtons next={state.next} mode={state.mode} busy={busy !== null} onAct={act} />
    ) : null;
  // A refusal shows where the person clicked: on the desk when the desk holds the buttons.
  const deskActions =
    deskButtons === null ? null : (
      <>
        {deskButtons}
        {error && <DeskError error={error} />}
      </>
    );
  const feedContext = useMemo(
    () => ({
      steps: state.steps,
      approvals: state.approvals,
      next: state.next.who ? { who: state.next.who, role: roleLabel(state.next.role) } : null,
    }),
    [state],
  );
  const kevinNow = useKevinStatus(clock, feedContext);
  const foot = (
    <Foot>
      {state.mode === "live"
        ? "Live: each step is real and takes a moment."
        : "Step by step through the recorded run."}
    </Foot>
  );

  const person = { name: actor.name, role: actor.role ?? null };
  // The live run moves through the API: each person's turn is a line, not a seek.
  const people: Person[] = PEOPLE.map((p) => ({
    ...p,
    line: state.next.who === p.name ? `up next: ${state.next.action}` : "nothing waiting",
    current: state.next.who === p.name,
    onPick: null,
  }));
  const header = (
    <GlobalHeader
      title={titleOf(route.page)}
      plant={route.plant}
      onPlant={(plant) => route.go({ plant })}
      clock={<HeaderClockLine clock={clock} />}
      kevin={busy ? { state: "drafting", label: "working…", working: true } : kevinNow}
      onKevin={() => {
        route.go({ page: "overview" });
        openFeed();
      }}
      curtain={curtain}
      setCurtain={setCurtain}
      people={people}
      upNext={person}
      saved={
        <SavedCounter
          clock={clock}
          plant={route.plant}
          onOpen={() => route.go({ page: "money" })}
        />
      }
      onJudge={() => {
        location.search = "?judge=1";
      }}
      onFirstShift={() => {
        location.search = "?intro=1";
      }}
    />
  );

  return (
    <Shell
      page={route.page}
      plant={route.plant}
      go={route.go}
      curtain={curtain}
      setCurtain={setCurtain}
      header={header}
      badges={{
        ...badgesOf(inventory, moves, books, inbox),
        overview: { count: waiting + (mail?.toSign ?? 0), tone: "attention" },
      }}
      person={person}
    >
      <WithRail
        curtain={curtain && route.page !== "arena"}
        rail={<Curtain data={state} upTo={last} page={route.page} />}
        feed={
          route.page === "overview"
            ? {
                clock,
                context: feedContext,
                go: route.go,
                plant: route.plant,
                actions: actionsFor(state.next).map((a) => (
                  <ActionButton
                    key={a.label}
                    action={a}
                    disabled={busy !== null}
                    off={offInReplay(state.next, state.mode, a.label)}
                    onAct={act}
                  />
                )),
              }
            : null
        }
      >
        <RecordNav run={state} at={last} page={route.page} curtain={curtain} go={route.go}>
          <Pages
            page={route.page}
            plant={route.plant}
            clock={clock}
            source={{ live: true, version: `${state.steps.length}-${acted}` }}
            run={state}
            at={last}
            turn={deskTurn}
            review={mail}
            deskActions={deskActions}
            curtain={curtain}
            inventory={inventory}
            books={books}
            policy={policy}
            inbox={inbox}
            links={{ brief: BRIEF_URL, books: BOOKS_EXPORT_URL }}
            queue={
              queue ? (
                <InboxPane
                  inbox={queue}
                  busy={busy !== null}
                  viewer="Ray Delgado"
                  onConfirm={confirmScan}
                />
              ) : null
            }
            wizard={
              <section className="card-v2">
                <ImportPane key={runs} onPosted={() => setActed((n) => n + 1)} />
              </section>
            }
            goMap={() => openGroupOnMap(route.go)}
            go={route.go}
            moves={moves}
            map={(pick) => (
              <PlantView
                run={state}
                at={last}
                curtain={curtain}
                onCurtain={setCurtain}
                onOpen={(page) => route.go({ page })}
                {...pick}
              />
            )}
            kevin={
              <>
                <UpNext
                  state={state}
                  onDesk={onDesk}
                  busy={busy}
                  error={deskButtons === null ? error : null}
                  onAct={act}
                  onUpload={uploadFile}
                  onReset={reset}
                  queue={null}
                />
                {!atUpload && queue && (
                  <InboxPane
                    inbox={queue}
                    busy={busy !== null}
                    viewer="Ray Delgado"
                    onConfirm={confirmScan}
                  />
                )}
                {mail && (
                  <ReviewPane
                    review={mail}
                    busy={busy !== null}
                    curtain={curtain}
                    viewer="Ray Delgado"
                    open={state.next.who === "Ray Delgado"}
                    onSign={signDraft}
                  />
                )}
              </>
            }
            activity={<StaffFeed data={state} upTo={last} curtain={curtain} />}
            integration={
              <Integration
                source={{
                  live: true,
                  version: `${state.steps.length}-${acted}-${inbox?.items.map((i) => i.status).join("") ?? ""}`,
                }}
                books={books}
                policy={policy}
                inbox={inbox}
                busy={busy !== null}
                act={{
                  decide: (input) => send("Record the decision", () => postDecision(input)),
                  dropScans: (all) => send("Drop the scans", () => postDropScans(all)),
                  posted: () => setActed((n) => n + 1),
                  confirmScan,
                }}
                go={(page) => route.go({ page })}
                curtain={curtain}
                wizardKey={runs}
              />
            }
            plants={
              <PlantsPane
                error={plantsError}
                inventory={inventory}
                mass={mass}
                policy={policy}
                moves={moves}
                moveNote={moveNote}
                busy={busy !== null}
                act={{
                  onReview: review,
                  onProposeWaste: proposeWaste,
                  onDecideMove: decideMove,
                  onReceiveMove: receiveMove,
                }}
              />
            }
            exportPane={
              <BooksPane
                books={books}
                error={plantsError}
                links={{ brief: BRIEF_URL, books: BOOKS_EXPORT_URL }}
                run={state}
                curtain={curtain}
              />
            }
            hq={<HqPane policy={policy} live />}
            foot={foot}
          />
        </RecordNav>
      </WithRail>
    </Shell>
  );
}

/** The status pill on Up next: the state of the run in a word, for whoever is up. */
function nextPill(state: LiveState, busy: string | null): { tone: Tone; label: string } {
  const { next } = state;
  const first = next.who?.split(" ")[0] ?? "";
  if (busy) return { tone: "neutral", label: "Kevin is working…" };
  if (state.stopped) return { tone: "refused", label: "stopped" };
  switch (next.phase) {
    case "upload":
    case "confirm":
      return { tone: "waiting", label: `waiting on ${first || "Ray"}` };
    case "reply":
      return { tone: "refused", label: `refused · needs ${first}` };
    case "receive":
      return { tone: "held", label: `on its way · ${first}` };
    case "qc":
      return { tone: "waiting", label: `in quarantine · ${first}` };
    case "done":
      return { tone: "paid", label: "run complete" };
    default:
      return { tone: "neutral", label: "Kevin's turn" };
  }
}

/** Whoever is up next, Kevin's one-line ask and their buttons; Linda's phone; Ray's queue. */
function UpNext({
  state,
  onDesk,
  busy,
  error,
  onAct,
  onUpload,
  onReset,
  queue,
}: {
  state: LiveState;
  /** The decision's buttons are on the desk above; this panel keeps the rest. */
  onDesk: boolean;
  busy: string | null;
  error: { message: string; hint?: string } | null;
  onAct: (a: Action) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
  /** At Ray's turn, the scans Kevin already read come before an upload. */
  queue: React.ReactNode;
}) {
  const { next } = state;
  const actor = actorOf(next);
  const actions = queue || onDesk ? [] : actionsFor(next);
  const waitingOnKevin = actions.length === 0 && !queue && !onDesk && next.phase !== "done";
  const request = state.approvals.find((a) => a.response === null)?.request;
  const pill = nextPill(state, busy);
  const lead = busy
    ? `${busy}… Kevin is working.`
    : state.stopped
      ? `The run stopped: ${state.stopped}`
      : waitingOnKevin
        ? next.action
        : next.phase === "done"
          ? summaryLine(state)
          : next.phase === "reply"
            ? `Kevin texted ${actor.name.split(" ")[0]} for the approval. In this replay you answer in that role, from the desk above.`
            : next.action;

  return (
    <section className="panel next" aria-label="Next action">
      <div className="panel-head">
        <h2>Up next</h2>
        <span className="right">
          <Pill tone={pill.tone}>{pill.label}</Pill>
        </span>
      </div>
      <div className="who">
        <span className={actor.name === "Kevin" ? "avatar kevin" : "avatar"} aria-hidden="true">
          {initials(actor.name)}
        </span>
        <span>
          <b>{actor.name}</b>
          {actor.role && <span className="muted"> · {actor.role}</span>}
          {next.phase === "reply" && <span className="muted"> · on her phone</span>}
        </span>
      </div>
      <FeedButton />
      {queue ?? <p className="lead">{lead}</p>}
      {state.stopped && state.help && !busy && <p className="muted small help">{state.help}</p>}

      {next.phase === "reply" && request && !busy && !onDesk ? (
        <div className="phone">
          <div className="from">Text message · Kevin</div>
          <p className="bubble">{request}</p>
          <div className="actions">
            {[...actions].reverse().map((a) => (
              <ActionButton
                key={a.label}
                action={a}
                off={offInReplay(next, state.mode, a.label)}
                onAct={onAct}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="actions">
          {actions.map((a) => (
            <ActionButton
              key={a.label}
              action={a}
              disabled={busy !== null}
              off={offInReplay(next, state.mode, a.label)}
              onAct={onAct}
            />
          ))}
          {next.phase === "upload" && (
            <label className={queue ? "file btn quiet sm" : "file btn"}>
              <span>Upload a photo instead</span>
              <input
                type="file"
                accept="image/jpeg"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {next.phase !== "done" && (
            <button
              type="button"
              className="quiet sm end"
              disabled={busy !== null}
              onClick={onReset}
            >
              Start over
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error.message}
          {error.hint && <span className="muted"> {error.hint}</span>}
        </p>
      )}
    </section>
  );
}

function ActionButton({
  action,
  disabled,
  off,
  onAct,
}: {
  action: Action;
  disabled?: boolean;
  /** Why the replay cannot take this choice; the button is shown off, with the reason. */
  off?: string | null;
  onAct: (a: Action) => void;
}) {
  // A refusal (NO, reject) is outlined in the refused colour, never the brand green.
  const refuses = /^(NO\b|Reject\b|Decline\b)/.test(action.label);
  return (
    <button
      type="button"
      className={refuses ? "danger" : action.kind}
      data-action={action.kind}
      disabled={disabled || Boolean(off)}
      title={off ?? undefined}
      onClick={() => onAct(action)}
    >
      {action.label}
    </button>
  );
}

/** The decision's buttons on the desk; a choice the replay cannot take is off, with why. */
function DeskButtons({
  next,
  mode,
  busy,
  onAct,
}: {
  next: LiveState["next"];
  mode: string;
  busy: boolean;
  onAct: (a: Action) => void;
}) {
  const actions = actionsFor(next).map((a) => ({
    action: { ...a, label: friendlyAction(a.label) },
    off: offInReplay(next, mode, a.label),
  }));
  const reasons = [...new Set(actions.flatMap((a) => (a.off ? [a.off] : [])))];
  return (
    <>
      {actions.map((a) => (
        <ActionButton
          key={a.action.label}
          action={a.action}
          disabled={busy}
          off={a.off}
          onAct={onAct}
        />
      ))}
      {reasons.map((r) => (
        <p key={r} className="desk-off muted small">
          {r}
        </p>
      ))}
    </>
  );
}

/** A refusal, in one plain sentence, beside the button that was pressed. */
function DeskError({ error }: { error: { message: string; hint?: string } }) {
  return (
    <p className="desk-error" role="alert">
      {error.message}
      {error.hint && <span className="muted"> {error.hint}</span>}
    </p>
  );
}

function summaryLine(state: LiveState) {
  const s = state.summary;
  if (!s) return "The run is complete.";
  // A failure is named where it can be read (behind the curtain), never only counted.
  const failed = s.failed > 0 ? `, ${s.failed} failed (each one is listed behind the curtain)` : "";
  return `Done: ${s.transactions} actions recorded, ${s.refusedByDesign} refused on purpose${failed}.`;
}

/** The phases whose buttons sit on the desk's decision card. */
const DESK_PHASES = new Set(["upload", "confirm", "reply", "receive", "qc"]);
