import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Audience,
  audienceOf,
  run,
  type Step,
  shortAccount,
  transactionsThrough,
} from "./run.ts";

const PLAY_MS = 2600;

export function App() {
  const last = run.steps.length - 1;
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

  const current = run.steps[at] as Step;

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
        <label className="switch">
          <input type="checkbox" checked={curtain} onChange={(e) => setCurtain(e.target.checked)} />
          <span>Behind the curtain</span>
        </label>
      </header>

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
        <StaffFeed upTo={at} onPick={go} curtain={curtain} />
        {curtain && <Curtain upTo={at} />}
      </main>

      <footer className="muted foot">
        Replay of a run recorded on NEAR {run.network} on{" "}
        {new Date(run.recordedAt).toISOString().slice(0, 10)}. All companies, people and numbers are
        fictional.
      </footer>
    </div>
  );
}

function StaffFeed({
  upTo,
  onPick,
  curtain,
}: {
  upTo: number;
  onPick: (i: number) => void;
  curtain: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the step changes
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [upTo]);

  return (
    <section className="pane feed" aria-label="What plant staff see">
      <h2>Plant floor</h2>
      {run.steps.slice(0, upTo + 1).map((step, i) => {
        const who = audienceOf(step);
        if (who.channel === "none") return null;
        return (
          <button
            type="button"
            key={`${step.step}-${step.title}`}
            className={i === upTo ? "card current" : "card"}
            onClick={() => onPick(i)}
          >
            <Who who={who} title={step.title} />
            {who.channel === "phone" ? <Phone step={step} /> : <Lines lines={step.staff} />}
          </button>
        );
      })}
      {audienceOf(run.steps[upTo] as Step).channel === "none" && (
        <p className="muted aside">
          Nothing changes on the plant floor at this step.
          {!curtain && " Turn on “Behind the curtain” to see it."}
        </p>
      )}
      <div ref={end} />
    </section>
  );
}

function Who({ who, title }: { who: Audience; title: string }) {
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
        <strong>{who.name}</strong> <span className="muted">· {who.role}</span>
      </span>
      <span className="tag">{title}</span>
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

function Phone({ step }: { step: Step }) {
  const approval = run.approvals[0];
  return (
    <div className="phone">
      <div className="phone-head muted">Text message · Kevin</div>
      {approval && <p className="bubble in">{approval.request}</p>}
      {approval?.response && <p className="bubble out">{approval.response}</p>}
      <Lines lines={step.staff.map((l) => l.replace(/^.*→\s*/, ""))} />
    </div>
  );
}

function Curtain({ upTo }: { upTo: number }) {
  const pane = useRef<HTMLElement>(null);
  const txs = transactionsThrough(upTo);
  // Lines without a transaction: the opening budget (step 0) and the closing summary.
  const notes = (from: number, to: number) =>
    run.steps
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
      <h2>Behind the curtain · NEAR {run.network}</h2>
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
            <a href={tx.url} target="_blank" rel="noreferrer">
              {tx.tx.slice(0, 10)}… on the explorer ↗
            </a>
          </li>
        ))}
      </ol>
      {txs.length === 0 && <p className="muted">No transactions yet.</p>}
      {notes(1, upTo + 1)}
    </section>
  );
}
