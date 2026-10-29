import { describe, expect, it } from "vitest";
import { envValues, hostProblems } from "./host-check.ts";

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

  it("does not treat short .env values (ports, modes) as secrets", () => {
    expect(
      hostProblems([{ ...page, text: `${page.text}8787 replay` }], ["8787", "replay"]),
    ).toEqual([]);
  });

  it("reads the values out of a .env file", () => {
    expect(envValues('# note\nNEARAI_API_KEY="abc def"\nPORT=8787\n\nEMPTY=\n')).toEqual([
      "abc def",
      "8787",
    ]);
  });
});
