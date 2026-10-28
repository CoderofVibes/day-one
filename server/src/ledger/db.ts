// Opens the ledger: one SQLite file (or memory), foreign keys on, WAL, migrations applied.
// All database access goes through server/src/ledger so a later driver switch is one file.

import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Ledger = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

/** A migrated ledger at `file`; in memory by default (tests, replay). */
export function openLedger(file = ":memory:"): Ledger {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema, casing: "snake_case" });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
