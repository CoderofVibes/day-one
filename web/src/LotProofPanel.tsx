// "Prove it" on the Lots & recall page (docs/REFERENCE_IDEAS_PLAN.md, C): the trace on screen is
// mapped to the lot book's records (a lot's receipt, QC decision and the payment of its PO; a
// batch; a shipment), a passport is built for them and checked with web/src/lotProof.ts, the
// same code `npm run verify:lot` runs. Each day's root is read from the contract in parallel
// first, so the check itself is quick and the page can say how far along it is. "Change one
// record" edits one disclosed record in memory and checks again, so a viewer sees what a changed
// record looks like; the book on disk and the chain never move. Staff words only; the day refs,
// roots, accounts and transactions show behind the curtain.

import { useCallback, useEffect, useRef, useState } from "react";
import { dollars, qty } from "./charts.tsx";
import { Pill } from "./feed.tsx";
import { type Genealogy, sha256Hex, type Trace } from "./genealogy.ts";
import {
  checkPassport,
  type EntryCheck,
  type EntryVerdict,
  loadLotBook,
  type OnChainAnchor,
  type Passport,
  type PassportEntry,
  type PassportLeaf,
  passportForKeys,
  readAnchor,
} from "./lotProof.ts";
import type { Tone } from "./run.ts";

export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

// ------------------------------------------------------------------ pure helpers

/**
 * The lot book's keys for a trace: each lot's receipt and QC decision and the payment of its PO,
 * each batch, each shipment, in trace order. Keys the book has no record for (a finished-goods lot
 * has no receipt; a PO paid before Day One has no payment) are left out when the passport is built.
 */
export function traceKeys(g: Genealogy, t: Trace): string[] {
  const keys: string[] = [];
  for (const n of t.nodes) {
    if (n.kind === "lot") {
      keys.push(`receipt:${n.id}`, `qc:${n.id}`);
      const po = g.lots[n.id]?.po;
      if (po) keys.push(`payment:${po}`);
    } else if (n.kind === "batch") keys.push(`batch:${n.id}`);
    else if (n.kind === "shipment") keys.push(`shipment:${n.id}`);
  }
  return [...new Set(keys)];
}

export const KIND_LABEL: Record<PassportLeaf["kind"], string> = {
  receipt: "Receipt",
  qc: "QC",
  payment: "Payment",
  batch: "Batch",
  shipment: "Shipment",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** The supplier a PO paid, by name: the lot bought on it knows its vendor. */
function supplierOfPo(g: Genealogy, po: string): string | null {
  return Object.values(g.lots).find((l) => l.po === po)?.vendorName ?? null;
}

/** One record in staff words: what happened, to which lot or PO, by whom. */
export function recordWords(leaf: PassportLeaf, g: Genealogy, curtain = false): string {
  const r = leaf.record;
  switch (leaf.kind) {
    case "receipt": {
      const lot = g.lots[str(r.lot)];
      const supplier = lot?.vendorName ?? str(r.supplier);
      const amount = lot ? ` · ${qty(num(r.receivedBase), lot.dimension)}` : "";
      return `${str(r.lot)} received from ${supplier}${r.po ? ` on ${str(r.po)}` : ""}${r.receivedBy ? ` by ${str(r.receivedBy)}` : ""}${amount}`;
    }
    case "qc":
      return `${str(r.lot)} QC ${str(r.decision)}${r.decidedBy ? ` by ${str(r.decidedBy)}` : ""}`;
    case "payment": {
      const po = str(r.po);
      const name = supplierOfPo(g, po) ?? (curtain ? str(r.supplier) : "the supplier");
      return `${po} paid: ${dollars(num(r.amountUnits))} to ${name}`;
    }
    case "batch": {
      const b = g.batches[str(r.batch)];
      const outputs = Array.isArray(r.outputs) ? (r.outputs as string[]) : [];
      const made = `${num(r.units).toLocaleString("en-US")} ${b?.productName ?? str(r.product)}`;
      return `Batch ${str(r.batch)} made ${made}${outputs.length ? ` · lot ${outputs.join(", ")}` : ""}`;
    }
    case "shipment": {
      const lots = Array.isArray(r.lots) ? r.lots.length : 0;
      return `Shipment ${str(r.shipment)} to ${str(r.customer)}${lots ? ` · ${lots} ${lots === 1 ? "lot" : "lots"}` : ""}`;
    }
  }
}

export interface VerdictLook {
  label: string;
  tone: Tone;
  /** One sentence on what the verdict means, for the summary and the row's title. */
  means: string;
}

/** A verdict in staff words, or behind the curtain in the checker's own words. */
export function verdictLook(v: EntryVerdict, curtain = false): VerdictLook {
  switch (v) {
    case "proved":
      return {
        label: "Proved",
        tone: "ok",
        means: curtain
          ? "The record leads to its day's root and the contract holds that root."
          : "Matches Acme's sealed daily records.",
      };
    case "path-only":
      return {
        label: curtain ? "Path only" : "Not confirmed",
        tone: "waiting",
        means: curtain
          ? "The record leads to its day's root; the root was not checked on chain (RPC unreachable)."
          : "The record is intact, but the network could not be reached to confirm the seal.",
      };
    case "changed":
      return {
        label: "Changed",
        tone: "refused",
        means: curtain
          ? "The record does not lead to the root it names: it was edited."
          : "This record no longer matches what was sealed.",
      };
    case "not-anchored":
      return {
        label: curtain ? "No anchor" : "Not sealed",
        tone: "refused",
        means: curtain
          ? "The record leads to its root, but the contract holds a different root or none."
          : "Acme's sealed records hold no copy of this day.",
      };
  }
}

export interface Counts {
  total: number;
  proved: number;
  pathOnly: number;
  changed: number;
  notAnchored: number;
}
export function countVerdicts(checks: EntryCheck[]): Counts {
  const c: Counts = { total: checks.length, proved: 0, pathOnly: 0, changed: 0, notAnchored: 0 };
  for (const e of checks) {
    if (e.verdict === "proved") c.proved += 1;
    else if (e.verdict === "path-only") c.pathOnly += 1;
    else if (e.verdict === "changed") c.changed += 1;
    else c.notAnchored += 1;
  }
  return c;
}

/** The headline and the sentence under it, for staff or behind the curtain. */
export function summaryWords(
  c: Counts,
  curtain = false,
): { headline: string; detail: string; tone: "ok" | "wait" | "bad" } {
  const records = c.total === 1 ? "record" : "records";
  if (c.total === 0) {
    return {
      headline: "No records to prove",
      detail: "Nothing in this trace has a sealed copy yet.",
      tone: "wait",
    };
  }
  if (c.changed || c.notAnchored) {
    const parts = [`${c.proved} of ${c.total} ${records} proved`];
    if (c.changed) parts.push(`${c.changed} changed`);
    if (c.notAnchored) parts.push(`${c.notAnchored} ${curtain ? "with no anchor" : "not sealed"}`);
    if (c.pathOnly) parts.push(`${c.pathOnly} not confirmed`);
    return {
      headline: parts.join(" · "),
      detail: c.changed
        ? curtain
          ? "A changed record no longer hashes to the leaf its Merkle path expects; the root the contract holds was never touched."
          : "A changed record no longer matches what Acme sealed on the day. The sealed copy wins."
        : curtain
          ? "Some roots are not the ones the contract holds, or it holds none for that day."
          : "Some of these records have no sealed copy to check against.",
      tone: "bad",
    };
  }
  if (c.pathOnly) {
    return {
      headline:
        c.proved > 0
          ? `${c.proved} of ${c.total} ${records} proved · ${c.pathOnly} not confirmed`
          : `${c.total} ${records} intact, none confirmed yet`,
      detail: curtain
        ? "Every record leads to its day's root, but testnet RPC could not be reached to compare the roots with the contract's anchors. Nothing here is proved until it is."
        : "Every record is intact, but the network could not be reached to confirm the seals, so nothing here is proved yet.",
      tone: "wait",
    };
  }
  return {
    headline: `${c.proved} of ${c.total} ${records} proved`,
    detail: curtain
      ? "Every record was hashed again here, walked to its day's root, and that root is the one the contract holds."
      : "Every record checked against Acme's sealed daily records.",
    tone: "ok",
  };
}

/** "1 receipt, 1 QC decision, 26 batches, 145 shipments": what a passport holds. */
export function kindCounts(entries: PassportEntry[]): string {
  const names: Record<PassportLeaf["kind"], [string, string]> = {
    receipt: ["receipt", "receipts"],
    qc: ["QC decision", "QC decisions"],
    payment: ["payment", "payments"],
    batch: ["batch", "batches"],
    shipment: ["shipment", "shipments"],
  };
  const order: PassportLeaf["kind"][] = ["receipt", "qc", "payment", "batch", "shipment"];
  return order
    .map((k) => [k, entries.filter((e) => e.leaf.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${names[k][n === 1 ? 0 : 1]}`)
    .join(", ");
}

export interface Tamper {
  key: string;
  field: string;
  was: string;
  now: string;
}

/**
 * The passport with one disclosed record edited in memory: the start lot's receipt when the
 * passport holds it, else the first receipt, else the first record. Returns what was changed in
 * staff words. Nothing on disk or on chain is touched.
 */
export function tamperPassport(
  p: Passport,
  g: Genealogy,
): { passport: Passport; tamper: Tamper | null } {
  const i = Math.max(
    0,
    [
      p.entries.findIndex((e) => e.leaf.kind === "receipt" && e.leaf.id === p.lot),
      p.entries.findIndex((e) => e.leaf.kind === "receipt"),
      p.entries.length ? 0 : -1,
    ].find((n) => n >= 0) ?? -1,
  );
  const entry = p.entries[i];
  if (!entry) return { passport: p, tamper: null };
  const record = { ...entry.leaf.record };
  const key = `${entry.leaf.kind}:${entry.leaf.id}`;
  let tamper: Tamper;
  switch (entry.leaf.kind) {
    case "receipt": {
      const dim = g.lots[str(record.lot)]?.dimension ?? "count";
      const was = num(record.receivedBase);
      record.receivedBase = was * 10;
      tamper = { key, field: "quantity received", was: qty(was, dim), now: qty(was * 10, dim) };
      break;
    }
    case "qc": {
      const was = str(record.decision);
      record.decision = was === "released" ? "rejected" : "released";
      tamper = { key, field: "QC decision", was, now: str(record.decision) };
      break;
    }
    case "payment": {
      const was = num(record.amountUnits);
      record.amountUnits = String(was * 10);
      tamper = { key, field: "amount paid", was: dollars(was), now: dollars(was * 10) };
      break;
    }
    case "batch": {
      const was = num(record.units);
      record.units = was * 10;
      tamper = {
        key,
        field: "units made",
        was: was.toLocaleString("en-US"),
        now: (was * 10).toLocaleString("en-US"),
      };
      break;
    }
    case "shipment": {
      const was = str(record.customer);
      record.customer = `${was} (another customer)`;
      tamper = { key, field: "customer", was, now: str(record.customer) };
      break;
    }
  }
  const entries = p.entries.map((e, j) => (j === i ? { ...e, leaf: { ...e.leaf, record } } : e));
  return { passport: { ...p, entries }, tamper };
}

/** The days a passport spans, each with what the chain said about it. */
export interface DayRow {
  refId: string;
  root: string;
  records: number;
  anchoredTx: string | null;
  on: OnChainAnchor | null | "unreachable" | undefined;
}
export function dayRows(p: Passport, chain: Chain): DayRow[] {
  const rows = new Map<string, DayRow>();
  for (const e of p.entries) {
    const row = rows.get(e.refId) ?? {
      refId: e.refId,
      root: e.root,
      records: 0,
      anchoredTx: e.anchoredTx,
      on: chain[e.refId],
    };
    row.records += 1;
    rows.set(e.refId, row);
  }
  return [...rows.values()].sort((a, b) => a.refId.localeCompare(b.refId));
}

/**
 * A page served over plain http (a LAN demo, the screenshot harness) has no crypto.subtle. The
 * SHA-256 written out in genealogy.ts stands in for digest there, so the same check runs anywhere.
 */
export function ensureDigest() {
  if (typeof crypto === "undefined" || crypto.subtle) return;
  const digest = async (_algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const hex = sha256Hex(new TextDecoder().decode(bytes));
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out.buffer;
  };
  Object.defineProperty(crypto, "subtle", { value: { digest }, configurable: true });
}

// ------------------------------------------------------------------ the hook

export type Chain = Record<string, OnChainAnchor | null | "unreachable">;
export interface ProofResult {
  passport: Passport;
  checks: EntryCheck[];
  chain: Chain;
  /** Milliseconds the whole check took, reads included. */
  ms: number;
  tamper: Tamper | null;
}
export type ProofState =
  | { phase: "idle" }
  | { phase: "working"; step: string; done: number; total: number }
  | { phase: "done"; result: ProofResult }
  | { phase: "failed"; error: string };

export interface LotProof {
  state: ProofState;
  prove: () => void;
  /** Edits one record in memory and checks again (true), or puts the real result back (false). */
  setTamper: (on: boolean) => void;
}

const requestKey = (input: RequestInfo | URL, init?: RequestInit) =>
  `${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}\n${typeof init?.body === "string" ? init.body : ""}`;

/** Builds and checks the passport for the trace on screen; starts over when the trace changes. */
export function useLotProof(g: Genealogy, t: Trace | null): LotProof {
  const [state, setState] = useState<ProofState>({ phase: "idle" });
  const run = useRef(0);
  const replay = useRef<typeof fetch | null>(null);
  const real = useRef<ProofResult | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new trace starts from nothing
  useEffect(() => {
    run.current += 1;
    real.current = null;
    setState({ phase: "idle" });
  }, [t?.start]);

  const prove = useCallback(async () => {
    if (!t) return;
    const id = ++run.current;
    const live = () => run.current === id;
    const t0 = performance.now();
    try {
      ensureDigest();
      setState({ phase: "working", step: "Opening the sealed records", done: 0, total: 0 });
      const book = await loadLotBook();
      const lot = t.start.slice(t.start.indexOf(":") + 1);
      const passport = await passportForKeys(book, lot, traceKeys(g, t));
      if (!live()) return;

      // Every day's anchor is read first, a few at a time, through a fetch that keeps each
      // answer; the check then reads from those answers, so it is quick and so is the re-check.
      const days = [...new Set(passport.entries.map((e) => e.refId))];
      const cache = new Map<string, string>();
      const recording: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        const text = await res.text();
        cache.set(requestKey(input, init), text);
        return new Response(text, { status: res.status });
      };
      const replaying: typeof fetch = async (input, init) => {
        const hit = cache.get(requestKey(input, init));
        if (hit === undefined) throw new Error("not read");
        return new Response(hit);
      };
      let done = 0;
      const reading = () =>
        live() &&
        setState({
          phase: "working",
          step: "Reading each day's seal from the network",
          done,
          total: days.length,
        });
      reading();
      const queue = [...days];
      const worker = async () => {
        for (let refId = queue.shift(); refId !== undefined; refId = queue.shift()) {
          if (passport.contract) {
            await readAnchor(passport.contract, refId, recording).catch(() => undefined);
          }
          done += 1;
          reading();
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, days.length) }, worker));
      if (!live()) return;
      setState({
        phase: "working",
        step: "Checking each record against its day's seal",
        done: days.length,
        total: days.length,
      });
      const { entries, chain } = await checkPassport(passport, {
        online: true,
        fetcher: replaying,
      });
      if (!live()) return;
      replay.current = replaying;
      const result: ProofResult = {
        passport,
        checks: entries,
        chain,
        ms: performance.now() - t0,
        tamper: null,
      };
      real.current = result;
      setState({ phase: "done", result });
    } catch (error) {
      if (live()) {
        setState({
          phase: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [g, t]);

  const setTamper = useCallback(
    async (on: boolean) => {
      const base = real.current;
      const fetcher = replay.current;
      if (!base || !fetcher) return;
      if (!on) {
        setState({ phase: "done", result: base });
        return;
      }
      const id = run.current;
      const { passport, tamper } = tamperPassport(base.passport, g);
      if (!tamper) return;
      const t0 = performance.now();
      const { entries, chain } = await checkPassport(passport, { online: true, fetcher });
      if (run.current !== id) return;
      setState({
        phase: "done",
        result: { passport, checks: entries, chain, ms: performance.now() - t0, tamper },
      });
    },
    [g],
  );

  return { state, prove, setTamper };
}

// ------------------------------------------------------------------ the panel

const seconds = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const short = (hash: string) => `${hash.slice(0, 10)}…`;
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ProvePanel({
  g,
  curtain,
  proof,
  traceOf,
}: {
  g: Genealogy;
  curtain: boolean;
  proof: LotProof;
  /** What the trace starts from, for the heading. */
  traceOf: string;
}) {
  const { state, prove, setTamper } = proof;
  const working = state.phase === "working";
  return (
    <section className="card-v2 prove" aria-label="Prove it" id="prove">
      <div className="drill-top">
        <div>
          <h3>Prove it</h3>
          <p className="small muted">
            Check every record in the trace from <span className="num">{traceOf}</span>, receipts,
            QC decisions, payments, batches and shipments, against Acme's sealed daily records. The
            check runs here, in your browser.
            {curtain &&
              " Behind the curtain: each day's records are hashed into one Merkle root per plant and anchored on the contract; the check hashes each record again, walks its path, and reads the root with get_anchor over testnet RPC."}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={prove} disabled={working}>
          {state.phase === "done" ? "Check again" : "Prove it"}
        </button>
      </div>
      {working && (
        <div className="prove-progress" aria-live="polite">
          <div
            className="bar"
            role="progressbar"
            aria-label={state.step}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, state.total)}
            aria-valuenow={state.done}
          >
            <i
              style={{
                width: state.total ? `${Math.round((state.done / state.total) * 100)}%` : "8%",
              }}
            />
          </div>
          <span className="small muted">
            {state.step}
            {state.total > 0 ? ` · ${state.done} of ${state.total} days` : "…"}
          </span>
        </div>
      )}
      {state.phase === "failed" && (
        <p className="small prove-failed" role="alert">
          The check could not run here: {state.error}
        </p>
      )}
      {state.phase === "done" && (
        <ProofResultView g={g} curtain={curtain} result={state.result} onTamper={setTamper} />
      )}
    </section>
  );
}

function ProofResultView({
  g,
  curtain,
  result,
  onTamper,
}: {
  g: Genealogy;
  curtain: boolean;
  result: ProofResult;
  onTamper: (on: boolean) => void;
}) {
  const { passport, checks, chain, tamper } = result;
  const counts = countVerdicts(checks);
  const sum = summaryWords(counts, curtain);
  const contract = passport.contract;
  const anchoredBy = [
    ...new Set(Object.values(chain).flatMap((on) => (on && on !== "unreachable" ? [on.by] : []))),
  ];
  // Anything that is not proved comes first, so a changed record is the first row.
  const rows = passport.entries
    .map((e, i) => ({ e, check: checks[i] as EntryCheck }))
    .sort((a, b) => Number(a.check.verdict === "proved") - Number(b.check.verdict === "proved"));
  return (
    <div className="prove-result">
      <div className={`prove-summary ${sum.tone}`} aria-live="polite">
        <p className="headline">{sum.headline}</p>
        <p className="small">{sum.detail}</p>
        <p className="small muted">
          {kindCounts(passport.entries)} · checked {tamper ? "again " : ""}in {seconds(result.ms)}
          {curtain && contract && (
            <>
              {" · roots read from "}
              <span className="num">{contract}</span>
              {anchoredBy.length > 0 && (
                <>
                  , anchored by <span className="num">{anchoredBy.join(", ")}</span>
                </>
              )}
            </>
          )}
        </p>
      </div>

      {passport.entries.length > 0 && (
        <div className="prove-tamper">
          <button
            type="button"
            className={tamper ? "btn sm on" : "btn sm"}
            aria-pressed={Boolean(tamper)}
            onClick={() => onTamper(!tamper)}
          >
            {tamper ? "Put it back" : "Change one record"}
          </button>
          {tamper ? (
            <p className="small">
              In this view only, <span className="num">{tamper.key.split(":")[1]}</span>'s{" "}
              {tamper.field} now reads <b>{tamper.now}</b> instead of <b>{tamper.was}</b>. The
              record turns red because it no longer matches its sealed copy. Nothing in the records
              was touched; “Put it back” shows the real result again.
            </p>
          ) : (
            <p className="small muted">
              Edit one record in memory and check again, to see what a changed record looks like.
              Nothing real changes.
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap tall prove-records">
          <table className="data">
            <caption className="sr-only">Each record in the trace and its result</caption>
            <thead>
              <tr>
                <th>Result</th>
                <th>Date</th>
                <th>Kind</th>
                <th>Record</th>
                {curtain && <th>Day</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, check }) => {
                const look = verdictLook(check.verdict, curtain);
                const changedHere = tamper?.key === check.key;
                return (
                  <tr key={check.key} className={changedHere ? "changed-here" : undefined}>
                    <td className="result" title={look.means}>
                      <Pill tone={look.tone}>{look.label}</Pill>
                    </td>
                    <td className="date num">{dayOf(e.leaf.at)}</td>
                    <td className="kind">{KIND_LABEL[e.leaf.kind]}</td>
                    <td className="what">
                      {recordWords(e.leaf, g, curtain)}
                      {curtain && e.leaf.kind === "payment" && (
                        <>
                          {" · "}
                          <a
                            href={`${EXPLORER_TX}${str(e.leaf.record.txHash)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(str(e.leaf.record.txHash))} on the explorer ↗
                          </a>
                        </>
                      )}
                      {changedHere && <span className="changed-tag">changed in this view</span>}
                    </td>
                    {curtain && <td className="day num">{e.refId}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {curtain && rows.length > 0 && (
        <div className="prove-days">
          <h4 className="small muted">
            Behind the curtain · one root per plant per day{contract ? ` on ${contract}` : ""}
          </h4>
          <div className="table-wrap tall">
            <table className="data">
              <caption className="sr-only">Each day's root and what the contract holds</caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>On chain</th>
                  <th>Root here</th>
                  <th>Transaction</th>
                  <th>Anchored by</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                {dayRows(passport, chain).map((d) => {
                  const on = d.on;
                  const said =
                    on === undefined || on === "unreachable"
                      ? "RPC unreachable"
                      : on === null
                        ? "nothing anchored"
                        : on.hash === d.root
                          ? "same root"
                          : `different root ${short(on.hash)}`;
                  const tone: Tone =
                    on && on !== "unreachable" && on.hash === d.root
                      ? "ok"
                      : on === undefined || on === "unreachable"
                        ? "waiting"
                        : "refused";
                  return (
                    <tr key={d.refId}>
                      <td className="num">{d.refId}</td>
                      <td>
                        <Pill tone={tone}>{said}</Pill>
                      </td>
                      <td className="num" title={d.root}>
                        {short(d.root)}
                      </td>
                      <td>
                        {d.anchoredTx ? (
                          <a
                            href={`${EXPLORER_TX}${d.anchoredTx}`}
                            target="_blank"
                            rel="noreferrer"
                            title={d.anchoredTx}
                          >
                            {short(d.anchoredTx)} ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">{on && on !== "unreachable" ? on.by : "—"}</td>
                      <td className="num">{d.records}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
