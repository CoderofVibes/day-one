import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { approvals, chainTx, facilities, purchaseOrders } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";
import { draftPo, draftPoFromRanking, rankQuotes, requestQuotes } from "./purchasing.ts";
import { submitPo } from "./submit.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KEVIN = "kevin.plant-b.acme-holdings.testnet";
const POLICY = "spend-policy.acme-holdings.testnet";
const SALT = "5a17".repeat(8);
const USD = 1_000_000;
const ctx = (summary: string) => ({ kevin: KEVIN, policyContract: POLICY, summary, now: NOW });

const POLICY_VIEW = {
  name: "Kevin",
  plant: "plant-b.acme-holdings.testnet",
  per_po_limit: String(2_500 * USD),
  monthly_limit: String(60_000 * USD),
  categories: ["raw_material", "packaging", "lab_chemical"],
  approver: "director.plant-b.acme-holdings.testnet",
  active: true,
};

/** Answers like the testnet contract would, from a queue. */
class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  constructor(private readonly outcomes: ChainOutcome[]) {}
  async send(call: ChainCall) {
    this.calls.push(call);
    const next = this.outcomes.shift();
    if (!next) throw new Error("no outcome");
    return next;
  }
  async view(view: ChainView) {
    if (view.method !== "get_agent_policy") throw new Error(view.method);
    return POLICY_VIEW;
  }
}

const outcome = (status: ChainOutcome["status"], errorMessage: string | null = null) => ({
  status,
  txHash: `Hash${status}`,
  errorMessage,
  events: [],
  returnValue: null,
  blockHeight: 1,
});

let db: Ledger;
let plantB: number;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
  plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get()?.id ?? 0;
});

function po1041() {
  return draftPo(db, {
    poNo: "PO-1041",
    vendor: "BLS",
    facilityId: plantB,
    lines: [
      { material: "ACN", qtyBase: 4, unitPriceUsdc: 128 * USD },
      { material: "BUF", qtyBase: 4, unitPriceUsdc: 25 * USD },
    ],
    needBy: null,
    salt: SALT,
  });
}

function po1042() {
  confirmBr1045(db);
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
  const rfq = requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);
  return draftPoFromRanking(db, rankQuotes(db, rfq, NOW), "PO-1042", SALT);
}

describe("submitPo", () => {
  it("sends the drafted terms as Kevin and marks a funded PO (DEMO_SCRIPT step 6)", async () => {
    const fake = new FakeChain([outcome("success")]);
    const po = po1041();
    const result = await submitPo(db, new ChainClient(db, fake), po, ctx("lab chemicals"));
    expect(fake.calls[0]).toMatchObject({
      signerId: KEVIN,
      receiverId: POLICY,
      method: "submit_po",
      args: {
        po_id: "PO-1041",
        supplier: "bayfront-labsupply.testnet",
        amount: "612000000",
        category: "lab_chemical",
        po_hash: po.poHash,
      },
    });
    expect(result.sentence).toBe(
      "PO-1041 to Bayfront Lab Supply, $612.00 — approved automatically and funded.",
    );
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "funded",
    );
    expect(db.select().from(chainTx).get()).toMatchObject({
      relatedType: "purchase_order",
      relatedId: po.id,
    });
  });

  it("sends the ordered quantity and a signed decision only when given (CONTRACTS.md §11)", async () => {
    const fake = new FakeChain([outcome("success"), outcome("success")]);
    const chain = new ChainClient(db, fake);
    await submitPo(db, chain, po1041(), ctx("lab chemicals"));
    expect(fake.calls[0]?.args).not.toHaveProperty("qty");
    expect(fake.calls[0]?.args).not.toHaveProperty("decision");
    const decision = { text: "m:a:b", signature: "0x01", response: "{}" };
    await submitPo(db, chain, po1042(), {
      ...ctx("ascorbic acid"),
      qtyBase: 700_000_000,
      decision,
    });
    expect(fake.calls[1]?.args).toMatchObject({ qty: "700000000", decision });
  });

  it("turns the over-limit refusal into Linda's approval request (DEMO_SCRIPT step 7)", async () => {
    const po = po1042();
    const refusal =
      "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.";
    const chain = new ChainClient(db, new FakeChain([outcome("refused", refusal)]));
    const result = await submitPo(db, chain, po, ctx("700 kg ascorbic acid"));
    expect(result.status).toBe("awaiting_approval");
    expect(result.sentence).toBe(
      "PO-1042 to Northgate Ingredients, $5,150.00 is over Kevin's $2,500.00 limit. Sent to Linda for approval.",
    );
    // FICTIONAL_DATA §9, word for word.
    expect(result.requestText).toBe(
      "Kevin needs approval: PO-1042, $5,150.00 to Northgate Ingredients for 700 kg ascorbic acid. Over Kevin's $2,500 limit. Reply YES 1042 or NO 1042.",
    );
    const approval = db.select().from(approvals).get();
    expect(approval).toMatchObject({ state: "requested", refusedTxId: result.outcome.id });
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "awaiting_approval",
    );
  });

  it("asks for approval with the contract's reason when the limit is not the cause", async () => {
    const po = po1041();
    const refusal =
      "PO-1041: $612.00 would take lab_chemical spending this month to $2,112.00, over the cap of $2,000.00; director approval required.";
    const chain = new ChainClient(db, new FakeChain([outcome("refused", refusal)]));
    const result = await submitPo(db, chain, po, ctx("lab chemicals"));
    expect(result.requestText).toContain(
      "$612.00 would take lab_chemical spending this month to $2,112.00, over the cap of $2,000.00.",
    );
    expect(result.sentence).toMatch(/needs Linda's approval/);
  });

  it("does not ask anyone when the contract says no approval can override", async () => {
    const po = po1041();
    const refusal =
      "bayfront-labsupply.testnet is not an approved supplier; no approval can override this.";
    const chain = new ChainClient(db, new FakeChain([outcome("refused", refusal)]));
    const result = await submitPo(db, chain, po, ctx("lab chemicals"));
    expect(result.status).toBe("refused");
    expect(db.select().from(approvals).all()).toEqual([]);
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "refused",
    );
  });

  it("leaves the PO a draft when the transaction itself failed", async () => {
    const po = po1041();
    const chain = new ChainClient(
      db,
      new FakeChain([outcome("failed", "Exceeded the prepaid gas")]),
    );
    const result = await submitPo(db, chain, po, ctx("lab chemicals"));
    expect(result.status).toBe("failed");
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "draft",
    );
  });
});
