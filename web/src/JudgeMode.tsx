// Judge mode (brief §5.12): the header's "Judge mode" button or ?judge=1. Dark theme, the curtain
// on, the recorded run from its start, and a stepper docked at the bottom (a bottom sheet on a
// phone) that walks the eleven steps of src/judge.ts: each opens its page at its recorded step,
// cuts a spotlight round what to look at, says what happened in a sentence or two and links the
// recorded testnet transactions. Recorded data only: no wallet, no login, no network.

import { useEffect, useState } from "react";
import { storedTheme } from "./chrome.ts";
import usdc from "./data/usdc.json";
import {
  attestation,
  JUDGE_STEPS,
  type JudgeStep,
  LIMIT_REQUEST,
  limitDraft,
  proofLinks,
  RECORDED_POLICY,
  remaining,
  savingLine,
  TOUR_URL,
  testCount,
  usd,
} from "./judge.ts";
import { LindaPhone } from "./Phone.tsx";
import { Spotlight } from "./Spotlight.tsx";
import type { PageId } from "./shell.tsx";
import "./judge.css";

/** The page's theme while judge mode is open: dark, put back as it was on exit. */
function useDarkWhileOpen() {
  useEffect(() => {
    const root = document.documentElement;
    const was = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    document.body.classList.add("judge-open");
    return () => {
      const stored = storedTheme();
      if (stored !== "system") root.setAttribute("data-theme", stored);
      else if (was) root.setAttribute("data-theme", was);
      else root.removeAttribute("data-theme");
      document.body.classList.remove("judge-open");
    };
  }, []);
}

function setParam(name: string, value: string | null) {
  const q = new URLSearchParams(location.search);
  if (value === null) q.delete(name);
  else q.set(name, value);
  const search = q.toString();
  history.replaceState(null, "", search ? `?${search}` : location.pathname);
}
const setJudgeParam = (value: string | null) => setParam("judge", value);

function ChainLinks({ step }: { step: JudgeStep }) {
  if (step.links.length === 0) return null;
  return (
    <ul className="judge-links">
      {step.links.map((l) => (
        <li key={l.url}>
          <a href={l.url} target="_blank" rel="noreferrer">
            See it on chain ↗
          </a>{" "}
          <small>{l.label}</small>
        </li>
      ))}
    </ul>
  );
}

/** PO-1047 in USDC: the order and its five recorded calls (judge mode and the tour). */
export function UsdcCard() {
  return (
    <section className="judge-card" aria-label={`${usdc.po} in USDC`}>
      <h3>
        {usdc.po} · ${usdc.amountUsdc} in Circle testnet USDC
      </h3>
      <p className="small">
        <code>{usdc.contract}</code> paid <code>{usdc.supplier}</code>; the order is{" "}
        {usdc.status.toLowerCase()}.
      </p>
      <ol className="judge-calls">
        {usdc.calls.map((c) => (
          <li key={c.tx}>
            <span className="ok">✓</span> {c.call}{" "}
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.tx.slice(0, 8)}… ↗
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** HQ's request in plain words and Kevin's draft of the owner call, from the recorded policy. */
function LimitsCard() {
  const p = RECORDED_POLICY;
  const draft = limitDraft();
  const units = (u: string) => usd(Number(u) / 1e6);
  return (
    <section className="judge-card" aria-label="Kevin's limits">
      <h3>Kevin's limits, on the contract</h3>
      <p className="judge-chips">
        <span>{units(p.perPoLimit)} per order</span>
        <span>{units(p.monthlyLimit)} a month</span>
        <span>over that: Linda approves</span>
      </p>
      <p className="small">HQ asks: “{LIMIT_REQUEST}”</p>
      <p className="small">Kevin's draft: {draft.sentence}</p>
      <p className="small">Try other wording:</p>
      <pre>npm run policy -- "{LIMIT_REQUEST}"</pre>
    </section>
  );
}

function AttestationCard() {
  const a = attestation();
  return (
    <section className="judge-card" aria-label="Attestation">
      <h3>Kevin's model ran in a hardware enclave</h3>
      <p className="judge-chips">
        <span>
          ✓ {a.checks} of {a.of} enclave checks
        </span>
        <span>✓ {a.answers} signed answers in this run</span>
      </p>
      <p className="small">
        {a.model}, report fetched {a.fetchedAt.slice(0, 10)} and verified again after recording.
        Re-check it, Intel's and NVIDIA's verdicts included:
      </p>
      <pre>npm run verify:attestation</pre>
    </section>
  );
}

function TourCard() {
  return (
    <section className="judge-card" aria-label="The tour">
      <h3>The tour</h3>
      <p className="small">
        The whole run in about two and a half minutes, in 3D, with captions. Space pauses, → skips a
        beat, R starts over.
      </p>
      <a className="judge-primary" href={TOUR_URL}>
        Play the tour (T)
      </a>
    </section>
  );
}

function Summary({ onBack, onExit }: { onBack: () => void; onExit: () => void }) {
  const links = proofLinks();
  const tests = testCount();
  return (
    <div className="judge-summary">
      <h2>Every proof, in one list</h2>
      <p className="small">
        {links.length} recorded testnet transactions, each opening on the explorer.{" "}
        {tests
          ? `${tests.tests.toLocaleString("en-US")} automated tests passed in the last full run (${tests.at.slice(0, 10)}): npm run check.`
          : "The automated tests run with npm run check; the attacks alone with npm run test:attacks."}
      </p>
      <p className="small">Does Kevin pay for himself? {savingLine()}</p>
      <ol className="judge-proofs">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          </li>
        ))}
      </ol>
      <div className="judge-controls">
        <button type="button" onClick={onBack}>
          ← Back
        </button>
        <a className="judge-primary" href={TOUR_URL}>
          Play the tour
        </a>
        <button type="button" onClick={onExit}>
          Exit judge mode
        </button>
      </div>
    </div>
  );
}

export default function JudgeMode({
  start,
  go,
  setCurtain,
  onExit,
}: {
  /** The step to open (0-based), or the summary. */
  start: number | "summary";
  /** Open a page with the recorded run at a step. */
  go: (page: PageId, at: number) => void;
  setCurtain: (on: boolean) => void;
  onExit: () => void;
}) {
  useDarkWhileOpen();
  const [i, setI] = useState(() =>
    start === "summary" ? JUDGE_STEPS.length : Math.min(start, JUDGE_STEPS.length - 1),
  );
  const step = JUDGE_STEPS[i];
  const total = JUDGE_STEPS.length;

  // Each step opens its page at its recorded step; the first flips the curtain on after a beat,
  // so the judge sees the staff screen first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a step opens once, when it is reached
  useEffect(() => {
    setJudgeParam(i >= total ? "summary" : String(i + 1));
    if (!step) {
      setCurtain(true);
      return;
    }
    setParam("attack", step.attack ? String(step.attack) : null);
    go(step.page, step.at);
    if (step.curtain === false) {
      setCurtain(false);
      return;
    }
    if (step.id !== "kevin") {
      setCurtain(true);
      return;
    }
    setCurtain(false);
    const flip = setTimeout(() => setCurtain(true), 1500);
    return () => clearTimeout(flip);
  }, [i]);

  const exit = () => {
    setJudgeParam(null);
    setParam("attack", null);
    onExit();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") exit();
      else if (e.key === "t" || e.key === "T") location.search = TOUR_URL;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {step?.spotlight && <Spotlight selector={step.spotlight} />}
      {step?.overlay && (
        <div className={`judge-overlay ${step.overlay}`}>
          {step.overlay === "phone" && <LindaPhone curtain replied />}
          {step.overlay === "usdc" && <UsdcCard />}
          {step.overlay === "limits" && <LimitsCard />}
          {step.overlay === "attestation" && <AttestationCard />}
          {step.overlay === "tour" && <TourCard />}
        </div>
      )}
      <section className="judge-bar" aria-label="Judge mode" data-step={step?.id ?? "summary"}>
        <div className="judge-head">
          <span className="judge-badge">Judge mode</span>
          <span className="small">
            {step ? `Step ${i + 1} of ${total} · ${remaining(i)}` : "Summary"}
          </span>
          <ol className="judge-dots" aria-label="Steps">
            {JUDGE_STEPS.map((s, n) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`Step ${n + 1}: ${s.title}`}
                  aria-current={n === i ? "step" : undefined}
                  className={n < i ? "done" : undefined}
                  onClick={() => setI(n)}
                />
              </li>
            ))}
          </ol>
          <button type="button" className="judge-x" onClick={exit} aria-label="Exit judge mode">
            ✕
          </button>
        </div>
        {step ? (
          <>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            {step.quote && <p className="judge-quote">{step.quote}</p>}
            <ChainLinks step={step} />
            <div className="judge-controls">
              <button type="button" onClick={() => setI(i - 1)} disabled={i === 0}>
                ← Back
              </button>
              <button type="button" onClick={() => setI(total)}>
                Skip to summary
              </button>
              <button type="button" onClick={exit}>
                Exit
              </button>
              <button type="button" className="judge-primary" onClick={() => setI(i + 1)}>
                {i === total - 1 ? "Summary →" : "Next →"}
              </button>
            </div>
          </>
        ) : (
          <Summary onBack={() => setI(total - 1)} onExit={exit} />
        )}
      </section>
    </>
  );
}
