import { beforeEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import { chainTx } from "../ledger/schema.ts";
import {
  type ChainCall,
  ChainClient,
  ChainProgramError,
  type ChainTransport,
  type ChainView,
} from "./client.ts";
import { type ChainOutcome, classify, parseOutcome, type RawOutcome } from "./outcome.ts";
import { RecordingTransport, ReplayTransport } from "./replay.ts";

const POLICY = "spend-policy.acme-holdings.testnet";
const KEVIN = "kevin.plant-b.acme-holdings.testnet";
const REFUSAL = "Over Kevin's $2,500.00 limit. Sent to the approver.";

const event = (name: string, data: unknown) =>
  `EVENT_JSON:${JSON.stringify({ standard: "dayone_spend_policy", version: "1.0.0", event: name, data })}`;

/** An RPC final outcome in the shape testnet returns. */
function raw(status: unknown, logs: string[] = []): RawOutcome {
  return {
    status,
    transaction_outcome: { id: "TxHash1111", block_hash: "BlockHash1", outcome: { logs: [] } },
    receipts_outcome: [{ outcome: { logs } }, { outcome: { logs: ["not an event"] } }],
  };
}

const panic = (message: string) => ({
  Failure: {
    ActionError: {
      index: 0,
      kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${message}` } },
    },
  },
});

describe("outcome parsing", () => {
  it("decodes a success with its JSON return value and events", () => {
    const value = Buffer.from(JSON.stringify({ po_id: "PO-1041" })).toString("base64");
    const outcome = parseOutcome(
      raw({ SuccessValue: value }, [event("po_funded", { po_id: "PO-1041" })]),
      123,
    );
    expect(outcome).toEqual({
      status: "success",
      errorMessage: null,
      returnValue: { po_id: "PO-1041" },
      txHash: "TxHash1111",
      blockHeight: 123,
      events: [
        {
          standard: "dayone_spend_policy",
          version: "1.0.0",
          event: "po_funded",
          data: { po_id: "PO-1041" },
        },
      ],
    });
  });

  it("treats an empty return value as null", () => {
    expect(classify({ SuccessValue: "" }).returnValue).toBeNull();
  });

  it("calls a contract panic a refusal and keeps the readable reason", () => {
    const outcome = parseOutcome(raw(panic(REFUSAL), [event("po_refused", {})]));
    expect(outcome.status).toBe("refused");
    expect(outcome.errorMessage).toBe(REFUSAL);
    expect(outcome.events.map((e) => e.event)).toEqual(["po_refused"]);
  });

  it("reads a relayed call's status from the contract's own receipt, not the relayer's", () => {
    // The shape testnet returned for a QC release relayed before the delivery was received
    // (PO-T9501, Nov 3): the transaction succeeded, the contract's receipt panicked.
    const relayed: RawOutcome = {
      status: { SuccessValue: "" },
      transaction_outcome: { id: "TxRelay", block_hash: "Block", outcome: { logs: [] } },
      receipts_outcome: [
        {
          outcome: {
            logs: [],
            executor_id: "qc.plant-b.acme-holdings.testnet",
            status: { SuccessValue: "" },
          },
        },
        {
          outcome: {
            logs: [],
            executor_id: "spend-policy.acme-holdings.testnet",
            status: panic("PO-T9501 is Funded, not Received."),
          },
        },
        {
          outcome: {
            logs: [],
            executor_id: "dayone-relayer.testnet",
            status: { SuccessValue: "" },
          },
        },
      ],
    };
    const asRelayed = parseOutcome(relayed, 1, "spend-policy.acme-holdings.testnet");
    expect(asRelayed.status).toBe("refused");
    expect(asRelayed.errorMessage).toBe("PO-T9501 is Funded, not Received.");
    // Read without the contract's name, the same outcome looks like a success: the old bug.
    expect(parseOutcome(relayed, 1).status).toBe("success");
    // A relayed call the contract accepted stays a success.
    const ok = structuredClone(relayed);
    const contractReceipt = ok.receipts_outcome[1];
    if (contractReceipt) contractReceipt.outcome.status = { SuccessValue: "" };
    expect(parseOutcome(ok, 1, "spend-policy.acme-holdings.testnet").status).toBe("success");
  });

  it("calls anything else a failure", () => {
    const gas = {
      Failure: {
        ActionError: {
          index: 0,
          kind: { FunctionCallError: { ExecutionError: "Exceeded the prepaid gas." } },
        },
      },
    };
    expect(classify(gas).status).toBe("failed");
    const noKey = { Failure: { InvalidTxError: { InvalidAccessKeyError: "AccessKeyNotFound" } } };
    expect(classify(noKey)).toMatchObject({ status: "failed" });
    expect(classify("Unknown").status).toBe("failed");
  });
});

/** A transport that answers from a queue of outcomes, like a scripted testnet. */
class ScriptedTransport implements ChainTransport {
  readonly network = "testnet";
  readonly mode = "live" as const;
  sent: ChainCall[] = [];
  constructor(
    private readonly outcomes: (ChainOutcome | Error)[],
    private readonly views: Record<string, unknown> = {},
  ) {}
  async send(call: ChainCall) {
    this.sent.push(call);
    const next = this.outcomes.shift();
    if (!next) throw new Error("no outcome scripted");
    if (next instanceof Error) throw next;
    return next;
  }
  async view(view: ChainView) {
    return this.views[view.method];
  }
}

const success = (txHash: string): ChainOutcome => ({
  status: "success",
  txHash,
  errorMessage: null,
  events: [],
  returnValue: null,
  blockHeight: 200,
});

const refused = (txHash: string): ChainOutcome => ({
  ...parseOutcome(raw(panic(REFUSAL), [event("po_refused", { po_id: "PO-1042" })]), 201),
  txHash,
});

const submit = (poId: string, amount: string): ChainCall => ({
  kind: "submit_po",
  signerId: KEVIN,
  receiverId: POLICY,
  method: "submit_po",
  args: { po_id: poId, amount },
  related: { type: "purchase_order", id: Number(poId.slice(3)) },
});

const T = "2026-11-05T09:00:00.000Z";
let db: Ledger;
beforeEach(() => {
  db = openLedger();
});

describe("ChainClient", () => {
  it("logs a success with its hash and explorer link", async () => {
    const chain = new ChainClient(db, new ScriptedTransport([success("HashA")]), () => T);
    const out = await chain.call(submit("PO-1041", "1890000000"));
    expect(out.status).toBe("success");
    expect(out.explorerUrl).toBe("https://testnet.nearblocks.io/txns/HashA");
    const rows = db.select().from(chainTx).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: out.id,
      network: "testnet",
      mode: "live",
      kind: "submit_po",
      signerId: KEVIN,
      receiverId: POLICY,
      argsJson: JSON.stringify({ po_id: "PO-1041", amount: "1890000000" }),
      status: "success",
      txHash: "HashA",
      blockHeight: 200,
      explorerUrl: "https://testnet.nearblocks.io/txns/HashA",
      relatedType: "purchase_order",
      relatedId: 1041,
      createdAt: T,
    });
  });

  it("logs a refusal with the contract's message and events, and does not throw", async () => {
    const chain = new ChainClient(db, new ScriptedTransport([refused("HashB")]));
    const out = await chain.call(submit("PO-1042", "5150000000"));
    expect(out.status).toBe("refused");
    const row = db.select().from(chainTx).get();
    expect(row?.status).toBe("refused");
    expect(row?.errorMessage).toBe(REFUSAL);
    expect(JSON.parse(row?.eventsJson ?? "[]")[0].event).toBe("po_refused");
    expect(row?.explorerUrl).toBe("https://testnet.nearblocks.io/txns/HashB");
  });

  it("logs a transport error as failed with no hash", async () => {
    const chain = new ChainClient(db, new ScriptedTransport([new Error("fetch failed")]));
    const out = await chain.call(submit("PO-1041", "1890000000"));
    expect(out).toMatchObject({ status: "failed", txHash: null, errorMessage: "fetch failed" });
    expect(db.select().from(chainTx).get()).toMatchObject({ status: "failed", txHash: null });
  });

  it("logs a program error as failed and rethrows it", async () => {
    const chain = new ChainClient(
      db,
      new ScriptedTransport([new ChainProgramError("replay call #1 differs")]),
    );
    await expect(chain.call(submit("PO-1041", "1"))).rejects.toThrow(ChainProgramError);
    expect(db.select().from(chainTx).get()?.status).toBe("failed");
  });

  it("leaves the row pending while the call is in flight", async () => {
    let release: (o: ChainOutcome) => void = () => {};
    const slow: ChainTransport = {
      network: "testnet",
      mode: "live",
      send: () => new Promise((resolve) => (release = resolve)),
      view: async () => null,
    };
    const pending = new ChainClient(db, slow).call(submit("PO-1041", "1"));
    await Promise.resolve();
    expect(db.select().from(chainTx).get()?.status).toBe("pending");
    release(success("HashC"));
    await pending;
    expect(db.select().from(chainTx).get()?.status).toBe("success");
  });
});

describe("record and replay", () => {
  async function demo(chain: ChainClient) {
    const budget = await chain.view<{ budget: string }>({
      contractId: POLICY,
      method: "get_budget",
    });
    const a = await chain.call(submit("PO-1041", "1890000000"));
    const b = await chain.call(submit("PO-1042", "5150000000"));
    return { budget, statuses: [a.status, b.status], hashes: [a.txHash, b.txHash] };
  }

  it("replays a recorded run with the same results, hashes and log rows", async () => {
    const recorder = new RecordingTransport(
      new ScriptedTransport([success("HashA"), refused("HashB")], {
        get_budget: { budget: "25000000000" },
      }),
    );
    const live = await demo(new ChainClient(openLedger(), recorder));
    const fixture = JSON.parse(JSON.stringify(recorder.fixture(T)));

    const replay = new ReplayTransport(fixture);
    const replayed = await demo(new ChainClient(db, replay));
    replay.assertDone();

    expect(replayed).toEqual(live);
    const rows = db.select().from(chainTx).all();
    expect(rows.map((r) => [r.mode, r.status, r.txHash])).toEqual([
      ["replay", "success", "HashA"],
      ["replay", "refused", "HashB"],
    ]);
    expect(rows[1]?.errorMessage).toBe(REFUSAL);
  });

  it("refuses a call that differs from the recording", async () => {
    const recorder = new RecordingTransport(new ScriptedTransport([success("HashA")]));
    await new ChainClient(openLedger(), recorder).call(submit("PO-1041", "1890000000"));
    const chain = new ChainClient(db, new ReplayTransport(recorder.fixture(T)));
    await expect(chain.call(submit("PO-1041", "1890000001"))).rejects.toThrow(/differs/);
  });

  it("refuses calls past the end and reports unplayed calls", async () => {
    const recorder = new RecordingTransport(new ScriptedTransport([success("HashA")]));
    await new ChainClient(openLedger(), recorder).call(submit("PO-1041", "1"));
    const replay = new ReplayTransport(recorder.fixture(T));
    expect(() => replay.assertDone()).toThrow(/after 0 of 1/);
    const chain = new ChainClient(db, replay);
    await chain.call(submit("PO-1041", "1"));
    replay.assertDone();
    await expect(chain.call(submit("PO-1042", "1"))).rejects.toThrow(/no call #2/);
  });
});
