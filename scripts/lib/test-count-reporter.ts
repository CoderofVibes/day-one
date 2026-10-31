// A Vitest reporter (vitest.config.ts): after a full run of the suite that passed (npm test,
// npm run check) it writes how many tests passed, and when, to data/runtime/test-count.json
// (gitignored). The web build reads it for judge mode's summary card (web/vite.config.ts), so the
// card states the count the last green run had instead of a number typed into the page. A run
// filtered to some files writes nothing.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

const root = resolve(import.meta.dirname, "../..");
export const TEST_COUNT_FILE = join(root, "data/runtime/test-count.json");

/** True when the command line names files or a filter, so the run is not the whole suite. */
export function filtered(argv: string[]): boolean {
  return argv.some((a) => !a.startsWith("-") && a !== "run");
}

export default class TestCountReporter implements Reporter {
  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<unknown>,
    reason: "passed" | "failed" | "interrupted",
  ) {
    if (reason !== "passed" || errors.length > 0 || filtered(process.argv.slice(2))) return;
    let tests = 0;
    for (const m of modules) {
      for (const t of m.children.allTests()) if (t.result().state === "passed") tests++;
    }
    mkdirSync(join(root, "data/runtime"), { recursive: true });
    writeFileSync(
      TEST_COUNT_FILE,
      `${JSON.stringify({ tests, files: modules.length, at: new Date().toISOString() })}\n`,
    );
  }
}
