import { defineConfig } from "drizzle-kit";

// Generates committed SQL migrations from src/schema.ts. After each generate, add STRICT to
// every new CREATE TABLE by hand (same rule as server/src/ledger).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./src/migrations",
  casing: "snake_case",
});
