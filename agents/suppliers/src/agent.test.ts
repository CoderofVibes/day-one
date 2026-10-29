import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { chainTx } from "@day-one/server/ledger/schema";
import { quoteFingerprint, type RfqRequest } from "@day-one/server/quotes";
import { fingerprint, verifyAnchor } from "@day-one/server/records/anchors";
import { describe, expect, it } from "vitest";
import { demoBus } from "./bus.ts";

const POLICY = "spend-policy.acme-holdings.testnet";
const APPROVED = new Set([
  "northgate-ingredients.testnet",
  "ridgeway-ascorbics.testnet",
  "bayfront-labsupply.testnet",
]);
const GATE = "Only a registered purchasing agent or an approved supplier can anchor records.";

/** The contract's anchor gate for suppliers (CONTRACTS.md §6), and get_anchor. */
class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  anchors = new Map<string, { kind: string; hash: string; by: string }>();
  private n = 0;
  async send(call: ChainCall): Promise<ChainOutcome> {
    this.calls.push(call);
    const a = call.args as { kind: string; ref_id: string; hash: string };
    const base = { txHash: `Tx${++this.n}`, events: [], returnValue: null, blockHeight: this.n };
    if (!APPROVED.has(call.signerId)) return { ...base, status: "refused", errorMessage: GATE };
    this.anchors.set(a.ref_id, { kind: a.kind, hash: a.hash, by: call.signerId });
    return { ...base, status: "success", errorMessage: null };
  }
  async view(view: ChainView) {
    return this.anchors.get((view.args as { ref_id: string }).ref_id) ?? null;
  }
}

const rfq: RfqRequest = {
  id: 1,
  rfqNo: "RFQ-2611-01",
  material: "ASC",
  qtyBase: 700_000_000,
  needBy: "2026-11-17",
};
const salt = (account: string) => account.slice(0, 4).padEnd(32, "0");

function setup() {
  const db: Ledger = openLedger();
  const fake = new FakeChain();
  const chain = new ChainClient(db, fake);
  return { db, fake, bus: demoBus(chain, { policyContract: POLICY, salt }) };
}

describe("supplier agents on the bus", () => {
  it("every agent that sells the material quotes, with a salted fingerprint anchored from its own account", async () => {
    const { db, fake, bus } = setup();
    const replies = await bus.requestQuotes(rfq);
    expect(replies.map((r) => [r.vendor, r.unitPrice, r.leadTimeDays, r.freight])).toEqual([
      ["QCD", 5.9, 4, 0],
      ["NGI", 7.1, 7, 180],
      ["RWA", 7.35, 5, 165],
    ]);
    expect(fake.calls.map((c) => [c.kind, c.method, c.signerId, c.viaRelayer ?? false])).toEqual([
      ["quote", "anchor", "quickchem-direct.testnet", false],
      ["quote", "anchor", "northgate-ingredients.testnet", false],
      ["quote", "anchor", "ridgeway-ascorbics.testnet", false],
    ]);
    const northgate = replies[1];
    if (!northgate) throw new Error("no Northgate quote");
    expect(northgate?.terms).toEqual({
      rfq: "RFQ-2611-01",
      supplier: "northgate-ingredients.testnet",
      material: "ASC",
      qtyBase: 700_000_000,
      unitPriceUsdc: 7_100_000,
      freightUsdc: 180_000_000,
      leadTimeDays: 7,
    });
    expect(northgate.hash).toBe(quoteFingerprint(northgate.terms, northgate.salt));
    expect(fake.calls[1]?.args).toEqual({
      kind: "quote",
      ref_id: "RFQ-2611-01/northgate-ingredients.testnet",
      hash: northgate.hash,
      prev: null,
    });
    // Every anchor, refused or not, is in the chain log.
    expect(
      db
        .select()
        .from(chainTx)
        .all()
        .map((r) => [r.signerId, r.status]),
    ).toEqual([
      ["quickchem-direct.testnet", "refused"],
      ["northgate-ingredients.testnet", "success"],
      ["ridgeway-ascorbics.testnet", "success"],
    ]);
  });

  it("an unapproved supplier's anchor is refused by the contract, and it still quotes", async () => {
    const { bus } = setup();
    const [quickchem] = await bus.requestQuotes(rfq);
    expect(quickchem?.vendor).toBe("QCD");
    expect(quickchem?.anchor.status).toBe("refused");
    expect(quickchem?.anchor.errorMessage).toBe(GATE);
  });

  it("the anchored fingerprint verifies from the terms and salt, and not from a changed price", async () => {
    const { fake, bus } = setup();
    const [, northgate] = await bus.requestQuotes(rfq);
    if (!northgate) throw new Error("no Northgate quote");
    const view = (v: ChainView) => fake.view(v);
    const refId = "RFQ-2611-01/northgate-ingredients.testnet";
    const terms = northgate.terms;
    const good = await verifyAnchor(view, POLICY, refId, fingerprint(terms, northgate.salt));
    expect(good.result).toBe("MATCH");
    expect(good.onChain?.by).toBe("northgate-ingredients.testnet");
    const cheaper = { ...terms, unitPriceUsdc: 7_000_000 };
    const bad = await verifyAnchor(view, POLICY, refId, fingerprint(cheaper, northgate.salt));
    expect(bad.result).toBe("MISMATCH");
  });

  it("asks nobody who does not sell the material", async () => {
    const { fake, bus } = setup();
    const replies = await bus.requestQuotes({ ...rfq, material: "ACN", qtyBase: 4 });
    expect(replies.map((r) => r.vendor)).toEqual(["BLS"]);
    expect(fake.calls).toHaveLength(1);
  });
});
