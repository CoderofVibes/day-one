import { defineConfig } from "drizzle-kit";

// Generates committed SQL migrations from src/ledger/schema.ts. After each generate, add
// STRICT to every new CREATE TABLE by hand (see the header of schema.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/ledger/schema.ts",
  out: "./src/ledger/migrations",
  casing: "snake_case",
});
