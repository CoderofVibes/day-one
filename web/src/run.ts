// The recorded demo run (web/src/data/demo-run.json, written by npm run web:data) and who on the
// plant floor sees each step. Staff screens use only `staff` lines; chain lines, accounts and
// transactions belong to the behind-the-curtain view.

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
  url: string;
  method: string;
  contract: string;
  signer: string;
  paidBy: string;
  status: string;
  error: string | null;
  events: string[];
}
export interface DemoRun {
  network: string;
  recordedAt: string;
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  approvals: { request: string; response: string | null }[];
  steps: Step[];
  transactions: Transaction[];
}

export const run = demoRun as DemoRun;

export interface Audience {
  name: string;
  role: string;
  /** How the person receives it: Kevin's screen, a text on their phone, or nobody on staff. */
  channel: "screen" | "phone" | "none";
}

const RAY: Audience = { name: "Ray Delgado", role: "Purchaser", channel: "screen" };

/** Who sees each step, keyed by the demo runner's step titles (DEMO_SCRIPT §2). */
export const AUDIENCE: Record<string, Audience> = {
  "Load seed": { name: "Day One", role: "Plant B setup", channel: "screen" },
  "Upload BR-B-1045": RAY,
  "Ray confirms": RAY,
  Forecast: RAY,
  Quotes: RAY,
  "Small PO": RAY,
  "Big PO": RAY,
  "Linda texts": { name: "Linda Park", role: "Ops director", channel: "phone" },
  "Kevin retries": RAY,
  "Supplier ships": { name: "Northgate Ingredients", role: "Supplier", channel: "none" },
  Delivery: { name: "Tommy Reyes", role: "Receiving", channel: "screen" },
  "QC release": { name: "Priya Natarajan", role: "QC", channel: "screen" },
  Paid: { name: "Marcy Allen", role: "Accounting", channel: "screen" },
  Summary: { name: "Day One", role: "Run summary", channel: "none" },
};

export function audienceOf(step: Step): Audience {
  const who = AUDIENCE[step.title];
  if (!who) throw new Error(`No audience for demo step "${step.title}"`);
  return who;
}

/** The transactions sent up to and including step index `upTo`, in order. */
export function transactionsThrough(upTo: number): { stepIndex: number; tx: Transaction }[] {
  const byHash = new Map(run.transactions.map((t) => [t.tx, t]));
  const out: { stepIndex: number; tx: Transaction }[] = [];
  run.steps.slice(0, upTo + 1).forEach((step, stepIndex) => {
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
