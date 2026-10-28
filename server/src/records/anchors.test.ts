import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../canonical.ts";
import {
  type ChainCall,
  ChainClient,
  type ChainTransport,
  type ChainView,
} from "../chain/client.ts";
import type { ChainOutcome } from "../chain/outcome.ts";
import { type Ledger, openLedger } from "../ledger/db.ts";
import { appendLotEvent } from "../ledger/events.ts";
import { anchors, lotEvents, lots } from "../ledger/schema.ts";
import { seedLedger } from "../seed/index.ts";
import { anchorBatch, fingerprint, nextLotEventRange, verifyAnchor } from "./anchors.ts";

const ctx = {
  kevin: "kevin.plant-b.acme-holdings.testnet",
  policyContract: "spend-policy.acme-holdings.testnet",
  now: "2026-11-09T13:06:00.000Z",
};

class FakeChain implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  calls: ChainCall[] = [];
  stored = new Map<string, { kind: string; hash: string; prev: string | null; by: string }>();
  constructor(private readonly status: ChainOutcome["status"] = "success") {}
  async send(call: ChainCall): Promise<ChainOutcome> {
    this.calls.push(call);
    if (this.status === "success") {
      for (const item of call.args.items as {
        kind: string;
        ref_id: string;
        hash: string;
        prev: string | null;
      }[]) {
        this.stored.set(item.ref_id, {
          kind: item.kind,
          hash: item.hash,
          prev: item.prev,
          by: call.signerId,
        });
      }
    }
    return {
      status: this.status,
      txHash: "AnchorHash",
      errorMessage: null,
      events: [],
      returnValue: null,
      blockHeight: 1,
    };
  }
  async view(view: ChainView) {
    const stored = this.stored.get(String(view.args?.ref_id));
    return stored ? { ...stored, at: "1" } : null;
  }
}

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("fingerprints", () => {
  it("hash the canonical record with its salt", () => {
    const record = { batch: "BR-B-1045", asc_kg: "412.350" };
    expect(fingerprint(record, "ab")).toBe(sha256Hex(canonicalJson({ record, salt: "ab" })));
    expect(fingerprint({ asc_kg: "412.350", batch: "BR-B-1045" }, "ab")).toBe(
      fingerprint(record, "ab"),
    );
    expect(fingerprint({ ...record, asc_kg: "412.351" }, "ab")).not.toBe(fingerprint(record, "ab"));
    expect(fingerprint(record, "cd")).not.toBe(fingerprint(record, "ab"));
  });
});

describe("lot event ranges", () => {
  it("anchors the whole seeded chain by its head hash, then only what is new", async () => {
    const fake = new FakeChain();
    const chain = new ChainClient(db, fake);
    const first = nextLotEventRange(db);
    const total = db.select().from(lotEvents).all().length;
    expect(first).toMatchObject({
      refId: `LE-1-${total}`,
      prev: null,
      ledger: { fromSeq: 1, toSeq: total },
    });
    await anchorBatch(db, chain, first ? [first] : [], ctx);
    expect(fake.calls[0]).toMatchObject({ method: "anchor_batch", signerId: ctx.kevin });
    expect(nextLotEventRange(db)).toBeNull();

    const lot = db.select().from(lots).where(eq(lots.lotCode, "ASC-260921-02")).get();
    appendLotEvent(db, {
      lotId: lot?.id ?? 0,
      kind: "count_adjust",
      qtyDeltaBase: -1_000,
      facilityId: lot?.currentFacilityId ?? 0,
      actorType: "staff",
      occurredAt: ctx.now,
      reason: "cycle count",
    });
    const second = nextLotEventRange(db);
    expect(second).toMatchObject({ refId: `LE-${total + 1}-${total + 1}`, prev: first?.hash });
  });

  it("records nothing when the anchor transaction fails", async () => {
    const chain = new ChainClient(db, new FakeChain("refused"));
    const item = nextLotEventRange(db);
    await anchorBatch(db, chain, item ? [item] : [], ctx);
    expect(db.select().from(anchors).all()).toEqual([]);
  });
});

describe("verify", () => {
  it("says MATCH for the anchored record, MISMATCH after one gram changes, NOT_ANCHORED otherwise", async () => {
    const fake = new FakeChain();
    const record = { batch: "BR-B-1045", asc_kg: "412.350" };
    const hash = fingerprint(record, "ab");
    await anchorBatch(
      db,
      new ChainClient(db, fake),
      [{ kind: "batch_record", refId: "BR-B-1045", hash, prev: null, ledger: {} }],
      ctx,
    );
    const view = (v: ChainView) => fake.view(v);
    expect((await verifyAnchor(view, ctx.policyContract, "BR-B-1045", hash)).result).toBe("MATCH");
    const edited = fingerprint({ ...record, asc_kg: "412.351" }, "ab");
    expect((await verifyAnchor(view, ctx.policyContract, "BR-B-1045", edited)).result).toBe(
      "MISMATCH",
    );
    expect((await verifyAnchor(view, ctx.policyContract, "BR-B-1046", hash)).result).toBe(
      "NOT_ANCHORED",
    );
  });
});
