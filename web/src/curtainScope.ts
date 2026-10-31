// Which recorded transactions each page cares about behind the curtain (docs/UPGRADE_BRIEF.md
// §5.7), so the panel is never empty: the page's own transactions up to the clock's step, and
// when it has none yet, the latest ones recorded on testnet. Every card is a recorded
// transaction from a fixture; nothing here makes up a hash.

import { groupBuy } from "./groupBuy.ts";
import type { AttackResult, Recorded } from "./reads.ts";
import { type RunData, run as recordedRun, type Transaction, transactionsThrough } from "./run.ts";
import type { PageId } from "./shell.tsx";

export type Card =
  | { kind: "tx"; tx: Transaction; stepIndex: number | null }
  /** A transaction from a recorded attack: the hash and link, the attack and the contract's words. */
  | { kind: "attack"; hash: string; url: string | null; attack: string; said: string | null };

export interface PageCards {
  cards: Card[];
  /** True when the page had none and the cards are the latest recorded ones. */
  fallback: boolean;
  /** Every recorded transaction the panel knows of, counted once. */
  total: number;
}

/** The supplier-credential attacks the Suppliers page lists (src/pages/Hq.tsx). */
const CREDENTIAL_ATTACKS = new Set([
  "Revoked supplier",
  "Expired supplier credential",
  "Supplier selling outside its categories",
  "Supplier suspended for repeated QC rejects",
]);

const PO_METHODS = [
  "submit_po",
  "approve_po",
  "accept_po",
  "mark_shipped",
  "confirm_receipt",
  "qc_release",
];
const LOT_METHODS = ["anchor_batch", "confirm_receipt", "qc_release"];
const BOOK_METHODS = ["qc_release", "anchor_batch"];

interface Scope {
  /** Methods of the run's transactions up to the clock's step; "all" for every one. */
  run?: string[] | "all";
  /** Only the run's transactions the ERP connector's steps name. */
  erp?: true;
  /** Methods of the recorded group purchase's transactions. */
  group?: string[] | "all";
  /** Recorded attacks whose transactions belong here. */
  attacks?: (r: Recorded) => AttackResult[];
}

/** Each page's selector. A page not listed sees the whole run. */
export const SCOPES: Partial<Record<PageId, Scope>> = {
  integration: { run: ["anchor", "anchor_batch"] },
  batches: { run: ["anchor_batch"] },
  inventory: { run: LOT_METHODS },
  schedule: { run: ["anchor_batch"] },
  purchasing: { run: PO_METHODS },
  invoices: { run: BOOK_METHODS },
  spreadsheets: {},
  erp: { erp: true },
  hq: { run: ["submit_po", "approve_po"] },
  suppliers: {
    run: ["anchor"],
    attacks: (r) => r.attacks.attacks.filter((a) => CREDENTIAL_ATTACKS.has(a.attack)),
  },
  group: { group: "all" },
  sealed: { attacks: (r) => r.sealed.attacks },
  export: { run: BOOK_METHODS },
  reconciliation: { run: BOOK_METHODS, group: ["qc_release"] },
};

/** How many of the latest recorded transactions the fallback shows. */
export const RECENT = 4;

function picks(methods: string[] | "all" | undefined, tx: Transaction) {
  return methods === "all" || (methods?.includes(tx.method) ?? false);
}

/** The run's transactions the ERP connector's recorded steps name (npm run erp:demo). */
function erpHashes(recorded: Recorded): Set<string> {
  const out = new Set<string>();
  for (const step of recorded.erp.steps) {
    if (!step.erp?.length) continue;
    for (const line of step.chain)
      for (const m of line.matchAll(/\(tx (\w+)\)/g)) if (m[1]) out.add(m[1]);
  }
  return out;
}

function attackCards(attacks: AttackResult[]): Card[] {
  const seen = new Set<string>();
  return attacks.flatMap((a) =>
    a.txHashes.flatMap((hash, i): Card[] => {
      if (seen.has(hash)) return [];
      seen.add(hash);
      const said = a.evidence.find((e) => e.startsWith("Contract"));
      return [
        {
          kind: "attack",
          hash,
          url: a.txUrls?.[i] ?? null,
          attack: a.attack,
          said: said ? (/"(.+)"/.exec(said)?.[1] ?? null) : null,
        },
      ];
    }),
  );
}

/**
 * The cards for a page at the run's step `upTo`. `recorded` is the HQ recordings (attacks, the
 * ERP's steps) once read; until then the pages that need them fall back to the latest.
 */
export function pageCards(
  page: PageId,
  data: RunData,
  upTo: number,
  recorded: Recorded | null,
): PageCards {
  const scope = SCOPES[page] ?? { run: "all" };
  const cards: Card[] = [];
  const erp = scope.erp && recorded ? erpHashes(recorded) : null;
  for (const { stepIndex, tx } of transactionsThrough(data, upTo)) {
    if (picks(scope.run, tx) || erp?.has(tx.tx)) cards.push({ kind: "tx", tx, stepIndex });
  }
  for (const tx of groupBuy.transactions) {
    if (picks(scope.group, tx)) cards.push({ kind: "tx", tx, stepIndex: null });
  }
  if (scope.attacks && recorded) cards.push(...attackCards(scope.attacks(recorded)));

  const all = new Set([
    ...recordedRun.transactions.map((t) => t.tx),
    ...data.transactions.map((t) => t.tx),
    ...groupBuy.transactions.map((t) => t.tx),
    ...(recorded
      ? [...recorded.attacks.attacks, ...recorded.sealed.attacks].flatMap((a) => a.txHashes)
      : []),
  ]);
  if (cards.length > 0) return { cards, fallback: false, total: all.size };
  const recent = recordedRun.transactions
    .slice(-RECENT)
    .reverse()
    .map((tx): Card => ({ kind: "tx", tx, stepIndex: null }));
  return { cards: recent, fallback: true, total: all.size };
}
