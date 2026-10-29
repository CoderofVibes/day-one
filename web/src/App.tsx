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
import { groupBuy } from "./groupBuy.ts";
import { ImportPane } from "./ImportPane.tsx";
import { InboxPane } from "./InboxPane.tsx";
import { type Action, actionsFor, actorOf, quantity } from "./live.ts";
import { plantsSnapshot, STATIC_BOOKS_URL, STATIC_BRIEF_URL } from "./plants.ts";
import {
  type Attestation,
  type Audience,
  audienceOf,
  type Check,
  type DemoRun,
  type RunData,
  run as recorded,
  type Step,
  shortAccount,
  transactionsThrough,
} from "./run.ts";

import { PlantView } from "./twin3d/PlantView.tsx";

const PLAY_MS = 2600;

/** The video page (?video=1): the recorded run on the storyboard's clock (docs/RECORDING.md). */
const VideoApp = lazy(() => import("./VideoApp.tsx"));
const VIDEO =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("video") === "1";

export function App() {
  if (VIDEO) {
    return (
      <Suspense fallback={<div className="app muted">Loading…</div>}>
        <VideoApp />
      </Suspense>
    );
  }
  return <Screens />;
}

/**
 * One UI, two sources. When the API (npm run api) answers, the screens run live: whoever is
 * up next gets their buttons and each click advances the run. Otherwise the recorded run
 * replays with Play, Back and Next, as on a static host.
 */
function Screens() {
  const [live, setLive] = useState<LiveState | null | undefined>(undefined);
  useEffect(() => {
    probeApi().then(setLive);
  }, []);
  if (live === undefined) return <div className="app muted">Loading…</div>;
  return live ? <LiveApp initial={live} /> : <ReplayApp />;
}

// ------------------------------------------------------------------ replay (static)

function ReplayApp() {
  const data = recorded;
  const last = data.steps.length - 1;
  const [at, setAt] = useState(0);
  const [curtain, setCurtain] = useState(false);
  const [map, setMap] = useState(true);
  const [plants, setPlants] = useState(false);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go]);

  const current = data.steps[at] as Step;

  return (
    <Frame
      curtain={curtain}
      setCurtain={setCurtain}
      extra={
        <>
          <MapSwitch on={map} setOn={setMap} />
          <label className="switch">
            <input type="checkbox" checked={plants} onChange={(e) => setPlants(e.target.checked)} />
            <span>Three plants</span>
          </label>
        </>
      }
    >
      <Guide data={data} />
      <nav className="controls" aria-label="Demo steps">
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0}>
          ← Back
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (!playing && at === last) go(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : at === last ? "Replay" : "Play"}
        </button>
        <button type="button" onClick={() => go(at + 1)} disabled={at === last}>
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
        <span className="muted step-count">
          {at + 1} / {last + 1} · {current.title}
        </span>
      </nav>

      <main className="panes">
        {map && <PlantView run={data} at={at} curtain={curtain} onStep={go} />}
        {plants && (
          <PlantsPane
            error={null}
            inventory={plantsSnapshot.inventory}
            mass={plantsSnapshot.massBalance}
            books={plantsSnapshot.books}
            policy={null}
            moves={plantsSnapshot.transfers}
            moveNote={[]}
            busy={false}
            links={{ brief: STATIC_BRIEF_URL, books: STATIC_BOOKS_URL }}
            snapshotAt={plantsSnapshot.at}
          />
        )}
        <StaffFeed data={data} upTo={at} onPick={go} curtain={curtain} />
        {curtain && <Curtain data={data} upTo={at} />}
      </main>
      {at === last && <Closing data={data} curtain={curtain} plants={plants} />}

      <footer className="muted foot">
        Replay of a run recorded on {new Date(data.recordedAt).toISOString().slice(0, 10)}. All
        companies, people and numbers are fictional.
      </footer>
    </Frame>
  );
}

// ------------------------------------------------------------------ live (behind the API)

function LiveApp({ initial }: { initial: LiveState }) {
  const [state, setState] = useState(initial);
  const [curtain, setCurtain] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [plants, setPlants] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [map, setMap] = useState(true);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run (state) moves
  useEffect(() => {
    if (!plants) return;
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
    load(getPolicy, setPolicy);
    load(getMassBalance, setMass);
    load(getBooks, setBooks);
    load(getTransferSuggestions, setMoves);
    return () => {
      stale = true;
    };
  }, [plants, state]);

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
  const waiting = inbox?.items.filter((i) => i.status === "waiting").length ?? 0;

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

  const last = state.steps.length - 1;
  return (
    <Frame
      curtain={curtain}
      setCurtain={setCurtain}
      extra={
        <>
          <MapSwitch on={map} setOn={setMap} />
          <label className="switch">
            <input type="checkbox" checked={plants} onChange={(e) => setPlants(e.target.checked)} />
            <span>Three plants</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} />
            <span>Spreadsheet</span>
          </label>
        </>
      }
    >
      <ActionBar
        state={state}
        busy={busy}
        error={error}
        onAct={act}
        onUpload={uploadFile}
        waiting={waiting}
        onReset={() => {
          setMoveNote([]);
          setRuns((n) => n + 1);
          send("Start over", () => postJson("api/run/reset"));
        }}
      />

      <main className="panes">
        {inbox?.folder && (inbox.items.length > 0 || state.next.phase === "upload") && (
          <InboxPane
            inbox={inbox}
            busy={busy !== null}
            viewer="Ray Delgado"
            onConfirm={confirmScan}
          />
        )}
        {map && <PlantView run={state} at={last} curtain={curtain} />}
        {sheet && <ImportPane key={runs} />}
        {plants && (
          <PlantsPane
            error={plantsError}
            inventory={inventory}
            mass={mass}
            books={books}
            policy={policy}
            moves={moves}
            moveNote={moveNote}
            busy={busy !== null}
            links={{ brief: BRIEF_URL, books: BOOKS_EXPORT_URL }}
            act={{
              onReview: review,
              onProposeWaste: proposeWaste,
              onDecideMove: decideMove,
              onReceiveMove: receiveMove,
            }}
          />
        )}
        <StaffFeed data={state} upTo={last} curtain={curtain} />
        {curtain && <Curtain data={state} upTo={last} />}
      </main>

      <footer className="muted foot">
        {state.mode === "live"
          ? "Live: each step is real and takes a moment."
          : "Step by step through the recorded run."}{" "}
        All companies, people and numbers are fictional.
      </footer>
    </Frame>
  );
}

function ActionBar({
  state,
  busy,
  error,
  onAct,
  onUpload,
  waiting,
  onReset,
}: {
  state: LiveState;
  busy: string | null;
  error: { message: string; hint?: string } | null;
  onAct: (a: Action) => void;
  onUpload: (file: File) => void;
  /** Scans Kevin already read from the folder: at Ray's turn they come before an upload. */
  waiting: number;
  onReset: () => void;
}) {
  const { next } = state;
  const actor = actorOf(next);
  const fromInbox = next.phase === "upload" && waiting > 0;
  const actions = fromInbox ? [] : actionsFor(next);
  const waitingOnKevin = actions.length === 0 && next.phase !== "done";
  const request = state.approvals.find((a) => a.response === null)?.request;

  return (
    <section className="controls action-bar" aria-label="Next action">
      <div className="bar-who">
        <Who who={{ name: actor.name, role: actor.role, channel: "screen" }} />
        <p className="bar-text">
          {busy
            ? `${busy}… Kevin is working.`
            : state.stopped
              ? `The run stopped: ${state.stopped}`
              : fromInbox
                ? `Kevin already read ${waiting === 1 ? "one batch record" : `${waiting} batch records`} from the scan folder. Open one under “Waiting for you”.`
                : waitingOnKevin
                  ? next.action
                  : next.phase === "done"
                    ? summaryLine(state)
                    : next.action}
        </p>
      </div>
      {state.stopped && state.help && !busy && <p className="muted small bar-help">{state.help}</p>}

      {next.phase === "reply" && request && !busy ? (
        <div className="phone">
          <div className="phone-head muted">Text message · Kevin</div>
          <p className="bubble in">{request}</p>
          <div className="actions phone-actions">
            {actions.map((a) => (
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
            <label className="file">
              <span>or choose a photo…</span>
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
          {next.phase !== "done" && next.phase !== "upload" && (
            <button type="button" className="quiet" disabled={busy !== null} onClick={onReset}>
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
  return (
    <button
      type="button"
      className={action.kind}
      data-action={action.kind}
      disabled={disabled}
      onClick={() => onAct(action)}
    >
      {action.label}
    </button>
  );
}

/** What a person can do in the three-plant view; absent in the static replay, which only shows. */
interface PlantActions {
  onReview: (id: number, decision: "apply" | "dismiss") => void;
  onProposeWaste: () => void;
  onDecideMove: (key: string, decision: "approve" | "dismiss") => void;
  onReceiveMove: (transferNo: string) => void;
}

/** Three facilities, one truth: stock by plant, and the transfer discrepancies with their review. */
function PlantsPane({
  error,
  inventory,
  mass,
  books,
  policy,
  moves,
  moveNote,
  busy,
  links,
  act,
  snapshotAt,
}: {
  error: string | null;
  inventory: PlantInventory | null;
  mass: MassBalance | null;
  books: Books | null;
  policy: PolicyState | null;
  moves: TransferSuggestions | null;
  moveNote: string[];
  busy: boolean;
  links: { brief: string; books: string };
  /** Without actions the pane is read-only (the static replay's snapshot). */
  act?: PlantActions;
  /** The run's clock when a read-only snapshot was taken. */
  snapshotAt?: string;
}) {
  if (!inventory) {
    return (
      <section className="pane plants" aria-label="Three plants">
        <h2>Three plants</h2>
        <p className={error ? "disc" : "muted"}>
          {error ? `The plant figures could not be read: ${error}` : "Loading…"}
        </p>
      </section>
    );
  }
  const plants = inventory.facilities;
  return (
    <section className="pane plants" aria-label="Three plants">
      <h2>Three plants · stock on hand</h2>
      {!act && (
        <p className="muted small">
          As the ledger stands at the end of the recorded run
          {snapshotAt ? ` (${demoTime(snapshotAt)})` : ""}. Read-only here: with the API running
          (npm run api) each proposal has its Apply, Dismiss or Approve button.
        </p>
      )}
      <p className="small">
        <a href={links.brief} target="_blank" rel="noreferrer">
          Kevin's morning brief for Hollow Pine (printable)
        </a>
      </p>
      {policy ? (
        <PolicyBlock state={policy} />
      ) : !act ? (
        <div className="policy">
          <h3>HQ · Kevin's limits on the contract</h3>
          <p className="muted">
            The contract refused PO-1042 over Kevin's per-PO limit in this run until Linda approved
            it (the "Big PO" step, behind the curtain). npm run escrow reads the limits and this
            month's spend from testnet as they are now.
          </p>
        </div>
      ) : (
        <div className="policy">
          <h3>HQ · Kevin's limits on the contract</h3>
          <p className="muted">Reading the contract…</p>
        </div>
      )}
      {inventory.discrepancies.length > 0 && (
        <ul className="discrepancies">
          {inventory.discrepancies.map((d) => (
            <li key={d.id} className={`disc ${d.status}`}>
              <p>{d.explanation}</p>
              {d.status === "proposed_adjustment" && d.proposed && act ? (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => act.onReview(d.id, "apply")}
                  >
                    Apply at Plant {d.proposed.facility}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => act.onReview(d.id, "dismiss")}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <span className="tag">{d.status.replace(/_/g, " ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {moves && (
        <TransfersBlock
          moves={moves}
          note={moveNote}
          busy={busy}
          {...(act ? { onDecide: act.onDecideMove, onReceive: act.onReceiveMove } : {})}
        />
      )}
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Material</th>
              {plants.map((p) => (
                <th key={p.code}>
                  Plant {p.code} <span className="muted">{p.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventory.materials.map((m) => (
              <tr key={m.code}>
                <th scope="row">
                  {m.name} <span className="muted">{m.code}</span>
                </th>
                {plants.map((p) => {
                  const s = m.byPlant[p.code];
                  return (
                    <td key={p.code} className={s?.low ? "low" : undefined}>
                      {s ? quantity(s.onHandBase, m.dimension) : "—"}
                      {s?.low && m.reorderPointBase !== null && (
                        <span className="muted small">
                          {" "}
                          · below {quantity(m.reorderPointBase, m.dimension)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mass && (
        <MassBalanceBlock
          mass={mass}
          plants={plants}
          busy={busy}
          {...(act ? { onPropose: act.onProposeWaste } : {})}
        />
      )}
      {books && <BooksBlock books={books} exportUrl={links.books} />}
      <GroupBuyBlock plants={plants} />
    </section>
  );
}

/**
 * Before you buy (FEATURES_V2 §3): one card per move Kevin proposes between plants, with
 * Approve and Dismiss, then the approved moves on the road with Receive for the other plant.
 */
function TransfersBlock({
  moves,
  note,
  busy,
  onDecide,
  onReceive,
}: {
  moves: TransferSuggestions;
  note: string[];
  busy: boolean;
  onDecide?: (key: string, decision: "approve" | "dismiss") => void;
  onReceive?: (transferNo: string) => void;
}) {
  const { suggestions, inTransit } = moves;
  if (!suggestions.length && !inTransit.length && !note.length) return null;
  return (
    <div className="transfers">
      <h3>Before you buy · stock another plant can spare</h3>
      {note.map((line) => (
        <p key={line} className="kevin-line">
          {line}
        </p>
      ))}
      <ul className="discrepancies">
        {suggestions.map((s) => (
          <li key={s.key} className="disc move">
            <p>{s.sentence}</p>
            {onDecide && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onDecide(s.key, "approve")}
                >
                  Approve the move
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => onDecide(s.key, "dismiss")}
                >
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
        {inTransit.map((t) => (
          <li key={t.transferNo} className="disc move">
            <p>
              {t.transferNo}: {quantity(t.qtyBase, t.dimension)} of {t.materialName} (lot{" "}
              {t.lotCode}) on the way from Plant {t.from} to Plant {t.to}.
            </p>
            {onReceive && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onReceive(t.transferNo)}
                >
                  Received at Plant {t.to}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One pooled purchase order across the plants (docs/GROUP_BUY.md), from the recorded group run. */
function GroupBuyBlock({ plants }: { plants: PlantInventory["facilities"] }) {
  const { pool, po, spent } = groupBuy;
  const declined = pool.declined;
  if (!po) return null;
  const usd = (units: number) =>
    `$${(units / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const kg = (base: number) => `${(base / 1_000_000).toLocaleString("en-US")} kg`;
  const name = (code: string) => plants.find((p) => p.code === code)?.name ?? `Plant ${code}`;
  const codes = [...new Set([...pool.shares.map((s) => s.plant), ...declined])].sort();
  return (
    <div className="mass group-buy">
      <h3>Group purchasing · {pool.poolId}</h3>
      <p className="kevin-line">
        {kg(pool.qtyBase)} of ascorbic acid pooled by {pool.shares.length} plants into one order:{" "}
        {po.poNo} to {po.vendor}, {usd(po.totalUsdc)} at {usd(po.unitPriceUsdc)}/kg,{" "}
        {usd(po.savingsUsdc)} less than buying alone. Each plant's share was checked against its own
        limits before the order was funded.
      </p>
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Plant</th>
              <th>Pooled</th>
              <th>Share</th>
              <th>Approved by</th>
              <th>On the books this month</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => {
              const share = pool.shares.find((s) => s.plant === code);
              return (
                <tr key={code}>
                  <th scope="row">
                    Plant {code} <span className="muted">{name(code)}</span>
                  </th>
                  <td>
                    {share ? (
                      kg(share.qtyBase)
                    ) : (
                      <span className="muted">no need · not in the pool</span>
                    )}
                  </td>
                  <td>{share ? usd(share.amount) : "—"}</td>
                  <td>{share?.approvedBy ?? (share ? "within limits" : "—")}</td>
                  <td>{usd(spent[code] ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {po.status === "paid"
          ? "Delivered to Plant B and paid on QC release"
          : `Status: ${po.status}`}
        ; from the recorded group purchase, not this run.
      </p>
    </div>
  );
}

/** Settled purchase orders for the books, the price-drift alerts, and the CSV export. */
function BooksBlock({ books, exportUrl }: { books: Books; exportUrl: string }) {
  const usd = (units: number) =>
    `$${(units / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const flagged = new Set(books.alerts.map((a) => a.poNo));
  return (
    <div className="mass books">
      <h3>Books · settled purchase orders</h3>
      {books.sentences.map((s) => (
        <p key={s} className="kevin-line">
          {s}
        </p>
      ))}
      <p>
        <a className="export" href={exportUrl} download>
          Export for QuickBooks (CSV)
        </a>{" "}
        <span className="muted small">
          one row per line, plain dates and numbers, totals to the cent
        </span>
      </p>
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>PO</th>
              <th>Vendor</th>
              <th>Released</th>
              <th>Total</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {books.settled.map((po) => (
              <tr key={po.poNo}>
                <th scope="row">{po.poNo}</th>
                <td>{po.vendor}</td>
                <td>{po.releasedOn ?? "—"}</td>
                <td className={flagged.has(po.poNo) ? "low" : undefined}>
                  {usd(po.totalUsdc)}
                  {flagged.has(po.poNo) && <span className="small"> price drift</span>}
                </td>
                <td>{po.paymentRef ? "on QC release" : "by check"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CATEGORY_WORDS: Record<string, string> = {
  raw_material: "raw materials",
  packaging: "packaging",
  lab_chemical: "lab chemicals",
};
const SUPPLIER_WORDS: Record<string, string> = {
  Qualified: "qualified",
  Conditional: "needs approval every time",
};

/**
 * HQ's view: the limits the contract enforces on Kevin right now, read from the chain each time
 * the run moves (api/policy). People and companies by name; the accounts stay behind the curtain.
 */
function PolicyBlock({ state }: { state: PolicyState }) {
  const usd = (units: string) =>
    `$${(Number(units) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const who = (account: string, names: Record<string, string>) =>
    names[account] ?? account.split(".")[0] ?? account;
  const list = (words: string[]) =>
    words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return (
    <div className="policy">
      <h3>HQ · Kevin's limits on the contract</h3>
      {!state.reachable ? (
        <p className="muted">The contract could not be read right now: {state.error}</p>
      ) : !state.policy.agent ? (
        <p className="muted">No spend policy is set for Kevin.</p>
      ) : (
        <>
          <p className="kevin-line policy-line">
            {state.policy.agent.name} may spend up to {usd(state.policy.agent.perPoLimit)} per PO
            and {usd(state.policy.agent.monthlyLimit)} a month on{" "}
            {list(state.policy.agent.categories.map((c) => CATEGORY_WORDS[c] ?? c))}. Over that,{" "}
            {who(state.policy.agent.approver, state.names)} approves.{" "}
            {state.policy.agent.active ? "" : "Kevin is paused. "}
            Spent this month: {usd(state.policy.agent.spentThisMonth)}. Plant budget:{" "}
            {usd(state.policy.budget)} unallocated, {usd(state.policy.escrowed)} held for open POs.
          </p>
          <div className="table-wrap">
            <table className="stock">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Monthly cap</th>
                  <th>Spent this month</th>
                </tr>
              </thead>
              <tbody>
                {state.policy.categories.map((c) => (
                  <tr key={c.category}>
                    <th scope="row">{CATEGORY_WORDS[c.category] ?? c.category}</th>
                    <td>{c.cap ? usd(c.cap) : "Kevin's monthly limit"}</td>
                    <td>{usd(c.spentThisMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small">
            Suppliers Kevin may pay:{" "}
            {state.policy.suppliers
              .map(
                (s) =>
                  `${who(s.account, state.names)} (${s.status ? (SUPPLIER_WORDS[s.status] ?? s.status) : "not listed, refused"})`,
              )
              .join(" · ")}
          </p>
        </>
      )}
      <p className="small muted">
        {state.history.length === 0
          ? "No policy change has been made during this run; the limits above were set when the contract was configured."
          : `Policy changes this run: ${state.history.map((h) => `${h.method} (${h.events.join(", ")})`).join("; ")}.`}
      </p>
    </div>
  );
}

/** Issued against tablets, QC samples and recorded waste, per plant and product (§15). */
export function MassBalanceBlock({
  mass,
  plants,
  busy,
  onPropose,
}: {
  mass: MassBalance;
  plants: PlantInventory["facilities"];
  busy: boolean;
  onPropose?: () => void;
}) {
  const name = (code: string) => plants.find((p) => p.code === code)?.name ?? `Plant ${code}`;
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const toPlants = [
    ...new Set(
      mass.batches.filter((b) => mass.unproposed.includes(b.batchNo)).map((b) => b.facility),
    ),
  ];
  return (
    <div className="mass">
      <h3>Mass balance · issued against tablets, QC samples and recorded waste</h3>
      {mass.sentences.length === 0 ? (
        <p className="muted">Every batch balances within 0.5%.</p>
      ) : (
        mass.sentences.map((s) => (
          <p key={s} className="kevin-line">
            {s}
          </p>
        ))
      )}
      {toPlants.length > 0 && onPropose && (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={onPropose}>
            Send Plant {toPlants.join(" and ")} a waste correction to review
          </button>
          <span className="muted small">
            {mass.unproposed.length} {mass.unproposed.length === 1 ? "batch" : "batches"}; the batch
            records stay as written.
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="stock">
          <thead>
            <tr>
              <th>Plant · product</th>
              <th>Batches</th>
              <th>Issued</th>
              <th>Unaccounted</th>
            </tr>
          </thead>
          <tbody>
            {mass.periods.map((p) => (
              <tr key={`${p.facility}-${p.product}`}>
                <th scope="row">
                  {name(p.facility)} <span className="muted">{p.product}</span>
                </th>
                <td>{p.batches}</td>
                <td>{quantity(p.issuedBase, "mass")}</td>
                <td className={p.flagged ? "low" : undefined}>
                  {quantity(p.unaccountedBase, "mass")}{" "}
                  <span className="small">({pct(p.unaccountedBp)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The demo clock as plant staff read it: "Mon Nov 16, 4:05 PM" (UTC, the clock's own zone). */
function demoTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
      <button type="button" className="guide-close quiet" onClick={close} aria-label="Close">
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
        <strong>3D</strong> on the map for the twin, and <strong>Three plants</strong> for stock,
        the mass balance and the books.
      </p>
    </aside>
  );
}

/** The last step: what just happened, in one line, and where to look next. */
function Closing({ data, curtain, plants }: { data: RunData; curtain: boolean; plants: boolean }) {
  const s = data.summary;
  return (
    <p className="closing">
      That is the whole loop: a batch record read, stock reordered, a refusal over the limit, an
      approval by text, and the supplier paid the moment QC released the lot.
      {s && !curtain
        ? ` Switch on "Behind the curtain" for the ${s.transactions} testnet transactions behind it.`
        : ""}
      {!plants ? ' "Three plants" shows what it did to stock and the books.' : ""}
    </p>
  );
}

function summaryLine(state: LiveState) {
  const s = state.summary;
  if (!s) return "The run is complete.";
  return `Done: ${s.transactions} actions recorded, ${s.refusedByDesign} refused on purpose, ${s.failed} failed.`;
}

// ------------------------------------------------------------------ shared pieces

function MapSwitch({ on, setOn }: { on: boolean; setOn: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>Plant map</span>
    </label>
  );
}

function Frame({
  curtain,
  setCurtain,
  extra,
  children,
}: {
  curtain: boolean;
  setCurtain: (on: boolean) => void;
  /** More switches beside "Behind the curtain". */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={curtain ? "app with-curtain" : "app"}>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            K
          </span>
          <div>
            <h1>Kevin</h1>
            <p className="muted">Purchasing assistant · Hollow Pine Tablet Co. (Plant B)</p>
          </div>
        </div>
        <div className="switches">
          {extra}
          <label className="switch">
            <input
              type="checkbox"
              checked={curtain}
              onChange={(e) => setCurtain(e.target.checked)}
            />
            <span>Behind the curtain</span>
          </label>
        </div>
      </header>
      {children}
    </div>
  );
}

function StaffFeed({
  data,
  upTo,
  onPick,
  curtain,
}: {
  data: RunData;
  upTo: number;
  onPick?: (i: number) => void;
  curtain: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const seen = useRef(upTo);
  // Scroll whenever the step changes.
  useEffect(() => {
    // Not on first paint: a visitor starts at the top of the page, with the header in view.
    if (seen.current === upTo) return;
    seen.current = upTo;
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [upTo]);

  const shown = data.steps.slice(0, upTo + 1);
  const current = shown.at(-1);
  return (
    <section className="pane feed" aria-label="What plant staff see">
      <h2>Plant floor</h2>
      {shown.map((step, i) => {
        const who = audienceOf(step);
        if (who.channel === "none") return null;
        const body = (
          <>
            <Who who={who} title={step.title} />
            {who.channel === "phone" ? (
              <Phone step={step} approvals={data.approvals} />
            ) : (
              <Lines lines={step.staff} />
            )}
          </>
        );
        const key = `${i}-${step.title}`;
        const className = i === upTo ? "card current" : "card";
        return onPick ? (
          <button type="button" key={key} className={className} onClick={() => onPick(i)}>
            {body}
          </button>
        ) : (
          <div key={key} className={`${className} still`}>
            {body}
          </div>
        );
      })}
      {current && audienceOf(current).channel === "none" && (
        <p className="muted aside">
          Nothing changes on the plant floor at this step.
          {!curtain && " Turn on “Behind the curtain” to see it."}
        </p>
      )}
      <div ref={end} />
    </section>
  );
}

export function Who({ who, title }: { who: Audience; title?: string }) {
  return (
    <div className="who">
      <span className="avatar" aria-hidden="true">
        {who.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)}
      </span>
      <span>
        <strong>{who.name}</strong>
        {who.role && <span className="muted"> · {who.role}</span>}
      </span>
      {title && <span className="tag">{title}</span>}
    </div>
  );
}

export function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="lines">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export function Phone({ step, approvals }: { step: Step; approvals: RunData["approvals"] }) {
  const approval = approvals.find((a) => a.response !== null) ?? approvals[0];
  return (
    <div className="phone">
      <div className="phone-head muted">Text message · Kevin</div>
      {approval && <p className="bubble in">{approval.request}</p>}
      {approval?.response && <p className="bubble out">{approval.response}</p>}
      <Lines lines={step.staff.map((l) => l.replace(/^.*→\s*/, ""))} />
    </div>
  );
}

const MARK: Record<Check["status"], string> = { verified: "✓", unverified: "✗", skipped: "–" };

/**
 * The hardware enclave Kevin's model ran in and the signature of each recorded answer, from
 * server/src/attestation (research 10). Dollars never appear here; staff never see it.
 */
function Attested({ result }: { result: Attestation }) {
  const unverified = [...result.enclave, ...result.answers.flatMap((a) => a.checks)].filter(
    (c) => c.status === "unverified",
  ).length;
  return (
    <section className="attest" aria-label="Attested model">
      <h3>Kevin's model runs in a hardware enclave</h3>
      <p className="note">
        {result.model} · NEAR AI Cloud {result.tier} · report{" "}
        {result.fetchedAt.slice(0, 16).replace("T", " ")}Z · nonce {result.nonce.slice(0, 8)}…
      </p>
      <ul className="checks">
        {result.enclave.map((c) => (
          <li key={c.name} className={`check ${c.status}`} title={c.detail}>
            {MARK[c.status]} {c.name}
          </li>
        ))}
      </ul>
      <ol className="answers">
        {result.answers.map((a) => (
          <li
            key={a.chatId}
            className={
              a.checks.some((c) => c.status === "unverified") ? "answer unverified" : "answer"
            }
          >
            <span className="task">{a.task}</span> chat {a.chatId.slice(0, 8)}… · request{" "}
            {a.requestSha256.slice(0, 8)}… · response {a.responseSha256.slice(0, 8)}… ·{" "}
            {a.checks.map((c) => `${MARK[c.status]} ${c.name}`).join(" · ")}
          </li>
        ))}
      </ol>
      <p className="muted">
        {unverified === 0 ? "Every check verified" : `${unverified} checks unverified`}; npm run
        verify:attestation re-checks it with no key. Every instance of a model shares one signing
        key, so the signer proves an attested instance of this model answered, not which one.
      </p>
    </section>
  );
}

export function Curtain({ data, upTo }: { data: RunData; upTo: number }) {
  const pane = useRef<HTMLElement>(null);
  const txs = transactionsThrough(data, upTo);
  // Lines without a transaction: the opening budget (step 0) and the closing summary.
  const notes = (from: number, to: number) =>
    data.steps
      .slice(from, to)
      .flatMap((s) => s.chain.filter((c) => !c.tx).map((c) => c.line.replace(/^chain:\s*/, "")))
      .map((n) => (
        <p key={n} className="note">
          {n}
        </p>
      ));

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest transaction
  useEffect(() => {
    pane.current?.querySelector(".fresh")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [upTo]);

  return (
    <section ref={pane} className="pane curtain" aria-label="Behind the curtain">
      <h2>Behind the curtain · NEAR {data.network}</h2>
      {notes(0, 1)}
      {data.attestation && <Attested result={data.attestation} />}
      <ol className="txs">
        {txs.map(({ stepIndex, tx }) => (
          <li
            key={tx.tx}
            className={`tx ${tx.status}${stepIndex === upTo ? " fresh" : ""}`}
            aria-current={stepIndex === upTo ? "step" : undefined}
          >
            <div className="tx-head">
              <code>{tx.method}</code>
              <span className={`status ${tx.status}`}>
                {tx.status === "refused" ? "✗ refused" : "✓"}
              </span>
            </div>
            <dl>
              <dt>signed by</dt>
              <dd>{shortAccount(tx.signer)}</dd>
              {tx.paidBy !== tx.signer && (
                <>
                  <dt>gas paid by</dt>
                  <dd>{tx.paidBy}</dd>
                </>
              )}
              {tx.events.length > 0 && (
                <>
                  <dt>events</dt>
                  <dd>{tx.events.join(", ")}</dd>
                </>
              )}
            </dl>
            {tx.error && <p className="refusal">“{tx.error}”</p>}
            {tx.url && (
              <a href={tx.url} target="_blank" rel="noreferrer">
                {tx.tx.slice(0, 10)}… on the explorer ↗
              </a>
            )}
          </li>
        ))}
      </ol>
      {txs.length === 0 && <p className="muted">No transactions yet.</p>}
      {notes(1, upTo + 1)}
    </section>
  );
}
