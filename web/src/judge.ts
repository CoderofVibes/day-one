// Judge mode's script (brief §5.12): eleven steps that hand a judge the story in about five
// minutes: the plant Acme just bought and the limits HQ sets Kevin first, then the employee's day
// (what Kevin handled, the one decision a person makes, the outcome), then the proof behind it. Each step has the page it opens, the recorded step it seeks to, what it
// spotlights, one or two sentences, and its "See it on chain" links. Every link is taken from the recordings the pages already read
// (demo-run.json, arena.json, group-buy.json, usdc.json), never typed here; src/judge.test.ts
// checks each one against the files under data/. Pure data, so the tests read it without a page.

import { draftPolicyChange } from "@day-one/kevin/policyChange";
import type { AgentPolicyView } from "@day-one/server/chain/policy";
import arena from "./data/arena.json";
import groupBuy from "./data/group-buy.json";
import journey from "./data/journey.json";
import usdc from "./data/usdc.json";
import { tally } from "./moneyView.ts";
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
  /** What opens over the page: Linda's phone, PO-1047's card, HQ's limit change, the attestation
   *  card or the tour. */
  overlay?: "phone" | "usdc" | "limits" | "attestation" | "tour";
  /** False for a step that shows a staff screen with the curtain off. */
  curtain?: false;
  /** The attack the arena opens on (arena.json's case number). */
  attack?: number;
  links: ProofLink[];
  /** About how long the step takes to read and look at, for "time remaining". */
  seconds: number;
}

type Arena = {
  cases: {
    n: number;
    attack: string;
    held: boolean;
    reason: string;
    txs: { url: string; status: string }[];
  }[];
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

/** The plant's inventory workbook as Kevin read it before anything posted. */
export function workbook() {
  const v = (journey as unknown as { importView: ImportView }).importView;
  return {
    file: v.fileName,
    rows: v.analysis.rows.length,
    questions: v.analysis.rows.filter((r) => r.flags.length > 0).length,
  };
}
type ImportView = { fileName: string; analysis: { rows: { flags: unknown[] }[] } };

/** Kevin's policy as the recorded run read it from the contract (get_agent_policy in
 *  data/replay/demo-chain.json; src/judge.test.ts checks the two agree). */
export const RECORDED_POLICY: AgentPolicyView = {
  account: "kevin.plant-b.acme-holdings.testnet",
  name: "Kevin",
  plant: "plant-b.acme-holdings.testnet",
  perPoLimit: "2500000000",
  monthlyLimit: "60000000000",
  categories: ["raw_material", "packaging", "lab_chemical"],
  approver: "director.plant-b.acme-holdings.testnet",
  active: true,
  spentThisMonth: "0",
};
/** What HQ asks for on the limits step. */
export const LIMIT_REQUEST = "raise Kevin's per-PO limit to $3,000";
/** Kevin's draft of that request: the grammar npm run policy and the live page use, no model. */
export function limitDraft() {
  return draftPolicyChange(LIMIT_REQUEST, RECORDED_POLICY, "Linda Park");
}

/** Kevin's realized saving at Hollow Pine and how many times his assumed fee it covers. */
export function savingLine(): string {
  const at = (journey as unknown as { at: string }).at;
  const t = tally("B", at);
  const fee = t.cost.feeUsdc / 1e6 / t.cost.months;
  return `${usd(t.paid.realizedUsdc / 1e6)} realized at Hollow Pine, ${t.paid.ratio}× Kevin's cost (an assumed $${fee.toLocaleString("en-US")} monthly fee, fictional). The Money page shows each figure's formula.`;
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
const book = workbook();
const bank = (arena as Arena).cases.find((c) => /bank details/i.test(c.attack));
const refusedAt = recorded.steps.findIndex((s) => s.title === "Big PO");
const textedAt = recorded.steps.findIndex((s) => s.title === "Linda texts");
const releasedAt = recorded.steps.findIndex((s) => s.title === "QC release");
const last = recorded.steps.length - 1;

export const JUDGE_STEPS: JudgeStep[] = [
  {
    id: "takeover",
    title: "Day One at the plant Acme just bought",
    body: `Hollow Pine ran on paper and one workbook, ${book.file}. Kevin read its ${book.rows} rows and asked Ray about ${book.questions} (a lot entered twice, pounds for kilograms, a total row) before anything posted. Paper, suppliers, limits and books move over the same way, each signed off by a person.`,
    page: "spreadsheets",
    at: 0,
    spotlight: '[aria-label="The inventory workbook"]',
    curtain: false,
    links: [],
    seconds: 30,
  },
  {
    id: "limits",
    title: "Acme HQ sets Kevin's limits once",
    body: "HQ puts Kevin's limits on the contract: $2,500 per order and $60,000 a month, with Linda approving anything over. Kevin cannot change them. HQ asks for a change in plain words; Kevin drafts the owner call and HQ's key signs it.",
    page: "hq",
    at: 0,
    overlay: "limits",
    curtain: false,
    links: [],
    seconds: 25,
  },
  {
    id: "kevin",
    title: "Kevin handled the paperwork",
    body: "After Ray confirmed the batch record Kevin read, Kevin caught 12.55 kg missing from a transfer, forecast a shortfall, compared three quotes and placed PO-1041 inside his limits. Done work sits apart from drafts and suggestions. Behind the curtain shows the chain staff never see.",
    page: "overview",
    at: refusedAt - 1,
    spotlight: ".desk",
    links: link(po.small, "submit_po PO-1041, funded"),
    seconds: 25,
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
    seconds: 30,
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
    body: "It opens on the fraud that costs companies most: an email asking to pay Northgate at a new bank account. Kevin held it and changed nothing. Every other attack, from a lookalike vendor to a peek at sealed quotes, was refused by Kevin or the contract. Press Fire attack.",
    ...(bank ? { quote: `Kevin: “${bank.reason.split(":")[0]}.”`, attack: bank.n } : {}),
    page: "arena",
    at: last,
    spotlight: ".arena-detail",
    links: attack.links.slice(0, 3),
    seconds: 35,
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
    spotlight: `[aria-label="Each plant's share"]`,
    links: [
      ...group.approvals.map((t) => ({
        label: `approve_po by ${short(t.signer)}`,
        url: t.url ?? "",
      })),
      ...link(group.funded, "submit_pooled_po, funded"),
      ...link(group.released, "qc_release, paid out"),
    ].filter((l) => l.url),
    seconds: 25,
  },
  {
    id: "books",
    title: `${agree} of ${rec.checks.length} reconciliation checks agree`,
    body: `Day One's ledger, the acquirer's ERP and the contract, checked against each other: inventory, POs, payments, escrow, the GL and supplier standing. The same contract code also runs on Circle's testnet USDC: it paid ${usdc.supplier.replace(/\.testnet$/, "")} ${usdc.amountUsdc} USDC for ${usdc.po}.`,
    page: "reconciliation",
    at: last,
    spotlight: '[aria-label="The checks"]',
    overlay: "usdc",
    links: usdc.calls.map((c) => ({ label: c.call.replace(/^(kevin|supplier) /, ""), url: c.url })),
    seconds: 30,
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
