import { describe, expect, it } from "vitest";
import { formatProblem, isCodePath, isTextPath, repoProblems, scriptFiles } from "./repo-check.ts";

// Spelled in two halves so the repo check does not report this test file as a stub.
const TODO = "TO" + "DO";

describe("the tracked repo before the freeze", () => {
  it("passes built code, data and docs", () => {
    const files = [
      {
        path: "server/src/money.ts",
        text: "export const cents = (n: number) => Math.round(n * 100);",
      },
      { path: "contracts/spend-policy/src/lib.rs", text: "pub fn submit_po() {}" },
      {
        path: "data/replay/demo-chain.json",
        text: '{"public_key":"ed25519:5XsNHR6xR8gC5PhMZ2sLFY3QZ4m6xnD9tVcQzRJ8kVhA"}',
      },
      { path: "docs/PLAN.md", text: `- [ ] ${TODO} on Nov 12: the status table` },
      { path: ".env.example", text: "NEARAI_API_KEY=\nRELAYER_KEY=ed25519:placeholder\n" },
      { path: "data/batch-records/BR-B-1045.jpg", text: null },
    ];
    expect(repoProblems(files)).toEqual([]);
  });

  it("reports a tracked key file by its name, whatever it holds", () => {
    const files = [
      { path: ".env", text: "PORT=8787\n" },
      { path: ".env.local", text: "" },
      { path: ".near-credentials/testnet/kevin.fc.json", text: "{}" },
      { path: "config/kevin.plant-b.fc.json", text: "{}" },
      { path: "certs/relay.pem", text: "" },
      { path: "config/private-keys.json", text: "{}" },
    ];
    expect(repoProblems(files).map(formatProblem)).toEqual([
      ".env: a .env file is tracked",
      ".env.local: a .env file is tracked",
      ".near-credentials/testnet/kevin.fc.json: a near-cli credentials folder is tracked",
      "config/kevin.plant-b.fc.json: a function-call key file is tracked",
      "certs/relay.pem: a private key file is tracked",
      "config/private-keys.json: a key file is tracked",
    ]);
  });

  it("finds a private key, an API key and a .env secret with their lines, naming no value", () => {
    const key = `ed25519:${"3".repeat(88)}`;
    const files = [
      { path: "scripts/demo.ts", text: `const a = 1;\nconst k = "${key}";\n` },
      {
        path: "docs/NOTES.md",
        text: `token: nearai-abc123def456ghi\nkey: sk-ant-${"a".repeat(24)}\n`,
      },
    ];
    const problems = repoProblems(files, {
      secrets: [
        { key: "NEARAI_API_KEY", value: "nearai-abc123def456ghi" },
        { key: "PORT", value: "8787" },
      ],
    });
    expect(problems.map(formatProblem)).toEqual([
      "scripts/demo.ts:2: contains a NEAR private key",
      "docs/NOTES.md:2: contains an Anthropic API key",
      "docs/NOTES.md:1: contains the value of NEARAI_API_KEY from .env",
    ]);
    expect(problems.map((p) => p.detail).join()).not.toContain("abc123");
  });

  it("reports stub markers in code but not in docs or data", () => {
    const files = [
      { path: "api/src/session.ts", text: `// ${TODO}: wire the hold\nexport {};\n` },
      { path: "erp/src/api.ts", text: 'throw new Error("not impl' + 'emented");\n' },
      { path: "contracts/spend-policy/src/lib.rs", text: "fn x() { to" + "do!() }\n" },
      { path: "web/src/App.tsx", text: '<input placeholder="Lot number" />\n' },
      { path: "docs/PLAN.md", text: `${TODO}: the status table\n` },
      { path: "data/seed/notes.json", text: `{"note":"${TODO}"}\n` },
    ];
    expect(repoProblems(files).map(formatProblem)).toEqual([
      `api/src/session.ts:1: has a ${TODO} marker`,
      "erp/src/api.ts:1: has 'not impl" + "emented'",
      "contracts/spend-policy/src/lib.rs:1: has a Rust to" + "do!/unimplemented! macro",
    ]);
  });

  it("reports an npm script that runs a missing file, relative to its package.json", () => {
    const scripts = [
      { file: "package.json", name: "demo", command: "tsx scripts/demo.ts" },
      { file: "package.json", name: "web", command: "npm run dev -w web" },
      { file: "package.json", name: "old", command: "tsx scripts/gone.ts --live && echo ok" },
      { file: "server/package.json", name: "seed", command: "tsx ./src/seed/cli.ts" },
    ];
    expect(scriptFiles(scripts[3])).toEqual(["server/src/seed/cli.ts"]);
    const exists = (p: string) => ["scripts/demo.ts", "server/src/seed/cli.ts"].includes(p);
    expect(repoProblems([], { scripts, exists }).map(formatProblem)).toEqual([
      "package.json: npm run old runs scripts/gone.ts, which does not exist",
    ]);
  });

  it("reports a folder with nothing tracked in it", () => {
    expect(repoProblems([], { emptyFolders: ["tests", "web/stale"] }).map(formatProblem)).toEqual([
      "tests: folder with nothing tracked in it",
      "web/stale: folder with nothing tracked in it",
    ]);
  });

  it("knows which paths are text and which are code", () => {
    expect(isTextPath("docs/x.md")).toBe(true);
    expect(isTextPath("data/batch-records/x.jpg")).toBe(false);
    expect(isTextPath("contracts/target/x.wasm")).toBe(false);
    expect(isCodePath("scripts/clean-clone.sh")).toBe(true);
    expect(isCodePath("README.md")).toBe(false);
    expect(isCodePath("data/replay/x.json")).toBe(false);
  });
});
