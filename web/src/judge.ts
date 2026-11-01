// Judge mode's script (brief §5.12): ten steps that hand a judge the story in a few minutes, the
// employee's day first (what Kevin handled, the one decision a person makes, the outcome), then
// the proof behind it. Each step has the page it opens, the recorded step it seeks to, what it
// spotlights, one or two sentences, and its "See it on chain" links. Every link is taken from the recordings the pages already read
// (demo-run.json, arena.json, group-buy.json, usdc.json), never typed here; src/judge.test.ts
// checks each one against the files under data/. Pure data, so the tests read it without a page.

import arena from "./data/arena.json";
import groupBuy from "./data/group-buy.json";
import journey from "./data/journey.json";
import usdc from "./data/usdc.json";
import { type RunData, run as recorded, type Transaction } from "./run.ts";
import { type PageId, PLANTS } from "./shell.tsx";

export interface ProofLink {
  label: string;
  url: string;
}

export interface JudgeStep {
  id: string;
  title: string;
  /** One or two sentences, in plain words. */
  body: string;
  /** A line quoted from the recording under the body (a contract's refusal, a staff line). */
  quote?: string;
  page: PageId;
  /** The recorded step the run is set to (src/data/demo-run.json, 0–14). */
  at: number;
  /** What the spotlight cuts out, as a CSS selector; none when an overlay is the subject. */
  spotlight?: string;
  /** What opens over the page: Linda's phone, PO-1047's card, the attestation card or the tour. */
  overlay?: "phone" | "usdc" | "attestation" | "tour";
  links: ProofLink[];
  /** About how long the step takes to read and look at, for "time remaining". */
  seconds: number;
}

type Arena = {
  cases: { n: number; attack: string; held: boolean; txs: { url: string; status: string }[] }[];
};
type Reconciliation = { checks: { name: string; ok: boolean; skipped?: boolean }[]; ok: boolean };

const short = (account: string) => account.replace(/\.acme-holdings\.testnet$/, "…");

function link(t: Transaction | undefined, label: string): ProofLink[] {
  return t?.url ? [{ label, url: t.url }] : [];
}

/** PO-1042's transactions in the recorded run, by what they did. */
export function po1042(data: RunData = recorded) {
  const tx = (hash: string | null | undefined) => data.transactions.find((t) => t.tx === hash);
  const stepTx = (title: string) =>
    tx(data.steps.find((s) => s.title === title)?.chain.find((c) => c.tx)?.tx);
  return {
    small: stepTx("Small PO"),
    refused: data.transactions.find((t) => t.method === "submit_po" && t.status === "refused"),
    approved: data.transactions.find((t) => t.method === "approve_po" && t.status === "success"),
    funded: stepTx("Kevin retries"),
    received: data.transactions.find((t) => t.method === "confirm_receipt"),
    released: data.transactions.find((t) => t.method === "qc_release"),
  };
}

/** The recorded group purchase: the pool, each plant's share, its approvals and its payout. */
export function groupPurchase() {
  const txs = groupBuy.transactions as unknown as Transaction[];
  const shares = groupBuy.pool.shares.map((s) => ({
    plant: s.plantName,
    amount: s.amount / 1e6,
    approvedBy: s.approvedBy,
  }));
  return {
    po: groupBuy.po.poNo,
    total: groupBuy.po.totalUsdc / 1e6,
    shares,
    declined: groupBuy.pool.declined.map((c) => PLANTS.find((p) => p.code === c)?.name ?? c),
    approvals: txs.filter((t) => t.method === "approve_po" && t.status === "success"),
    funded: txs.find((t) => t.method === "submit_pooled_po" && t.status === "success"),
    released: txs.find((t) => t.method === "qc_release"),
  };
}

/** The fifteen recorded attacks: how many were refused, and each refused transaction. */
export function attacks() {
  const cases = (arena as Arena).cases;
  return {
    total: cases.length,
    refused: cases.filter((c) => c.held).length,
    links: cases.flatMap((c) =>
      c.txs.filter((t) => t.status === "refused").map((t) => ({ label: c.attack, url: t.url })),
    ),
  };
}

export function reconciliation(): Reconciliation {
  return (journey as unknown as { reconciliation: Reconciliation }).reconciliation;
}

export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The attestation as the recorded run verified it: enclave checks and signed answers. */
export function attestation(data: RunData = recorded) {
  const a = data.attestation;
  return {
    model: a?.model ?? "",
    checks: a?.enclave.filter((c) => c.status === "verified").length ?? 0,
    of: a?.enclave.length ?? 0,
    answers: a?.answers.length ?? 0,
    ok: Boolean(a?.ok),
    fetchedAt: a?.fetchedAt ?? "",
  };
}

const po = po1042();
const group = groupPurchase();
const attack = attacks();
const rec = reconciliation();
const agree = rec.checks.filter((c) => c.ok && !c.skipped).length;
const att = attestation();
const refusedAt = recorded.steps.findIndex((s) => s.title === "Big PO");
const textedAt = recorded.steps.findIndex((s) => s.title === "Linda texts");
const releasedAt = recorded.steps.findIndex((s) => s.title === "QC release");
const last = recorded.steps.length - 1;

export const JUDGE_STEPS: JudgeStep[] = [
  {
    id: "kevin",
    title: "Kevin handled the paperwork",
    body: "After Ray confirmed the batch record Kevin read, Kevin caught 12.55 kg missing from a transfer, forecast a shortfall, compared three quotes and placed PO-1041 inside his limits. Done work sits apart from drafts and suggestions. Behind the curtain shows the chain staff never see.",
    page: "overview",
    at: refusedAt - 1,
    spotlight: ".desk",
    links: link(po.small, "submit_po PO-1041, funded"),
    seconds: 30,
  },
  {
    id: "refused",
    title: "One decision needs Linda",
    body: "PO-1042 is $5,150.00, over Kevin's $2,500 limit, and the contract refused it. The desk hands Linda one decision with why her, what she decides and what happens after. Kevin first checked that no other plant could spare the stock.",
    ...(po.refused?.error ? { quote: `Contract: “${po.refused.error}”` } : {}),
    page: "overview",
    at: refusedAt,
    spotlight: ".desk-card.need",
    links: link(po.refused, "submit_po, refused"),
    seconds: 35,
  },
  {
    id: "approve",
    title: "Linda approves by text",
    body: "Linda Park replies YES 1042 from her phone. The reply becomes approve_po signed by her own account, gas paid by Day One; Kevin cannot fake it, and Linda never sees a wallet. Her approval files under what was handled; the payment's condition stays in view.",
    page: "overview",
    at: textedAt,
    overlay: "phone",
    links: [
      ...link(po.approved, `approve_po by ${short(po.approved?.signer ?? "")}`),
      ...link(po.funded, "submit_po, funded into escrow"),
    ],
    seconds: 30,
  },
  {
    id: "paid",
    title: "Escrow released on QC",
    body: "The truck arrives, lot ASC-261116-01 waits in quarantine, and Priya releases it. The contract pays Northgate from escrow in that call: paid on QC, not on an invoice. On the desk, the condition reads met; the desk still lists the other work waiting.",
    page: "map",
    at: releasedAt,
    spotlight: ".map-frame",
    links: [
      ...link(po.received, "confirm_receipt"),
      ...link(po.released, "qc_release, escrow paid out"),
    ],
    seconds: 30,
  },
  {
    id: "attacks",
    title: `${attack.refused} of ${attack.total} attacks refused`,
    body: "Every attack the suite tried, from a lookalike vendor to a new-bank-details email, refused by Kevin or the contract. Pick one and press Fire attack.",
    page: "arena",
    at: last,
    spotlight: ".arena-list",
    links: attack.links.slice(0, 3),
    seconds: 40,
  },
  {
    id: "group",
    title: `Group buy ${group.po}, ${usd(group.total)}`,
    body: `${group.shares.length} plants pool ascorbic acid into one order, ${group.shares
      .map((s) => `${s.plant} ${usd(s.amount)}`)
      .join(
        " and ",
      )}, each approved by its own director${group.declined.length ? `; ${group.declined.join(" and ")} declined` : ""}.`,
    page: "group",
    at: last,
    spotlight: '[aria-label="Each plant\'s share"]',
    links: [
      ...group.approvals.map((t) => ({
        label: `approve_po by ${short(t.signer)}`,
        url: t.url ?? "",
      })),
      ...link(group.funded, "submit_pooled_po, funded"),
      ...link(group.released, "qc_release, paid out"),
    ].filter((l) => l.url),
    seconds: 30,
  },
  {
    id: "reconcile",
    title: `${agree} of ${rec.checks.length} reconciliation checks agree`,
    body: "Day One's ledger, the acquirer's ERP and the contract, checked against each other: inventory, POs, payments, escrow, the GL and supplier standing. These read the contract's views, so there is no transaction to link.",
    page: "reconciliation",
    at: last,
    spotlight: '[aria-label="The checks"]',
    links: [],
    seconds: 25,
  },
  {
    id: "usdc",
    title: `Real USDC: ${usdc.po}, $${usdc.amountUsdc}`,
    body: `The same contract code, deployed with Circle's testnet USDC as its token, paid ${usdc.supplier.replace(/\.testnet$/, "")} ${usdc.amountUsdc} USDC for ${usdc.po} in five calls.`,
    page: "hq",
    at: last,
    overlay: "usdc",
    links: usdc.calls.map((c) => ({ label: c.call.replace(/^(kevin|supplier) /, ""), url: c.url })),
    seconds: 25,
  },
  {
    id: "attested",
    title: "Attested answers",
    body: `Kevin's model (${att.model}) ran in a hardware enclave on NEAR AI Cloud: ${att.checks} of ${att.of} enclave checks verified and each recorded answer signed. Re-check it yourself with npm run verify:attestation.`,
    page: "ask",
    at: last,
    spotlight: ".rail-v2 .attest",
    overlay: "attestation",
    links: [],
    seconds: 25,
  },
  {
    id: "tour",
    title: "Recall drill, and the tour",
    body: "Run the recall drill to trace a mock supplier recall notice through every batch, or play the tour: the whole run in 3D with captions.",
    page: "lots",
    at: last,
    spotlight: '[aria-label="Recall drill"]',
    overlay: "tour",
    links: [],
    seconds: 20,
  },
];

/** Every proof link in judge mode, once each, in the order the steps show them. */
export function proofLinks(steps: JudgeStep[] = JUDGE_STEPS): ProofLink[] {
  const seen = new Set<string>();
  const all = [
    ...steps.flatMap((s) =>
      s.id === "attacks"
        ? attack.links.map((l) => ({ ...l, label: `${l.label}, refused` }))
        : s.links,
    ),
  ];
  // Two attacks can share a name (two QC-reject suspensions): each label ends with its transaction.
  return all
    .filter((l) => !seen.has(l.url) && seen.add(l.url))
    .map((l) => ({
      ...l,
      label: `${l.label} · ${l.url.slice(l.url.lastIndexOf("/") + 1, l.url.lastIndexOf("/") + 9)}…`,
    }));
}

/** "about 3 min left" from step `i` on. */
export function remaining(i: number, steps: JudgeStep[] = JUDGE_STEPS): string {
  const s = steps.slice(i).reduce((sum, x) => sum + x.seconds, 0);
  return s < 60 ? "under a minute left" : `about ${Math.round(s / 60)} min left`;
}

/** The tour: the storyboard with its extra beats (src/video.ts), started at once. */
export const TOUR_URL = "?video=1&tour=1&autostart=1";

export interface TestCount {
  tests: number;
  files: number;
  at: string;
}

/** The last full green test run where the page was built (web/vite.config.ts), or null. */
export function testCount(raw: unknown = import.meta.env.VITE_TEST_COUNT): TestCount | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as TestCount | null;
    return v && typeof v.tests === "number" ? v : null;
  } catch {
    return null;
  }
}
