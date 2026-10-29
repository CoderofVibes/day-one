// The in-process bus (ARCHITECTURE §5.4): Kevin publishes an RFQ, every supplier agent that
// sells the material answers with a quote. Agents answer one after another in the order they
// joined, so a recorded run replays in the same order.

import type { ChainClient } from "@day-one/server/chain/client";
import type { RfqRequest } from "@day-one/server/quotes";
import { SUPPLIERS } from "@day-one/server/seed/quotes";
import { type QuoteReply, SupplierAgent, type SupplierContext } from "./agent.ts";

export class QuoteBus {
  constructor(private readonly agents: readonly SupplierAgent[]) {}

  async requestQuotes(rfq: RfqRequest): Promise<QuoteReply[]> {
    const replies: QuoteReply[] = [];
    for (const agent of this.agents) {
      const reply = await agent.quote(rfq);
      if (reply) replies.push(reply);
    }
    return replies;
  }
}

/** The four supplier agents of FICTIONAL_DATA §5 on one chain client. */
export function demoSuppliers(chain: ChainClient, ctx: SupplierContext) {
  return SUPPLIERS.map((spec) => new SupplierAgent(spec, chain, ctx));
}

/** A bus with the demo's supplier agents on it. */
export function demoBus(chain: ChainClient, ctx: SupplierContext) {
  return new QuoteBus(demoSuppliers(chain, ctx));
}
