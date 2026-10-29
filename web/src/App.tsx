// One shell, four screens, one switch (docs/UI_DESIGN.md §3). Floor: whoever is up next, the run
// so far and the plant map. Plants, Books and HQ: the three-plant view, Marcy's books with the
// import wizard, and HQ's read of the contract. "Behind the curtain" opens the auditor's rail
// beside the run. Staff screens show dollars, POs, approvals and people; the chain stays behind
// the curtain (src/run.test.ts).
//
// One UI, two sources: when the API (npm run api) answers, the screens run live and each button
// advances the run; otherwise the recorded run replays with Play, Back and Next, as on a static
// host (docs/HOSTING.md).

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  postTransferDecision,
  postTransferReceipt,
  postWasteProposals,
  probeApi,
  type TransferSuggestions,
} from "./api.ts";
import { Curtain } from "./Curtain.tsx";
import { initials, Pill, StaffFeed } from "./feed.tsx";
import { InboxPane } from "./InboxPane.tsx";
import { type Action, actionsFor, actorOf } from "./live.ts";
import { BooksPane, HqPane, PlantsPane } from "./panes.tsx";
import { plantsSnapshot, STATIC_BOOKS_URL, STATIC_BRIEF_URL } from "./plants.ts";
import { type DemoRun, type RunData, run as recorded, type Step, type Tone } from "./run.ts";
import { PlantView } from "./twin3d/PlantView.tsx";

const PLAY_MS = 2600;

/** The video page (?video=1): the recorded run on the storyboard's clock (docs/RECORDING.md). */
const VideoApp = lazy(() => import("./VideoApp.tsx"));
const VIDEO =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("video") === "1";

type Screen = "floor" | "plants" | "books" | "hq";
const SCREENS: { id: Screen; label: string }[] = [
  { id: "floor", label: "Floor" },
  { id: "plants", label: "Plants" },
  { id: "books", label: "Books" },
  { id: "hq", label: "HQ" },
];

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

// ------------------------------------------------------------------ the shell

function Shell({
  screen,
  setScreen,
  curtain,
  setCurtain,
  badge,
  children,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  curtain: boolean;
  setCurtain: (on: boolean) => void;
  /** Scans waiting for Ray: shown on the Floor tab. */
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="bar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            K
          </span>
          <div>
            <h1>Day One</h1>
            <p>Kevin, AI purchasing assistant · Hollow Pine Tablet Co. (Plant B)</p>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Screens">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={screen === s.id}
              onClick={() => setScreen(s.id)}
            >
              {s.label}
              {s.id === "floor" && badge ? (
                <span className="badge">
                  {badge}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <label className="switch">
          <input type="checkbox" checked={curtain} onChange={(e) => setCurtain(e.target.checked)} />
          <span>Behind the curtain</span>
        </label>
      </header>
      {children}
    </>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <footer className="foot">{children} All companies, people and numbers are fictional.</footer>
  );
}

// ------------------------------------------------------------------ replay (static)

function ReplayApp() {
  const data = recorded;
  const last = data.steps.length - 1;
  const [at, setAt] = useState(0);
  const [curtain, setCurtain] = useState(false);
  const [screen, setScreen] = useState<Screen>("floor");
  const [playing, setPlaying] = useState(false);

  const go = useCallback((to: number) => setAt(Math.max(0, Math.min(last, to))), [last]);

  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => go(at + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, at, last, go]);

  useEffect(() => {
    if (screen !== "floor") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, screen]);

  const current = data.steps[at] as Step;
  const links = { brief: STATIC_BRIEF_URL, books: STATIC_BOOKS_URL };
  const foot = (
    <Foot>Replay of a run recorded on {new Date(data.recordedAt).toISOString().slice(0, 10)}.</Foot>
  );

  return (
    <Shell screen={screen} setScreen={setScreen} curtain={curtain} setCurtain={setCurtain}>
      {screen === "floor" ? (
        <main className={curtain ? "page floor with-curtain" : "page floor"}>
          <Guide data={data} />
          <div className="col">
            {at === last ? (
              <Closing
                data={data}
                curtain={curtain}
                onReplay={() => go(0)}
                onPlants={() => setScreen("plants")}
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
                  <button
                    type="button"
                    className="btn"
                    onClick={() => go(at - 1)}
                    disabled={at === 0}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      if (!playing && at === last) go(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => go(at + 1)}
                    disabled={at === last}
                  >
                    Next →
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={last}
                    value={at}
                    onChange={(e) => go(Number(e.target.value))}
                    aria-label="Step"
                  />
                  <span className="step-count">
                    {at + 1} / {last + 1} · {current.title}
                  </span>
                </div>
              </section>
            )}
            <StaffFeed data={data} upTo={at} onPick={go} curtain={curtain} />
          </div>
          <div className="col">
            <div className="sticky">
              <PlantView run={data} at={at} curtain={curtain} onStep={go} />
            </div>
          </div>
          {curtain && (
            <aside className="col">
              <div className="sticky rail">
                <Curtain data={data} upTo={at} />
              </div>
            </aside>
          )}
          {foot}
        </main>
      ) : (
        <main className="page">
          {screen === "plants" && (
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
          )}
          {screen === "books" && (
            <BooksPane
              books={plantsSnapshot.books}
              error={null}
              links={links}
              run={data}
              curtain={curtain}
            />
          )}
          {screen === "hq" && <HqPane policy={null} live={false} />}
          {curtain && <Curtain data={data} upTo={at} />}
          {foot}
        </main>
      )}
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
        <strong>3D</strong> on the map for the twin, and <strong>Plants</strong>,{" "}
        <strong>Books</strong> and <strong>HQ</strong> for stock, the mass balance, the books and
        Kevin's limits.
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
  const [screen, setScreen] = useState<Screen>("floor");
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

  // The Plants, Books and HQ screens read the ledger and the contract when opened and whenever
  // the run moves; the figures stay on screen between reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run (state) moves
  useEffect(() => {
    if (screen === "floor") return;
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
    if (screen === "plants") {
      load(getInventory, setInventory);
      load(getPolicy, setPolicy);
      load(getMassBalance, setMass);
      load(getTransferSuggestions, setMoves);
    } else if (screen === "books") {
      load(getBooks, setBooks);
    } else {
      load(getPolicy, setPolicy);
    }
    return () => {
      stale = true;
    };
  }, [screen, state]);

  // When the run moves to the next person, the page comes back to "Up next" so they see their
  // turn, however far down the history the last reader had scrolled.
  const turn = state.next.phase + state.next.who + state.steps.length;
  const seenTurn = useRef(turn);
  useEffect(() => {
    if (seenTurn.current === turn) return;
    seenTurn.current = turn;
    if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [turn]);

  const send = useCallback(async (label: string, call: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await call();
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
    }
  }, []);

  const act = (a: Action) => send(a.label, () => postJson(a.path, a.body));
  const uploadFile = (file: File) =>
    send(`Upload ${file.name}`, () => postImage("api/batch-records", file, file.name));
  const confirmScan = (batchNo: string, resolutions: Record<string, string>) =>
    send(`Confirm ${batchNo}`, () => postInboxConfirm(batchNo, resolutions));
  const waiting =
    inbox?.items.filter(
      (i) => i.status === "waiting" && (i.waitingFor === null || i.waitingFor === "Ray Delgado"),
    ).length ?? 0;

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
    send("Start over", () => postJson("api/run/reset"));
  };

  const last = state.steps.length - 1;
  const queue = inbox?.folder && inbox.items.length > 0 ? inbox : null;
  const atUpload = state.next.phase === "upload";
  const foot = (
    <Foot>
      {state.mode === "live"
        ? "Live: each step is real and takes a moment."
        : "Step by step through the recorded run."}
    </Foot>
  );

  return (
    <Shell
      screen={screen}
      setScreen={setScreen}
      curtain={curtain}
      setCurtain={setCurtain}
      badge={waiting}
    >
      {screen === "floor" ? (
        <main className={curtain ? "page floor with-curtain" : "page floor"}>
          <div className="col">
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
            <StaffFeed data={state} upTo={last} curtain={curtain} />
          </div>
          <div className="col">
            <div className="sticky">
              <PlantView run={state} at={last} curtain={curtain} />
            </div>
          </div>
          {curtain && (
            <aside className="col">
              <div className="sticky rail">
                <Curtain data={state} upTo={last} />
              </div>
            </aside>
          )}
          {foot}
        </main>
      ) : (
        <main className="page">
          {screen === "plants" && (
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
          )}
          {screen === "books" && (
            <BooksPane
              books={books}
              error={plantsError}
              links={{ brief: BRIEF_URL, books: BOOKS_EXPORT_URL }}
              wizardKey={runs}
              run={state}
              curtain={curtain}
            />
          )}
          {screen === "hq" && <HqPane policy={policy} live />}
          {curtain && <Curtain data={state} upTo={last} />}
          {foot}
        </main>
      )}
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
