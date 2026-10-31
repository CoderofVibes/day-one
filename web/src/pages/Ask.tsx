// Talk to Kevin (docs/UPGRADE_BRIEF.md §3.2): ask Kevin why he did something and he answers from
// the records, citing each one as a link to the page that shows it, with the model's label:
// "Signed in enclave ✓" for NEAR AI Cloud, "Fallback model · not attested" otherwise. In the
// static replay the suggested questions answer from the recording; behind the running API any
// question goes to POST /api/ask. Kevin explains and proposes; a proposal links to the page
// where a person acts. Nothing here changes the run.

import { type FormEvent, useEffect, useRef, useState } from "react";
import "../ask.css";
import {
  askApi,
  type Check,
  type KevinAnswer,
  type RecordedAsk,
  readRecordedAsk,
  withCitations,
} from "../ask.ts";
import type { Source } from "../series.ts";
import { useRead } from "../series.ts";
import { NAV } from "../shell.tsx";
import { Loading } from "./common.tsx";

const LABELS = new Map(NAV.flatMap((g) => g.items.map((i) => [i.id as string, i.label])));
const NOT_YET = "Recorded answers arrive with the next recording.";

/** Opens another page the way the sidebar does: the URL changes and the shell follows it. */
function openPage(page: string) {
  const q = new URLSearchParams(location.search);
  q.set("page", page);
  history.pushState(null, "", `?${q}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

function PageLink({ page, children }: { page: string; children: React.ReactNode }) {
  return (
    <a
      href={`?page=${page}`}
      onClick={(e) => {
        e.preventDefault();
        openPage(page);
      }}
    >
      {children}
    </a>
  );
}

export interface Turn {
  key: number;
  question: string;
  answer: KevinAnswer | null;
  /** Shown instead of an answer: why there is none. */
  note: string | null;
  signature: RecordedAsk["questions"][number]["signature"];
  recorded: boolean;
  pending: boolean;
}

export function AskPage({ source }: { source: Source }) {
  const { value, error } = useRead(readRecordedAsk, "recorded answers");
  if (!value) return <Loading error={error} what="Kevin's recorded answers" />;
  return <AskKevin recorded={value} live={source.live} />;
}

export function AskKevin({ recorded, live }: { recorded: RecordedAsk; live: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const counter = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.pending);
  const anyRecorded = recorded.questions.some((q) => q.answer);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const key = ++counter.current;
    const fromRecording = recorded.questions.find((r) => r.question === q);
    if (!live) {
      setTurns((t) => [
        ...t,
        {
          key,
          question: q,
          answer: fromRecording?.answer ?? null,
          note: fromRecording?.answer ? null : NOT_YET,
          signature: fromRecording?.signature ?? null,
          recorded: true,
          pending: false,
        },
      ]);
      return;
    }
    const pending: Turn = {
      key,
      question: q,
      answer: null,
      note: null,
      signature: null,
      recorded: false,
      pending: true,
    };
    setTurns((t) => [...t, pending]);
    setDraft("");
    const done = (patch: Partial<Turn>) =>
      setTurns((t) => t.map((x) => (x.key === key ? { ...x, ...patch, pending: false } : x)));
    try {
      const answer = await askApi(q);
      const signed =
        answer.recorded && fromRecording?.answer?.model.chatId === answer.model.chatId
          ? fromRecording.signature
          : null;
      done({ answer, signature: signed, recorded: Boolean(answer.recorded) });
    } catch (e) {
      done({ note: (e as Error).message });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  return (
    <div className="ask">
      <section className="card-v2 ask-start" aria-label="Ask Kevin">
        <p className="small muted">
          {live
            ? "Kevin answers from the plant's records and cites each one. He explains and proposes; he never places, approves or pays from here."
            : anyRecorded
              ? "This replay answers the suggested questions from Kevin's recorded, signed answers. Run the API with a NEAR AI key to ask anything."
              : `This replay answers the suggested questions from Kevin's recorded answers. ${NOT_YET}`}
        </p>
        <fieldset className="ask-chips">
          <legend className="sr-only">Suggested questions</legend>
          {recorded.questions.map((q) => (
            <button
              key={q.question}
              type="button"
              className="ask-chip"
              disabled={busy}
              onClick={() => void ask(q.question)}
            >
              {q.question}
            </button>
          ))}
        </fieldset>
        <form className="ask-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="ask-input">
            Your question for Kevin
          </label>
          <input
            id="ask-input"
            className="ask-input"
            value={draft}
            maxLength={300}
            disabled={!live || busy}
            placeholder={
              live
                ? "Ask Kevin about an order, a lot, a supplier…"
                : "Live questions need the running API"
            }
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!live || busy || !draft.trim()}>
            Ask
          </button>
        </form>
      </section>

      {turns.length > 0 && (
        <ol className="ask-turns" aria-live="polite">
          {turns.map((t) => (
            <li key={t.key} className="ask-turn">
              <p className="ask-q">{t.question}</p>
              <AnswerCard turn={t} enclave={recorded.enclave} />
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
    </div>
  );
}

export function AnswerCard({ turn, enclave }: { turn: Turn; enclave: RecordedAsk["enclave"] }) {
  if (turn.pending)
    return <section className="card-v2 ask-a muted">Kevin is reading the records…</section>;
  const a = turn.answer;
  if (!a) return <section className="card-v2 ask-a muted">{turn.note}</section>;
  return (
    <section className="card-v2 ask-a" aria-label="Kevin's answer">
      <p className="ask-text">
        {withCitations(a.answer, a.citations).map((part) =>
          part.cite ? (
            <PageLink key={part.at} page={part.cite.page}>
              {part.text}
            </PageLink>
          ) : (
            <span key={part.at}>{part.text}</span>
          ),
        )}
      </p>
      {a.citations.length > 0 && (
        <p className="ask-cites small">
          <span className="muted">Records: </span>
          {a.citations.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              <PageLink page={c.page}>{c.title}</PageLink>
            </span>
          ))}
        </p>
      )}
      {a.proposal && (
        <p className="ask-proposal small">
          <strong>Proposal:</strong> {a.proposal.text}{" "}
          <PageLink page={a.proposal.page}>
            Open {LABELS.get(a.proposal.page) ?? a.proposal.page} →
          </PageLink>
        </p>
      )}
      {a.rejected.length > 0 && (
        <p className="small muted">
          Kevin's check caught {a.rejected.flat().join(", ")}, which the records do not hold, and
          {a.answered ? " asked again." : " withheld the answer."}
        </p>
      )}
      <ModelChip answer={a} signature={turn.signature} enclave={enclave} recorded={turn.recorded} />
    </section>
  );
}

function ModelChip({
  answer,
  signature,
  enclave,
  recorded,
}: {
  answer: KevinAnswer;
  signature: Turn["signature"];
  enclave: RecordedAsk["enclave"];
  recorded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const m = answer.model;
  const verified = (checks: Check[]) => checks.filter((c) => c.status === "verified").length;
  return (
    <div className="ask-model">
      <button
        type="button"
        className={m.attested ? "ask-badge signed" : "ask-badge fallback"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {m.attested ? "Signed in enclave ✓" : "Fallback model · not attested"}
      </button>
      {recorded && <span className="ask-recorded small">recorded answer</span>}
      {open && (
        <dl className="ask-details small">
          <dt>Model</dt>
          <dd>
            {m.model} (
            {m.provider === "nearai" ? "NEAR AI Cloud" : "Anthropic, outside the enclave"})
          </dd>
          {m.attested && enclave && (
            <>
              <dt>Enclave</dt>
              <dd>
                {enclave.tier}: {verified(enclave.checks)} of {enclave.checks.length} enclave checks
                verified (report fetched {enclave.fetchedAt.slice(0, 10)})
              </dd>
            </>
          )}
          {m.chatId && (
            <>
              <dt>Answer</dt>
              <dd>
                chat {m.chatId}
                {signature
                  ? `: ${verified(signature.checks)} of ${signature.checks.length} signature checks verified`
                  : ": signed by the enclave; npm run attest checks the signature"}
              </dd>
            </>
          )}
          {!m.attested && (
            <>
              <dt>Why</dt>
              <dd>
                NEAR AI Cloud did not answer, so the labeled fallback model did; no enclave signed
                it.
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
