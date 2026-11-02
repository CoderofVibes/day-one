// The attack arena (docs/UPGRADE_BRIEF.md §3.1), recorded mode: the fifteen cases of
// `npm run test:attacks` down the left, the picked case in the middle with its timeline and
// result, and on the right a log of the transactions fired this visit, styled like Behind the
// curtain. A fired case replays its recorded refusal; the run, the ledger and the chain do not
// move.

import { useEffect, useRef, useState } from "react";
import {
  type Arena,
  type ArenaCase,
  type ArenaTx,
  announceFired,
  CASE_MS,
  chipLabel,
  PHASES,
  RESULT_PHASE,
  readArena,
  recordedDay,
  STEP_MS,
  shortHash,
  tally,
  tallyLine,
  timeline,
} from "../arena.ts";
import { run, shortAccount } from "../run.ts";
import { useRead } from "../series.ts";
import { PlantView } from "../twin3d/PlantView.tsx";
import { Loading } from "./common.tsx";

export function ArenaPage() {
  const { value, error } = useRead(readArena, "arena");
  if (!value) return <Loading error={error} what="the attack suite" />;
  return <ArenaConsole arena={value} />;
}

interface LogEntry {
  key: string;
  at: string;
  c: ArenaCase;
  tx: ArenaTx | null;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const clock = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ArenaConsole({ arena }: { arena: Arena }) {
  // ?attack=<n> opens on that case (judge mode opens on the bank-details email).
  const asked = Number(new URLSearchParams(location.search).get("attack"));
  const first = arena.cases.find((c) => c.n === asked) ?? (arena.cases[0] as ArenaCase);
  const [selected, setSelected] = useState(first.n);
  const [pane, setPane] = useState<"attack" | "proof">("attack");
  /** How many of each case's timeline lines are showing (0 = not fired this visit). */
  const [shown, setShown] = useState<Record<number, number>>({});
  const [tried, setTried] = useState<ReadonlySet<number>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [all, setAll] = useState(false);
  const timers = useRef<number[]>([]);
  const fired = useRef(0);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (ms: number, f: () => void) => {
    if (ms <= 0) f();
    else timers.current.push(window.setTimeout(f, ms));
  };

  const fire = (c: ArenaCase, start = 0) => {
    const step = reducedMotion() ? 0 : STEP_MS;
    later(start, () => setShown((s) => ({ ...s, [c.n]: 0 })));
    for (let i = 1; i <= PHASES; i++)
      later(start + i * step, () => {
        setShown((s) => ({ ...s, [c.n]: i }));
        if (i !== RESULT_PHASE + 1) return;
        setTried((t) => new Set(t).add(c.n));
        announceFired(c);
        const at = clock();
        const run = ++fired.current;
        const entries: LogEntry[] = c.txs.length
          ? c.txs.map((tx) => ({ key: `${run}-${tx.tx}`, at, c, tx }))
          : [{ key: `${run}-${c.n}`, at, c, tx: null }];
        setLog((l) => [...entries.reverse(), ...l]);
      });
  };

  // On a phone the list sits above the attack; picking one brings the attack into view.
  const pick = (n: number) => {
    setSelected(n);
    const el = detail.current;
    const grid = el?.parentElement;
    if (!el || !grid || getComputedStyle(grid).gridTemplateColumns.split(" ").length > 1) return;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const tryAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setAll(true);
    setShown({});
    arena.cases.forEach((c, i) => {
      later(i * CASE_MS, () => setSelected(c.n));
      fire(c, i * CASE_MS);
    });
    later(arena.cases.length * CASE_MS, () => setAll(false));
  };

  const c = arena.cases.find((x) => x.n === selected) ?? first;
  // On a phone the attack and its proof are two tabs; wider, they sit side by side.
  const t = tally(arena.cases, tried);
  const day = recordedDay(arena.recordedAt);
  return (
    <div className="arena">
      <div className="arena-bar">
        <span
          className="src-note"
          title="Each attack replays its recorded refusal. Nothing here changes the plant, its money or its records."
        >
          Recorded replay · no changes
        </span>
        <span className="arena-tally" aria-live="polite">
          <span className="arena-dot refused" aria-hidden="true" />
          {tallyLine(t)}
        </span>
        <button type="button" className="btn sm" disabled={all} onClick={tryAll}>
          {all ? "Running…" : `Try all ${arena.cases.length}`}
        </button>
      </div>
      <fieldset className="seg arena-tabs" aria-label="Show">
        {(["attack", "proof"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={pane === k}
            className={pane === k ? "on" : undefined}
            onClick={() => setPane(k)}
          >
            {k === "attack" ? "Attack" : "Proof"}
          </button>
        ))}
      </fieldset>
      <div className={`arena-grid show-${pane}`}>
        <section className="card-v2 arena-list" aria-label="Attacks">
          <div className="arena-list-head">
            <h3>
              Recorded on NEAR {arena.network}, {day}
            </h3>
          </div>
          <ol>
            {arena.cases.map((x) => {
              const done = (shown[x.n] ?? 0) > RESULT_PHASE;
              return (
                <li key={x.n}>
                  <button
                    type="button"
                    aria-current={x.n === selected ? "true" : undefined}
                    onClick={() => pick(x.n)}
                  >
                    <span className={done ? "arena-dot refused" : "arena-dot"} aria-hidden="true" />
                    <span className="arena-row">
                      <span>{x.attack}</span>
                      {done ? (
                        <code className="arena-code">{x.code}</code>
                      ) : (
                        <small className="muted">{x.defense}</small>
                      )}
                    </span>
                    {done && <span className="sr-only"> refused</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
        <section ref={detail} className="card-v2 arena-detail" aria-label="Attack">
          <div className="arena-detail-head">
            <div>
              <div className="crumb">
                Attack {c.n} of {arena.cases.length} · {c.defense}
              </div>
              <h2>{c.attack}</h2>
            </div>
            <button
              type="button"
              className="btn arena-fire"
              disabled={all}
              onClick={() => {
                timers.current.forEach(clearTimeout);
                timers.current = [];
                fire(c);
              }}
            >
              Fire attack
            </button>
          </div>
          <p>{c.story}</p>
          <dl className="arena-facts">
            <dt>Attacker controls</dt>
            <dd>{c.controls}</dd>
            <dt>Stopped by</dt>
            <dd>
              {c.refusedBy === "contract" ? (
                <>
                  the contract, <code>{c.method}</code>
                </>
              ) : (
                `${c.refusedBy === "ERP" ? "the ERP" : "Kevin"}, before anything reaches the chain`
              )}
            </dd>
          </dl>
          <Timeline c={c} shown={shown[c.n] ?? 0} fired={c.n in shown} />
          {(shown[c.n] ?? 0) > RESULT_PHASE && <ArenaResult c={c} />}
        </section>
        <ArenaLog entries={log} network={arena.network} day={day} />
      </div>
      <section className="card-v2 arena-twin" aria-label="The attacks in 3D">
        <h3>In 3D, behind the curtain</h3>
        <p className="small muted">
          The recorded run's end, with the chain layer up. An attack the contract refused flies into
          a red shield in front of the part of spend-policy it called, with the contract's own
          words; one Kevin or the ERP stopped never reaches the chain.
        </p>
        <PlantView run={run} at={run.steps.length - 1} curtain />
      </section>
    </div>
  );
}

function Timeline({ c, shown, fired }: { c: ArenaCase; shown: number; fired: boolean }) {
  if (!fired) return null;
  return (
    <ol className="arena-steps" aria-label="What happens">
      {timeline(c).map((label, i) => (
        <li
          key={label}
          className={
            i >= shown ? "pending" : i === RESULT_PHASE ? "result" : i > RESULT_PHASE ? "after" : ""
          }
        >
          <span className="arena-step-dot" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}

/** The inline result: who refused it, the reason verbatim, and the transaction when there is one. */
export function ArenaResult({ c }: { c: ArenaCase }) {
  const refused = c.txs.find((t) => t.status === "refused") ?? null;
  return (
    <section className="arena-result" aria-label="Result">
      <span className="arena-chip">{chipLabel(c)}</span>
      <p className={c.refusedBy === "contract" ? "arena-reason" : "arena-reason long"}>
        <code>{c.reason}</code>
      </p>
      <dl className="arena-facts">
        {c.method && (
          <>
            <dt>Method</dt>
            <dd>
              <code>{c.method}</code>
            </dd>
          </>
        )}
        {c.signer && (
          <>
            <dt>Signer</dt>
            <dd>
              <code>{c.signer}</code>
            </dd>
          </>
        )}
        <dt>Transaction</dt>
        <dd>
          {refused ? (
            <>
              <code title={refused.tx}>{shortHash(refused.tx)}</code>
              {refused.url && (
                <>
                  {" · "}
                  <a href={refused.url} target="_blank" rel="noreferrer">
                    View on explorer ↗
                  </a>
                </>
              )}
            </>
          ) : (
            "no transaction: refused before the chain"
          )}
        </dd>
      </dl>
      {c.txs.length > 1 && (
        <p className="small muted">
          {c.txs.length} recorded transactions in this case; the log has each.
        </p>
      )}
    </section>
  );
}

function outcomeOf(tx: ArenaTx) {
  if (tx.status === "refused") return "✗ refused";
  return tx.events.some((e) => e.endsWith("funded")) ? "✓ funded" : "✓ ok";
}

function ArenaLog({
  entries,
  network,
  day,
}: {
  entries: LogEntry[];
  network: string;
  day: string;
}) {
  return (
    <section className="curtain arena-log" aria-label="Behind the curtain">
      <div className="panel-head">
        <h2>Behind the curtain · NEAR {network}</h2>
        <span className="right small dim">
          {entries.length === 1 ? "1 entry" : `${entries.length} entries`}
        </span>
      </div>
      <p className="ledger">
        Transactions recorded on {network} on {day}, replayed here as you fire them.
      </p>
      {entries.length === 0 && <p className="dim">Fire an attack to see its transaction here.</p>}
      <ol className="txs">
        {entries.map((e, i) =>
          e.tx ? (
            <li key={e.key} className={`tx ${e.tx.status}${i === 0 ? " fresh" : ""}`}>
              <div className="head">
                <time className="dim small">{e.at}</time>
                <code>{e.tx.method}</code>
                <span className="st">{outcomeOf(e.tx)}</span>
              </div>
              <dl>
                <dt>attack</dt>
                <dd>{e.c.attack}</dd>
                <dt>signed by</dt>
                <dd>{shortAccount(e.tx.signer)}</dd>
                {e.tx.paidBy !== e.tx.signer && (
                  <>
                    <dt>gas paid by</dt>
                    <dd>{e.tx.paidBy}</dd>
                  </>
                )}
                {e.tx.events.length > 0 && (
                  <>
                    <dt>events</dt>
                    <dd>{e.tx.events.join(", ")}</dd>
                  </>
                )}
                {e.tx.block !== null && (
                  <>
                    <dt>block</dt>
                    <dd>{e.tx.block.toLocaleString("en-US")}</dd>
                  </>
                )}
              </dl>
              {e.tx.error && <p className="why">“{e.tx.error}”</p>}
              {e.tx.url && (
                <a href={e.tx.url} target="_blank" rel="noreferrer">
                  {e.tx.tx.slice(0, 10)}… on the explorer ↗
                </a>
              )}
            </li>
          ) : (
            <li key={e.key} className={`tx refused offchain${i === 0 ? " fresh" : ""}`}>
              <div className="head">
                <time className="dim small">{e.at}</time>
                <code>{e.c.refusedBy === "ERP" ? "erp" : "kevin"}</code>
                <span className="st">✗ refused</span>
              </div>
              <dl>
                <dt>attack</dt>
                <dd>{e.c.attack}</dd>
              </dl>
              <p className="dim small">no transaction: refused before the chain</p>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
