// Judge mode's script (brief §5.12; Astra's complexity pass, Tony Nov 4): six stops that follow
// one order, PO-1042, from need to payment in about three and a half minutes (the plant Acme just
// bought, the limits HQ sets, the refusal, Linda's approval beside Kevin's signed decision, receipt
// and payment, the lot's record), then "See every proof" for everything else (PROOF_STEPS). Each
// step has the page it opens, the recorded step it seeks to, what it spotlights, one or two
// sentences, and its named transaction links. Every link is taken from the
// recordings the pages already read (demo-run.json, arena.json, group-buy.json, usdc.json,
// lot-anchors.json), never typed here; src/judge.test.ts checks each one against the files under
// data/. Pure data, so the tests read it without a page.

import { draftPolicyChange } from "@day-one/kevin/policyChange";
import type { AgentPolicyView } from "@day-one/server/chain/policy";
import arena from "./data/arena.json";
import groupBuy from "./data/group-buy.json";
import journey from "./data/journey.json";
import lotAnchors from "./data/lot-anchors.json";
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
  /** A page shown first (the workbook Kevin read); the step's own page follows on Next, never by
   *  itself (first-use review, Nov 5: a page that moved with nobody pressing anything confused). */
  /** A page shown first, with its own caption, so Next changes the words as well as the page. */
  prelude?: {
    page: PageId;
    at: number;
    spotlight: string;
    next: string;
    title: string;
    body: string;
  };
  /** What opens over the page: Linda's phone, PO-1047's card, Kevin's limits, HQ's plain-words
   *  change, the attestation card or the tour. */
  overlay?: "phone" | "usdc" | "limits" | "policy" | "attestation" | "tour";
  /** False for a step that shows a staff screen with the curtain off. */
  curtain?: false;
  /** The attack the arena opens on (arena.json's case number). */
  attack?: number;
  links: ProofLink[];
  /** A page of this site to open in a new tab (a check the judge can run), beside the chain links. */
  open?: ProofLink;
  /** About how long the step takes to read and look at, for "time remaining". */
  seconds: number;
}

type Arena = {
  cases: {
    n: number;
    attack: string;
    held: boolean;
    reason: string;
    txs: { url: string; status: string; method?: string; events?: string[] }[];
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
    invoiced: data.transactions.find((t) => t.method === "record_invoice"),
    released: data.transactions.find((t) => t.method === "qc_release"),
  };
}

/**
 * The short delivery invoiced in full (arena case 19): the release that paid pro rata, with the
 * contract's settlement line as recorded. Judge mode quotes it on the settlement step.
 */
export function shortDelivery() {
  const c = (arena as Arena).cases.find((x) => /short delivery/i.test(x.attack));
  const release = c?.txs.filter((t) => t.status === "success").at(-1);
  const settled = (c as { evidence?: string[] } | undefined)?.evidence?.find((e) =>
    /^Contract: paid/.test(e),
  );
  return { n: c?.n, release, settled };
}

/** The lot book's anchors: how many days each plant anchored, and the last anchor per plant. */
export function lotBook() {
  const rows = lotAnchors.anchored;
  const last = PLANTS.map((p) => rows.filter((r) => r.plant === p.code).at(-1)).filter(
    (r): r is (typeof rows)[number] => r !== undefined,
  );
  return {
    contract: lotAnchors.contract,
    days: rows.reduce((sum, r) => sum + r.days, 0),
    transactions: rows.length,
    last,
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

/** The twenty-one recorded attacks: how many were refused, and each refused transaction. */
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
const short19 = shortDelivery();
const lots = lotBook();
const refusedAt = recorded.steps.findIndex((s) => s.title === "Big PO");
const retriedAt = recorded.steps.findIndex((s) => s.title === "Kevin retries");
const last = recorded.steps.length - 1;
const plantName = (code: string) => PLANTS.find((p) => p.code === code)?.name ?? code;
const monthDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// The core path (Astra's complexity pass, Tony Nov 4): one order from need to payment in six stops,
// about three and a half minutes. Everything else is in PROOF_STEPS, under "See every proof".
export const JUDGE_STEPS: JudgeStep[] = [
  {
    id: "takeover",
    title: "One batch record exposes a shortage",
    body: "Ray confirms Kevin's reading of batch record BR-B-1045. The stock it used comes off the books, and Kevin sees the next batches will run short of ascorbic acid: the shortage that leads to PO-1042.",
    page: "overview",
    at: recorded.steps.findIndex((s) => s.title === "Forecast"),
    prelude: {
      page: "spreadsheets",
      at: 0,
      spotlight: '[aria-label="The inventory workbook"]',
      next: "Next: Ray's desk →",
      title: "Kevin starts from the plant's own spreadsheet",
      body: `Acme just bought Hollow Pine, whose stock lived in this workbook. Kevin read its ${book.rows} rows and asked Ray ${book.questions} questions instead of guessing.`,
    },
    spotlight: ".batch-handoff",
    curtain: false,
    links: link(
      recorded.transactions.find((t) => t.method === "anchor_batch"),
      "Batch record fingerprint",
    ),
    seconds: 25,
  },
  {
    id: "limits",
    title: "HQ sets what Kevin may spend",
    body: "HQ set Kevin's limits at $2,500 per order and $60,000 a month. The contract enforces them. An order over those limits needs Linda's approval; Kevin cannot change the rules or approve his own order.",
    page: "hq",
    at: 0,
    overlay: "limits",
    curtain: false,
    links: [],
    seconds: 20,
  },
  {
    id: "refused",
    title: "The model approved. The contract still refused.",
    body: "Kevin prepared PO-1042: 700 kg of ascorbic acid from Northgate, $5,150.00 with freight. His AI model had signed off on it, but the $2,500 limit is the contract's rule, so the contract refused the order. Linda can approve it; then Kevin sends it again and the money is set aside, paid only after receipt and QC.",
    ...(po.refused?.error ? { quote: `Contract: “${po.refused.error}”` } : {}),
    page: "overview",
    at: refusedAt,
    spotlight: ".desk-card.need",
    links: link(po.refused, "Refused purchase order"),
    seconds: 30,
  },
  {
    id: "approve",
    title: "Linda approves; Kevin's signed decision stays the same",
    body: "Linda approved and Kevin resent PO-1042 with the same signed decision; the contract funded it. It checks who signed and which order the decision names, by a code computed from the order, and relies on Kevin to compute that code from the real order. Linda's text is simulated; the server holds her key.",
    page: "overview",
    at: retriedAt,
    spotlight: ".curtain .decision",
    links: [
      ...link(po.approved, "Director's authorization"),
      ...link(po.funded, "Funded retry with the same signed decision"),
    ],
    seconds: 50,
  },
  {
    id: "paid",
    title: "Received, released, paid",
    body: "Tommy counted 700 kg of lot ASC-261116-01 into stock and the $5,150.00 invoice was recorded. When Priya released the lot, the contract paid Northgate for what arrived, never more than the money set aside or the invoice: $5,150.00.",
    // The order's own track, not the plant twin: the twin at this step also carries the other
    // plant's open discrepancy and the refused order, two red marks on the success step (13).
    page: "overview",
    // The step after the release, where the track reads Paid and the condition met.
    at: recorded.steps.findIndex((s) => s.title === "Paid"),
    spotlight: ".desk .track",
    links: [
      ...link(po.received, "Receiving confirmation"),
      ...link(po.invoiced, "Invoice recorded"),
      ...link(po.released, "QC release and supplier payment"),
    ],
    seconds: 40,
  },
  {
    id: "passport",
    title: "The lot keeps the record",
    body: "Press Prove it to compare these records with their daily roots on testnet. Change one record shows the check failing. The fictional history was sealed on Nov 3, 2026. A match shows that the records agree with those anchored roots.",
    page: "lots",
    at: last,
    spotlight: '[aria-label="Prove it"]',
    links: lots.last.map((r) => ({
      label: `anchor_batch, ${r.days} daily roots for ${plantName(r.plant)} (${monthDay(r.from)} – ${monthDay(r.to)})`,
      url: r.url,
    })),
    open: { label: "Lots & recall with the check already running", url: "?page=lots&prove=1" },
    seconds: 40,
  },
];

/**
 * The proofs behind "See every proof": each opens like a step, from the summary. The attacks come
 * first (the security track); then the other recorded flows and the checks a judge can run.
 */
export const PROOF_STEPS: JudgeStep[] = [
  {
    id: "attacks",
    title: `${attack.refused} of ${attack.total} attack scenarios stopped`,
    body: `An email asks to send Northgate's payments to a new account. Kevin set it aside and changed nothing, so it never reached the chain. All ${attack.total} recorded attacks were stopped by Kevin, the mock ERP or the contract. Press Fire attack to replay this one; below are three attacks the contract itself refused.`,
    ...(bank ? { quote: `Kevin: “${bank.reason.split(":")[0]}.”`, attack: bank.n } : {}),
    page: "arena",
    at: last,
    spotlight: ".arena-detail",
    links: attack.links
      .slice(0, 3)
      .map((l) => ({ ...l, label: `refused by the contract: ${l.label}` })),
    seconds: 35,
  },
  {
    id: "short",
    title: "Half delivered, half paid",
    body: `Attack ${short19.n ?? 19}: a supplier ships half and invoices in full. The receiving lead counts what arrived, and at QC release the contract pays escrow pro rata to that quantity and returns the rest to the budget.`,
    ...(short19.settled ? { quote: `Attack ${short19.n}: “${short19.settled}”` } : {}),
    page: "arena",
    at: last,
    ...(short19.n ? { attack: short19.n } : {}),
    spotlight: ".arena-detail",
    links: short19.release
      ? [
          {
            label: "qc_release on the short delivery, settlement_adjusted",
            url: short19.release.url,
          },
        ]
      : [],
    seconds: 25,
  },
  {
    id: "group",
    title: `Group buy ${group.po}, ${usd(group.total)}`,
    body: `${group.shares.length} plants pool ascorbic acid into one order, ${group.shares
      .map((s) => `${s.plant} ${usd(s.amount)}`)
      .join(
        " and ",
      )}, each approved by its own director${group.declined.length ? `; ${group.declined.join(" and ")} had no need and stayed out` : ""}.`,
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
    body: `${agree} recorded checks agree across Day One's ledger, Acme's mock ERP and the contract: inventory, POs, payments, escrow, the general ledger and supplier standing. The ERP is a mock, and its match is not a payment condition.`,
    page: "reconciliation",
    at: last,
    spotlight: '[aria-label="The checks"]',
    links: [],
    seconds: 25,
  },
  {
    id: "usdc",
    title: `${usdc.po} in Circle testnet USDC`,
    body: `${usdc.po} paid ${usdc.amountUsdc} USDC to ${usdc.supplier.replace(/\.testnet$/, "")} on a separate deployment of the first contract version. It does not demonstrate v2 receipt settlement or signed decisions.`,
    page: "reconciliation",
    at: last,
    overlay: "usdc",
    links: usdc.calls.map((c) => ({ label: c.call.replace(/^(kevin|supplier) /, ""), url: c.url })),
    seconds: 20,
  },
  {
    id: "attested",
    title: "Attested answers",
    body: `Kevin's model (${att.model}) ran in a hardware enclave on NEAR AI Cloud: ${att.checks} of ${att.of} enclave checks verified, and each of this run's ${att.answers} recorded answers carries a verified signature. That proves where an answer came from, not that it is right.`,
    page: "ask",
    at: last,
    spotlight: ".rail-v2 .attest",
    overlay: "attestation",
    links: [],
    seconds: 25,
  },
  {
    id: "policy",
    title: "HQ changes a limit in plain words (a recorded example)",
    body: "HQ writes a request in plain words; Kevin drafts the exact change the contract needs. Nothing changes until HQ's own key signs it, and Kevin's account cannot sign it. This page has no owner key by design, so the example here is recorded, not typed.",
    page: "hq",
    at: 0,
    overlay: "policy",
    curtain: false,
    links: [],
    seconds: 20,
  },
  {
    id: "recall",
    title: "Run a recall drill",
    body: "The recall drill traces a fictional supplier recall through the seeded lot history across the plants. The drill leaves the ledger unchanged.",
    page: "lots",
    at: last,
    spotlight: '[aria-label="Recall drill"]',
    links: [],
    seconds: 20,
  },
  {
    id: "tour",
    title: "The captioned tour",
    body: "The whole recorded run in about two and a half minutes, in 3D, with captions.",
    page: "lots",
    at: last,
    overlay: "tour",
    links: [],
    seconds: 15,
  },
];

/**
 * Every proof link in judge mode, once each: the core path's, then each proof's (the attacks with
 * all their refused transactions). Built from both lists, so moving a step out of the core path
 * never drops its evidence from the summary.
 */
export function proofLinks(steps: JudgeStep[] = [...JUDGE_STEPS, ...PROOF_STEPS]): ProofLink[] {
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
