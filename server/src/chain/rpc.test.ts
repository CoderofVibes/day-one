import { describe, expect, it } from "vitest";
import {
  isNetworkError,
  RpcUnavailableError,
  resilientProvider,
  rpcUrls,
  TESTNET_FALLBACK_RPC,
} from "./rpc.ts";

/** A stand-in endpoint: answers, refuses like a contract, fails like a network, or hangs. */
function endpoint(behaviour: "answer" | "refuse" | "down" | "hang", log: string[], name: string) {
  return {
    async callFunction(args: { method: string }) {
      log.push(`${name} ${args.method}`);
      if (behaviour === "down") throw new TypeError("fetch failed");
      if (behaviour === "refuse")
        throw new Error("Smart contract panicked: PO-1041 was already submitted.");
      if (behaviour === "hang") return new Promise(() => {});
      return `${name} answered`;
    },
  };
}

function provider(behaviours: Parameters<typeof endpoint>[0][], timeoutMs = 50) {
  const log: string[] = [];
  const urls = behaviours.map((_, i) => `https://rpc-${i}.test`);
  const p = resilientProvider(urls, {
    make: (url) => endpoint(behaviours[urls.indexOf(url)] ?? "answer", log, url.slice(8, 13)),
    viewTimeoutMs: timeoutMs,
  }) as unknown as { callFunction(a: { method: string }): Promise<unknown> };
  return { p, log };
}

describe("the RPC behind live calls", () => {
  it("tries NEAR_RPC_URL first, then the public testnet RPC", () => {
    expect(rpcUrls("testnet", undefined, { NEAR_RPC_URL: "https://mine.test" })).toEqual([
      "https://mine.test",
      TESTNET_FALLBACK_RPC,
    ]);
    expect(rpcUrls("testnet", TESTNET_FALLBACK_RPC, {})).toEqual([TESTNET_FALLBACK_RPC]);
    // A local sandbox node has no fallback.
    expect(rpcUrls("sandbox", "http://127.0.0.1:3030", {})).toEqual(["http://127.0.0.1:3030"]);
  });

  it("moves to the next endpoint when the first is down, and stays there", async () => {
    const { p, log } = provider(["down", "answer"]);
    expect(await p.callFunction({ method: "get_po" })).toBe("rpc-1 answered");
    expect(await p.callFunction({ method: "get_budget" })).toBe("rpc-1 answered");
    expect(log).toEqual(["rpc-0 get_po", "rpc-1 get_po", "rpc-1 get_budget"]);
  });

  it("passes a contract's refusal through in its own words, without trying elsewhere", async () => {
    const { p, log } = provider(["refuse", "answer"]);
    await expect(p.callFunction({ method: "get_po" })).rejects.toThrow(/already submitted/);
    expect(log).toEqual(["rpc-0 get_po"]);
  });

  it("times out an endpoint that hangs", async () => {
    const { p } = provider(["hang", "answer"], 20);
    expect(await p.callFunction({ method: "get_po" })).toBe("rpc-1 answered");
  });

  it("says in plain words when no endpoint answers", async () => {
    const { p } = provider(["down", "hang"], 20);
    const error = await p.callFunction({ method: "get_po" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcUnavailableError);
    expect((error as Error).message).toMatch(/did not answer.*NEAR_RPC_URL.*npm run preflight/);
  });

  it("tells a network failure from an answer", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } }))).toBe(
      true,
    );
    expect(isNetworkError(Object.assign(new Error("unavailable"), { cause: 503 }))).toBe(true);
    expect(isNetworkError(new Error("Smart contract panicked: no such PO"))).toBe(false);
    expect(isNetworkError("fetch failed")).toBe(false);
  });
});
