import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { chainTx } from "@day-one/server/ledger/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptAndShip, type Shipment } from "./shipping.ts";

const POLICY = "spend-policy.acme-holdings.testnet";
const NORTHGATE = "northgate-ingredients.testnet";

const ok = (txHash: string): ChainOutcome => ({
  status: "success",
  txHash,
  errorMessage: null,
  events: [],
  returnValue: null,
  blockHeight: 1,
});

class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  constructor(
    public onChainPo: unknown,
    private readonly outcomes: ChainOutcome[] = [],
  ) {}
  async send(call: ChainCall) {
    this.calls.push(call);
    const next = this.outcomes.shift();
    if (!next) throw new Error(`unexpected call ${call.method}`);
    return next;
  }
  async view(_view: ChainView) {
    return this.onChainPo;
  }
}

const shipment: Shipment = {
  poNo: "PO-1042",
  poId: 7,
  supplierAccount: NORTHGATE,
  amount: 5_150_000_000n,
  supplierLot: "NG-24-8812",
};
const funded = { supplier: NORTHGATE, amount: "5150000000", status: "Funded" };

let db: Ledger;
beforeEach(() => {
  db = openLedger();
});

describe("supplier ships a funded PO", () => {
  it("accepts, then ships with its lot, signing from its own account", async () => {
    const fake = new FakeChain(funded, [ok("AcceptHash"), ok("ShipHash")]);
    const r = await acceptAndShip(new ChainClient(db, fake), shipment, { policyContract: POLICY });

    expect(r.status).toBe("shipped");
    expect(fake.calls.map((c) => [c.kind, c.signerId, c.viaRelayer ?? false, c.args])).toEqual([
      ["accept_po", NORTHGATE, false, { po_id: "PO-1042" }],
      ["mark_shipped", NORTHGATE, false, { po_id: "PO-1042", supplier_lot: "NG-24-8812" }],
    ]);
    expect(
      db
        .select()
        .from(chainTx)
        .all()
        .map((t) => t.kind),
    ).toEqual(["accept_po", "mark_shipped"]);
  });

  it("only ships when an accepted PO is resumed", async () => {
    const fake = new FakeChain({ ...funded, status: "Accepted" }, [ok("ShipHash")]);
    const r = await acceptAndShip(new ChainClient(db, fake), shipment, { policyContract: POLICY });
    expect(r.status).toBe("shipped");
    expect(fake.calls.map((c) => c.method)).toEqual(["mark_shipped"]);
  });

  it.each([
    [null, "PO-1042 is not on chain."],
    [{ ...funded, amount: "5000000000" }, "PO-1042 holds 5000000000, not the 5150000000 agreed."],
    [
      { ...funded, supplier: "ridgeway-ascorbics.testnet" },
      "PO-1042 is with ridgeway-ascorbics.testnet, not northgate-ingredients.testnet.",
    ],
    [{ ...funded, status: "Cancelled" }, "PO-1042 is Cancelled, not waiting to ship."],
  ])(
    "declines without a transaction when the escrow does not hold the deal (%#)",
    async (po, reason) => {
      const fake = new FakeChain(po);
      const r = await acceptAndShip(new ChainClient(db, fake), shipment, {
        policyContract: POLICY,
      });
      expect(r).toEqual({ status: "declined", reason, outcomes: [] });
      expect(fake.calls).toHaveLength(0);
    },
  );
});
