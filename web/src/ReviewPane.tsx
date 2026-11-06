// "Morning review" (research 24 §2): what Kevin read in Ray's mailbox overnight, one row per
// message with the sender, the subject and a pill, in plain words. Ray opens one, reads what it
// says and Kevin's check, and signs the drafts that are ready; nothing changes until he does, and
// a signature changes the schedule or a vendor's card, never where an order pays. The refused
// email stays on the list with its reason, so the attack is seen, not hidden. Accounts an email
// named stay behind the curtain.

import { useEffect, useState } from "react";
import type { ReviewProposal, ReviewState } from "./api.ts";
import { KevinNote, Pill } from "./feed.tsx";
import {
  flaggedWords,
  reviewPill,
  senderOf,
  shortDate,
  signingDoes,
  staffWords,
} from "./review.ts";

export function ReviewPane({
  review,
  busy,
  curtain,
  viewer,
  open,
  onSign,
  readOnly,
  show = null,
}: {
  review: ReviewState;
  busy: boolean;
  curtain: boolean;
  /** Whose screen this is: only the mailbox's owner signs. */
  viewer: string;
  /** Unfolded: at the purchaser's turn. */
  open: boolean;
  /** Null on a static host, where nothing can be signed; `readOnly` then says so. */
  onSign: ((messageId: string) => void) | null;
  readOnly?: string;
  /** A message to start open, for the video page; Ray opens them himself otherwise. */
  show?: string | null;
}) {
  const [shown, setShown] = useState<string | null>(show);
  // Opened by the turn, then left as the person left it: signing a draft never folds the panel.
  const [unfolded, setUnfolded] = useState(open);
  useEffect(() => setUnfolded(open), [open]);
  const mine = viewer === review.for && onSign !== null;
  const first = review.for.split(" ")[0] ?? review.for;
  // The drafts, Kevin's questions and the refusal first; messages that need nothing fold below.
  const quiet = review.proposals.filter((p) => p.decision === "none" && !p.signed);
  const active = review.proposals.filter((p) => !quiet.includes(p));
  const row = (p: ReviewProposal, i: number) => (
    <ReviewRow
      key={p.messageId}
      proposal={p}
      curtain={curtain}
      canSign={mine}
      first={i === 0 && p.decision === "sign" && !p.signed}
      open={shown === p.messageId}
      busy={busy}
      onOpen={() => setShown(shown === p.messageId ? null : p.messageId)}
      onSign={() => onSign?.(p.messageId)}
    />
  );
  return (
    <details
      className="panel inbox review-pane"
      aria-label="Morning review"
      open={unfolded}
      onToggle={(e) => setUnfolded((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="panel-head">
        <h2>Morning review</h2>
        <span className="right">
          <Pill tone={review.toSign ? "waiting" : "neutral"}>
            {review.toSign ? `${count(review.toSign, "draft")} for ${first}` : "all signed"}
          </Pill>
        </span>
      </summary>
      <KevinNote>
        {review.toSign
          ? `Good morning, ${first}. The drafts to sign are first; open one to see what signing does.`
          : `Good morning, ${first}. Everything Kevin drafted is signed.`}
      </KevinNote>
      <ul className="queue" aria-label="Messages Kevin read">
        {active.map(row)}
      </ul>
      {quiet.length > 0 && (
        <details className="review-quiet">
          <summary className="small">
            {count(quiet.length, "more message")} that {quiet.length === 1 ? "needs" : "need"}{" "}
            nothing
          </summary>
          <ul className="queue" aria-label="Messages that need nothing">
            {quiet.map((p) => row(p, -1))}
          </ul>
        </details>
      )}
      <p className="muted small">
        Nothing is changed until it is signed; a signature changes a vendor's card or the schedule,
        never where an order pays.
        {onSign === null && readOnly ? ` ${readOnly}` : ""}
      </p>
    </details>
  );
}

function ReviewRow({
  proposal: p,
  curtain,
  canSign,
  first,
  open,
  busy,
  onOpen,
  onSign,
}: {
  proposal: ReviewProposal;
  curtain: boolean;
  canSign: boolean;
  first: boolean;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onSign: () => void;
}) {
  const pill = reviewPill(p);
  const live = p.decision === "sign" && !p.signed;
  const does = signingDoes(p);
  return (
    <li className={`${live ? "" : "dim"}${open ? " open" : ""}`.trim() || undefined}>
      <span className={p.kind === "note" ? "doc note" : "doc"} aria-hidden="true" />
      <span className="t">
        <b>
          {senderOf(p.from)}
          <Pill tone={pill.tone}>{pill.label}</Pill>
          <span className="muted small">{shortDate(p.date)}</span>
        </b>
        <span className="sum">
          {p.signed ? `${p.signed.by.split(" ")[0]}: ${p.signed.outcome}` : p.subject}
        </span>
      </span>
      {open ? (
        <div className="review-box">
          <div className="inbox-review">
            <p className="small">
              <b>Says:</b> {p.says}
            </p>
            <p className="small">
              <b>Kevin:</b> {staffWords(p.kevin, curtain)}
            </p>
            {p.flagged.length > 0 && (
              <ul className="inbox-notes small muted">
                {p.flagged.map((line) => (
                  <li key={line}>⚠ {flaggedWords(line, curtain)}</li>
                ))}
              </ul>
            )}
            {does && (
              <p className="small">
                <b>{p.signed ? "Signed:" : "Signing does:"}</b> {does}
              </p>
            )}
            <div className="actions">
              {live && canSign && (
                <button type="button" className="primary" disabled={busy} onClick={onSign}>
                  Sign
                </button>
              )}
              <button type="button" className="quiet end" disabled={busy} onClick={onOpen}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={first ? "btn primary" : "btn"}
          disabled={busy}
          onClick={onOpen}
        >
          Open
        </button>
      )}
    </li>
  );
}

const count = (n: number, noun: string) => `${n === 1 ? "one" : n} ${noun}${n === 1 ? "" : "s"}`;
