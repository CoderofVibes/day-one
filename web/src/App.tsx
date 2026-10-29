import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  BOOKS_EXPORT_URL,
  type Books,
  getBooks,
  getInventory,
  getMassBalance,
  getState,
  type LiveState,
  type MassBalance,
  type PlantInventory,
  postImage,
  postJson,
  postReview,
  probeApi,
} from "./api.ts";
import { type Action, actionsFor, actorOf, quantity } from "./live.ts";
import {
  type Audience,
  audienceOf,
  type RunData,
  run as recorded,
  type Step,
  shortAccount,
  transactionsThrough,
} from "./run.ts";

const PLAY_MS = 2600;

/**
 * One UI, two sources. When the API (npm run api) answers, the screens run live: whoever is
 * up next gets their buttons and each click advances the run. Otherwise the recorded run
 * replays with Play, Back and Next, as on a static host.
 */
export function App() {
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
    <Frame curtain={curtain} setCurtain={setCurtain}>
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
        <StaffFeed data={data} upTo={at} onPick={go} curtain={curtain} />
        {curtain && <Curtain data={data} upTo={at} />}
      </main>

      <footer className="muted foot">
        Replay of a run recorded on NEAR {data.network} on{" "}
        {new Date(data.recordedAt).toISOString().slice(0, 10)}. All companies, people and numbers
        are fictional.
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
  const [inventory, setInventory] = useState<PlantInventory | null>(null);
  const [mass, setMass] = useState<MassBalance | null>(null);
  const [books, setBooks] = useState<Books | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh whenever the run (state) moves
  useEffect(() => {
    if (!plants) return;
    let stale = false;
    getInventory().then((inv) => {
      if (!stale) setInventory(inv);
    });
    getMassBalance().then((m) => {
      if (!stale) setMass(m);
    });
    getBooks().then((b) => {
      if (!stale) setBooks(b);
    });
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

  const review = (id: number, decision: "apply" | "dismiss") =>
    send(decision === "apply" ? "Apply the adjustment" : "Dismiss", async () => {
      const result = await postReview(id, decision);
      setInventory(result.inventory);
    });

  const last = state.steps.length - 1;
  return (
    <Frame
      curtain={curtain}
      setCurtain={setCurtain}
      extra={
        <label className="switch">
          <input type="checkbox" checked={plants} onChange={(e) => setPlants(e.target.checked)} />
          <span>Three plants</span>
        </label>
      }
    >
      <ActionBar
        state={state}
        busy={busy}
        error={error}
        onAct={act}
        onUpload={uploadFile}
        onReset={() => send("Start over", () => postJson("api/run/reset"))}
      />

      <main className="panes">
        {plants && (
          <PlantsPane
            inventory={inventory}
            mass={mass}
            books={books}
            busy={busy !== null}
            onReview={review}
          />
        )}
        <StaffFeed data={state} upTo={last} curtain={curtain} />
        {curtain && <Curtain data={state} upTo={last} />}
      </main>

      <footer className="muted foot">
        {state.mode === "live"
          ? `Live on NEAR ${state.network}: each step sends a real transaction.`
          : `Step by step through the run recorded on NEAR ${state.network}: each step replays its real transaction.`}{" "}
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
  onReset,
}: {
  state: LiveState;
  busy: string | null;
  error: { message: string; hint?: string } | null;
  onAct: (a: Action) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  const { next } = state;
  const actor = actorOf(next);
  const actions = actionsFor(next);
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
              : waitingOnKevin
                ? next.action
                : next.phase === "done"
                  ? summaryLine(state)
                  : next.action}
        </p>
      </div>

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

/** Three facilities, one truth: stock by plant, and the transfer discrepancies with their review. */
function PlantsPane({
  inventory,
  mass,
  books,
  busy,
  onReview,
}: {
  inventory: PlantInventory | null;
  mass: MassBalance | null;
  books: Books | null;
  busy: boolean;
  onReview: (id: number, decision: "apply" | "dismiss") => void;
}) {
  if (!inventory) {
    return (
      <section className="pane plants" aria-label="Three plants">
        <h2>Three plants</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  const plants = inventory.facilities;
  return (
    <section className="pane plants" aria-label="Three plants">
      <h2>Three plants · stock on hand</h2>
      {inventory.discrepancies.length > 0 && (
        <ul className="discrepancies">
          {inventory.discrepancies.map((d) => (
            <li key={d.id} className={`disc ${d.status}`}>
              <p>{d.explanation}</p>
              {d.status === "proposed_adjustment" && d.proposed ? (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => onReview(d.id, "apply")}
                  >
                    Apply at Plant {d.proposed.facility}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => onReview(d.id, "dismiss")}
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
      {mass && <MassBalanceBlock mass={mass} plants={plants} />}
      {books && <BooksBlock books={books} />}
    </section>
  );
}

/** Settled purchase orders for the books, the price-drift alerts, and the CSV export. */
function BooksBlock({ books }: { books: Books }) {
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
        <a className="export" href={BOOKS_EXPORT_URL} download>
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

/** Issued against tablets, QC samples and recorded waste, per plant and product (§15). */
function MassBalanceBlock({
  mass,
  plants,
}: {
  mass: MassBalance;
  plants: PlantInventory["facilities"];
}) {
  const name = (code: string) => plants.find((p) => p.code === code)?.name ?? `Plant ${code}`;
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
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

function summaryLine(state: LiveState) {
  const s = state.summary;
  if (!s) return "The run is complete.";
  return `Done: ${s.transactions} transactions, ${s.refusedByDesign} refused by design, ${s.failed} failed.`;
}

// ------------------------------------------------------------------ shared pieces

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the step changes
  useEffect(() => {
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

function Who({ who, title }: { who: Audience; title?: string }) {
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

function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="lines">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function Phone({ step, approvals }: { step: Step; approvals: RunData["approvals"] }) {
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

function Curtain({ data, upTo }: { data: RunData; upTo: number }) {
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
