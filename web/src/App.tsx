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
import { ActivityFrame, FeedButton, type FeedProps } from "./ActivityRail.tsx";
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
import { HeaderClock, HeaderClockLine, jumpsFor } from "./ClockBar.tsx";
import { Curtain } from "./Curtain.tsx";
import { kevinStatus, nextTurn, PEOPLE } from "./chrome.ts";
import {
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
import { stepTimes } from "./engine.ts";
import { initials, Pill, StaffFeed } from "./feed.tsx";
import { GlobalHeader, type Person } from "./Header.tsx";
import { ImportPane } from "./ImportPane.tsx";
import { InboxPane } from "./InboxPane.tsx";
import { postDecision, postDropScans } from "./journey.ts";
import { type Action, actionsFor, actorOf, roleLabel } from "./live.ts";
import { REVIEW_READ_ONLY, reviewSnapshot } from "./mail.ts";
import { ErpPage, ThreeSchedules } from "./pages/Acme.tsx";
import { ArenaPage } from "./pages/Arena.tsx";
import { AskPage } from "./pages/Ask.tsx";
import { InvoicesPage, PurchasingPage, SpreadsheetsPage } from "./pages/Buying.tsx";
import { GroupPage, ReconciliationPage, SealedPage, SuppliersPage } from "./pages/Hq.tsx";
import { Integration } from "./pages/Integration.tsx";
import { LotsPage } from "./pages/Lots.tsx";
import { MapPage, type MapPick } from "./pages/MapPage.tsx";
import { Overview } from "./pages/Overview.tsx";
import { BatchRecordsPage, BriefPage, InventoryPage, SchedulePage } from "./pages/Plant.tsx";
import { BooksPane, HqPane, PlantsPane } from "./panes.tsx";
import { plantsSnapshot, STATIC_BOOKS_URL, STATIC_BRIEF_URL } from "./plants.ts";
import { ReviewPane } from "./ReviewPane.tsx";
import {
  audienceOf,
  type DemoRun,
  type RunData,
  run as recorded,
  type Step,
  type Tone,
} from "./run.ts";
import type { Source } from "./series.ts";
import { PageHeader, type PageId, type PlantCode, Shell, useRoute } from "./shell.tsx";
import { PlantView } from "./twin3d/PlantView.tsx";

/** The video page (?video=1): the recorded run on the storyboard's clock (docs/RECORDING.md). */
const VideoApp = lazy(() => import("./VideoApp.tsx"));
const VIDEO =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("video") === "1";

export function App() {
  if (VIDEO) {
    return (
      <Suspense fallback={<div className="loading">Loading…</div>}>
        <VideoApp />
      </Suspense>
    );
  }
  return <Screens />;
}

function Screens() {
  const [live, setLive] = useState<LiveState | null | undefined>(undefined);
  useEffect(() => {
    probeApi().then(setLive);
  }, []);
  if (live === undefined) return <div className="loading">Loading…</div>;
  return live ? <LiveApp initial={live} /> : <ReplayApp />;
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
  crumb,
  title,
  sentence,
  children,
}: {
  label: string;
  crumb: string;
  title: string;
  sentence: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page v2" aria-label={label}>
      <PageHeader crumb={crumb} title={title} sentence={sentence} />
      {children}
    </main>
  );
}

const PLANT_NAMES: Record<PlantCode, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine Tablet Co.",
  C: "Acme Lakeview",
};

/** Each page's header: where it sits, its title and one plain sentence. */
const PAGE_TEXT: Record<
  Exclude<PageId, "integration" | "overview">,
  { group: "plant" | "acme" | "hq" | "proof"; title: string; sentence: string }
> = {
  map: {
    group: "plant",
    title: "Plant map",
    sentence: "The three plants, the suppliers, the escrow and HQ, as the run moves through them.",
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
  export: {
    group: "hq",
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
    sentence: "Pick one of the fifteen recorded attacks, fire it, and see what refused it and why.",
  },
  ask: {
    group: "proof",
    title: "Talk to Kevin",
    sentence: "Ask Kevin why he did something; he answers from the records and cites each one.",
  },
};

/** Where a page sits and its short name, for the global header. */
function headingOf(page: PageId, plant: PlantCode): { crumb: string; title: string } {
  if (page === "integration")
    return { crumb: `${PLANT_NAMES.B} › Your integration`, title: "Your integration" };
  if (page === "overview") return { crumb: `${PLANT_NAMES[plant]} › Overview`, title: "Overview" };
  const text = PAGE_TEXT[page];
  const where =
    text.group === "plant"
      ? PLANT_NAMES[plant]
      : text.group === "acme"
        ? "Across Acme"
        : text.group === "proof"
          ? "Proof"
          : "Acme HQ";
  return { crumb: `${where} › ${text.title}`, title: text.title };
}

/** The pages both sources share; each source hands in its own panes and reads. */
function Pages({
  page,
  plant,
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
  foot,
}: {
  page: PageId;
  plant: PlantCode;
  source: Source;
  curtain: boolean;
  inventory: PlantInventory | null;
  books: Books | null;
  policy: PolicyState | null;
  inbox: InboxState | null;
  links: { brief: string | null; books: string };
  /** The plant map; on the map page it takes the area picking. */
  map: (pick?: MapPick) => React.ReactNode;
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
  foot: React.ReactNode;
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
          map={map()}
          kevin={kevin}
          activity={activity}
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
        return <InventoryPage {...props} inventory={inventory} />;
      case "lots":
        return <LotsPage {...props} />;
      case "schedule":
        return <SchedulePage {...props} />;
      case "purchasing":
        return <PurchasingPage {...props} policy={policy} />;
      case "invoices":
        return <InvoicesPage {...props} books={books} exportUrl={links.books} />;
      case "spreadsheets":
        return <SpreadsheetsPage {...props} wizard={wizard} />;
      case "plants":
        return (
          <>
            {plants}
            <ThreeSchedules source={source} />
          </>
        );
      case "erp":
        return <ErpPage source={source} curtain={curtain} />;
      case "hq":
        return hq;
      case "suppliers":
        return <SuppliersPage source={source} curtain={curtain} />;
      case "group":
        return <GroupPage go={goMap} />;
      case "sealed":
        return <SealedPage source={source} curtain={curtain} />;
      case "export":
        return exportPane;
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
      crumb={headingOf(page, plant).crumb}
      title={text.title}
      sentence={text.sentence}
    >
      {body}
      {foot}
    </Page>
  );
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

const JUMPS = jumpsFor(recorded.steps);
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
      steps: data.steps,
      initial: readPersisted(location.search, storedClock()),
    }),
  );
  useEffect(() => {
    shareClock(clock);
    const stop = persist(clock);
    return () => {
      stop();
      shareClock(null);
    };
  }, [clock]);
  const at = useClock(clock, (s) => stepAt(s.simNow, clock.range));
  const [curtain, setCurtain] = useState(false);
  const route = useRoute();

  const go = useCallback(
    (to: number) => clock.seek(clock.range.steps[Math.max(0, Math.min(last, to))] ?? 0),
    [clock, last],
  );
  const headerClock = (
    <HeaderClock
      clock={clock}
      jumps={JUMPS}
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, route.page]);

  const current = data.steps[at] as Step;
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
      <section className="panel next" aria-label="Demo steps">
        <div className="panel-head">
          <h2>
            Step {at + 1} of {last + 1}
          </h2>
          <span className="right small muted">{current.title}</span>
        </div>
        <div className="transport">
          <button type="button" className="btn" onClick={() => go(at - 1)} disabled={at === 0}>
            ← Back
          </button>
          <button type="button" className="btn" onClick={() => go(at + 1)} disabled={at === last}>
            Next →
          </button>
          <FeedButton />
          <span className="step-count">
            {at + 1} / {last + 1} · {current.title}
          </span>
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
      title={headingOf(route.page, route.plant).title}
      plant={route.plant}
      onPlant={(plant) => route.go({ plant })}
      clock={headerClock}
      kevin={kevinStatus(current, upNext?.name ?? null)}
      onKevin={() => route.go({ page: "overview" })}
      curtain={curtain}
      setCurtain={setCurtain}
      people={people}
      upNext={person}
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
        <Pages
          page={route.page}
          plant={route.plant}
          source={{ live: false, version: 0 }}
          curtain={curtain}
          inventory={plantsSnapshot.inventory}
          books={plantsSnapshot.books}
          policy={null}
          inbox={null}
          links={links}
          queue={null}
          wizard={null}
          goMap={() => openGroupOnMap(route.go)}
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
              <Guide data={data} />
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
      </WithRail>
    </Shell>
  );
}

const GUIDE_KEY = "day-one-guide-closed";

/**
 * What a first-time visitor is looking at and how to step through it. Shown on the static
 * replay (a hosted demo); closed for good with ×. Not part of the run, so not in video mode.
 */
function Guide({ data }: { data: DemoRun }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // Private windows may refuse storage; the guide just comes back next time.
    }
  };
  const s = data.summary;
  return (
    <aside className="guide" aria-label="How to read this demo">
      <button type="button" className="guide-close" onClick={close} aria-label="Close">
        ×
      </button>
      <p>
        <strong>Day One.</strong> Kevin is an AI purchasing assistant at Hollow Pine, a small tablet
        plant that has just been bought. He reads batch records, gets quotes and drafts purchase
        orders; his spending limits, the approvals and the payment on delivery are rules in a
        contract on NEAR testnet.
      </p>
      <p>
        This page replays a run recorded on {data.recordedAt.slice(0, 10)}
        {s ? ` (${s.transactions} transactions, ${s.refusedByDesign} refused by design)` : ""}.
        Press <strong>Play</strong> or the → key. Staff see dollars and POs only; switch on{" "}
        <strong>Behind the curtain</strong> for every transaction with its explorer link,{" "}
        <strong>3D</strong> on the map for the twin, and the pages on the left for the integration
        program, every plant page, the three plants and HQ.
      </p>
    </aside>
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
      steps: recorded.steps,
      frames: null,
      initial: { log: readPersisted(location.search, storedClock()).log ?? [] },
    }),
  );
  useEffect(() => {
    shareClock(clock);
    const stop = persist(clock);
    return () => {
      stop();
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
  const feedContext = useMemo(
    () => ({
      steps: state.steps,
      approvals: state.approvals,
      next: state.next.who ? { who: state.next.who, role: roleLabel(state.next.role) } : null,
    }),
    [state],
  );
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
      title={headingOf(route.page, route.plant).title}
      plant={route.plant}
      onPlant={(plant) => route.go({ plant })}
      clock={<HeaderClockLine clock={clock} />}
      kevin={
        busy
          ? { state: "drafting", label: "working…" }
          : kevinStatus(state.steps[last], state.next.who)
      }
      onKevin={() => route.go({ page: "overview" })}
      curtain={curtain}
      setCurtain={setCurtain}
      people={people}
      upNext={person}
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
                actions: actionsFor(state.next).map((a) => (
                  <ActionButton key={a.label} action={a} disabled={busy !== null} onAct={act} />
                )),
              }
            : null
        }
      >
        <Pages
          page={route.page}
          plant={route.plant}
          source={{ live: true, version: `${state.steps.length}-${acted}` }}
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
                busy={busy}
                error={error}
                onAct={act}
                onUpload={uploadFile}
                onReset={reset}
                queue={
                  atUpload && queue ? (
                    <InboxPane
                      inbox={queue}
                      busy={busy !== null}
                      viewer="Ray Delgado"
                      onConfirm={confirmScan}
                      embedded
                    />
                  ) : null
                }
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
  busy,
  error,
  onAct,
  onUpload,
  onReset,
  queue,
}: {
  state: LiveState;
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
  const actions = queue ? [] : actionsFor(next);
  const waitingOnKevin = actions.length === 0 && !queue && next.phase !== "done";
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

      {next.phase === "reply" && request && !busy ? (
        <div className="phone">
          <div className="from">Text message · Kevin</div>
          <p className="bubble">{request}</p>
          <div className="actions">
            {[...actions].reverse().map((a) => (
              <ActionButton key={a.label} action={a} onAct={onAct} />
            ))}
          </div>
        </div>
      ) : (
        <div className="actions">
          {actions.map((a) => (
            <ActionButton key={a.label} action={a} disabled={busy !== null} onAct={onAct} />
          ))}
          {next.phase === "upload" && (
            <label className={queue ? "file quiet sm" : "file"}>
              <span>or upload a photo…</span>
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
  onAct,
}: {
  action: Action;
  disabled?: boolean;
  onAct: (a: Action) => void;
}) {
  // A refusal (NO, reject) is outlined in the refused colour, never the brand green.
  const refuses = /^(NO\b|Reject\b)/.test(action.label);
  return (
    <button
      type="button"
      className={refuses ? "danger" : action.kind}
      data-action={action.kind}
      disabled={disabled}
      onClick={() => onAct(action)}
    >
      {action.label}
    </button>
  );
}

function summaryLine(state: LiveState) {
  const s = state.summary;
  if (!s) return "The run is complete.";
  return `Done: ${s.transactions} actions recorded, ${s.refusedByDesign} refused on purpose, ${s.failed} failed.`;
}
