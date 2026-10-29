// Sealed quote rounds, Kevin's side (CONTRACTS.md §9). Kevin opens a round for an RFQ on the
// spend-policy contract; until the deadline the chain holds only each supplier's fingerprint,
// and Kevin's ranking refuses to run, so nobody, Kevin included, can read or rank a price early.
// After the deadline Kevin ranks only quotes the contract accepted as opened, each re-checked
// against its seal, and awards the round on chain, which the contract allows only for one of
// them. The deadline and the reveal-matches-seal rule are the contract's; this file never
// replaces them, it only refuses to look before they have done their work.

import { sha256Hex } from "@day-one/server/canonical";
import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import { vendors } from "@day-one/server/ledger/schema";
import { parseSealedQuote } from "@day-one/server/quotes";
import { checkBid, type SealedRoundView } from "@day-one/server/sealed";
import type { QuoteAnswer, Rfq } from "./purchasing.ts";

/** How long suppliers have to seal and then to open their quotes. */
export interface RoundWindows {
  commitSecs: number;
  revealSecs: number;
}

/** The demo's round: two hours to seal quotes, then one hour to open them. */
export const DEMO_WINDOWS: RoundWindows = { commitSecs: 2 * 3_600, revealSecs: 3_600 };

export interface SealedContext {
  kevin: string;
  policyContract: string;
}

/** Kevin asked for quotes the round has not opened yet. */
export class SealedRoundError extends Error {
  override name = "SealedRoundError";
}

/** "2:00 PM" for a time on the demo clock (UTC). */
export function clockTime(iso: string) {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** The demo-clock time `secs` after `iso`. */
export function laterBy(iso: string, secs: number) {
  return new Date(Date.parse(iso) + secs * 1_000).toISOString();
}

export function openSealedRound(
  chain: ChainClient,
  ctx: SealedContext,
  rfq: Rfq,
  windows: RoundWindows,
): Promise<LoggedOutcome> {
  return chain.call({
    kind: "quote",
    signerId: ctx.kevin,
    receiverId: ctx.policyContract,
    method: "open_sealed_round",
    args: { round_id: rfq.rfqNo, commit_secs: windows.commitSecs, reveal_secs: windows.revealSecs },
    related: { type: "rfq", id: rfq.id },
  });
}

export async function readSealedRound(
  chain: ChainClient,
  ctx: SealedContext,
  roundId: string,
): Promise<SealedRoundView> {
  const round = await chain.view<SealedRoundView | null>({
    contractId: ctx.policyContract,
    method: "get_sealed_round",
    args: { round_id: roundId },
  });
  if (!round) throw new SealedRoundError(`${roundId} has no sealed quote round`);
  return round;
}

/** A sealed quote Kevin will not rank, with the reason staff see. */
export interface VoidQuote {
  supplier: string;
  reason: string;
}

export interface OpenedQuotes {
  answers: QuoteAnswer[];
  void: VoidQuote[];
}

/**
 * The quotes Kevin may rank: only those the contract accepted as opened, each re-checked here
 * (hash, round, supplier, sealed before the deadline). Refuses while the round is still sealed.
 */
export function openedQuotes(db: Ledger, round: SealedRoundView): OpenedQuotes {
  if (round.phase === "sealed") {
    throw new SealedRoundError(
      `${round.round_id} is sealed until the deadline; ${round.bids.length} ` +
        `fingerprint${round.bids.length === 1 ? "" : "s"} and no prices to rank`,
    );
  }
  const listed = db.select().from(vendors).all();
  const answers: QuoteAnswer[] = [];
  const voided: VoidQuote[] = [];
  for (const bid of round.bids) {
    const check = checkBid(round, bid);
    const vendor = listed.find((v) => v.nearAccountId === bid.supplier);
    const parsed = bid.quote === null ? null : parseSealedQuote(bid.quote);
    if (!check.opened) {
      voided.push({ supplier: bid.supplier, reason: "never opened its sealed quote" });
    } else if (!check.matches || !check.sealedBeforeDeadline || !parsed) {
      voided.push({ supplier: bid.supplier, reason: check.problems.join("; ") || "invalid" });
    } else if (!vendor) {
      voided.push({ supplier: bid.supplier, reason: "not on the supplier list" });
    } else {
      const { terms, salt } = parsed;
      answers.push({
        vendor: vendor.code,
        name: vendor.name,
        account: bid.supplier,
        unitPrice: terms.unitPriceUsdc / 1_000_000,
        freight: terms.freightUsdc / 1_000_000,
        leadTimeDays: terms.leadTimeDays,
        salt,
        // recordQuotes recomputes the fingerprint from the RFQ and these terms; a reveal for
        // another quantity or material no longer matches and is ignored.
        hash: sha256Hex(bid.quote ?? ""),
        anchor: null,
      });
    }
  }
  return { answers, void: voided };
}

export function awardSealedRound(
  chain: ChainClient,
  ctx: SealedContext,
  rfq: Rfq,
  supplier: string,
): Promise<LoggedOutcome> {
  return chain.call({
    kind: "quote",
    signerId: ctx.kevin,
    receiverId: ctx.policyContract,
    method: "award_sealed_round",
    args: { round_id: rfq.rfqNo, supplier },
    related: { type: "rfq", id: rfq.id },
  });
}
