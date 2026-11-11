// "Waiting for you" (research 24 §1): the scans Kevin read from the plant's batch-record folder,
// one row each with his summary and a status pill, in plain words. Ray opens one, answers the
// flags and confirms; nothing posts until he does. A page that is not a batch record is listed
// with Kevin's reason, so a misfiled scan is never silently lost. At Ray's turn the queue sits
// inside "Up next" (embedded); at other turns it is its own panel.

import { useEffect, useRef, useState } from "react";
import type { InboxFlag, InboxItem, InboxState } from "./api.ts";
import { BatchReading } from "./BatchReading.tsx";
import { KevinNote, Pill } from "./feed.tsx";
import type { Tone } from "./run.ts";

export function InboxPane({
  inbox,
  busy,
  viewer,
  onConfirm,
  embedded,
}: {
  inbox: InboxState;
  busy: boolean;
  /** Whose screen this is: his records first, others marked with their plant. */
  viewer: string;
  onConfirm: (batchNo: string, resolutions: Record<string, string>) => void;
  /** Inside the Up next card: no panel of its own. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const waiting = inbox.items.filter((i) => i.status === "waiting");
  const mine = waiting.filter((i) => i.waitingFor === viewer || i.waitingFor === null);
  const others = inbox.items.filter((i) => !waiting.includes(i));
  const questions = mine.reduce((s, i) => s + i.questions, 0);
  const line =
    waiting.length === 0
      ? "Nothing is waiting. Scans dropped in the batch-record folder show up here once Kevin has read them."
      : `Kevin read ${count(waiting.length, "batch record")} from the scan folder` +
        (questions ? ` and has ${count(questions, "question")} for you.` : ". Nothing to ask.") +
        " Nothing is posted until you confirm.";

  const list = (
    <ul className="queue" aria-label="Waiting for you">
      {[...waiting, ...others].map((item, i) => (
        <InboxRow
          key={item.id}
          item={item}
          viewer={viewer}
          first={i === 0}
          open={open === item.id}
          busy={busy}
          onOpen={() => setOpen(open === item.id ? null : item.id)}
          onConfirm={(resolutions) => {
            if (item.batchNo) onConfirm(item.batchNo, resolutions);
          }}
        />
      ))}
    </ul>
  );
  // On the desk the card above already says what the scans are and that nothing posts until
  // Ray confirms; the list is enough (first-use review, finding 19).
  if (embedded) return list;
  // Someone else's turn: the queue folds to one line so Ray's scans do not crowd their screen.
  return (
    <details className="panel inbox" aria-label="Batch-record scans">
      <summary className="panel-head">
        <h2>Batch-record scans</h2>
        <span className="right">
          <Pill tone={mine.length ? "waiting" : "neutral"}>
            {mine.length
              ? `${count(mine.length, "scan")} for ${viewer.split(" ")[0]}`
              : "none waiting"}
          </Pill>
        </span>
      </summary>
      <KevinNote>{line}</KevinNote>
      {list}
    </details>
  );
}

function pillFor(item: InboxItem, viewer: string): { tone: Tone; label: string } {
  switch (item.status) {
    case "confirmed":
      return { tone: "ok", label: "posted" };
    case "failed":
      return { tone: "refused", label: "not read" };
    case "set_aside":
      return { tone: "neutral", label: "set aside" };
    default:
      if (item.waitingFor && item.waitingFor !== viewer)
        return { tone: "neutral", label: `for ${item.waitingFor}` };
      return item.questions
        ? { tone: "waiting", label: count(item.questions, "question") }
        : { tone: "ok", label: "ready to confirm" };
  }
}

function InboxRow({
  item,
  viewer,
  first,
  open,
  busy,
  onOpen,
  onConfirm,
}: {
  item: InboxItem;
  viewer: string;
  first: boolean;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onConfirm: (resolutions: Record<string, string>) => void;
}) {
  const name = item.file.split("/").at(-1) ?? item.file;
  const pill = pillFor(item, viewer);
  const waiting = item.status === "waiting";
  // An opened record comes into view, so the first "Open" never looks dead below the fold
  // (first-use review, finding 18).
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [open]);
  return (
    <li ref={row} className={`${waiting ? "" : "dim"}${open ? " open" : ""}`.trim() || undefined}>
      <span className="doc" aria-hidden="true" />
      <span className="t">
        <b>
          {item.batchNo ?? name}
          <Pill tone={pill.tone}>{pill.label}</Pill>
          {item.facility && waiting && <span className="muted small">Plant {item.facility}</span>}
        </b>
        <span className="sum">
          {item.status === "confirmed"
            ? `${item.confirmedBy ?? "Confirmed"}: ${item.outcome ?? "posted."}`
            : item.summary}
        </span>
        {item.status !== "confirmed" && item.batchNo && <span className="file">{name}</span>}
      </span>
      {(waiting || (item.status === "confirmed" && item.reading)) &&
        (open ? (
          <div className="review-box">
            {waiting ? (
              <Review item={item} busy={busy} onConfirm={onConfirm} onClose={onOpen} />
            ) : (
              <>
                <BatchReading
                  scan={`api/batch-records/${item.id}/scan`}
                  reading={item.reading ?? null}
                  posted={item.postedReading ?? null}
                />
                <button type="button" onClick={onOpen}>
                  Close
                </button>
              </>
            )}
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
        ))}
    </li>
  );
}

/** Open: every flag in Kevin's words; a box or a tick for each one Ray must answer. */
function Review({
  item,
  busy,
  onConfirm,
  onClose,
}: {
  item: InboxItem;
  busy: boolean;
  onConfirm: (resolutions: Record<string, string>) => void;
  onClose: () => void;
}) {
  const asks = item.flags.filter((f) => f.blocking);
  // Empty until Ray answers: Kevin's reading is offered, never assumed.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // A quantity is answered by a number; words ("eighty three") are refused in the box itself.
  const wrong = (f: InboxFlag) => {
    const typed = (answers[f.fieldPath] ?? "").trim();
    return typed !== "" && wantsNumber(f) && !NUMBER.test(typed);
  };
  const done = (f: InboxFlag) =>
    f.answer === "value"
      ? (answers[f.fieldPath] ?? "").trim() !== "" && !wrong(f)
      : checked[f.fieldPath];
  const ready = asks.every(done);
  // A note the summary line already says is not repeated under it.
  const notes = item.flags.filter((f) => !f.blocking && !item.summary?.includes(f.message));
  return (
    <div className="inbox-review">
      <BatchReading
        scan={`api/batch-records/${item.id}/scan`}
        reading={item.reading ?? null}
        flags={item.flags}
      />
      {asks.length > 0 && (
        <ol className="review">
          {asks.map((f) => (
            <li key={f.fieldPath} className={done(f) ? "done" : undefined}>
              <div className="cont">
                <Pill tone={done(f) ? "ok" : "waiting"}>{done(f) ? "answered" : "question"}</Pill>
                <p>{f.message}</p>
              </div>
              {f.answer === "value" ? (
                <div className="actions">
                  <label className="qty">
                    <span className="small">Type what the page says:</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-invalid={wrong(f) || undefined}
                      value={answers[f.fieldPath] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [f.fieldPath]: e.target.value }))
                      }
                    />
                  </label>
                  {wrong(f) && (
                    <span className="answer-wrong small" role="alert">
                      Type the number as the page shows it, in digits
                      {f.suggestion ? ` (for example ${f.suggestion})` : ""}.
                    </span>
                  )}
                  {f.suggestion && answers[f.fieldPath] !== f.suggestion && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [f.fieldPath]: f.suggestion ?? "" }))
                      }
                    >
                      Kevin's best reading: {f.suggestion}
                    </button>
                  )}
                </div>
              ) : (
                <label className="qty">
                  <input
                    type="checkbox"
                    checked={checked[f.fieldPath] ?? false}
                    onChange={(e) =>
                      setChecked((prev) => ({ ...prev, [f.fieldPath]: e.target.checked }))
                    }
                  />
                  <span className="small">I checked this on the page.</span>
                </label>
              )}
            </li>
          ))}
        </ol>
      )}
      {notes.length > 0 && (
        <ul className="inbox-notes small muted">
          {notes.map((f) => (
            <li key={f.fieldPath}>{f.message}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !ready}
          onClick={() =>
            onConfirm(
              Object.fromEntries(
                asks.map((f) => [
                  f.fieldPath,
                  f.answer === "value" ? (answers[f.fieldPath] ?? "").trim() : "checked",
                ]),
              ),
            )
          }
        >
          Confirm {item.batchNo}
        </button>
        {asks.length > 0 && (
          <span className="muted small">
            {asks.filter(done).length} of {asks.length} answered
          </span>
        )}
        <button type="button" className="quiet end" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Digits with an optional decimal part: "83.040", "1,250", "83". */
const NUMBER = /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/;

/** A flag on a quantity, or one whose suggestion is a number, wants a number back. */
function wantsNumber(f: InboxFlag): boolean {
  return /(qty|quantity|yield|weight)$/i.test(f.fieldPath) || NUMBER.test(f.suggestion ?? "");
}

const count = (n: number, noun: string) => `${n === 1 ? "one" : n} ${noun}${n === 1 ? "" : "s"}`;
