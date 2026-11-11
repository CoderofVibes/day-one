// Behind the curtain: the auditor's view. Every account in the run with what it signed and who
// paid its gas, the contract's ledger line, one card per transaction in order with the
// contract's own words on a refusal, and the attestation of Kevin's model folded into two chips.
// Dark in both themes. Dollars never lead here; staff never see it.

import { useEffect, useRef } from "react";
import { type Card, type PageCards, pageCards } from "./curtainScope.ts";
import { readRecorded } from "./reads.ts";
import {
  type Attestation,
  type Check,
  type DecisionEvidence,
  type RunData,
  shortAccount,
  type Transaction,
  transactionsThrough,
} from "./run.ts";
import { useRead } from "./series.ts";
import type { PageId } from "./shell.tsx";

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
            {unverified ? "✗" : "✓"} {result.answers.length} signed answers in this run
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

/**
 * The latest signed decision the run has sent up to a step, and what the contract did with it:
 * the submission that carried it, an earlier refused submission of the same PO and response, and
 * whether a director's approval came before it. Null before any decision-bearing submission.
 */
export function decisionAt(data: RunData, upTo: number) {
  const txs = transactionsThrough(data, upTo).map((x) => x.tx);
  const at = txs.findLast((t) => t.decision);
  const ev = at?.decision;
  if (!at || !ev) return null;
  const before = txs.slice(0, txs.indexOf(at));
  const sameRefused = before.find(
    (t) =>
      t.status === "refused" &&
      t.decision?.poHash === ev.poHash &&
      t.decision?.responseSha256 === ev.responseSha256,
  );
  const approved = before.some((t) => t.method === "approve_po" && t.status === "success");
  return { tx: at, ev, sameRefused, approved };
}

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Kevin's signed decision beside the contract's answer (docs/astra/2026-11-04_Complexity.md §G):
 * the signature says the answer is authentic; the outcome line says what the spending rule did.
 * Built from the recording only; a missing or unverified link says so instead of a green badge.
 */
export function DecisionCard({ data, upTo }: { data: RunData; upTo: number }) {
  const d = decisionAt(data, upTo);
  if (!d) return null;
  const { tx, ev, sameRefused, approved } = d;
  const refused = tx.status === "refused";
  const outcome = refused
    ? `refused${/director approval required/.test(tx.error ?? "") ? ", Linda's approval required" : ""}`
    : approved
      ? "funded after Linda approved"
      : "funded";
  const hex = (s: string) => <code className="hash">{s}</code>;
  return (
    <section className="decision" aria-label="Kevin's signed decision">
      <h3>{ev.poId} · Model decision</h3>
      <p className="dim">
        {ev.qtyKg !== null ? `${ev.qtyKg.toLocaleString("en-US")} kg · ` : ""}
        {ev.supplier.replace(/.testnet$/, "")} · {dollars(ev.amount)}
      </p>
      <p className="verdict">
        {ev.namesThisPo
          ? "APPROVE: the response names this PO's fingerprint"
          : ev.verdict
            ? `The response does not approve this PO's fingerprint`
            : "No verdict in the recorded response"}
      </p>
      <p className={ev.verified ? "sig ok" : "sig bad"}>
        {ev.verified
          ? "✓ Recorded signature check: verified"
          : `✗ Signed decision unverified in this recording: ${ev.failed}`}
      </p>
      <p className="dim">Model: {ev.model} · NEAR AI Cloud</p>
      <p className={`outcome ${refused ? "refused" : "funded"}`}>Contract result: {outcome}</p>
      {!refused && sameRefused && (
        <p className="dim small">Same PO fingerprint and signed response as the refused attempt.</p>
      )}
      {!refused && approved && (
        <p className="dim small">
          Director approval: signed with the director account's key, held by the server in this
          demo. It is a separate signature from the model's.
        </p>
      )}
      <details>
        <summary>Signature and recording</summary>
        <dl>
          <dt>Signed response excerpt</dt>
          <dd>{hex(ev.verdict || "none")}</dd>
          <dt>PO fingerprint</dt>
          <dd>{hex(ev.poHash)}</dd>
          <dt>Model signer</dt>
          <dd>{hex(ev.signer ?? "not found")}</dd>
          <dt>Chat</dt>
          <dd>{hex(ev.chatId)}</dd>
          <dt>Request / response SHA-256</dt>
          <dd>
            {hex(ev.requestSha256)} {hex(ev.responseSha256)}
          </dd>
          <dt>Submissions carrying it</dt>
          <dd>
            {[sameRefused, tx]
              .filter((t) => t?.url)
              .map((t) => (
                <a key={t?.tx} href={t?.url ?? ""} target="_blank" rel="noreferrer">
                  {t?.status === "refused" ? "refused" : "funded"} {t?.tx.slice(0, 8)}… ↗{" "}
                </a>
              ))}
          </dd>
        </dl>
        <p className="dim small">
          This recorded signature ties the answer to an attested model key and this PO's
          fingerprint. It does not prove the supplied facts are true or the purchase is correct. HQ
          registers the signer after checking attestation; the contract checks the signature.
          Instances of the model share a signing key. Re-check: npm run verify:attestation.
        </p>
      </details>
    </section>
  );
}

/** One transaction: method, signer, gas payer, events, the contract's words on a refusal, the explorer. */
export function TxItem({ tx, fresh = false }: { tx: Transaction; fresh?: boolean }) {
  return (
    <li
      className={`tx ${tx.status}${fresh ? " fresh" : ""}`}
      aria-current={fresh ? "step" : undefined}
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
  );
}

/** A transaction a recorded attack sent: which attack, what the contract said, the link. */
function AttackCard({ card }: { card: Extract<Card, { kind: "attack" }> }) {
  return (
    <li className="tx attack">
      <div className="head">
        <code>{card.attack}</code>
        <span className="st">held</span>
      </div>
      {card.said && <p className="why">“{card.said}”</p>}
      {card.url ? (
        <a href={card.url} target="_blank" rel="noreferrer">
          {card.hash.slice(0, 10)}… on the explorer ↗
        </a>
      ) : (
        <code className="dim">{card.hash.slice(0, 10)}…</code>
      )}
    </li>
  );
}

/**
 * Behind the curtain beside a page: with `page`, the transactions that page cares about
 * (src/curtainScope.ts), or the latest recorded when it has none yet; without, every
 * transaction of the run up to the step (the video page).
 */
export function Curtain({ data, upTo, page }: { data: RunData; upTo: number; page?: PageId }) {
  return page ? (
    <PageCurtain data={data} upTo={upTo} page={page} />
  ) : (
    <CurtainBody data={data} upTo={upTo} view={null} />
  );
}

function PageCurtain({ data, upTo, page }: { data: RunData; upTo: number; page: PageId }) {
  const { value: recorded } = useRead(() => readRecorded(), "recorded");
  return <CurtainBody data={data} upTo={upTo} view={pageCards(page, data, upTo, recorded)} />;
}

function CurtainBody({
  data,
  upTo,
  view,
}: {
  data: RunData;
  upTo: number;
  view: PageCards | null;
}) {
  const pane = useRef<HTMLElement>(null);
  const txs = transactionsThrough(data, upTo);
  const cards: Card[] =
    view?.cards ?? txs.map(({ stepIndex, tx }) => ({ kind: "tx", tx, stepIndex }));
  const count = view
    ? `${view.fallback ? 0 : view.cards.length} on this page · ${view.total} recorded across every run`
    : txs.length === 1
      ? "1 transaction"
      : `${txs.length} transactions`;
  // Lines without a transaction: the opening budget (step 0) and the closing summary.
  const notes = (from: number, to: number) =>
    data.steps
      .slice(from, to)
      .flatMap((s) =>
        s.chain
          .filter((c) => !c.tx)
          // The closing count is this order's run alone, not every recorded run.
          .map((c) =>
            c.line.replace(/^chain:\s*/, "").replace(/^(\d+ transactions)/, "This order's run: $1"),
          ),
      )
      .map((n) => (
        <p key={n} className="ledger">
          {n}
        </p>
      ));

  // Follow the newest transaction when the run moves; not on mount, so opening the curtain on
  // another screen does not scroll the page. Beside the page (the sticky rail of a wide screen)
  // the rail scrolls itself; under the page (a phone) nothing moves, so the reader keeps their
  // place instead of being carried to the bottom of the rail.
  const seen = useRef(upTo);
  useEffect(() => {
    if (seen.current === upTo) return;
    seen.current = upTo;
    const fresh = pane.current?.querySelector(".fresh");
    const rail = pane.current?.closest<HTMLElement>(".rail-v2");
    if (!fresh) return;
    if (!rail) {
      fresh.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (getComputedStyle(rail).position !== "sticky") return;
    const r = fresh.getBoundingClientRect();
    const p = rail.getBoundingClientRect();
    if (r.bottom > p.bottom) rail.scrollBy({ top: r.bottom - p.bottom + 12, behavior: "smooth" });
    else if (r.top < p.top) rail.scrollBy({ top: r.top - p.top - 12, behavior: "smooth" });
  }, [upTo]);

  return (
    <section ref={pane} className="curtain" aria-label="Behind the curtain">
      <div className="panel-head">
        <h2>Behind the curtain · NEAR {data.network}</h2>
        <span className="right small dim">{count}</span>
      </div>
      <DecisionCard data={data} upTo={upTo} />
      <Accounts data={data} upTo={upTo} />
      {notes(0, 1)}
      {data.attestation && <Attested result={data.attestation} />}
      {view?.fallback && (
        <div className="recent">
          <h3>Recent on testnet</h3>
          <p className="dim small">
            No calls from this page yet. The last calls recorded in the run:
          </p>
        </div>
      )}
      <ol className="txs">
        {cards.map((c) =>
          c.kind === "tx" ? (
            <TxItem key={c.tx.tx} tx={c.tx} fresh={c.stepIndex === upTo} />
          ) : (
            <AttackCard key={c.hash} card={c} />
          ),
        )}
      </ol>
      {cards.length === 0 && <p className="dim">No transactions yet.</p>}
      {notes(1, upTo + 1)}
    </section>
  );
}
