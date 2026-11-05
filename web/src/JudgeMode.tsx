// Judge mode (brief §5.12): the header's "Judge mode" button or ?judge=1. Dark theme, the curtain
// on, the recorded run from its start, and a stepper docked at the bottom (a bottom sheet on a
// phone) that walks the six core stops of src/judge.ts: each opens its page at its recorded step,
// cuts a spotlight round what to look at, says what happened in a sentence or two and links the
// recorded testnet transactions. Then "See every proof" opens any of the other proofs the same way
// and lists every transaction. Recorded data only: no wallet, no login, no network.

import { useEffect, useRef, useState } from "react";
import { storedTheme } from "./chrome.ts";
import usdc from "./data/usdc.json";
import {
  attestation,
  JUDGE_STEPS,
  type JudgeStep,
  LIMIT_REQUEST,
  limitDraft,
  PROOF_STEPS,
  proofLinks,
  RECORDED_POLICY,
  remaining,
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
  if (step.links.length === 0 && !step.open) return null;
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
      {step.open && (
        <li key={step.open.url}>
          <a href={step.open.url} target="_blank" rel="noreferrer">
            Open it ↗
          </a>{" "}
          <small>{step.open.label}</small>
        </li>
      )}
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
        {usdc.status.toLowerCase()}. This deployment runs the first contract version.
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

const units = (u: string) => usd(Number(u) / 1e6);

/** Kevin's recorded limits as the contract holds them: nothing else on the core stop. */
function LimitsCard() {
  const p = RECORDED_POLICY;
  return (
    <section className="judge-card" aria-label="Kevin's limits">
      <h3>Kevin's limits, on the contract</h3>
      <p className="small">As the recorded run read them</p>
      <p className="judge-chips">
        <span>{units(p.perPoLimit)} per order</span>
        <span>{units(p.monthlyLimit)} a month</span>
        <span>over that: Linda approves</span>
      </p>
    </section>
  );
}

/** HQ's request in plain words and Kevin's draft of the owner call, from the recorded policy. */
function PolicyCard() {
  const draft = limitDraft();
  return (
    <section className="judge-card" aria-label="A limit change in plain words">
      <h3>A limit change in plain words</h3>
      <p className="small">An unsigned example; the recorded limit stays $2,500</p>
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

/** "See every proof": each proof opens like a step; every transaction folded below. */
function Summary({
  onBack,
  onExit,
  onOpen,
}: {
  onBack: () => void;
  onExit: () => void;
  onOpen: (k: number) => void;
}) {
  const links = proofLinks();
  const tests = testCount();
  return (
    <div className="judge-summary">
      <h2>See every proof</h2>
      <p className="small">
        Choose a claim to inspect its recording, checks and limitations.{" "}
        {tests
          ? `${tests.tests.toLocaleString("en-US")} automated tests passed in the last full run (${tests.at.slice(0, 10)}); npm run prove checks every claim with no keys.`
          : "npm run prove checks every claim with no keys."}
      </p>
      <ol className="judge-proof-list">
        {PROOF_STEPS.map((s, k) => (
          <li key={s.id}>
            <button type="button" onClick={() => onOpen(k)}>
              {s.title} →
            </button>
          </li>
        ))}
      </ol>
      <details className="judge-all">
        <summary>All {links.length} recorded testnet transactions in judge mode</summary>
        <ol className="judge-proofs">
          {links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            </li>
          ))}
        </ol>
      </details>
      <div className="judge-controls">
        <button type="button" onClick={onBack}>
          ← Back
        </button>
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
  // The latest go(): a prelude timer must not call the one from the render that started it, which
  // still thinks the page is the one before the prelude.
  const goRef = useRef(go);
  goRef.current = go;
  const total = JUDGE_STEPS.length;
  const [i, setI] = useState(() => (start === "summary" ? total : Math.min(start, total - 1)));
  /** A proof opened from the summary (an index into PROOF_STEPS), or null. */
  const [proof, setProof] = useState<number | null>(null);
  /** True while a step's prelude page is showing. */
  const [preluding, setPreluding] = useState(false);
  const step: JudgeStep | undefined =
    proof !== null ? PROOF_STEPS[proof] : i < total ? JUDGE_STEPS[i] : undefined;

  // Each step opens its page at its recorded step; a prelude shows its own page first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a step opens once, when it is reached
  useEffect(() => {
    setJudgeParam(proof !== null || i >= total ? "summary" : String(i + 1));
    setPreluding(false);
    if (!step) {
      setParam("attack", null);
      setCurtain(true);
      return;
    }
    setParam("attack", step.attack ? String(step.attack) : null);
    setCurtain(step.curtain !== false);
    if (!step.prelude) {
      goRef.current(step.page, step.at);
      return;
    }
    setPreluding(true);
    goRef.current(step.prelude.page, step.prelude.at);
    const t = setTimeout(() => {
      setPreluding(false);
      goRef.current(step.page, step.at);
    }, step.prelude.ms);
    return () => clearTimeout(t);
  }, [i, proof]);

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

  const spotlight = preluding ? step?.prelude?.spotlight : step?.spotlight;
  const overlay = preluding ? undefined : step?.overlay;

  return (
    <>
      {spotlight && <Spotlight key={spotlight} selector={spotlight} />}
      {overlay && (
        <div className={`judge-overlay ${overlay}`}>
          {overlay === "phone" && <LindaPhone curtain replied />}
          {overlay === "usdc" && <UsdcCard />}
          {overlay === "limits" && <LimitsCard />}
          {overlay === "policy" && <PolicyCard />}
          {overlay === "attestation" && <AttestationCard />}
          {overlay === "tour" && <TourCard />}
        </div>
      )}
      <section className="judge-bar" aria-label="Judge mode" data-step={step?.id ?? "summary"}>
        <div className="judge-head">
          <span className="judge-badge">Judge mode</span>
          <span className="small">
            {proof !== null
              ? "Every proof"
              : step
                ? `Step ${i + 1} of ${total} · ${remaining(i)}`
                : "Every proof"}
          </span>
          <ol className="judge-dots" aria-label="Steps">
            {JUDGE_STEPS.map((s, n) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`Step ${n + 1}: ${s.title}`}
                  aria-current={proof === null && n === i ? "step" : undefined}
                  className={proof !== null || n < i ? "done" : undefined}
                  onClick={() => {
                    setProof(null);
                    setI(n);
                  }}
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
            {proof !== null ? (
              <div className="judge-controls">
                <button type="button" className="judge-primary" onClick={() => setProof(null)}>
                  ← Every proof
                </button>
                <button type="button" onClick={exit}>
                  Exit
                </button>
              </div>
            ) : (
              <div className="judge-controls">
                <button type="button" onClick={() => setI(i - 1)} disabled={i === 0}>
                  ← Back
                </button>
                <button type="button" className="judge-primary" onClick={() => setI(i + 1)}>
                  {i === total - 1 ? "See every proof →" : "Next →"}
                </button>
                {i < total - 1 && (
                  <button type="button" onClick={() => setI(total)}>
                    Every proof
                  </button>
                )}
                <button type="button" onClick={exit}>
                  Exit
                </button>
              </div>
            )}
          </>
        ) : (
          <Summary onBack={() => setI(total - 1)} onExit={exit} onOpen={(k) => setProof(k)} />
        )}
      </section>
    </>
  );
}
