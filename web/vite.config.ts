import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The last full green test run on this machine (scripts/lib/test-count-reporter.ts writes it),
 * for judge mode's summary card; "null" when the suite has not run here, and the card then names
 * the command instead of a number.
 */
function testCount(): string {
  try {
    return JSON.stringify(
      JSON.parse(readFileSync(new URL("../data/runtime/test-count.json", import.meta.url), "utf8")),
    );
  } catch {
    return "null";
  }
}

// Relative base so the built folder works from any static host or sub-path. In development the
// API (npm run api, port 8787 unless PORT says otherwise) answers /api behind the Vite server.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { "import.meta.env.VITE_TEST_COUNT": JSON.stringify(testCount()) },
  server: { proxy: { "/api": `http://localhost:${process.env.PORT ?? 8787}` } },
});
