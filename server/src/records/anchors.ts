// Record anchoring (CONTRACTS.md §6, research 09). A record's fingerprint is the SHA-256 of
// its canonical JSON with a salt, so low-entropy records cannot be guessed from the hash.
// Kevin stores fingerprints with `anchor_batch`; anyone can check one with a free view call.
//
// Lot events are anchored as ranges: the lot event chain is already hash-linked, so the hash
// of the last event in a range commits to every event before it.

import { desc, eq, max } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "../canonical.ts";
import type { ChainClient, ChainView, LoggedOutcome } from "../chain/client.ts";
import type { Ledger } from "../ledger/db.ts";
import { type ANCHOR_SUBJECTS, anchors, lotEvents } from "../ledger/schema.ts";

export type AnchorKind = (typeof ANCHOR_SUBJECTS)[number];

export function fingerprint(record: unknown, salt: string): string {
  return sha256Hex(canonicalJson({ record, salt }));
}

export interface AnchorItem {
  kind: AnchorKind;
  /** The id on chain, e.g. "BR-B-1045" or "LE-1-352". */
  refId: string;
  hash: string;
  prev: string | null;
  /** How the ledger row points back at its subject. */
  ledger: { refId?: number; fromSeq?: number; toSeq?: number };
}

/** The lot events since the last anchored range, or null when there are none. */
export function nextLotEventRange(db: Ledger): AnchorItem | null {
  const last = db
    .select()
    .from(anchors)
    .where(eq(anchors.subjectType, "lot_events_range"))
    .orderBy(desc(anchors.toSeq))
    .get();
  const fromSeq = (last?.toSeq ?? 0) + 1;
  const toSeq =
    db
      .select({ seq: max(lotEvents.seq) })
      .from(lotEvents)
      .get()?.seq ?? 0;
  if (toSeq < fromSeq) return null;
  const head = db.select().from(lotEvents).where(eq(lotEvents.seq, toSeq)).get();
  if (!head) return null;
  return {
    kind: "lot_events_range",
    refId: `LE-${fromSeq}-${toSeq}`,
    hash: head.eventHash,
    prev: last?.hash ?? null,
    ledger: { fromSeq, toSeq },
  };
}

export interface AnchorContext {
  kevin: string;
  policyContract: string;
  now: string;
}

/** Anchors up to 50 items in one `anchor_batch` call and records them on success. */
export async function anchorBatch(
  db: Ledger,
  chain: ChainClient,
  items: readonly AnchorItem[],
  ctx: AnchorContext,
): Promise<LoggedOutcome> {
  const outcome = await chain.call({
    kind: "anchor",
    signerId: ctx.kevin,
    receiverId: ctx.policyContract,
    method: "anchor_batch",
    args: {
      items: items.map((i) => ({ kind: i.kind, ref_id: i.refId, hash: i.hash, prev: i.prev })),
    },
    gasTera: 150,
  });
  if (outcome.status === "success") {
    db.insert(anchors)
      .values(
        items.map((i) => ({
          subjectType: i.kind,
          refId: i.ledger.refId ?? null,
          fromSeq: i.ledger.fromSeq ?? null,
          toSeq: i.ledger.toSeq ?? null,
          hash: i.hash,
          prevHash: i.prev,
          chainTxId: outcome.id,
          anchoredAt: ctx.now,
        })),
      )
      .run();
  }
  return outcome;
}

export interface OnChainAnchor {
  kind: string;
  hash: string;
  prev: string | null;
  by: string;
  at: string;
}

export interface Verification {
  refId: string;
  computed: string;
  onChain: OnChainAnchor | null;
  result: "MATCH" | "MISMATCH" | "NOT_ANCHORED";
}

/** Compares a recomputed fingerprint with the one stored on chain. Needs no keys. */
export async function verifyAnchor(
  view: (v: ChainView) => Promise<unknown>,
  policyContract: string,
  refId: string,
  computed: string,
): Promise<Verification> {
  const onChain = (await view({
    contractId: policyContract,
    method: "get_anchor",
    args: { ref_id: refId },
  })) as OnChainAnchor | null;
  return {
    refId,
    computed,
    onChain,
    result: !onChain ? "NOT_ANCHORED" : onChain.hash === computed ? "MATCH" : "MISMATCH",
  };
}
