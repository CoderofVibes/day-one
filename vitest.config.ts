import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees holds other sessions' checkouts (git worktree); their tests are theirs.
    exclude: [
      ...configDefaults.exclude,
      "**/dist/**",
      "**/target/**",
      "**/build/**",
      "**/.claude/**",
    ],
    // Each test file seeds its own ledger. One worker per core (28 on the dev PC) is far more
    // than the suite needs and aborted workers when Windows was short of memory (LESSONS).
    maxWorkers: 2,
    // Several tests replay a whole recorded run or sync the ERP and take 3–4 s on the dev PC; the
    // 5 s default timed two out in a Windows clean clone under load (Nov 11). A judge's slower
    // machine gets the same margin.
    testTimeout: 20_000,
    // The default output, and the count of a full green run for judge mode's summary card.
    reporters: ["default", "./scripts/lib/test-count-reporter.ts"],
  },
});
