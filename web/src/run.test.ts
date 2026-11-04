import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audienceOf, run, statusOf, transactionsThrough } from "./run.ts";

const transcript = readFileSync(
  join(import.meta.dirname, "../../data/replay/transcript.txt"),
  "utf8",
);

describe("the web UI's recorded run", () => {
  it("shows the transcript's lines, in its order", () => {
    const lines = run.steps.flatMap((s) => [...s.staff, ...s.chain.map((c) => `  ${c.line}`)]);
    expect(transcript.startsWith(`${lines.join("\n")}\n`)).toBe(true);
  });

  it("knows who sees every step, including ones the live run can add", () => {
    for (const step of run.steps) expect(audienceOf(step), step.title).toBeDefined();
    const step = (title: string) => ({ step: 0, title, staff: [], chain: [] });
    expect(audienceOf(step("Upload BR-B-1046")).name).toBe("Ray Delgado");
    expect(audienceOf(step("QC reject")).name).toBe("Priya Natarajan");
    expect(audienceOf(step("Stopped")).channel).toBe("screen");
    expect(() => audienceOf(step("Something new"))).toThrow(/No audience/);
  });

  it("names what happened at each step in a word, with its status colour", () => {
    const by = Object.fromEntries(run.steps.map((s) => [s.title, statusOf(s)]));
    expect(by["Big PO"]).toEqual({ label: "refused", tone: "refused" });
    expect(by["Small PO"]).toEqual({ label: "funded", tone: "held" });
    expect(by["Linda texts"]).toEqual({ label: "approved", tone: "ok" });
    expect(by["Kevin retries"]).toEqual({ label: "funded", tone: "held" });
    expect(by.Delivery).toEqual({ label: "quarantine", tone: "waiting" });
    expect(by["QC release"]).toEqual({ label: "released", tone: "ok" });
    expect(by.Paid).toEqual({ label: "paid", tone: "paid" });
    expect(by.Discrepancy).toEqual({ label: "for Plant A to review", tone: "waiting" });
    const step = (title: string, ...staff: string[]) => ({ step: 0, title, staff, chain: [] });
    expect(statusOf(step("Linda texts", "Linda: NO 1042 → Declined by Linda Park.")).tone).toBe(
      "refused",
    );
    expect(statusOf(step("Delivery", "Short 25 kg against PO-1042.")).label).toBe("on hold");
    expect(statusOf(step("QC reject", "Priya rejected lot X.")).tone).toBe("refused");
    expect(statusOf(step("Something new")).label).toBe("something new");
  });

  it("keeps chain words off staff screens", () => {
    for (const step of run.steps) {
      for (const line of step.staff) expect(line).not.toMatch(/\b(tx|DTUSD|gas|wallet|testnet)\b/);
    }
  });

  it("lists every transaction once, with its explorer link", () => {
    const all = transactionsThrough(run, run.steps.length - 1);
    expect(all.map((t) => t.tx.tx)).toEqual(run.transactions.map((t) => t.tx));
    expect(all).toHaveLength(run.summary.transactions);
    for (const { tx } of all) expect(tx.url).toBe(`https://testnet.nearblocks.io/txns/${tx.tx}`);
  });

  it("shows the refusal and the relayer-paid approval", () => {
    // Two refusals by design: QuickChem's quote anchor (not an approved supplier) and PO-1042.
    const refused = run.transactions.filter((t) => t.status === "refused");
    expect(refused.map((t) => t.method)).toEqual(["anchor", "submit_po"]);
    expect(refused[0]?.signer).toBe("quickchem-direct.testnet");
    expect(refused[1]?.error).toContain("director approval required");
    const approve = run.transactions.find((t) => t.method === "approve_po");
    expect(approve?.paidBy).toBe("dayone-relayer.testnet");
    expect(approve?.signer).toMatch(/^director\.plant-b\./);
    expect(run.approvals[0]?.response).toBe("YES 1042");
  });

  it("carries the verified attestation of the recorded model answers", () => {
    const a = run.attestation;
    expect(a?.ok).toBe(true);
    // BR-B-1045, Kevin's enclave-signed decision on PO-1042, and the invoice.
    expect(a?.answers.map((x) => x.task)).toEqual(["vision", "reasoning", "reasoning"]);
    for (const c of [...(a?.enclave ?? []), ...(a?.answers.flatMap((x) => x.checks) ?? [])]) {
      expect(c.status, c.name).toBe("verified");
    }
    // Hashes and signers stay behind the curtain: no staff line names them.
    for (const step of run.steps) {
      for (const line of step.staff) expect(line).not.toMatch(/sha256|enclave|attest/i);
    }
  });
});
