// Kevin's morning review on Ray's screen (research 24 §2, OPEN_QUESTIONS #38): the mailbox read
// overnight, each message checked against the ledger as the run starts, and the drafts left for
// Ray to sign with the morning coffee. The review is read once per run, on the ledger the run
// began with (the same answers npm run review replays), and kept: a signature changes the plan
// or a vendor's card through `applyProposal` and never where an order pays, so the drafts need
// no second look. Who signed what is remembered for the run; "Start over" clears it.

import { DEMO_CLOCK } from "@day-one/kevin/demo";
import {
  applyProposal,
  type MorningReview,
  morningReview,
  type Proposal,
  reviewSince,
} from "@day-one/kevin/morningReview";
import type { Ledger } from "@day-one/server/ledger/db";
import type { LlmClient } from "@day-one/server/llm/types";
import { MAILBOX, MAILBOX_FACILITY, MAILBOX_OWNER } from "@day-one/server/seed/mailbox";

export interface Signature {
  by: string;
  at: string;
  /** What the signature did, in Kevin's words ("BR-B-1049 moved from Nov 19 to Nov 12."). */
  outcome: string;
}

export type SignedProposal = Proposal & { signed: Signature | null };

/** The review as Ray's screen draws it: the proposals, each with its signature when it has one. */
export interface ReviewState extends Omit<MorningReview, "proposals"> {
  proposals: SignedProposal[];
  /** Drafts still waiting for a signature. */
  toSign: number;
}

export class ReviewRefused extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export class ReviewDesk {
  private review: Promise<MorningReview> | null = null;
  private readonly signed = new Map<string, Signature>();

  constructor(
    private readonly db: Ledger,
    private readonly llm: LlmClient,
  ) {}

  /** The review, read on first use and kept for the run. */
  async state(): Promise<ReviewState> {
    this.review ??= morningReview(this.db, this.llm, MAILBOX, {
      now: DEMO_CLOCK.start,
      facility: MAILBOX_FACILITY,
      since: reviewSince(DEMO_CLOCK.start),
    });
    const review = await this.review;
    const proposals = review.proposals.map((p) => ({
      ...p,
      signed: this.signed.get(p.messageId) ?? null,
    }));
    return {
      ...review,
      proposals,
      toSign: proposals.filter((p) => p.decision === "sign" && !p.signed).length,
    };
  }

  /** Ray signs one draft: the change lands in the ledger and the signature is kept. */
  async sign(messageId: string, by = MAILBOX_OWNER, at: string): Promise<ReviewState> {
    const { proposals } = await this.state();
    const proposal = proposals.find((p) => p.messageId === messageId);
    if (!proposal) throw new ReviewRefused(404, `${messageId} is not in the review`);
    if (proposal.signed) {
      throw new ReviewRefused(409, `${messageId} was signed by ${proposal.signed.by} already`);
    }
    if (proposal.decision !== "sign" || !proposal.action) {
      throw new ReviewRefused(400, `${messageId}: nothing to sign (${proposal.decision})`);
    }
    let outcome: string;
    try {
      outcome = applyProposal(this.db, proposal, by, at);
    } catch (error) {
      // The plan moved on since Kevin read the message: the draft is stale, not wrong.
      throw new ReviewRefused(409, error instanceof Error ? error.message : String(error));
    }
    this.signed.set(messageId, { by, at, outcome });
    return this.state();
  }
}
