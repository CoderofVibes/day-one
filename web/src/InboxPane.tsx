// "Waiting for you" (research 24 §1): the scans Kevin read from the plant's batch-record folder,
// one line each with his summary and what he asks, in plain words. Ray opens one, answers the
// flags and confirms; nothing posts until he does. A page that is not a batch record is listed
// with Kevin's reason, so a misfiled scan is never silently lost.

import { useState } from "react";
import type { InboxFlag, InboxItem, InboxState } from "./api.ts";

export function InboxPane({
  inbox,
  busy,
  viewer,
  onConfirm,
}: {
  inbox: InboxState;
  busy: boolean;
  /** Whose screen this is: his records first, others marked with their plant. */
  viewer: string;
  onConfirm: (batchNo: string, resolutions: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const waiting = inbox.items.filter((i) => i.status === "waiting");
  const mine = waiting.filter((i) => i.waitingFor === viewer || i.waitingFor === null);
  const others = inbox.items.filter((i) => !waiting.includes(i));
  const questions = mine.reduce((s, i) => s + i.questions, 0);

  return (
    <section className="pane plants inbox" aria-label="Waiting for you">
      <h2>Waiting for you</h2>
      <p className="kevin-line">
        {waiting.length === 0
          ? "Nothing is waiting. Scans dropped in the batch-record folder show up here once Kevin has read them."
          : `Kevin read ${count(waiting.length, "batch record")} from the scan folder` +
            (questions
              ? ` and has ${count(questions, "question")} for you.`
              : ". Nothing to ask.") +
            " Nothing is posted until you confirm."}
      </p>
      <ul className="inbox-list">
        {[...waiting, ...others].map((item) => (
          <InboxRow
            key={item.id}
            item={item}
            viewer={viewer}
            open={open === item.id}
            busy={busy}
            onOpen={() => setOpen(open === item.id ? null : item.id)}
            onConfirm={(resolutions) => {
              if (item.batchNo) onConfirm(item.batchNo, resolutions);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function InboxRow({
  item,
  viewer,
  open,
  busy,
  onOpen,
  onConfirm,
}: {
  item: InboxItem;
  viewer: string;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onConfirm: (resolutions: Record<string, string>) => void;
}) {
  const name = item.file.split("/").at(-1) ?? item.file;
  if (item.status !== "waiting") {
    return (
      <li className={`disc inbox-item ${item.status}`}>
        <p className="inbox-head">
          <strong>{item.batchNo ?? name}</strong>
          <span className="tag">{statusLabel(item)}</span>
        </p>
        <p className="small">
          {item.status === "confirmed"
            ? `${item.confirmedBy ?? "Confirmed"}: ${item.outcome ?? "posted."}`
            : item.summary}
        </p>
        {item.status !== "confirmed" && item.batchNo && <p className="muted small">{name}</p>}
      </li>
    );
  }
  const elsewhere = item.waitingFor && item.waitingFor !== viewer;
  return (
    <li className={`disc inbox-item waiting${open ? " open" : ""}`}>
      <p className="inbox-head">
        <strong>{item.batchNo}</strong>
        {item.facility && <span className="muted small"> · Plant {item.facility}</span>}
        <span className="tag">
          {elsewhere
            ? `for ${item.waitingFor}`
            : item.questions
              ? count(item.questions, "question")
              : "ready to confirm"}
        </span>
      </p>
      <p className="small">{item.summary}</p>
      {open ? (
        <Review item={item} busy={busy} onConfirm={onConfirm} onClose={onOpen} />
      ) : (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={onOpen}>
            Open {item.batchNo}
          </button>
        </div>
      )}
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
  const done = (f: InboxFlag) =>
    f.answer === "value" ? (answers[f.fieldPath] ?? "").trim() !== "" : checked[f.fieldPath];
  const ready = asks.every(done);
  const notes = item.flags.filter((f) => !f.blocking);

  return (
    <div className="inbox-review">
      {asks.length > 0 && (
        <ol className="flags">
          {asks.map((f) => (
            <li key={f.fieldPath} className={`disc flag${done(f) ? " answered" : ""}`}>
              <p>{f.message}</p>
              {f.answer === "value" ? (
                <div className="actions">
                  <label className="qty">
                    <span className="small">What the page says:</span>
                    <input
                      type="text"
                      value={answers[f.fieldPath] ?? ""}
                      placeholder={f.suggestion ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [f.fieldPath]: e.target.value }))
                      }
                    />
                  </label>
                  {f.suggestion && answers[f.fieldPath] !== f.suggestion && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [f.fieldPath]: f.suggestion ?? "" }))
                      }
                    >
                      Use {f.suggestion}
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
        <ul className="inbox-notes">
          {notes.map((f) => (
            <li key={f.fieldPath} className="small">
              {f.message}
            </li>
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
        <button type="button" className="quiet" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function statusLabel(item: InboxItem) {
  switch (item.status) {
    case "confirmed":
      return "posted";
    case "failed":
      return "not read";
    default:
      return "set aside";
  }
}

const count = (n: number, noun: string) => `${n === 1 ? "one" : n} ${noun}${n === 1 ? "" : "s"}`;
