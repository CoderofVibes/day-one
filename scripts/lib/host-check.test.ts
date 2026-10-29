import { describe, expect, it } from "vitest";
import { envEntries, envSecrets, hostProblems } from "./host-check.ts";

const page = { path: "index.html", text: "<html><head></head><body></body></html>" };

describe("the static folder before it is published", () => {
  it("passes a plain replay build", () => {
    expect(hostProblems([page, { path: "assets/app.js", text: "console.log(1)" }])).toEqual([]);
  });

  it("refuses a page the API marked, or no page at all", () => {
    const marked = { path: "index.html", text: '<head><meta name="day-one-api" content="live" />' };
    expect(hostProblems([marked])[0]).toMatch(/API's marker/);
    expect(hostProblems([])[0]).toMatch(/index.html is missing/);
  });

  it("finds key shapes and .env values in any file", () => {
    const key = `ed25519:${"3".repeat(88)}`;
    const leaked = {
      path: "assets/app.js",
      text: `const k = "${key}"; const t = "nearai-abc123def456ghi";`,
    };
    const problems = hostProblems([page, leaked], ["nearai-abc123def456ghi", "short"]);
    expect(problems).toEqual([
      "assets/app.js contains a NEAR private key.",
      "assets/app.js contains a value from .env.",
    ]);
  });

  it("names the key of a leaked .env value, never the value", () => {
    const leaked = {
      path: "assets/app.js",
      text: 'fetch("https://x", {auth: "nearai-abc123def456ghi"})',
    };
    const problems = hostProblems(
      [page, leaked],
      [{ key: "NEARAI_API_KEY", value: "nearai-abc123def456ghi" }],
    );
    expect(problems).toEqual(["assets/app.js contains the value of NEARAI_API_KEY from .env."]);
    expect(problems.join()).not.toContain("abc123");
  });

  it("treats a .env value that .env.example also carries as public, keys and tokens excepted", () => {
    const example =
      "NEAR_SPEND_POLICY_ACCOUNT=spend-policy.acme-holdings.testnet\nNEAR_RPC_URL=https://test.rpc.fastnear.com\nNEARAI_API_KEY=\nRELAYER_KEY=ed25519:placeholder-not-a-key\n";
    const env =
      "NEAR_SPEND_POLICY_ACCOUNT=spend-policy.acme-holdings.testnet\nNEAR_RPC_URL=https://rpc.testnet.near.org\nNEARAI_API_KEY=nearai-abc123def456ghi\nRELAYER_KEY=ed25519:placeholder-not-a-key\n";
    expect(envSecrets(env, example)).toEqual([
      { key: "NEAR_RPC_URL", value: "https://rpc.testnet.near.org" },
      { key: "NEARAI_API_KEY", value: "nearai-abc123def456ghi" },
      { key: "RELAYER_KEY", value: "ed25519:placeholder-not-a-key" },
    ]);
    const bundle = {
      path: "assets/app.js",
      text: 'const c = "spend-policy.acme-holdings.testnet";',
    };
    expect(hostProblems([page, bundle], envSecrets(env, example))).toEqual([]);
  });

  it("does not treat short .env values (ports, modes) as secrets", () => {
    expect(
      hostProblems([{ ...page, text: `${page.text}8787 replay` }], ["8787", "replay"]),
    ).toEqual([]);
  });

  it("reads the entries out of a .env file", () => {
    expect(envEntries('# note\nNEARAI_API_KEY="abc def"\nPORT=8787\n\nEMPTY=\n')).toEqual([
      { key: "NEARAI_API_KEY", value: "abc def" },
      { key: "PORT", value: "8787" },
    ]);
  });
});
