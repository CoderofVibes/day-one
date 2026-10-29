// A rule-based supplier agent (ARCHITECTURE §5.4, decision #23): it answers an RFQ for a
// material it sells from its price list, fingerprints the quote with a fresh salt, anchors the
// fingerprint on the spend-policy contract from its own account, and sends Kevin the terms, the
// salt and the anchor. The contract takes the anchor only from a supplier HQ has approved and
// only for the supplier's own quote, so an unqualified vendor's anchor comes back refused; the
// agent still quotes, and Kevin's ranking is what excludes it.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import {
  type QuoteTerms,
  quoteFingerprint,
  quoteRefId,
  quoteTermsOf,
  type RfqRequest,
} from "@day-one/server/quotes";
import type { QuoteSpec, SupplierSpec } from "@day-one/server/seed/quotes";
import { priceFor } from "./pricing.ts";

/** A quote as the bus delivers it to Kevin. */
export interface QuoteReply extends QuoteSpec {
  account: string;
  terms: QuoteTerms;
  salt: string;
  hash: string;
  /** The supplier's anchor of the hash, refused or not. */
  anchor: LoggedOutcome;
}

export interface SupplierContext {
  policyContract: string;
  /** A fresh 16-byte hex salt per quote; fixed per recording so replay matches. */
  salt: (account: string) => string;
}

export class SupplierAgent {
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
   * Quotes the RFQ, or null when the agent does not sell the material. A pooled RFQ large
   * enough to reach one of the supplier's volume breaks (pricing.ts) gets the break price.
   */
  async quote(rfq: RfqRequest): Promise<QuoteReply | null> {
    const price = priceFor(this.spec, rfq.material, rfq.qtyBase);
    if (!price) return null;
    const terms = quoteTermsOf(rfq, this.spec.account, price);
    const salt = this.ctx.salt(this.spec.account);
    const hash = quoteFingerprint(terms, salt);
    const anchor = await this.chain.call({
      kind: "quote",
      signerId: this.spec.account,
      receiverId: this.ctx.policyContract,
      method: "anchor",
      args: { kind: "quote", ref_id: quoteRefId(rfq.rfqNo, this.spec.account), hash, prev: null },
      related: { type: "rfq", id: rfq.id },
    });
    return {
      vendor: this.spec.vendor,
      name: this.spec.name,
      account: this.spec.account,
      ...price,
      terms,
      salt,
      hash,
      anchor,
    };
  }
}
