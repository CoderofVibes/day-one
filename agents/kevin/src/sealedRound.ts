// One sealed quote round end to end (`npm run sealed`, CONTRACTS.md §10): Kevin opens RFQ-2611-02
// for 700 kg of ascorbic acid, the three ascorbic suppliers seal their quotes (QuickChem's is
// refused: not an approved supplier), and nobody can read a price until the deadline (two hours
// on the fast-forwarded sandbox, three minutes on testnet). The run includes
// the sealed-bid attacks of the attack suite, each refused:
//
//   peek     before the deadline Kevin tries to rank and to award, and Northgate tries to open
//            early: Kevin's ranking refuses, the contract refuses the award and the reveal, and
//            the chain holds fingerprints only.
//   reveal   after Northgate opens at $7.10, Ridgeway tries to open a $6.95 quote in place of
//            the $7.35 it sealed: refused, the text does not match its seal.
//   late     Ridgeway then tries to seal a fresh $6.95 quote after the deadline: refused.
//
// Ridgeway opens its real quote, Kevin ranks the two opened quotes and awards the round on chain.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import { formatUsd } from "@day-one/server/money";
import type { RefusedCall, SealedRoundProof, SealedRoundView } from "@day-one/server/sealed";
import type { SealedQuote, SealedQuoteAgent } from "@day-one/suppliers/sealed";
import type { AttackResult } from "./attacks.ts";
import type { Forecast } from "./forecast.ts";
import { openRfq, type Ranking, type Rfq, rankQuotes, recordQuotes } from "./purchasing.ts";
import {
  awardSealedRound,
  clockTime,
  laterBy,
  type OpenedQuotes,
  openedQuotes,
  openSealedRound,
  type RoundWindows,
  readSealedRound,
  type SealedContext,
  SealedRoundError,
} from "./sealed.ts";

export const SEALED_RFQ = "RFQ-2611-02";
/** Ridgeway's attempted undercut, in USDC base units per kg ($6.95). */
export const UNDERCUT_USDC = 6_950_000;

export interface SealedRoundDeps extends SealedContext {
  db: Ledger;
  chain: ChainClient;
  forecast: Forecast;
  /** The suppliers asked for quotes; each seals one if it sells the material. */
  suppliers: readonly SealedQuoteAgent[];
  windows: RoundWindows;
  /** When Kevin opens the round, on the demo clock. */
  openedAt: string;
  /** Returns once the chain's clock is past the round's deadline (no-op in replay). */
  waitPastDeadline: (round: SealedRoundView) => Promise<void>;
  network: string;
}

export interface SealedRoundRun {
  rfq: Rfq;
  open: LoggedOutcome;
  sealed: SealedQuote[];
  peek: {
    kevinRefusal: string | null;
    /** The round as anyone could read it before the deadline. */
    before: SealedRoundView;
    earlyAward: LoggedOutcome;
    earlyReveal: LoggedOutcome;
  };
  reveals: LoggedOutcome[];
  mismatchedReveal: LoggedOutcome;
  lateSeal: LoggedOutcome;
  opened: OpenedQuotes;
  ranking: Ranking;
  award: LoggedOutcome | null;
  round: SealedRoundView;
  proof: SealedRoundProof;
  /** What staff see: dollars, names and times, no hashes. */
  staff: string[];
  /** Behind the curtain: every call with its fingerprint, block time and transaction. */
  curtain: string[];
}

const usd = (units: number) => formatUsd(BigInt(units));
const short = (hash: string) => `${hash.slice(0, 10)}…`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function find(agents: readonly SealedQuoteAgent[], account: string) {
  const agent = agents.find((a) => a.account === account);
  if (!agent) throw new Error(`no supplier agent ${account}`);
  return agent;
}

export async function runSealedRound(deps: SealedRoundDeps): Promise<SealedRoundRun> {
  const { db, chain, suppliers, windows, openedAt } = deps;
  const ctx = { kevin: deps.kevin, policyContract: deps.policyContract };
  const curtain: string[] = [];
  const staff: string[] = [];
  const closesAt = laterBy(openedAt, windows.commitSecs);
  const tx = (o: LoggedOutcome) => (o.txHash ? ` (tx ${o.txHash})` : "");
  const line = (what: string, o: LoggedOutcome) =>
    curtain.push(
      o.status === "success"
        ? `${what} ✓${tx(o)}`
        : `${what} ✗ REFUSED "${o.errorMessage ?? o.status}"${tx(o)}`,
    );

  // Noon: Kevin opens the round and the suppliers seal their quotes.
  const rfq = openRfq(db, deps.forecast, SEALED_RFQ);
  const open = await openSealedRound(chain, ctx, rfq, windows);
  line(
    `open_sealed_round ${rfq.rfqNo}, ${windows.commitSecs} s to seal, ${windows.revealSecs} s to open`,
    open,
  );
  const askedFor = suppliers.filter((s) => s.supplies(rfq.material));
  const sealed: SealedQuote[] = [];
  for (const agent of askedFor) {
    const quote = await agent.seal(rfq);
    if (!quote) continue;
    sealed.push(quote);
    line(`commit_quote by ${quote.account}: seal ${short(quote.hash)}`, quote.commit);
  }
  const accepted = sealed.filter((q) => q.commit.status === "success");
  const refused = sealed.filter((q) => q.commit.status !== "success");
  staff.push(
    `${clockTime(openedAt)}  Kevin asked ${plural(askedFor.length, "supplier")} for sealed quotes on ` +
      `${rfq.qtyBase / 1_000_000} kg ascorbic acid (${rfq.rfqNo}). Quotes stay sealed until ` +
      `${clockTime(closesAt)}.`,
  );
  staff.push(
    `${clockTime(openedAt)}  ${plural(accepted.length, "sealed quote")} received.` +
      refused
        .map(
          (q) =>
            ` ${find(suppliers, q.account).spec.name}'s was refused: not an approved supplier.`,
        )
        .join(""),
  );

  // Before the deadline: the peek attempts.
  const before = await readSealedRound(chain, ctx, rfq.rfqNo);
  let kevinRefusal: string | null = null;
  try {
    openedQuotes(db, before);
  } catch (error) {
    if (!(error instanceof SealedRoundError)) throw error;
    kevinRefusal = error.message;
  }
  curtain.push(
    `get_sealed_round before the deadline: phase ${before.phase}, ` +
      `${before.bids.map((b) => `${b.supplier} ${short(b.hash)} (quote ${b.quote ?? "hidden"})`).join(", ")}`,
  );
  curtain.push(`Kevin's ranking: refused, "${kevinRefusal ?? "it ranked a sealed round"}"`);
  const leader = accepted[0];
  if (!leader) throw new Error(`${rfq.rfqNo}: no quote was sealed`);
  const earlyAward = await awardSealedRound(chain, ctx, rfq, leader.account);
  line(`award_sealed_round by Kevin before the deadline`, earlyAward);
  const earlyReveal = await find(suppliers, leader.account).reveal(rfq.rfqNo);
  line(`reveal_quote by ${leader.account} before the deadline`, earlyReveal);

  // 2 PM: the round opens.
  await deps.waitPastDeadline(before);
  const reveals: LoggedOutcome[] = [];
  const first = await find(suppliers, leader.account).reveal(rfq.rfqNo);
  reveals.push(first);
  line(`reveal_quote by ${leader.account}`, first);

  const rival = accepted[1];
  if (!rival) throw new Error(`${rfq.rfqNo}: the run needs two sealed quotes`);
  const rivalAgent = find(suppliers, rival.account);
  const mismatchedReveal = await rivalAgent.reveal(
    rfq.rfqNo,
    rivalAgent.undercut(rfq.rfqNo, UNDERCUT_USDC),
  );
  line(`reveal_quote by ${rival.account} at ${usd(UNDERCUT_USDC)}/kg`, mismatchedReveal);
  const late = await rivalAgent.seal(rfq, UNDERCUT_USDC / 1_000_000);
  const lateSeal = late?.commit ?? mismatchedReveal;
  line(`commit_quote by ${rival.account} after the deadline`, lateSeal);
  const second = await rivalAgent.reveal(rfq.rfqNo);
  reveals.push(second);
  line(`reveal_quote by ${rival.account}`, second);

  // Kevin ranks only the opened quotes, then awards the round on chain.
  const afterReveal = await readSealedRound(chain, ctx, rfq.rfqNo);
  const opened = openedQuotes(db, afterReveal);
  recordQuotes(db, rfq, opened.answers);
  const ranking = rankQuotes(db, rfq, closesAt);
  const winner = ranking.selected;
  const winnerAccount = winner
    ? opened.answers.find((a) => a.vendor === winner.vendorCode)?.account
    : undefined;
  const award = winnerAccount ? await awardSealedRound(chain, ctx, rfq, winnerAccount) : null;
  if (award) line(`award_sealed_round to ${winnerAccount}`, award);
  const round = await readSealedRound(chain, ctx, rfq.rfqNo);

  staff.push(
    `${clockTime(closesAt)}  ${plural(opened.answers.length, "sealed quote")}, opened at ` +
      `${clockTime(closesAt)}. Each matched the quote sealed before the deadline.`,
  );
  if (mismatchedReveal.status !== "success" || lateSeal.status !== "success") {
    staff.push(
      `${clockTime(closesAt)}  ${rivalAgent.spec.name} tried to lower its price after the ` +
        `opening. Refused: its sealed price stands.`,
    );
  }
  staff.push(`${clockTime(closesAt)}  ${ranking.sentence}`);
  if (winner && award?.status === "success") {
    staff.push(`${clockTime(closesAt)}  Kevin chose ${winner.vendorName}. The award is on record.`);
  }
  for (const b of round.bids) {
    curtain.push(
      `${b.supplier}: sealed at block time ${b.committed_at}, opened at ${b.revealed_at ?? "never"}` +
        `${b.quote ? `, quote ${b.quote}` : ""}`,
    );
  }
  curtain.push(
    `deadline at block time ${round.closes_at}; awarded to ${round.awarded ?? "nobody"}`,
  );

  const refusals: RefusedCall[] = [];
  const refusedBy = (account: string, method: string, o: LoggedOutcome) => {
    if (o.status !== "success") {
      refusals.push({ account, method, reason: o.errorMessage ?? o.status, tx: o.txHash });
    }
  };
  for (const q of refused) refusedBy(q.account, "commit_quote", q.commit);
  refusedBy(deps.kevin, "award_sealed_round", earlyAward);
  refusedBy(leader.account, "reveal_quote", earlyReveal);
  refusedBy(rival.account, "reveal_quote", mismatchedReveal);
  refusedBy(rival.account, "commit_quote", lateSeal);
  const txs: Record<string, string | null> = { open: open.txHash };
  for (const q of accepted) txs[`commit:${q.account}`] = q.commit.txHash;
  txs[`reveal:${leader.account}`] = first.txHash;
  txs[`reveal:${rival.account}`] = second.txHash;
  txs.award = award?.txHash ?? null;
  const proof: SealedRoundProof = {
    kind: "sealed_round",
    network: deps.network,
    contract: deps.policyContract,
    round,
    txs,
    refused: refusals,
  };

  return {
    rfq,
    open,
    sealed,
    peek: { kevinRefusal, before, earlyAward, earlyReveal },
    reveals,
    mismatchedReveal,
    lateSeal,
    opened,
    ranking,
    award,
    round,
    proof,
    staff,
    curtain,
  };
}

/**
 * The sealed-bid attacks (attack suite 8–10), read from a finished round. Each holds only when
 * every layer it targets refused it.
 */
export function sealedAttacks(run: SealedRoundRun): AttackResult[] {
  const { peek, round } = run;
  const hidden = peek.before.bids.every((b) => b.quote === null);
  const txs = (...outcomes: LoggedOutcome[]) =>
    outcomes.flatMap((o) => (o.txHash ? [o.txHash] : []));
  const said = (o: LoggedOutcome) => `"${o.errorMessage ?? o.status}"`;
  const undercut = `"unitPriceUsdc":${UNDERCUT_USDC}`;
  const results: AttackResult[] = [
    {
      attack: "Peek at sealed quotes",
      held:
        peek.before.phase === "sealed" &&
        hidden &&
        peek.kevinRefusal !== null &&
        peek.earlyAward.status === "refused" &&
        peek.earlyReveal.status === "refused",
      evidence: [
        `Chain before the deadline: ${plural(peek.before.bids.length, "fingerprint")}, ` +
          `${hidden ? "no prices" : "PRICES VISIBLE"}.`,
        `Kevin's ranking: "${peek.kevinRefusal ?? "ranked a sealed round"}"`,
        `Contract, when Kevin's key awards the round early: ${said(peek.earlyAward)}`,
        `Contract, when a supplier opens its quote early: ${said(peek.earlyReveal)}`,
      ],
      txHashes: txs(peek.earlyAward, peek.earlyReveal),
    },
    {
      attack: "Reveal a different price than the one sealed",
      held:
        run.mismatchedReveal.status === "refused" &&
        run.opened.answers.length > 0 &&
        round.bids.every((b) => !b.quote?.includes(undercut)),
      evidence: [
        `Contract, when a supplier opens a ${usd(UNDERCUT_USDC)}/kg quote in place of the one ` +
          `it sealed: ${said(run.mismatchedReveal)}`,
        `Kevin ranked the sealed prices: ${run.ranking.sentence}`,
      ],
      txHashes: txs(run.mismatchedReveal),
    },
    {
      attack: "Seal a quote after the deadline",
      held:
        run.lateSeal.status === "refused" &&
        round.bids.every((b) => BigInt(b.committed_at) < BigInt(round.closes_at)),
      evidence: [
        `Contract, when a supplier seals a ${usd(UNDERCUT_USDC)}/kg quote after the deadline: ` +
          said(run.lateSeal),
        `Every quote in the round was sealed before block time ${round.closes_at}.`,
      ],
      txHashes: txs(run.lateSeal),
    },
  ];
  return results.map((r) => ({ ...r, network: run.proof.network }));
}
