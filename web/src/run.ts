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
/** What both sources share. */
export interface RunData {
  network: string;
  summary: Summary | null;
  approvals: Approval[];
  steps: Step[];
  transactions: Transaction[];
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

export function audienceOf(step: Step): Audience {
  const who = AUDIENCE[step.title];
  if (who) return who;
  // Titles that carry a record or a name: "Upload BR-B-1046", "Ray confirms", "Linda texts".
  if (step.title.startsWith("Upload ") || step.title.endsWith(" confirms")) return RAY;
  if (step.title.endsWith(" texts")) return LINDA;
  throw new Error(`No audience for demo step "${step.title}"`);
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
