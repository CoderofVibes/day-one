// The attack arena (docs/UPGRADE_BRIEF.md §3.1), recorded mode: the twenty cases of
// `npm run test:attacks` as npm run web:data exported them (scripts/lib/arena.ts), replayed one
// at a time in the browser. Firing a case plays its recorded refusal; nothing here touches the
// run, the ledger or the chain.

export interface ArenaTx {
  tx: string;
  url: string | null;
  method: string;
  contract: string;
  signer: string;
  paidBy: string;
  status: string;
  error: string | null;
  events: string[];
  block: number | null;
}

export interface ArenaCase {
  n: number;
  attack: string;
  story: string;
  controls: string;
  defense: string;
  code: string;
  steps: [string, string, string];
  outcome: string;
  refusedBy: "contract" | "Kevin" | "ERP";
  method: string | null;
  signer: string | null;
  reason: string;
  held: boolean;
  evidence: string[];
  txs: ArenaTx[];
}

export interface Arena {
  network: string;
  recordedAt: string;
  cases: ArenaCase[];
}

let arena: Promise<Arena> | undefined;
export function readArena(): Promise<Arena> {
  arena ??= import("./data/arena.json").then((m) => m.default as unknown as Arena);
  return arena;
}

/**
 * Fired cases, as they reach their result: the 3D curtain (twin3d/ChainLayer.tsx) draws a case
 * the contract refused as a red pulse into a shield, with the recording's own words.
 */
const firedListeners = new Set<(c: ArenaCase) => void>();
export function onFired(listener: (c: ArenaCase) => void): () => void {
  firedListeners.add(listener);
  return () => firedListeners.delete(listener);
}
export function announceFired(c: ArenaCase): void {
  for (const l of firedListeners) l(c);
}

/** A fired case's timeline: three steps, the result, then what happened to the money. */
export const PHASES = 5;
export const RESULT_PHASE = 3;
/** Milliseconds between timeline steps, and between cases in "Try all". */
export const STEP_MS = 280;
export const CASE_MS = 1500;

export function timeline(c: ArenaCase): string[] {
  const result =
    c.refusedBy === "contract"
      ? "Refused by contract"
      : c.refusedBy === "ERP"
        ? "Refused by the ERP"
        : "Refused by Kevin";
  return [...c.steps, result, c.outcome];
}

export function chipLabel(c: ArenaCase) {
  return c.refusedBy === "contract"
    ? "Refused by contract"
    : `Refused by ${c.refusedBy === "ERP" ? "the ERP" : "Kevin"}`;
}

export function shortHash(tx: string) {
  return `${tx.slice(0, 6)}…${tx.slice(-4)}`;
}

/** "Oct 29" from an ISO date, in UTC so every machine reads the same day. */
export function recordedDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The scoreboard: what the judge tried this visit, and the suite as recorded. */
export function tally(cases: ArenaCase[], tried: ReadonlySet<number>) {
  const mine = cases.filter((c) => tried.has(c.n));
  return {
    tried: mine.length,
    refused: mine.filter((c) => c.held).length,
    suite: cases.length,
    suiteRefused: cases.filter((c) => c.held).length,
  };
}

export function tallyLine(t: ReturnType<typeof tally>) {
  const suite = `Suite: ${t.suiteRefused} of ${t.suite}`;
  return t.tried === 0 ? suite : `Refused ${t.refused} of ${t.tried} you tried · ${suite}`;
}
