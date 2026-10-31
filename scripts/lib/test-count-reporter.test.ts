import { describe, expect, it } from "vitest";
import { filtered } from "./test-count-reporter.ts";

describe("the test-count reporter", () => {
  it("counts only a run of the whole suite", () => {
    expect(filtered(["run"])).toBe(false);
    expect(filtered(["run", "--reporter=json"])).toBe(false);
    expect(filtered([])).toBe(false);
    expect(filtered(["run", "web/src/judge.test.ts"])).toBe(true);
    expect(filtered(["judge"])).toBe(true);
  });
});
