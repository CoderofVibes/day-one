import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEPS } from "./clean-clone.ts";
import { CLAIMS, contractClaim, markdown, scriptsUsed, wslPath } from "./prove.ts";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { scripts: Record<string, string> };

describe("the proof scorecard", () => {
  it("runs only npm scripts package.json defines", () => {
    const missing = [...scriptsUsed()].filter((n) => !(n in pkg.scripts));
    expect(missing).toEqual([]);
  });

  it("takes each shared command and its expected text from the clean-clone table", () => {
    for (const c of CLAIMS)
      for (const s of c.steps) {
        const shared = STEPS.find((x) => x.name === s.name);
        if (shared) expect(s).toBe(shared);
      }
  });

  it("gives every claim a unique id, a sentence, evidence and a command", () => {
    const ids = CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CLAIMS) {
      expect(c.claim.length).toBeGreaterThan(20);
      expect(c.evidence.length).toBeGreaterThan(10);
      expect(c.steps.length).toBeGreaterThan(0);
    }
  });

  it("covers every keyless replay the README's clean clone runs", () => {
    const used = scriptsUsed();
    for (const n of ["demo", "verify", "test:attacks", "demo:group", "sealed", "usdc"])
      expect(used.has(n)).toBe(true);
  });

  it("runs the contract tests in WSL on Windows and with cargo elsewhere", () => {
    expect(wslPath("C:\\Dev\\NEAR Hackathon")).toBe("/mnt/c/Dev/NEAR Hackathon");
    expect(contractClaim("C:\\Dev\\NEAR Hackathon", "win32").steps[0].command).toContain(
      "cd '/mnt/c/Dev/NEAR Hackathon/contracts'",
    );
    expect(contractClaim("/home/j/day-one", "linux").steps[0].command).toBe(
      "cd contracts && cargo test",
    );
  });

  it("prints one row per claim and the total", () => {
    const md = markdown(
      [
        {
          id: "a",
          claim: "A works.",
          evidence: "e",
          ok: true,
          seconds: 1,
          commands: ["npm run a"],
        },
        {
          id: "b",
          claim: "B works.",
          evidence: "e",
          ok: false,
          seconds: 1,
          commands: ["npm run b"],
          reason: "b: exit 1, expected 0",
        },
      ],
      { commit: "abc1234", skipped: ["the contract"] },
    );
    expect(md).toContain("| PASS | A works.");
    expect(md).toContain("| FAIL | B works.");
    expect(md).toContain("**Failed:** b: exit 1");
    expect(md).toContain("1 of 2 claims proved.");
    expect(md).toContain("Skipped: the contract");
  });
});
