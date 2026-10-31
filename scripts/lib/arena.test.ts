import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Arena, buildArena, readRecordings, type SuiteAttack } from "./arena.ts";

const root = resolve(import.meta.dirname, "../..");
const arena = JSON.parse(readFileSync(join(root, "web/src/data/arena.json"), "utf8")) as Arena;

// A fresh replay of the suite, as `npm run test:attacks -- --json` prints it.
function runSuite(): SuiteAttack[] {
  const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/attacks.ts", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(out.status, out.stderr).toBe(0);
  return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "{}").attacks;
}

describe("the attack arena's catalog", () => {
  it("is the fifteen cases of npm run test:attacks: names, hashes and reasons", () => {
    const suite = runSuite();
    expect(suite).toHaveLength(15);
    expect(arena.cases.map((c) => c.attack)).toEqual(suite.map((a) => a.attack));
    for (const [i, c] of arena.cases.entries()) {
      const a = suite[i] as SuiteAttack;
      expect(c.held, c.attack).toBe(true);
      expect(a.held, c.attack).toBe(true);
      expect(
        c.txs.map((t) => t.tx),
        c.attack,
      ).toEqual(a.txHashes);
      expect(
        c.txs.map((t) => t.url),
        c.attack,
      ).toEqual(a.txUrls);
      // The reason is the suite's own words: quoted in its evidence, or a line of it.
      expect(
        a.evidence.some((l) => l.includes(c.reason)),
        `${c.attack}: "${c.reason}" is not in the suite's evidence`,
      ).toBe(true);
    }
    // And the file is what buildArena makes of this run.
    expect(buildArena(suite, readRecordings(root))).toEqual(arena);
  }, 60_000);

  it("names the contract's refusal for every case with a transaction, and no hash for the rest", () => {
    for (const c of arena.cases) {
      if (c.refusedBy === "contract") {
        const refused = c.txs.find((t) => t.status === "refused");
        expect(refused?.error, c.attack).toBe(c.reason);
        expect(c.method, c.attack).toBe(refused?.method);
        expect(c.signer, c.attack).toBe(refused?.signer);
        expect(refused?.url, c.attack).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);
      } else {
        expect(c.txs, c.attack).toEqual([]);
        expect(c.method, c.attack).toBeNull();
      }
    }
    expect(arena.cases.filter((c) => c.refusedBy !== "contract").map((c) => c.attack)).toEqual([
      "Inflated invoice",
      "Hidden instructions in an invoice",
      "Duplicate invoice",
      "New bank details by email",
    ]);
  });

  it("refuses a suite that does not match its words", () => {
    const suite = arena.cases.map((c) => ({
      attack: c.attack,
      held: c.held,
      evidence: c.evidence,
      txHashes: c.txs.map((t) => t.tx),
      txUrls: c.txs.map((t) => t.url),
    }));
    expect(() => buildArena(suite.slice(1), readRecordings(root))).toThrow(
      /"Lookalike vendor" is not in the suite/,
    );
    const renamed = [{ ...(suite[0] as SuiteAttack), attack: "Something new" }, ...suite.slice(1)];
    expect(() => buildArena(renamed, readRecordings(root))).toThrow(/no words for "Something new"/);
    const forged = [
      { ...(suite[0] as SuiteAttack), txHashes: ["1".repeat(44)] },
      ...suite.slice(1),
    ];
    expect(() => buildArena(forged, readRecordings(root))).toThrow(/in no recording/);
  });
});
