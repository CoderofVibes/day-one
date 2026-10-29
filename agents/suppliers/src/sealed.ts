// A supplier agent in a sealed quote round (CONTRACTS.md §10). Before the deadline it seals its
// quote: the contract stores only the SHA-256 of the quote text, and the text and salt stay with
// the agent, so nobody, Kevin included, can read the price yet. After the deadline it reveals
// the text; the contract takes it only if it hashes to the seal.

import { sha256Hex } from "@day-one/server/canonical";
import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import {
  type QuoteTerms,
  quoteTermsOf,
  type RfqRequest,
  sealedQuoteText,
} from "@day-one/server/quotes";
import type { SupplierSpec } from "@day-one/server/seed/quotes";
import type { SupplierContext } from "./agent.ts";

/** A quote the agent sealed: what it keeps private until the deadline, and the commit outcome. */
export interface SealedQuote {
  account: string;
  terms: QuoteTerms;
  salt: string;
  /** The exact text it will reveal. */
  text: string;
  hash: string;
  commit: LoggedOutcome;
}

export class SealedQuoteAgent {
  private readonly sealed = new Map<string, SealedQuote>();

  constructor(
    readonly spec: SupplierSpec,
    private readonly chain: ChainClient,
    private readonly ctx: SupplierContext,
  ) {}

  get account() {
    return this.spec.account;
  }

  supplies(material: string) {
    return material in this.spec.prices;
  }

  /**
   * Seals a quote for the RFQ's round, or returns null when the agent does not sell it.
   * `unitPrice` (dollars) replaces the list price: what a supplier trying to rebid sends.
   */
  async seal(rfq: RfqRequest, unitPrice?: number): Promise<SealedQuote | null> {
    const listed = this.spec.prices[rfq.material];
    if (!listed) return null;
    const price = unitPrice === undefined ? listed : { ...listed, unitPrice };
    const terms = quoteTermsOf(rfq, this.spec.account, price);
    const salt = this.ctx.salt(this.spec.account);
    const text = sealedQuoteText(terms, salt);
    const hash = sha256Hex(text);
    const commit = await this.chain.call({
      kind: "quote",
      signerId: this.spec.account,
      receiverId: this.ctx.policyContract,
      method: "commit_quote",
      args: { round_id: rfq.rfqNo, hash },
      related: { type: "rfq", id: rfq.id },
    });
    const quote = { account: this.spec.account, terms, salt, text, hash, commit };
    if (commit.status === "success") this.sealed.set(rfq.rfqNo, quote);
    return quote;
  }

  /** Reveals the sealed quote; `text` replaces it, which the contract refuses unless identical. */
  reveal(rfqNo: string, text?: string): Promise<LoggedOutcome> {
    const quote = this.sealed.get(rfqNo);
    if (!quote && text === undefined)
      throw new Error(`${this.account} sealed nothing for ${rfqNo}`);
    return this.chain.call({
      kind: "quote",
      signerId: this.spec.account,
      receiverId: this.ctx.policyContract,
      method: "reveal_quote",
      args: { round_id: rfqNo, quote: text ?? quote?.text },
    });
  }

  /** The quote text with a lower unit price than the one sealed: what a reveal attack sends. */
  undercut(rfqNo: string, unitPriceUsdc: number): string {
    const quote = this.sealed.get(rfqNo);
    if (!quote) throw new Error(`${this.account} sealed nothing for ${rfqNo}`);
    return sealedQuoteText({ ...quote.terms, unitPriceUsdc }, quote.salt);
  }
}
