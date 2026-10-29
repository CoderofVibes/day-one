import { describe, expect, it } from "vitest";
import { assess, type Facts, formatFindings } from "./preflight.ts";

const DOLLAR = 1_000_000n;

/** A computer and a contract ready for the recorded run. */
function ready(): Facts {
  return {
    network: "testnet",
    contract: "spend-policy.acme-holdings.testnet",
    relayer: "dayone-relayer.testnet",
    envFile: true,
    nearAiKey: true,
    nearAi: { ok: true, detail: "answered" },
    rpc: [
      { url: "https://a", ok: true, ms: 300 },
      { url: "https://b", ok: true, ms: 900 },
    ],
    signers: [
      {
        account: "kevin.plant-b.acme-holdings.testnet",
        methods: ["submit_po", "anchor_batch"],
        relayed: false,
      },
      { account: "director.plant-b.acme-holdings.testnet", methods: ["approve_po"], relayed: true },
      { account: "northgate-ingredients.testnet", methods: ["accept_po"], relayed: false },
    ],
    keys: {
      "kevin.plant-b.acme-holdings.testnet": {
        file: "kevin.fc.json",
        onChain: ["submit_po", "anchor", "anchor_batch", "open_pool"],
      },
      "director.plant-b.acme-holdings.testnet": {
        file: "director.fc.json",
        onChain: ["approve_po", "reject_po"],
      },
      "northgate-ingredients.testnet": { file: "northgate.json", onChain: "full" },
      "dayone-relayer.testnet": { file: "relayer.json", onChain: "full" },
    },
    balances: {
      "dayone-relayer.testnet": 9.9,
      "kevin.plant-b.acme-holdings.testnet": 0.98,
      "northgate-ingredients.testnet": 0.99,
    },
    pos: [
      { po: "PO-1041", onChain: false },
      { po: "PO-1042", onChain: false },
    ],
    budget: { budget: 25_000n * DOLLAR, needed: 5_762n * DOLLAR },
    kevin: { account: "kevin.plant-b.acme-holdings.testnet", active: true, present: true },
    suppliers: [
      { account: "northgate-ingredients.testnet", standing: "Approved", mayBePaid: true },
    ],
  };
}

const blocks = (f: Facts) => assess(f).filter((x) => x.level === "block");

describe("npm run preflight", () => {
  it("says ready when everything the run needs is in place", () => {
    const text = formatFindings(assess(ready()));
    expect(blocks(ready())).toEqual([]);
    expect(text).toMatch(/Ready for a live run\.\n$/);
  });

  it("stops on a PO id the contract already has, and says how to reset", () => {
    const f = ready();
    f.pos[0] = { po: "PO-1041", onChain: true };
    const [b] = blocks(f);
    expect(b?.check).toBe("PO-1041");
    expect(b?.fix).toMatch(/reset:testnet.*npm run demo/);
  });

  it("stops on a relayer that cannot pay, and warns when it runs low", () => {
    const f = ready();
    f.balances["dayone-relayer.testnet"] = 0.1;
    expect(blocks(f)[0]?.check).toMatch(/pays the staff's gas/);
    f.balances["dayone-relayer.testnet"] = 0.6;
    expect(blocks(f)).toEqual([]);
    expect(assess(f).find((x) => x.level === "warn")?.detail).toBe("0.60 NEAR, low");
  });

  it("names a key that lacks a method the run calls", () => {
    const f = ready();
    f.keys["kevin.plant-b.acme-holdings.testnet"] = {
      file: "kevin.fc.json",
      onChain: ["submit_po"],
    };
    expect(blocks(f)[0]).toMatchObject({ detail: "may not call anchor_batch" });
    f.keys["kevin.plant-b.acme-holdings.testnet"] = { file: "kevin.fc.json", onChain: null };
    expect(blocks(f)[0]?.detail).toMatch(/not a key of that account/);
  });

  it("collects keys missing from this computer into one line", () => {
    const f = ready();
    for (const k of Object.values(f.keys)) k.file = null;
    const b = blocks(f);
    expect(b).toHaveLength(1);
    expect(b[0]?.fix).toMatch(/not a git worktree/);
  });

  it("passes on the contract's verdict on a supplier held after rehearsals", () => {
    const f = ready();
    f.suppliers[0] = {
      account: "northgate-ingredients.testnet",
      standing: "Suspended",
      mayBePaid: false,
    };
    expect(blocks(f)[0]?.fix).toMatch(/reinstates/);
  });

  it("falls back quietly when one RPC is down, and stops when both are", () => {
    const f = ready();
    f.rpc[0] = { url: "https://a", ok: false, error: "fetch failed" };
    expect(blocks(f)).toEqual([]);
    expect(assess(f).find((x) => x.level === "warn")?.fix).toMatch(/falls back/);
    f.rpc[1] = { url: "https://b", ok: false, error: "fetch failed" };
    expect(blocks(f).map((b) => b.check)).toEqual(["RPC https://a", "RPC https://b"]);
  });

  it("stops without the NEAR AI key or when the service refuses it", () => {
    const f = ready();
    f.nearAi = { ok: false, detail: "answered 401 for z-ai/glm-5.3-flash" };
    expect(blocks(f)[0]?.check).toBe("NEAR AI Cloud");
    f.nearAiKey = false;
    expect(blocks(f)[0]?.check).toBe("NEAR AI Cloud key");
  });

  it("stops when the budget cannot fund the run or Kevin is paused", () => {
    const f = ready();
    f.budget = { budget: 1_000n * DOLLAR, needed: 5_762n * DOLLAR };
    f.kevin.active = false;
    expect(blocks(f).map((b) => b.check)).toEqual(["plant budget", "Kevin's policy"]);
  });
});
