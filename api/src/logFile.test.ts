import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cappedLog } from "./logFile.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "day-one-log-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the capped server log", () => {
  it("keeps one line repeated thousands of times under twice the cap", () => {
    const path = join(dir, "api.log");
    const write = cappedLog(path, 16 * 1024);
    const line = "Inbox: data/inbox/batch-records: ENOENT: no such file or directory\n";
    for (let i = 0; i < 3_000; i++) write(line); // about 200 KB written, 12 rolls
    const total = statSync(path).size + statSync(`${path}.1`).size;
    expect(statSync(path).size).toBeLessThanOrEqual(16 * 1024);
    expect(total).toBeLessThanOrEqual(32 * 1024);
    expect(readFileSync(path, "utf8").endsWith(line)).toBe(true);
  });

  it("continues a log that is already there and rolls it only at the cap", () => {
    const path = join(dir, "api.log");
    cappedLog(path, 100)("first run\n");
    const write = cappedLog(path, 100);
    write("second run\n");
    expect(readFileSync(path, "utf8")).toBe("first run\nsecond run\n");
    expect(existsSync(`${path}.1`)).toBe(false);
    write(`${"x".repeat(90)}\n`);
    expect(readFileSync(`${path}.1`, "utf8")).toBe("first run\nsecond run\n");
    expect(readFileSync(path, "utf8")).toBe(`${"x".repeat(90)}\n`);
  });
});
