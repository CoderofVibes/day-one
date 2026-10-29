import { readFileSync } from "node:fs";
import { ChainClient } from "@day-one/server/chain/client";
import { type Fixture, ReplayTransport } from "@day-one/server/chain/replay";
import { rebuildErp } from "@day-one/server/erp-connector/rebuild";
import { openLedger } from "@day-one/server/ledger/db";
import { seedLedger } from "@day-one/server/seed";
import { describe, expect, it } from "vitest";
import {
  type CredentialAttackFile,
  runCredentialAttacks,
  type SetupStep,
} from "./credential-attacks.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const file = (path: string) => new URL(`../../../${path}`, import.meta.url);
const SPEC = JSON.parse(
  readFileSync(file("data/attacks/credential-attacks.json"), "utf8"),
) as CredentialAttackFile;
const recording = (network = "sandbox") =>
  JSON.parse(readFileSync(file(`data/attacks/credentials-${network}.json`), "utf8")) as Fixture & {
    setup: SetupStep[];
  };

async function run(fixture: Fixture & { setup: SetupStep[] }) {
  const db = openLedger();
  seedLedger(db);
  const { connector: erp } = await rebuildErp(":memory:");
  const transport = new ReplayTransport(fixture);
  const results = await runCredentialAttacks({
    chain: new ChainClient(db, transport, () => NOW),
    erp,
    spec: SPEC,
    setup: fixture.setup,
    relayStaff: fixture.network === "testnet",
  });
  transport.assertDone();
  return results;
}

describe("the supplier-credential attacks on the recorded sandbox run", () => {
  it("shows all four failing, with the contract's reasons", async () => {
    const results = await run(recording());
    expect(results.map((r) => [r.attack, r.held])).toEqual([
      ["Revoked supplier", true],
      ["Expired supplier credential", true],
      ["Supplier selling outside its categories", true],
      ["Supplier suspended for repeated QC rejects", true],
    ]);
    expect(results[0]?.evidence[1]).toContain('"on hold: approval withdrawn by HQ"');
    expect(results[0]?.evidence[3]).toContain("Acme AP should put it on hold in the ERP.");
    expect(results[2]?.evidence[4]).toContain("is not credentialed to sell raw material");
    expect(results[3]?.evidence[5]).toMatch(/^Linda approves PO-T9304 \(success\)/);
    expect(results[3]?.evidence[6]).toContain("suspended Pacific Excipient Co. on PO-T9312");
    // Sandbox hashes are not shown as testnet explorer links.
    expect(results.flatMap((r) => r.txHashes)).toEqual([]);
  });

  it("does not pass an attack the contract let through", async () => {
    const fixture = recording();
    const forced = fixture.entries.find(
      (e) => e.type === "call" && e.request.args.po_id === "PO-T9301",
    );
    if (forced?.type !== "call") throw new Error("PO-T9301 missing from the recording");
    forced.outcome = { ...forced.outcome, status: "success", errorMessage: null };
    const results = await run(fixture);
    expect(results.map((r) => r.held)).toEqual([false, true, true, true]);
  });
});

describe("the supplier-credential attacks on the recorded testnet run", () => {
  it("shows all four failing, with testnet links and the escrow untouched", async () => {
    const results = await run(recording("testnet"));
    expect(results.every((r) => r.held)).toBe(true);
    // Three refusals, then Linda's relayed approval and Kevin's refused retry.
    expect(results.map((r) => r.txHashes.length)).toEqual([1, 1, 1, 3]);
    expect(results[3]?.evidence.at(-1)).toMatch(/in escrow, as before the first\.$/);
  });

  it("fails when the escrow moved during the attacks", async () => {
    const fixture = recording("testnet");
    const books = fixture.entries.filter(
      (e) => e.type === "view" && e.request.method === "get_budget",
    );
    const last = books.at(-1);
    if (books.length < 2 || last?.type !== "view") throw new Error("expected two budget reads");
    last.result = { budget: "0", escrowed: "9748000000" };
    const results = await run(fixture);
    expect(results.map((r) => r.held)).toEqual([true, true, true, false]);
  });
});
