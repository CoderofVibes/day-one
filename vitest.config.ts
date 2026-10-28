import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**", "**/target/**", "**/build/**"],
    // Each test file seeds its own ledger. One worker per core (28 on the dev PC) is far more
    // than the suite needs and aborted workers when Windows was short of memory (LESSONS).
    maxWorkers: 2,
  },
});
