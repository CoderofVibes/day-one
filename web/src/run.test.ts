import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audienceOf, run, transactionsThrough } from "./run.ts";

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
    const refused = run.transactions.filter((t) => t.status === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.error).toContain("director approval required");
    const approve = run.transactions.find((t) => t.method === "approve_po");
    expect(approve?.paidBy).toBe("dayone-relayer.testnet");
    expect(approve?.signer).toMatch(/^director\.plant-b\./);
    expect(run.approvals[0]?.response).toBe("YES 1042");
  });
});
