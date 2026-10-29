// Behind the curtain: the auditor's view. Every account in the run with what it signed and who
// paid its gas, the contract's ledger line, one card per transaction in order with the
// contract's own words on a refusal, and the attestation of Kevin's model folded into two chips.
// Dark in both themes. Dollars never lead here; staff never see it.

import { useEffect, useRef } from "react";
import {
  type Attestation,
  type Check,
  type RunData,
  shortAccount,
  transactionsThrough,
} from "./run.ts";

const MARK: Record<Check["status"], string> = { verified: "✓", unverified: "✗", skipped: "–" };

/** Who signed what in this run, and who paid for it: the account tree as the chain saw it. */
export function Accounts({ data, upTo }: { data: RunData; upTo?: number }) {
  const txs =
    upTo === undefined ? data.transactions : transactionsThrough(data, upTo).map((t) => t.tx);
  const bySigner = new Map<string, { methods: Set<string>; paidBy: Set<string> }>();
  for (const tx of txs) {
    const row = bySigner.get(tx.signer) ?? { methods: new Set(), paidBy: new Set() };
    row.methods.add(tx.method);
    if (tx.paidBy !== tx.signer) row.paidBy.add(tx.paidBy);
    bySigner.set(tx.signer, row);
  }
  if (bySigner.size === 0) return null;
  return (
    <div className="acct">
      {[...bySigner].map(([signer, row]) => (
        <div key={signer} className="acct-row">
          <code>{shortAccount(signer)}</code>
          <span>
            {[...row.methods].join(", ")}
            {row.paidBy.size > 0 && (
              <span className="dim"> · gas paid by {[...row.paidBy].join(", ")}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The hardware enclave Kevin's model ran in and the signature of each recorded answer, from
 * server/src/attestation (research 10): two chips, the full list behind a disclosure.
 */
function Attested({ result }: { result: Attestation }) {
  const checks = [...result.enclave, ...result.answers.flatMap((a) => a.checks)];
  const unverified = checks.filter((c) => c.status === "unverified").length;
  return (
    <details className="attest">
      <summary>
        <span className="attest-title">Kevin's model ran in a hardware enclave</span>
        <span className="chips">
          <span className={unverified ? "chip bad" : "chip"}>
            {unverified ? "✗" : "✓"} {result.enclave.length} enclave checks
          </span>
          <span className={unverified ? "chip bad" : "chip"}>
            {unverified ? "✗" : "✓"} {result.answers.length} signed answers
          </span>
        </span>
      </summary>
      <p className="ledger">
        {result.model} · NEAR AI Cloud {result.tier} · report{" "}
        {result.fetchedAt.slice(0, 16).replace("T", " ")}Z · nonce {result.nonce.slice(0, 8)}…
      </p>
      <ul className="checks">
        {result.enclave.map((c) => (
          <li key={c.name} className={`check ${c.status}`} title={c.detail}>
            {MARK[c.status]} {c.name}
          </li>
        ))}
      </ul>
      <ol className="answers">
        {result.answers.map((a) => (
          <li
            key={a.chatId}
            className={a.checks.some((c) => c.status === "unverified") ? "unverified" : undefined}
          >
            <span className="task">{a.task}</span> chat {a.chatId.slice(0, 8)}… · request{" "}
            {a.requestSha256.slice(0, 8)}… · response {a.responseSha256.slice(0, 8)}… ·{" "}
            {a.checks.map((c) => `${MARK[c.status]} ${c.name}`).join(" · ")}
          </li>
        ))}
      </ol>
      <p className="dim small">
        {unverified === 0 ? "Every check verified" : `${unverified} checks unverified`}; npm run
        verify:attestation re-checks it with no key. Every instance of a model shares one signing
        key, so the signer proves an attested instance of this model answered, not which one.
      </p>
    </details>
  );
}

export function Curtain({ data, upTo }: { data: RunData; upTo: number }) {
  const pane = useRef<HTMLElement>(null);
  const txs = transactionsThrough(data, upTo);
  // Lines without a transaction: the opening budget (step 0) and the closing summary.
  const notes = (from: number, to: number) =>
    data.steps
      .slice(from, to)
      .flatMap((s) => s.chain.filter((c) => !c.tx).map((c) => c.line.replace(/^chain:\s*/, "")))
      .map((n) => (
        <p key={n} className="ledger">
          {n}
        </p>
      ));

  // Follow the newest transaction when the run moves; not on mount, so opening the curtain on
  // another screen does not scroll the page.
  const seen = useRef(upTo);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest transaction
  useEffect(() => {
    if (seen.current === upTo) return;
    seen.current = upTo;
    pane.current?.querySelector(".fresh")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [upTo]);

  return (
    <section ref={pane} className="curtain" aria-label="Behind the curtain">
      <div className="panel-head">
        <h2>Behind the curtain · NEAR {data.network}</h2>
        <span className="right small dim">
          {txs.length === 1 ? "1 transaction" : `${txs.length} transactions`}
        </span>
      </div>
      <Accounts data={data} upTo={upTo} />
      {notes(0, 1)}
      {data.attestation && <Attested result={data.attestation} />}
      <ol className="txs">
        {txs.map(({ stepIndex, tx }) => (
          <li
            key={tx.tx}
            className={`tx ${tx.status}${stepIndex === upTo ? " fresh" : ""}`}
            aria-current={stepIndex === upTo ? "step" : undefined}
          >
            <div className="head">
              <code>{tx.method}</code>
              <span className="st">{tx.status === "refused" ? "✗ refused" : "✓"}</span>
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
            {tx.error && <p className="why">“{tx.error}”</p>}
            {tx.url && (
              <a href={tx.url} target="_blank" rel="noreferrer">
                {tx.tx.slice(0, 10)}… on the explorer ↗
              </a>
            )}
          </li>
        ))}
      </ol>
      {txs.length === 0 && <p className="dim">No transactions yet.</p>}
      {notes(1, upTo + 1)}
    </section>
  );
}
