import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_STEP,
  judge,
  readmeScripts,
  STEPS,
  scriptsCovered,
  tail,
  tamperRecord,
  testsLine,
} from "./clean-clone.ts";

const readme = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");

describe("the clean-clone step table", () => {
  it("runs every numbered step and table row of the README's Try it section", () => {
    const tryIt = readme.slice(readme.indexOf("## Try it"), readme.indexOf("## What happens"));
    const listed = readmeScripts(tryIt);
    expect(listed).toContain("demo");
    expect(listed).toContain("test:attacks");
    const covered = scriptsCovered();
    expect(listed.filter((n) => !covered.has(n))).toEqual([]);
  });

  it("reads a command from a numbered step or a table row, not from prose", () => {
    const text = [
      "1. `npm ci` → installs.",
      "2. `npm run demo` → replays.",
      "| `npm run books` | the CSV |",
      "Captured by `npm run web:shot:3d` (needs Edge).",
    ].join("\n");
    expect(readmeScripts(text)).toEqual(["demo", "books"]);
  });

  it("starts with the README's numbered steps and keeps the contract step apart", () => {
    expect(STEPS.slice(0, 4).map((s) => s.name)).toEqual(["npm-ci", "demo", "verify", "tamper"]);
    expect(STEPS.map((s) => s.name)).not.toContain(CONTRACT_STEP.name);
    expect(CONTRACT_STEP.command).toContain("cargo test");
  });
});

describe("judging a step", () => {
  const demo = STEPS.find((s) => s.name === "demo");
  const tamper = STEPS.find((s) => s.name === "tamper");
  if (!demo || !tamper) throw new Error("steps missing");

  it("passes on the expected exit code and the README's closing line", () => {
    const ok = { status: 0, output: "...\nTranscript matches data/replay/transcript.txt.\n" };
    expect(judge(demo, ok)).toBeNull();
    expect(judge(tamper, { status: 1, output: "MISMATCH  BR-B-1045" })).toBeNull();
  });

  it("names the wrong exit code or the missing line", () => {
    expect(
      judge(demo, { status: 1, output: "Transcript matches data/replay/transcript.txt." }),
    ).toBe("exit 1, expected 0");
    expect(judge(demo, { status: 0, output: "Transcript differs" })).toBe(
      'output does not contain "Transcript matches data/replay/transcript.txt."',
    );
    expect(judge(tamper, { status: 0, output: "MATCH" })).toBe("exit 0, expected 1");
    expect(judge(demo, { status: null, output: "" })).toBe("exit signal, expected 0");
  });
});

describe("README step 4", () => {
  it("adds one gram to the first actual_mg and nothing else", () => {
    const record = '{"lines":[{"actual_mg": 12550000},{"actual_mg":  400}]}';
    expect(tamperRecord(record)).toBe('{"lines":[{"actual_mg": 12551000},{"actual_mg":  400}]}');
    expect(tamperRecord('{"planned_mg": 1}')).toBeNull();
  });
});

describe("reporting", () => {
  it("keeps the last lines of a failed step and Vitest's count", () => {
    const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(tail(out, 3)).toBe("line 28\nline 29\nline 30");
    expect(
      testsLine(" Test Files  40 passed (40)\n      Tests  506 passed (506)\n   Start at  01:00"),
    ).toBe("Tests  506 passed (506)");
    expect(testsLine("no vitest here")).toBeUndefined();
  });
});
