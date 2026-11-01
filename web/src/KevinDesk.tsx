// Kevin's desk, the top of the Overview (src/desk.ts holds the model): on the left the one thing
// that needs a person now, with why them, what they decide and what happens after, and the
// order's way from draft to paid; on the right what Kevin has already handled, done work kept
// apart from drafts, suggestions and held requests. A graphite surface with paper cards in both
// themes, so the work reads as one desk. Each entry can point at its place on the plant twin.
//
// Three moments move, and only these (reduced motion turns them off): an order meeting Kevin's
// limit resolves into Linda's request; her approval lands as a history entry while the payment's
// condition stays pinned; QC's release draws the line to the supplier's payment.

import "./desk.css";
import { useMemo, useState } from "react";
import type { InboxState, PlantInventory, ReviewState } from "./api.ts";
import { readout, sharedClock } from "./clock.ts";
import {
  type Handled,
  handledFromInbox,
  handledFromReview,
  handledFromRun,
  type Need,
  needOf,
  nextWords,
  type Place,
  type PoTrack,
  poTrack,
  primaryLabel,
  type RunFacts,
  runFacts,
  type SourcingCheck,
  secondaryLabel,
  sourcingCheck,
  type Turn,
  waitingBeside,
} from "./desk.ts";
import { initials } from "./feed.tsx";
import { groupBuy } from "./groupBuy.ts";
import { RecordLink } from "./kit.tsx";
import type { RunData } from "./run.ts";

/** A place on the plant twin (desk.ts Place): an object, its fallback, what else it touches. */
export type Where = Place;

const SHOWN = 6;

export function Desk({
  run,
  at,
  turn,
  review,
  inbox,
  inventory,
  actions,
  onShow,
}: {
  run: RunData;
  at: number;
  turn: Turn;
  review: ReviewState | null;
  inbox: InboxState | null;
  inventory: PlantInventory | null;
  /** The buttons for the decision: the replay steps the run, the live run posts the action. */
  actions: React.ReactNode;
  /** Point the plant twin at a place. */
  onShow: (where: Where) => void;
}) {
  const facts = useMemo(() => runFacts(run, at), [run, at]);
  const track = poTrack(facts);
  const need = needOf(turn, facts, run, at, inbox);
  const handled = useMemo(
    () => [...handledFromRun(run, at), ...handledFromInbox(inbox), ...handledFromReview(review)],
    [run, at, inbox, review],
  );
  const waiting = waitingBeside(review, inbox, inventory, turn);
  const sourcing = sourcingCheck(facts, inventory, groupBuy);
  const tally = count(handled);

  return (
    <section className="desk" aria-label="Kevin's desk">
      <div className="desk-grid">
        <div className="desk-col">
          <header className="desk-head">
            <h2>Needs you</h2>
            <span className="desk-count">
              {need ? "1 decision" : "nothing right now"}
              {waiting.length > 0 && ` · ${waiting.length} more waiting`}
            </span>
          </header>
          {need ? (
            <NeedCard
              key={need.id}
              need={need}
              facts={facts}
              track={track}
              sourcing={turn.kind === "approve" ? sourcing : null}
              actions={actions}
              onShow={onShow}
            />
          ) : (
            <KevinCard
              key={`kevin-${at}`}
              turn={turn}
              facts={facts}
              track={track}
              sourcing={!facts.big ? sourcing : null}
              actions={actions}
              onShow={onShow}
            />
          )}
          {waiting.length > 0 && (
            <ul className="desk-waiting" aria-label="Also waiting">
              {waiting.map((w) => (
                <li key={w.id}>
                  <span className="mini-avatar" aria-hidden="true">
                    {initials(w.who)}
                  </span>
                  <b>{w.who}</b> {w.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <HandledList items={handled} at={at} tally={tally} onShow={onShow} />
      </div>
    </section>
  );
}

function count(items: Handled[]) {
  const by = (k: Handled["kind"]) => items.filter((i) => i.kind === k).length;
  const drafts = items.filter(
    (i) => i.kind === "draft" && !/^(approved|declined)/.test(i.outcome ?? ""),
  ).length;
  return {
    done:
      by("done") +
      by("guard") +
      items.filter((i) => i.kind === "draft" && /^approved/.test(i.outcome ?? "")).length,
    drafts,
    suggestions: by("suggestion"),
    decisions: by("decision"),
  };
}

// ------------------------------------------------------------------ the decision

export function NeedCard({
  need,
  facts,
  track,
  sourcing,
  actions,
  onShow,
}: {
  need: Need;
  facts: RunFacts;
  track: PoTrack | null;
  sourcing: SourcingCheck | null;
  actions: React.ReactNode;
  onShow: (where: Where) => void;
}) {
  const limit = need.id.startsWith("approve-") && facts.big ? facts.big : null;
  return (
    <article
      className={limit ? "desk-card paper need has-limit" : "desk-card paper need"}
      aria-label={`${need.who}: ${need.title}`}
    >
      <div className="card-who">
        <span className="avatar" aria-hidden="true">
          {initials(need.who)}
        </span>
        <span>
          <b>{need.who}</b>
          <span className="muted"> · {need.role}</span>
        </span>
        <span className="channel">
          {need.channel === "phone" ? "by text message" : "on screen"}
        </span>
      </div>
      {limit && <LimitMeter amount={limit.amount} limit={limit.limit} who={need.who} />}
      <h3 className="card-title">{need.title}</h3>
      {need.subtitle && <p className="card-sub">{need.subtitle}</p>}
      <dl className="three">
        <div style={{ "--i": 0 } as React.CSSProperties}>
          <dt>Why you</dt>
          <dd>{need.why}</dd>
        </div>
        <div style={{ "--i": 1 } as React.CSSProperties}>
          <dt>What you decide</dt>
          <dd>{need.deciding}</dd>
        </div>
        <div style={{ "--i": 2 } as React.CSSProperties}>
          <dt>What happens next</dt>
          <dd>{need.after}</dd>
        </div>
      </dl>
      {track && !limit && <Track track={track} />}
      <footer className="card-foot">
        <div className="card-actions">{actions}</div>
        <WhereButton where={need.where} onShow={onShow} />
      </footer>
      {sourcing && <Sourcing check={sourcing} />}
      {need.channel === "phone" && facts.request && (
        <details className="card-text">
          <summary>The text {need.who.split(" ")[0]} got from Kevin</summary>
          <p>{facts.request}</p>
        </details>
      )}
    </article>
  );
}

/** Nobody is needed: what Kevin is doing, the order in flight, and the way on. */
function KevinCard({
  turn,
  facts,
  track,
  sourcing,
  actions,
  onShow,
}: {
  turn: Turn;
  facts: RunFacts;
  track: PoTrack | null;
  sourcing: SourcingCheck | null;
  actions: React.ReactNode;
  onShow: (where: Where) => void;
}) {
  const done = turn.kind === "done";
  const title = done
    ? facts.paid
      ? `${facts.paid.po} is paid.`
      : "This order is closed."
    : "Nothing needs you right now";
  const line =
    turn.kind === "kevin"
      ? `Kevin is ${turn.doing}.`
      : turn.kind === "supplier"
        ? `${facts.big?.supplier ?? "The supplier"} is packing ${facts.funded?.po ?? "the order"}. Tommy is next, when the truck arrives.`
        : done
          ? "Every step of the order closed, and each one is on file."
          : "";
  return (
    <article className={done ? "desk-card paper kevin done" : "desk-card paper kevin"}>
      <div className="card-who">
        <span className="avatar kevin" aria-hidden="true">
          K
        </span>
        <span>
          <b>Kevin</b>
          <span className="muted"> · purchasing assistant</span>
        </span>
        <span className={done ? "channel ok" : "channel working"}>{done ? "done" : "working"}</span>
      </div>
      <h3 className="card-title">{title}</h3>
      {line && <p className="card-sub">{line}</p>}
      {sourcing && <Sourcing check={sourcing} />}
      {track && <Track track={track} />}
      <footer className="card-foot">
        <div className="card-actions">{actions}</div>
        {track && (facts.funded || facts.paid) && (
          <WhereButton
            where={
              facts.paid
                ? {
                    label: "Accounting, Hollow Pine",
                    focus: "dept-B-accounting",
                    fallback: "plant-B",
                    also: ["escrow"],
                  }
                : { label: `${track.po}'s money, Escrow`, focus: track.po, fallback: "escrow" }
            }
            onShow={onShow}
          />
        )}
      </footer>
    </article>
  );
}

export function WhereButton({ where, onShow }: { where: Where; onShow: (where: Where) => void }) {
  return (
    <button type="button" className="where" onClick={() => onShow(where)}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" />
      </svg>
      Show on the plant
      <span className="where-label">{where.label}</span>
    </button>
  );
}

// ------------------------------------------------------------------ the limit, in motion

/** The order's amount against Kevin's per-order limit: it fills to the limit, runs past it, and
 * resolves into the person who decides. */
function LimitMeter({ amount, limit, who }: { amount: string; limit: string; who: string }) {
  const a = Number(amount.replace(/[$,]/g, ""));
  const l = Number(limit.replace(/[$,]/g, ""));
  const at = a > 0 ? Math.min(100, (l / a) * 100) : 100;
  return (
    <div
      className="limit-meter"
      style={{ "--limit": `${at}%` } as React.CSSProperties}
      role="img"
      aria-label={`${amount} against Kevin's ${limit} limit per order`}
    >
      <div className="lm-bar">
        <span className="lm-in" />
        <span className="lm-over" />
        <span className="lm-tick" />
      </div>
      <div className="lm-labels">
        <span className="lm-limit">Kevin's limit {limit.replace(".00", "")}</span>
        <span className="lm-amount">{amount.replace(".00", "")}</span>
      </div>
      <p className="lm-resolve">
        Over the limit, so it came to {who.split(" ")[0]}. Kevin could not place it alone.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ the order's track

export function Track({ track, head = true }: { track: PoTrack; head?: boolean }) {
  const linked =
    track.stages.find((s) => s.key === "qc")?.state === "done" &&
    track.stages.find((s) => s.key === "paid")?.state === "done";
  return (
    <section className="track" aria-label={`${track.po}, from draft to paid`}>
      {head && (
        <div className="track-head">
          <RecordLink id={track.po} page="purchasing" />
          <span className="muted small">
            {track.supplier} · {track.amount}
          </span>
        </div>
      )}
      <ol className={linked ? "track-stages linked" : "track-stages"}>
        {track.stages.map((s) => (
          <li key={`${s.key}-${s.state}`} className={`st-${s.state} st-${s.key}`}>
            <span className="st-dot" aria-hidden="true" />
            <span className="st-label">{s.label}</span>
            {s.note && <span className="st-note">{s.note}</span>}
          </li>
        ))}
      </ol>
      {track.condition && (
        <p
          key={track.condition.met ? "met" : "held"}
          className={track.condition.met ? "condition met" : "condition"}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {track.condition.met ? (
              <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
            ) : (
              <path d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7h1Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
            )}
          </svg>
          <span>
            <b>{track.condition.met ? "Condition met" : "Payment condition"}</b>{" "}
            {track.condition.text}
          </span>
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ before we buy

function Sourcing({ check }: { check: SourcingCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? "sourcing open" : "sourcing"}>
      <button
        type="button"
        className="sourcing-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="sourcing-q">{check.question}</span>
        <span className="sourcing-chips">
          {check.options.map((o) => (
            <span key={o.key} className={`verdict v-${o.verdict.replace(" ", "-")}`}>
              {o.key === "transfer" ? "Move" : o.key === "alone" ? "Buy" : "Pool"}:{" "}
              {o.verdict === "worth asking" ? "ask" : o.verdict}
            </span>
          ))}
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <ol className="sourcing-options">
          {check.options.map((o) => (
            <li key={o.key} className={`v-${o.verdict.replace(" ", "-")}`}>
              <div className="opt-head">
                <b>{o.label}</b>
                <span className={`verdict v-${o.verdict.replace(" ", "-")}`}>{o.verdict}</span>
              </div>
              <p>{o.reason}</p>
              {o.plants && (
                <ul>
                  {o.plants.map((p) => (
                    <li key={p.plant}>{p.line}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ handled for you

const KIND_LABEL: Record<Handled["kind"], string> = {
  done: "Done",
  decision: "Decided",
  draft: "Draft",
  suggestion: "Suggested",
  guard: "Held",
};

function HandledList({
  items,
  at,
  tally,
  onShow,
}: {
  items: Handled[];
  at: number;
  tally: ReturnType<typeof count>;
  onShow: (where: Where) => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const times = sharedClock()?.range.steps;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <aside className="desk-col handled" aria-label="Handled for you">
      <header className="desk-head">
        <h2>Handled for you</h2>
        <span className="desk-count">
          {tally.done} done
          {tally.drafts > 0 && ` · ${tally.drafts} ${tally.drafts === 1 ? "draft" : "drafts"}`}
          {tally.suggestions > 0 && ` · ${tally.suggestions} suggested`}
        </span>
      </header>
      <ol className="handled-list">
        {shown.map((h) => {
          const fresh = h.step !== undefined && h.step === at;
          const when =
            h.step !== undefined && times?.[h.step] ? readout(times[h.step] as number) : null;
          const isOpen = open === h.id;
          const resolved = h.kind === "draft" && /^(approved|declined)/.test(h.outcome ?? "");
          return (
            <li
              key={h.id}
              className={`h-item k-${resolved ? "done" : h.kind}${fresh ? " fresh" : ""}`}
            >
              <span className="h-mark" aria-hidden="true">
                {h.kind === "decision" && h.who ? (
                  initials(h.who)
                ) : (
                  <Mark kind={resolved ? "done" : h.kind} />
                )}
              </span>
              <div className="h-body">
                <button
                  type="button"
                  className="h-title"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : h.id)}
                >
                  {h.title}
                </button>
                <p className="h-meta">
                  <span className="h-kind">
                    {h.kind === "decision" && h.who
                      ? `${h.from ? "From" : "Decided by"} ${h.who.split(" ")[0]}`
                      : KIND_LABEL[resolved ? "done" : h.kind]}
                  </span>
                  {h.outcome && <span className="h-outcome">{h.outcome}</span>}
                  {when && <span className="h-when">{when.split(" · ")[1]}</span>}
                </p>
                {isOpen && (
                  <div className="h-detail">
                    {h.detail.length > 0 ? (
                      h.detail.map((d) => <p key={d}>{d}</p>)
                    ) : (
                      <p className="muted">No more on file than the line above.</p>
                    )}
                    <div className="h-links">
                      {h.records.map((r) => (
                        <RecordLink key={r} id={r} />
                      ))}
                      {h.where && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => onShow(h.where as Where)}
                        >
                          Show on the plant
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > SHOWN && (
        <button type="button" className="h-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </aside>
  );
}

function Mark({ kind }: { kind: Handled["kind"] }) {
  switch (kind) {
    case "done":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path className="draw" d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      );
    case "draft":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 13h3l7-7-3-3-7 7v3Z" />
        </svg>
      );
    case "suggestion":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2v3M8 11v3M2 8h3M11 8h3" />
        </svg>
      );
    case "guard":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.8 13 3.6v4c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6v-4L8 1.8Z" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * The desk's buttons in the replay: the decision in the person's words, which steps the recorded
 * run on; the other answer is shown but off, since the recording took the first one.
 */
export function ReplayDeskActions({
  turn,
  data,
  at,
  onNext,
  onReplay,
}: {
  turn: Turn;
  data: RunData;
  at: number;
  onNext: () => void;
  onReplay: () => void;
}) {
  const facts = runFacts(data, at);
  const last = data.steps.length - 1;
  const other = secondaryLabel(turn, facts);
  const next = data.steps[at + 1];
  const label =
    turn.kind === "done" && at >= last
      ? primaryLabel(turn, facts)
      : turn.kind === "kevin" || turn.kind === "supplier" || turn.kind === "done"
        ? nextWords(next?.title)
        : primaryLabel(turn, facts);
  return (
    <>
      <button
        type="button"
        className="primary"
        onClick={turn.kind === "done" && at >= last ? onReplay : onNext}
      >
        {label}
      </button>
      {other && (
        <button
          type="button"
          className="danger"
          disabled
          title={`The recorded run's answer was "${primaryLabel(turn, facts)}"`}
        >
          {other}
        </button>
      )}
    </>
  );
}
