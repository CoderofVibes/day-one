import { KeyPair, type KeyPairString } from "near-api-js";
import { describe, expect, it } from "vitest";
import type { ChainCall } from "../chain/client.ts";
import { plantBStaff, Relayer, type RelayerConfig, refusalReason } from "./relayer.ts";

const POLICY = "spend-policy.acme-holdings.testnet";
const DIRECTOR = "director.plant-b.acme-holdings.testnet";
const RELAYER = "dayone-relayer.testnet";
const config: RelayerConfig = {
  relayerId: RELAYER,
  policyContract: POLICY,
  staffMethods: plantBStaff(),
};

const approve: ChainCall = {
  kind: "approve_po",
  signerId: DIRECTOR,
  receiverId: POLICY,
  method: "approve_po",
  args: { po_id: "PO-1042" },
  viaRelayer: true,
};

describe("relayer allowlist", () => {
  it("carries a staff member's own methods to the spend-policy contract", () => {
    expect(refusalReason(config, approve)).toBeNull();
  });

  it("refuses unknown senders, other contracts, other methods and deposits", () => {
    expect(
      refusalReason(config, { ...approve, signerId: "kevin.plant-b.acme-holdings.testnet" }),
    ).toMatch(/not staff/);
    expect(
      refusalReason(config, { ...approve, receiverId: "dtusd.acme-holdings.testnet" }),
    ).toMatch(/only calls/);
    expect(refusalReason(config, { ...approve, method: "qc_release" })).toMatch(/may not call/);
    expect(refusalReason(config, { ...approve, depositYocto: 1n })).toMatch(/deposit/);
  });
});

describe("relay", () => {
  const keys = new Map<string, KeyPairString>([
    [DIRECTOR, KeyPair.fromRandom("ed25519").toString() as KeyPairString],
    [RELAYER, KeyPair.fromRandom("ed25519").toString() as KeyPairString],
  ]);
  const lookup = (id: string) => {
    const key = keys.get(id);
    if (!key) throw new Error(`no key for ${id}`);
    return key;
  };

  /** Just enough of a JSON-RPC provider for near-api-js to build and send transactions. */
  function fakeProvider() {
    const sent: { signerId: string; receiverId: string; actions: unknown[] }[] = [];
    const block = { header: { hash: "11111111111111111111111111111111", height: 100 } };
    const provider = {
      viewAccessKey: async () => ({
        nonce: 7n,
        permission: "FullAccess",
        block_hash: block.header.hash,
        block_height: 100,
      }),
      viewBlock: async () => block,
      sendTransactionUntil: async (signed: {
        transaction: { signerId: string; receiverId: string; actions: unknown[] };
      }) => {
        sent.push(signed.transaction);
        return {
          status: { SuccessValue: "" },
          transaction_outcome: {
            id: "RelayedHash",
            block_hash: block.header.hash,
            outcome: { logs: [] },
          },
          receipts_outcome: [],
        };
      },
    };
    return { provider, sent };
  }

  it("wraps the director's signed delegate in a transaction the relayer signs", async () => {
    const { provider, sent } = fakeProvider();
    const relayer = new Relayer(provider as never, lookup, config);
    const raw = await relayer.relay(approve);
    expect(raw.transaction_outcome.id).toBe("RelayedHash");
    expect(sent).toHaveLength(1);
    const tx = sent[0] as {
      signerId: string;
      receiverId: string;
      actions: { signedDelegate?: { delegateAction: { senderId: string; receiverId: string } } }[];
    };
    expect(tx.signerId).toBe(RELAYER);
    expect(tx.receiverId).toBe(DIRECTOR);
    const delegate = tx.actions[0]?.signedDelegate?.delegateAction;
    expect(delegate).toMatchObject({ senderId: DIRECTOR, receiverId: POLICY });
  });

  it("throws before signing anything when the allowlist says no", async () => {
    const { provider, sent } = fakeProvider();
    const relayer = new Relayer(provider as never, lookup, config);
    await expect(relayer.relay({ ...approve, method: "withdraw_budget" })).rejects.toThrow(
      /may not call/,
    );
    expect(sent).toEqual([]);
  });
});
