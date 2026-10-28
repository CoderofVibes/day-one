// Opens the ERP's database: one SQLite file (or memory), foreign keys on, WAL, migrations
// applied. All access goes through this module so the file location is decided in one place.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Erp = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** A transaction handle or the database itself: what the posting functions accept. */
export type ErpDb = Parameters<Parameters<Erp["transaction"]>[0]>[0] | Erp;

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

/** The file `npm run erp` and `npm run erp:seed` share, relative to the repo root. */
export const ERP_DB_FILE = "data/runtime/erp.db";

/** A migrated ERP database at `file`; in memory by default (tests, the replayed demo). */
export function openErp(file = ":memory:"): Erp {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema, casing: "snake_case" });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
