// The shape of a demo run as the screens see it, and who on the plant floor sees each step.
// Two sources give this shape: the recorded run (src/data/demo-run.json, written by
// npm run web:data) for the static replay, and GET /api/run when the API is up (src/api.ts).
// Staff screens use only `staff` lines; chain lines, accounts and transactions belong to the
// behind-the-curtain view.

import demoRun from "./data/demo-run.json";

export interface ChainLine {
  line: string;
  tx: string | null;
}
export interface Step {
  step: number;
  title: string;
  staff: string[];
  chain: ChainLine[];
}
export interface Transaction {
  tx: string;
  url: string | null;
  method: string;
  contract: string;
  signer: string;
  paidBy: string;
  status: string;
  error: string | null;
  events: string[];
  /** The signed decision a submit_po carried, with its recorded evidence (scripts/lib/decisionEvidence.ts). */
  decision?: DecisionEvidence | null;
}
/** Kevin's model decision on a PO, as the recording holds it; `verified` is the offline check. */
export interface DecisionEvidence {
  poId: string;
  supplier: string;
  amount: number;
  qtyKg: number | null;
  poHash: string;
  verdict: string;
  namesThisPo: boolean;
  model: string;
  chatId: string;
  requestSha256: string;
  responseSha256: string;
  signer: string | null;
  signature: string;
  verified: boolean;
  failed: string | null;
}
export interface Summary {
  transactions: number;
  refusedByDesign: number;
  refusedOther: number;
  failed: number;
}
export interface Approval {
  request: string;
  response: string | null;
}
/** One line of evidence from the attestation check (server/src/attestation). */
export interface Check {
  name: string;
  status: "verified" | "unverified" | "skipped";
  detail: string;
}
export interface AttestedAnswer {
  chatId: string;
  model: string;
  task: string;
  promptStart: string;
  requestSha256: string;
  responseSha256: string;
  signer: string | null;
  checks: Check[];
}
/** The enclave Kevin's model ran in and the signature of each recorded answer, verified. */
export interface Attestation {
  model: string;
  tier: string;
  fetchedAt: string;
  nonce: string;
  enclave: Check[];
  answers: AttestedAnswer[];
  ok: boolean;
}
/** What both sources share. */
export interface RunData {
  network: string;
  summary: Summary | null;
  approvals: Approval[];
  steps: Step[];
  transactions: Transaction[];
  /** The recorded run's attestation; null when a live run has not been attested. */
  attestation: Attestation | null;
}
export interface DemoRun extends RunData {
  recordedAt: string;
  summary: Summary;
}

export const run = demoRun as DemoRun;

export interface Audience {
  name: string;
  role: string;
  /** How the person receives it: Kevin's screen, a text on their phone, or nobody on staff. */
  channel: "screen" | "phone" | "none";
}

const RAY: Audience = { name: "Ray Delgado", role: "Purchaser", channel: "screen" };
const LINDA: Audience = { name: "Linda Park", role: "Ops director", channel: "phone" };
const PRIYA: Audience = { name: "Priya Natarajan", role: "QC", channel: "screen" };
const SYSTEM: Audience = { name: "Day One", role: "Plant B setup", channel: "screen" };

/** Who sees each step, keyed by the demo runner's step titles (DEMO_SCRIPT §2). */
export const AUDIENCE: Record<string, Audience> = {
  "Load seed": SYSTEM,
  "Upload BR-B-1045": RAY,
  "Ray confirms": RAY,
  Discrepancy: RAY,
  Forecast: RAY,
  Quotes: RAY,
  "Small PO": RAY,
  "Big PO": RAY,
  "Linda texts": LINDA,
  "Kevin retries": RAY,
  "Supplier ships": { name: "Northgate Ingredients", role: "Supplier", channel: "none" },
  Delivery: { name: "Tommy Reyes", role: "Receiving", channel: "screen" },
  "QC release": PRIYA,
  "QC reject": PRIYA,
  Paid: { name: "Marcy Allen", role: "Accounting", channel: "screen" },
  Summary: { name: "Day One", role: "Run summary", channel: "none" },
  Stopped: { name: "Day One", role: "Run stopped", channel: "screen" },
};

/** A recorded step's title in staff words; the demo runner's titles are for the transcript. */
const PLAIN_TITLES: Record<string, string> = {
  "Load seed": "The plant's records loaded",
  Discrepancy: "Kevin checked the stock",
  Forecast: "Kevin forecast the batches",
  Quotes: "Kevin asked for quotes",
  "Small PO": "Kevin placed a small order",
  "Big PO": "Kevin prepared the big order",
  "Kevin retries": "Kevin sent the approved order",
  "Supplier ships": "The supplier shipped",
  Delivery: "Tommy received the delivery",
  "QC release": "Priya released the lot",
  "QC reject": "Priya rejected the lot",
  Paid: "Kevin paid the invoice",
  Summary: "The run's summary",
};
export function plainTitle(step: Step): string {
  const t = step.title;
  if (PLAIN_TITLES[t]) return PLAIN_TITLES[t];
  if (t.startsWith("Upload ")) return `Kevin read ${t.slice(7)}`;
  if (t.endsWith(" texts")) return `${t.replace(/ texts$/, "")} answered Kevin's text`;
  return t;
}

export function audienceOf(step: Step): Audience {
  const who = AUDIENCE[step.title];
  if (who) return who;
  // Titles that carry a record or a name: "Upload BR-B-1046", "Ray confirms", "Linda texts".
  if (step.title.startsWith("Upload ") || step.title.endsWith(" confirms")) return RAY;
  if (step.title.endsWith(" texts")) return LINDA;
  throw new Error(`No audience for demo step "${step.title}"`);
}

/** The status colours (docs/UI_DESIGN.md §4): colour never alone, every pill carries a word. */
export type Tone = "refused" | "waiting" | "held" | "paid" | "ok" | "neutral";
export interface Status {
  label: string;
  tone: Tone;
}

/**
 * What happened at a step, in a word, for the pill on its card: the demo runner's titles
 * ("Big PO", "Kevin retries") are for the transcript; staff read "refused" and "funded". Read
 * from the title and, where the live run can go two ways, from Kevin's own line.
 */
export function statusOf(step: Step): Status {
  const t = step.title;
  const text = step.staff.join(" ");
  if (t === "Load seed") return { label: "set up", tone: "neutral" };
  if (t.startsWith("Upload ")) return { label: "batch record", tone: "neutral" };
  if (t.endsWith(" confirms")) return { label: "confirmed", tone: "ok" };
  if (t === "Discrepancy") {
    const plant = /sent to Plant ([A-Z])/.exec(text)?.[1];
    return { label: plant ? `for Plant ${plant} to review` : "to review", tone: "waiting" };
  }
  if (t === "Forecast") return { label: "forecast", tone: "neutral" };
  if (t === "Quotes") return { label: "quotes", tone: "neutral" };
  if (t === "Small PO" || t === "Big PO")
    return /is over|refused/i.test(text)
      ? { label: "refused", tone: "refused" }
      : { label: "funded", tone: "held" };
  if (t.endsWith(" texts")) {
    if (/Approved by/.test(text)) return { label: "approved", tone: "ok" };
    if (/Declined by/.test(text)) return { label: "declined", tone: "refused" };
    return { label: "asked again", tone: "waiting" };
  }
  if (t === "Kevin retries")
    return /Funds held/.test(text)
      ? { label: "funded", tone: "held" }
      : { label: "not funded", tone: "refused" };
  if (t === "Supplier ships") return { label: "on its way", tone: "held" };
  if (t === "Delivery")
    return /on hold|Short/.test(text)
      ? { label: "on hold", tone: "waiting" }
      : { label: "quarantine", tone: "waiting" };
  if (t === "QC release") return { label: "released", tone: "ok" };
  if (t === "QC reject") return { label: "rejected", tone: "refused" };
  if (t === "Paid") return { label: "paid", tone: "paid" };
  if (t === "Stopped") return { label: "stopped", tone: "refused" };
  return { label: t.toLowerCase(), tone: "neutral" };
}

/** The transactions sent up to and including step index `upTo`, in order. */
export function transactionsThrough(
  data: RunData,
  upTo: number,
): { stepIndex: number; tx: Transaction }[] {
  const byHash = new Map(data.transactions.map((t) => [t.tx, t]));
  const out: { stepIndex: number; tx: Transaction }[] = [];
  data.steps.slice(0, upTo + 1).forEach((step, stepIndex) => {
    for (const c of step.chain) {
      const tx = c.tx ? byHash.get(c.tx) : undefined;
      if (tx) out.push({ stepIndex, tx });
    }
  });
  return out;
}

export function shortAccount(account: string): string {
  return account.replace(/\.acme-holdings\.testnet$/, ".acme…");
}
