import { readFileSync } from "node:fs";
import { ChainClient } from "@day-one/server/chain/client";
import { type Fixture, ReplayTransport } from "@day-one/server/chain/replay";
import { openLedger } from "@day-one/server/ledger/db";
import { describe, expect, it } from "vitest";
import { orderTotal, po1047, runUsdcOrder, USDC_TESTNET, usdcPoHash } from "./usdcOrder.ts";

const file = (path: string) => new URL(`../../../${path}`, import.meta.url);
const fixture = () =>
  JSON.parse(readFileSync(file("data/usdc/PO-1047-chain.json"), "utf8")) as Fixture;
const run = (f: Fixture) => {
  const replay = new ReplayTransport(f);
  return { replay, result: runUsdcOrder(new ChainClient(openLedger(), replay), po1047()) };
};

describe("PO-1047 in Circle testnet USDC", () => {
  it("is FICTIONAL_DATA §9's order: BUF ×2 at $9.50 from Bayfront, $19.00", () => {
    const spec = po1047();
    expect(orderTotal(spec)).toBe(19_000_000n);
    expect(spec.token).toBe(USDC_TESTNET);
    expect(usdcPoHash(spec)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replays the testnet recording: escrow funded, shipped, received, released, Bayfront paid", async () => {
    const { replay, result } = run(fixture());
    const r = await result;
    replay.assertDone();
    expect(r.ok).toBe(true);
    expect(r.staffLine).toBe("PO-1047 (pH buffer ×2, $19.00) settled in Circle USDC.");
    expect(r.steps.map((s) => s.status)).toEqual(Array(5).fill("success"));
    expect(BigInt(r.supplierAfter) - BigInt(r.supplierBefore)).toBe(19_000_000n);
    expect(r.poStatus).toBe("Released");
    expect(readFileSync(file("data/usdc/transcript.txt"), "utf8").trimEnd()).toBe(
      [r.staffLine, ...r.chainLines].join("\n"),
    );
  });

  it("every call went to the USDC deployment, and the release's callback recorded the payout", () => {
    const calls = fixture().entries.flatMap((e) => (e.type === "call" ? [e] : []));
    expect(new Set(calls.map((c) => c.request.receiverId))).toEqual(
      new Set(["spend-policy-usdc.acme-holdings.testnet"]),
    );
    expect(calls.filter((c) => c.request.viaRelayer).map((c) => c.request.method)).toEqual([
      "confirm_receipt",
      "qc_release",
    ]);
    expect(calls.at(-1)?.outcome.events.map((e) => e.event)).toContain("po_released");
  });

  it("does not call the order settled when the supplier's balance did not move", async () => {
    const f = fixture();
    const balances = f.entries.filter(
      (e) => e.type === "view" && e.request.method === "ft_balance_of",
    );
    for (const e of balances) if (e.type === "view") e.result = "0";
    const r = await run(f).result;
    expect(r.ok).toBe(false);
    expect(r.staffLine).toContain("did not settle");
    expect(r.chainLines.join("\n")).toContain("NOT PAID");
  });
});
