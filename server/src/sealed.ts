// Sealed quote rounds (CONTRACTS.md §10): what `get_sealed_round` returns, the proof file a judge
// checks with `npm run verify:round`, and the check itself. The contract already refuses late
// commits and mismatched reveals; this check lets anyone confirm, from the file alone and with
// no keys, that the round the file describes obeyed those rules and that the winner was a
// quote sealed before the deadline and opened unchanged.

import { sha256Hex } from "./canonical.ts";
import { parseSealedQuote, type QuoteTerms } from "./quotes.ts";

export type RoundPhase = "sealed" | "revealing" | "closed";

export interface SealedBidView {
  supplier: string;
  hash: string;
  /** Block times in nanoseconds, as decimal strings (U64). */
  committed_at: string;
  quote: string | null;
  revealed_at: string | null;
}

/** `get_sealed_round` as the contract returns it. */
export interface SealedRoundView {
  round_id: string;
  agent: string;
  opened_at: string;
  closes_at: string;
  reveal_ends_at: string;
  bids: SealedBidView[];
  awarded: string | null;
  awarded_at: string | null;
  phase: RoundPhase;
}

/** A call the contract refused during the round, kept in the proof as evidence. */
export interface RefusedCall {
  account: string;
  method: string;
  reason: string;
  tx: string | null;
}

/** The file `npm run verify:round` checks: the closed round as the chain returned it. */
export interface SealedRoundProof {
  kind: "sealed_round";
  network: string;
  contract: string;
  round: SealedRoundView;
  /** Transaction hashes by step: "open", "commit:<account>", "reveal:<account>", "award". */
  txs: Record<string, string | null>;
  refused: RefusedCall[];
}

export interface BidCheck {
  supplier: string;
  sealedBeforeDeadline: boolean;
  opened: boolean;
  /** The opened text hashes to the commitment and names this round and supplier. */
  matches: boolean;
  terms: QuoteTerms | null;
  problems: string[];
}

export interface RoundCheck {
  roundId: string;
  result: "VALID" | "INVALID";
  bids: BidCheck[];
  winner: string | null;
  problems: string[];
}

/** Checks one bid against its round's rules; an unopened bid is void, not a problem. */
export function checkBid(round: SealedRoundView, bid: SealedBidView): BidCheck {
  const problems: string[] = [];
  const closesAt = BigInt(round.closes_at);
  const sealedBeforeDeadline = BigInt(bid.committed_at) < closesAt;
  if (!sealedBeforeDeadline) problems.push("sealed after the deadline");
  let terms: QuoteTerms | null = null;
  let matches = false;
  if (bid.quote !== null) {
    const parsed = parseSealedQuote(bid.quote);
    terms = parsed?.terms ?? null;
    if (sha256Hex(bid.quote) !== bid.hash) problems.push("opened text does not match its seal");
    else if (terms?.rfq !== round.round_id || terms.supplier !== bid.supplier) {
      problems.push("opened text names another round or supplier");
    } else matches = true;
    const revealedAt = BigInt(bid.revealed_at ?? "0");
    if (revealedAt < closesAt || revealedAt >= BigInt(round.reveal_ends_at)) {
      problems.push("opened outside the reveal window");
    }
  }
  return {
    supplier: bid.supplier,
    sealedBeforeDeadline,
    opened: bid.quote !== null,
    matches,
    terms,
    problems,
  };
}

/** Checks a closed round: every opened bid valid, and the winner sealed in time and unchanged. */
export function checkSealedRound(round: SealedRoundView): RoundCheck {
  const bids = round.bids.map((b) => checkBid(round, b));
  const problems = bids.flatMap((b) => b.problems.map((p) => `${b.supplier}: ${p}`));
  const won = bids.find((b) => b.supplier === round.awarded);
  if (round.awarded === null) problems.push("the round has no winner");
  else if (!won?.matches || !won.sealedBeforeDeadline) {
    problems.push(`the winner ${round.awarded} has no quote sealed in time and opened unchanged`);
  }
  if (round.awarded_at !== null && BigInt(round.awarded_at) < BigInt(round.closes_at)) {
    problems.push("awarded before the deadline");
  }
  return {
    roundId: round.round_id,
    result: problems.length === 0 ? "VALID" : "INVALID",
    bids,
    winner: round.awarded,
    problems,
  };
}

/** The round as stored, without the phase the view adds at read time. */
export function storedRound(round: SealedRoundView) {
  const { phase: _phase, ...stored } = round;
  return stored;
}
