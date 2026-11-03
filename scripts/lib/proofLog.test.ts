import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchorOf, buildProofLog, flows, methodIndex, PROOF_FILE } from "./proofLog.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("PROOF.md", () => {
  it("is current: the committed file is what the recordings give (run npm run proof)", () => {
    const committed = readFileSync(join(root, PROOF_FILE), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(buildProofLog(root));
  });

  it("lists every recorded call with a transaction hash", () => {
    for (const f of flows(root)) {
      expect(f.calls.length).toBeGreaterThan(0);
      for (const c of f.calls) expect(c.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    }
  });

  it("names the contract code behind every method it lists", () => {
    const index = methodIndex(root);
    for (const f of flows(root))
      for (const c of f.calls) expect(index.has(c.method), c.method).toBe(true);
  });

  it("counts the contract's refusals as evidence, each with its message", () => {
    const refused = flows(root).flatMap((f) => f.calls.filter((c) => !c.ok));
    expect(refused.length).toBeGreaterThan(10);
    for (const c of refused) expect(c.message).toBeTruthy();
  });

  it("links headings the way GitHub anchors them", () => {
    expect(anchorOf("Group purchase: PO-G-2001")).toBe("group-purchase-po-g-2001");
    expect(anchorOf("PO-1047 in Circle testnet USDC")).toBe("po-1047-in-circle-testnet-usdc");
  });
});
