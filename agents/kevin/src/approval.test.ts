import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "@day-one/server/chain/client";
import type { ChainOutcome } from "@day-one/server/chain/outcome";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { approvals, purchaseOrders, staff } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { handleApprovalReply } from "./approval.ts";
import { forecastMaterial } from "./forecast.ts";
import { draftPoFromRanking, type PoDraft, rankQuotes, requestQuotes } from "./purchasing.ts";
import { submitPo } from "./submit.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KEVIN = "kevin.plant-b.acme-holdings.testnet";
const POLICY = "spend-policy.acme-holdings.testnet";
const DIRECTOR = "director.plant-b.acme-holdings.testnet";
const ctx = { kevin: KEVIN, policyContract: POLICY, now: NOW };
const REFUSAL =
  "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.";

const result = (
  status: ChainOutcome["status"],
  txHash: string,
  errorMessage: string | null = null,
) => ({
  status,
  txHash,
  errorMessage,
  events: [],
  returnValue: null,
  blockHeight: 1,
});

class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  constructor(private readonly outcomes: ChainOutcome[]) {}
  async send(call: ChainCall) {
    this.calls.push(call);
    const next = this.outcomes.shift();
    if (!next) throw new Error(`unexpected call ${call.method}`);
    return next;
  }
  async view(_view: ChainView) {
    return { name: "Kevin", per_po_limit: "2500000000", approver: DIRECTOR };
  }
}

let db: Ledger;
let po: PoDraft;
let linda: number;
let ray: number;

async function refusedPo1042(fake: FakeChain) {
  confirmBr1045(db);
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
  const rfq = requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);
  po = draftPoFromRanking(db, rankQuotes(db, rfq, NOW), "PO-1042", "5a17".repeat(8));
  await submitPo(db, new ChainClient(db, fake), po, { ...ctx, summary: "700 kg ascorbic acid" });
}

beforeEach(() => {
  db = openLedger();
  seedLedger(db);
  linda = db.select().from(staff).where(eq(staff.name, "Linda Park")).get()?.id ?? 0;
  ray = db.select().from(staff).where(eq(staff.role, "purchaser")).get()?.id ?? 0;
});

describe("approval replies", () => {
  it("turns YES 1042 into a relayed approve_po and Kevin's funded retry (steps 8 and 9)", async () => {
    const fake = new FakeChain([
      result("refused", "RefusedHash", REFUSAL),
      result("success", "ApproveHash"),
      result("success", "RetryHash"),
    ]);
    await refusedPo1042(fake);
    const chain = new ChainClient(db, fake);
    const reply = await handleApprovalReply(
      db,
      chain,
      { fromStaffId: linda, text: "YES 1042" },
      ctx,
    );

    expect(reply.sentences).toEqual([
      "Approved by Linda Park.",
      "PO-1042 sent to Northgate Ingredients. Funds held until delivery passes QC.",
    ]);
    expect(fake.calls[1]).toMatchObject({
      kind: "approve_po",
      signerId: DIRECTOR,
      viaRelayer: true,
      args: {
        po_id: "PO-1042",
        supplier: "northgate-ingredients.testnet",
        amount: "5150000000",
        category: "raw_material",
        po_hash: po.poHash,
        refused_tx: "RefusedHash",
      },
    });
    // The retry is the identical submit_po.
    expect(fake.calls[2]).toEqual(fake.calls[0]);
    expect(db.select().from(approvals).get()).toMatchObject({
      state: "approved",
      responseText: "YES 1042",
    });
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "funded",
    );
  });

  it("ignores a reply that does not name the PO and asks again", async () => {
    const fake = new FakeChain([result("refused", "RefusedHash", REFUSAL)]);
    await refusedPo1042(fake);
    const chain = new ChainClient(db, fake);
    for (const text of ["yes", "YES 1041", "Yes please!"]) {
      const reply = await handleApprovalReply(db, chain, { fromStaffId: linda, text }, ctx);
      expect(reply.handled).toBe(false);
      expect(reply.sentences).toEqual([
        "Please reply YES 1042 or NO 1042 so I know which PO you mean.",
      ]);
    }
    expect(fake.calls).toHaveLength(1);
    expect(db.select().from(approvals).get()?.state).toBe("requested");
  });

  it("accepts a reply only from the approver the request went to", async () => {
    const fake = new FakeChain([result("refused", "RefusedHash", REFUSAL)]);
    await refusedPo1042(fake);
    const reply = await handleApprovalReply(
      db,
      new ChainClient(db, fake),
      { fromStaffId: ray, text: "YES 1042" },
      ctx,
    );
    expect(reply.sentences).toEqual(["There is nothing waiting for your approval."]);
    expect(fake.calls).toHaveLength(1);
  });

  it("records NO 1042 on chain and leaves the PO waiting", async () => {
    const fake = new FakeChain([
      result("refused", "RefusedHash", REFUSAL),
      result("success", "RejectHash"),
    ]);
    await refusedPo1042(fake);
    const reply = await handleApprovalReply(
      db,
      new ChainClient(db, fake),
      { fromStaffId: linda, text: "no 1042" },
      ctx,
    );
    expect(fake.calls[1]).toMatchObject({
      method: "reject_po",
      signerId: DIRECTOR,
      viaRelayer: true,
    });
    expect(reply.sentences[0]).toBe("Declined by Linda Park. PO-1042 is on hold; Kevin told Ray.");
    expect(db.select().from(approvals).get()?.state).toBe("declined");
    expect(db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get()?.status).toBe(
      "awaiting_approval",
    );
  });

  it("keeps the request open when the relayed approval does not go through", async () => {
    const fake = new FakeChain([
      result("refused", "RefusedHash", REFUSAL),
      result("failed", "", "relayer out of gas"),
    ]);
    await refusedPo1042(fake);
    const reply = await handleApprovalReply(
      db,
      new ChainClient(db, fake),
      { fromStaffId: linda, text: "YES 1042" },
      ctx,
    );
    expect(reply.sentences[0]).toMatch(/did not go through/);
    expect(db.select().from(approvals).get()?.state).toBe("requested");
  });
});
