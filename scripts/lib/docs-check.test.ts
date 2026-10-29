import { describe, expect, it } from "vitest";
import { type DocsRepo, docProblems, formatProblem } from "./docs-check.ts";

const repo: DocsRepo = {
  exists: (p) =>
    [
      "README.md",
      "docs",
      "docs/CONTRACTS.md",
      "docs/research/01-usdc.md",
      "scripts",
      "scripts/verify.ts",
      "scripts/clean-clone.sh",
      "server/src/ledger/schema.ts",
      "data/replay/transcript.txt",
    ].includes(p),
  ignored: (p) => p.startsWith("data/runtime/") || p === "web/dist",
  topLevel: new Set(["README.md", "docs", "scripts", "server", "data", "web"]),
  scripts: new Set(["demo", "verify", "db:generate"]),
};

describe("docs against the repo", () => {
  it("passes links, paths and commands that exist", () => {
    const text = [
      "See [the contracts](CONTRACTS.md#3-escrow) and [the brief](../README.md).",
      "Run `npm run demo`, then `npm run verify -- data/replay/transcript.txt`.",
      "`scripts/verify` and `scripts/clean-clone` are shorthand; `web/dist/` is built.",
      "`server/src/ledger/schema.ts` holds the tables; `data/runtime/erp.db` is created.",
      "`npm run db:generate -w server` and `npm run --silent verify` too.",
      "Placeholders: `npm run <command>`, `data/batch-records/*.jpg`, `.near-credentials/<account>.json`.",
      "Not paths: `z-ai/glm-5.3-flash`, https://docs.near.org/x/y, [docs](https://docs.near.org).",
    ].join("\n");
    expect(docProblems([{ path: "docs/DEMO_SCRIPT.md", text }], repo)).toEqual([]);
  });

  it("reports a broken link, a missing path and a renamed script with their lines", () => {
    const text = [
      "Links: [old](../HANDOFF.md) and [ok](CONTRACTS.md).",
      "Paths: `server/ledger/schema.ts` was moved; `scripts/verify.ts` was not.",
      "Commands: `npm run test:contracts` was never added.",
    ].join("\n");
    const problems = docProblems([{ path: "docs/DEMO_SCRIPT.md", text }], repo);
    expect(problems).toEqual([
      { file: "docs/DEMO_SCRIPT.md", line: 1, kind: "link", target: "../HANDOFF.md" },
      { file: "docs/DEMO_SCRIPT.md", line: 2, kind: "path", target: "server/ledger/schema.ts" },
      { file: "docs/DEMO_SCRIPT.md", line: 3, kind: "script", target: "npm run test:contracts" },
    ]);
    expect(problems.map(formatProblem)).toEqual([
      "docs/DEMO_SCRIPT.md:1: broken link ../HANDOFF.md",
      "docs/DEMO_SCRIPT.md:2: missing path server/ledger/schema.ts",
      "docs/DEMO_SCRIPT.md:3: no such script npm run test:contracts",
    ]);
  });

  it("reports each stale reference once per file", () => {
    const text = "`npm run test:contracts` here and `npm run test:contracts` again.";
    expect(docProblems([{ path: "README.md", text }], repo)).toHaveLength(1);
  });

  it("checks only the links of a dated record", () => {
    const text = "[gone](../gone.md); `server/ledger/old.ts`; `npm run demo-replay`.";
    const problems = docProblems([{ path: "docs/research/01-usdc.md", text }], repo);
    expect(problems.map((p) => p.kind)).toEqual(["link"]);
  });

  it("refuses a link that leaves the repo", () => {
    const text = "[outside](../../etc/passwd)";
    expect(docProblems([{ path: "docs/X.md", text }], repo)[0]?.kind).toBe("link");
  });
});
